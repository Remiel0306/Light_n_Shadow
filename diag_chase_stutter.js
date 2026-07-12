/**
 * Diagnose chase start/stop stutter in BP_EnemyAIController.
 */
const fs = require('fs');
const { spawn } = require('child_process');

const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const AIC = '/Game/BluePrint/System/BP_EnemyAIController';

const mcp = spawn('npx.cmd', ['ue-mcp', PROJECT], { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
let id = 1;
const pending = new Map();
let buf = '';

function rpc(method, params, ms = 180000) {
  return new Promise((resolve, reject) => {
    const i = id++;
    const t = setTimeout(() => {
      pending.delete(i);
      reject(new Error(`timeout ${method}`));
    }, ms);
    pending.set(i, (msg) => {
      clearTimeout(t);
      resolve(msg);
    });
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n');
  });
}

mcp.stdout.on('data', (d) => {
  buf += d.toString();
  const lines = buf.split('\n');
  buf = lines.pop();
  for (const line of lines) {
    try {
      const msg = JSON.parse(line);
      const cb = pending.get(msg.id);
      if (cb) cb(msg);
    } catch (_) {}
  }
});

function parse(res) {
  try {
    return JSON.parse(res?.result?.content?.[0]?.text);
  } catch {
    return res;
  }
}

async function bp(args) {
  return parse(
    await rpc('tools/call', {
      name: 'blueprint',
      arguments: { path: AIC, assetPath: AIC, ...args },
    })
  );
}

function titleOf(n) {
  return (n.title || '').replace(/\n/g, ' | ');
}

(async () => {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'diag_chase_stutter' },
  });

  const sum = await bp({ action: 'read_graph_summary', graphName: 'EventGraph' });
  const g = await bp({ action: 'read_graph', graphName: 'EventGraph' });
  const titles = Object.fromEntries((sum.nodes || []).map((n) => [n.id, n.title]));

  // Map short->long by title order
  const longs = {};
  for (const n of g.nodes || []) {
    const t = (n.title || '').split('\n')[0].trim();
    (longs[t] = longs[t] || []).push(n);
  }
  const shorts = {};
  for (const n of sum.nodes || []) {
    (shorts[n.title] = shorts[n.title] || []).push(n.id);
  }
  const s2l = {};
  for (const t of Object.keys(shorts)) {
    if ((longs[t] || []).length === shorts[t].length) {
      shorts[t].forEach((s, i) => {
        s2l[s] = longs[t][i];
      });
    }
  }

  const moveTos = (g.nodes || [])
    .filter((n) => /AI MoveTo/i.test(n.title || ''))
    .map((n) => {
      const pins = {};
      for (const p of n.pins || []) {
        if (
          /Pawn|Destination|TargetActor|Acceptance|OnSuccess|OnFail|execute|bStopOnOverlap/i.test(
            p.name
          )
        ) {
          pins[p.name] = { connected: p.connected, default: p.defaultValue };
        }
      }
      return { id: n.id, x: n.posX, y: n.posY, pins };
    });

  // Data edges into each MoveTo
  const moveData = [];
  for (const e of sum.dataEdges || []) {
    if (titles[e.to] === 'AI MoveTo') {
      const fromLong = s2l[e.from];
      const toLong = s2l[e.to];
      moveData.push({
        from: titles[e.from],
        fromPin: e.fromPin,
        toPin: e.toPin,
        fromTitleDetail: fromLong ? titleOf(fromLong) : titles[e.from],
        toPos: toLong ? [toLong.posX, toLong.posY] : null,
      });
    }
  }

  // Exec edges involving MoveTo, KeepChase, Wander, Delay, Perception, isChasing
  const execInteresting = (sum.execEdges || [])
    .map((e) => ({
      from: titles[e.from],
      fromPin: e.fromPin,
      to: titles[e.to],
      toPin: e.toPin,
    }))
    .filter((e) =>
      /MoveTo|KeepChase|Keep Chase|Wander|Delay|Perception|isChasing|Branch|Print|Set MaxWalkSpeed/i.test(
        `${e.from} ${e.to}`
      )
    );

  // Delay durations
  const delays = (g.nodes || [])
    .filter((n) => /^Delay/i.test((n.title || '').split('\n')[0]))
    .map((n) => ({
      id: n.id,
      pos: [n.posX, n.posY],
      duration: (n.pins || []).find((p) => p.name === 'Duration')?.defaultValue,
    }));

  // Set isChasing values
  const setChase = (g.nodes || [])
    .filter((n) => /Set isChasing/i.test(n.title || ''))
    .map((n) => ({
      id: n.id,
      pos: [n.posX, n.posY],
      val: (n.pins || []).find((p) => p.name === 'isChasing')?.defaultValue,
    }));

  // Perception-related component props if readable
  let sight = null;
  try {
    sight = await bp({
      action: 'read_component_properties',
      componentName: 'AIPerception',
    });
  } catch (_) {}

  const findings = [];

  // Analyze MoveTo targets
  for (const m of moveData) {
    if (m.toPin === 'TargetActor' && /Enemy Ref/i.test(m.from)) {
      findings.push({
        severity: 'critical',
        issue: 'AI MoveTo TargetActor 接到 Enemy Ref（自己），會立刻 Success，造成跑跑停停/原地循環',
        detail: m,
      });
    }
    if (m.toPin === 'TargetActor' && /Player/i.test(m.from)) {
      findings.push({
        severity: 'ok',
        issue: 'AI MoveTo TargetActor 接到 Player',
        detail: m,
      });
    }
    if (m.toPin === 'Pawn' && /Enemy Ref/i.test(m.from)) {
      findings.push({ severity: 'ok', issue: 'Pawn = Enemy Ref', detail: m });
    }
  }

  // Acceptance radius
  for (const m of moveTos) {
    const ar = m.pins.AcceptanceRadius?.default;
    if (ar && parseFloat(ar) >= 80) {
      findings.push({
        severity: 'warn',
        issue: `Acceptance Radius=${ar} 偏大，玩家在邊界晃會一直 Success/重追 → 跑跑停停`,
        detail: m,
      });
    }
  }

  // Fail path without delay to KeepChase
  for (const e of execInteresting) {
    if (e.from === 'AI MoveTo' && e.fromPin === 'OnFail' && /KeepChase|Keep Chase/i.test(e.to)) {
      findings.push({
        severity: 'warn',
        issue: 'On Fail 直接 KeepChase 無 Delay，失敗時會高速重試造成頓挫',
        detail: e,
      });
    }
    if (e.from === 'AI MoveTo' && e.fromPin === 'OnSuccess' && /KeepChase|Keep Chase/i.test(e.to)) {
      findings.push({
        severity: 'info',
        issue: 'On Success 接到 KeepChase（持續追）',
        detail: e,
      });
    }
    if (e.from === 'AI MoveTo' && e.fromPin === 'OnFail' && /Wander/i.test(e.to)) {
      findings.push({
        severity: 'critical',
        issue: '追擊 On Fail 接到 Wander → 追一下又回去亂走 = 跑跑停停',
        detail: e,
      });
    }
    if (e.from === 'AI MoveTo' && e.fromPin === 'OnSuccess' && /Wander/i.test(e.to)) {
      findings.push({
        severity: 'critical',
        issue: '追擊 On Success 接到 Wander',
        detail: e,
      });
    }
  }

  // Count MoveTo nodes - multiple can fight
  if (moveTos.length >= 2) {
    findings.push({
      severity: 'warn',
      issue: `EventGraph 有 ${moveTos.length} 個 AI MoveTo，若 Wander+Chase 同時下指令會互相取消造成跑停`,
      detail: moveTos.map((m) => ({ id: m.id, pos: [m.x, m.y], pins: m.pins })),
    });
  }

  // Success delay very short
  for (const d of delays) {
    if (parseFloat(d.duration) <= 0.05) {
      findings.push({
        severity: 'warn',
        issue: `Delay=${d.duration} 太短，Success 後幾乎立刻重下 MoveTo，路徑一直被取消會頓挫`,
        detail: d,
      });
    }
  }

  const out = {
    findings,
    moveTos,
    moveData,
    delays,
    setChase,
    execInteresting,
    sightSummary: sight
      ? {
          success: sight.success,
          keys: Object.keys(sight.properties || sight || {}).slice(0, 40),
        }
      : null,
    nodeTitles: (sum.nodes || []).map((n) => n.title),
  };

  fs.writeFileSync('diag_chase_stutter.out.json', JSON.stringify(out, null, 2));
  console.log('=== FINDINGS ===');
  for (const f of findings) {
    console.log(`[${f.severity}] ${f.issue}`);
  }
  console.log('\n=== MoveTo data pins ===');
  for (const m of moveData) {
    console.log(`  ${m.from}.${m.fromPin} -> MoveTo.${m.toPin} @ ${m.toPos}`);
  }
  console.log('\n=== Delays ===');
  console.log(delays);
  console.log('\n=== Key exec ===');
  for (const e of execInteresting.filter((x) => /MoveTo|KeepChase|Keep Chase|Wander/i.test(`${x.from}${x.to}`))) {
    console.log(`  ${e.from} -${e.fromPin}-> ${e.to}`);
  }
  mcp.kill();
})().catch((e) => {
  console.error(e);
  mcp.kill();
  process.exit(1);
});
