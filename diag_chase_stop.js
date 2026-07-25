/**
 * Diagnose why chase stops at first-seen position / slows near player.
 */
const fs = require('fs');
const { spawn } = require('child_process');

const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const AIC = '/Game/BluePrint/System/BP_EnemyAIController';
const ENEMY = '/Game/BluePrint/Enemy/BP_EnemyShadowLogic';

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

async function bp(path, args) {
  return parse(
    await rpc('tools/call', {
      name: 'blueprint',
      arguments: { path, assetPath: path, ...args },
    })
  );
}

(async () => {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'diag_chase_stop' },
  });

  const sum = await bp(AIC, { action: 'read_graph_summary', graphName: 'EventGraph' });
  const g = await bp(AIC, { action: 'read_graph', graphName: 'EventGraph' });
  const titles = Object.fromEntries((sum.nodes || []).map((n) => [n.id, n.title]));

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

  function info(sid) {
    const n = s2l[sid];
    return {
      title: titles[sid],
      pos: n ? [n.posX, n.posY] : null,
      id: n?.id || sid,
    };
  }

  const edges = (sum.execEdges || []).map((e) => ({
    from: info(e.from),
    fromPin: e.fromPin,
    to: info(e.to),
    toPin: e.toPin,
  }));

  const dataEdges = (sum.dataEdges || []).map((e) => ({
    from: titles[e.from],
    fromPin: e.fromPin,
    to: titles[e.to],
    toPin: e.toPin,
    fromPos: s2l[e.from] ? [s2l[e.from].posX, s2l[e.from].posY] : null,
    toPos: s2l[e.to] ? [s2l[e.to].posX, s2l[e.to].posY] : null,
  }));

  const moveTos = (g.nodes || [])
    .filter((n) => /AI MoveTo/i.test(n.title || ''))
    .map((n) => {
      const pin = (name) => (n.pins || []).find((p) => p.name === name);
      return {
        id: n.id,
        pos: [n.posX, n.posY],
        AcceptanceRadius: pin('AcceptanceRadius'),
        TargetActor: pin('TargetActor'),
        Destination: pin('Destination'),
        Pawn: pin('Pawn'),
        OnSuccess: pin('OnSuccess'),
        OnFail: pin('OnFail'),
        bStopOnOverlap: pin('bStopOnOverlap'),
      };
    });

  // Data into each MoveTo
  const moveInputs = dataEdges.filter((e) => e.to === 'AI MoveTo');

  const chaseRelated = edges.filter((e) =>
    /KeepChase|Keep Chase|MoveTo|Wander|isChasing|Perception|Delay|Velocity|Normalize|Make Vector|vector \+|Vector \+|Get Actor Location|MaxWalkSpeed/i.test(
      `${e.from.title} ${e.to.title}`
    )
  );

  const velocityRelated = (g.nodes || [])
    .filter((n) =>
      /Velocity|Normalize|vector \+|Vector \+|Get Actor Location|Get Actor Forward|Make Vector|Multiply|KeepChase|Keep Chase/i.test(
        n.title || ''
      )
    )
    .map((n) => ({
      title: (n.title || '').replace(/\n/g, ' | '),
      pos: [n.posX, n.posY],
      class: n.class,
    }));

  // Speeds from vars
  const vars = await bp(AIC, { action: 'list_variables' });
  const speedDefaults = {};
  for (const v of vars.variables || []) {
    if (/Speed|Chase|Wander|Sight|isChasing/i.test(v.name)) {
      try {
        speedDefaults[v.name] = await bp(AIC, {
          action: 'get_cdo_properties',
        });
      } catch (_) {}
    }
  }

  let cdo = null;
  try {
    cdo = await bp(AIC, { action: 'get_cdo_properties' });
  } catch (_) {}

  let enemyMove = null;
  try {
    enemyMove = await bp(ENEMY, {
      action: 'get_component_property',
      componentName: 'CharMoveComp',
      propertyName: 'MaxWalkSpeed',
    });
  } catch (_) {}

  // For each MoveTo classify chase vs wander by inputs
  const classified = moveTos.map((m) => {
    const inputs = moveInputs.filter(
      (e) => e.toPos && e.toPos[0] === m.pos[0] && e.toPos[1] === m.pos[1]
    );
    // fallback: all move inputs if pos match fails - use nearby
    const nearby = moveInputs.filter((e) => {
      if (!e.toPos) return false;
      return Math.abs(e.toPos[0] - m.pos[0]) < 5 && Math.abs(e.toPos[1] - m.pos[1]) < 5;
    });
    return {
      ...m,
      inputs: nearby.length ? nearby : inputs,
      outs: chaseRelated.filter(
        (e) =>
          e.from.title === 'AI MoveTo' &&
          e.from.pos &&
          Math.abs(e.from.pos[0] - m.pos[0]) < 5 &&
          Math.abs(e.from.pos[1] - m.pos[1]) < 5
      ),
    };
  });

  const findings = [];

  for (const m of classified) {
    const hasDest = m.Destination?.connected;
    const hasTarget = m.TargetActor?.connected;
    const ar = parseFloat(m.AcceptanceRadius?.defaultValue || '0');
    const inFrom = m.inputs.map((i) => `${i.from}.${i.fromPin}->${i.toPin}`).join('; ');
    const outStr = m.outs.map((o) => `${o.fromPin}->${o.to.title}`).join('; ');

    if (hasDest && !hasTarget) {
      // static destination - if from Get Actor Location of player at sense time without refresh = freeze at seen pos
      const fromLoc = m.inputs.some((i) => /Actor Location|Get Actor Location/i.test(i.from));
      const fromRandom = m.inputs.some((i) => /Random Reachable/i.test(i.from));
      const fromVel = m.inputs.some((i) => /Velocity|Normalize|Forward|vector \+|Vector \+/i.test(i.from));
      if (fromRandom) {
        findings.push({
          sev: 'info',
          msg: `MoveTo@${m.pos} 是亂走（Random point） AR=${ar}`,
        });
      } else if (fromLoc && !fromVel) {
        findings.push({
          sev: 'critical',
          msg: `MoveTo@${m.pos} 用 Destination=某個 Actor Location，且沒有 Velocity 前方點。若只在「第一次看到」時算一次，就會衝到「看見當下的位置」就停。 inputs=[${inFrom}] outs=[${outStr}] AR=${ar}`,
        });
      } else if (fromVel) {
        findings.push({
          sev: 'ok',
          msg: `MoveTo@${m.pos} 似乎有前方點/速度偏移 inputs=[${inFrom}] outs=[${outStr}] AR=${ar}`,
        });
      } else {
        findings.push({
          sev: 'warn',
          msg: `MoveTo@${m.pos} 只有 Destination、無 TargetActor。可能追死點。 inputs=[${inFrom}] outs=[${outStr}] AR=${ar}`,
        });
      }
    }
    if (hasTarget) {
      findings.push({
        sev: 'ok',
        msg: `MoveTo@${m.pos} TargetActor 有接。inputs=[${inFrom}] outs=[${outStr}] AR=${ar}`,
      });
    }
    if (!m.OnSuccess?.connected && hasTarget) {
      findings.push({
        sev: 'critical',
        msg: `追擊 MoveTo@${m.pos} OnSuccess 沒接 → 進 Acceptance(${ar}) 就停，玩家跑掉就會「減速停下然後你一直逃」`,
      });
    }
    if (!m.OnFail?.connected && (hasTarget || (hasDest && !m.inputs.some((i) => /Random/i.test(i.from))))) {
      findings.push({
        sev: 'warn',
        msg: `MoveTo@${m.pos} OnFail 沒接 → 失敗後可能整段追擊斷掉`,
      });
    }
    if (ar >= 50 && hasTarget) {
      findings.push({
        sev: 'warn',
        msg: `MoveTo@${m.pos} AcceptanceRadius=${ar} 偏大 → 靠近就當 Success 並刹車`,
      });
    }
  }

  // KeepChase loop check
  const keepEdges = edges.filter(
    (e) => /KeepChase|Keep Chase/i.test(e.from.title || '') || /KeepChase|Keep Chase/i.test(e.to.title || '')
  );
  if (!keepEdges.length) {
    findings.push({
      sev: 'critical',
      msg: '找不到 KeepChase 相關執行線 → 追擊可能只下一次 MoveTo',
    });
  }

  // Success -> nothing vs KeepChase
  for (const e of edges) {
    if (e.from.title === 'AI MoveTo' && e.fromPin === 'OnSuccess') {
      if (/Wander/i.test(e.to.title || '')) {
        findings.push({ sev: 'critical', msg: `追擊/移動 OnSuccess 接到 Wander @${e.from.pos}` });
      }
      if (!e.to.title) {
        findings.push({ sev: 'critical', msg: 'OnSuccess 接到空?' });
      }
    }
  }

  const out = {
    findings,
    classified,
    keepEdges: keepEdges.map((e) => `${e.from.title}@${e.from.pos} -${e.fromPin}-> ${e.to.title}@${e.to.pos}`),
    chaseRelated: chaseRelated.map(
      (e) => `${e.from.title}@${e.from.pos} -${e.fromPin}-> ${e.to.title}@${e.to.pos}`
    ),
    velocityRelated,
    moveInputs,
    vars: vars.variables,
    enemyMaxWalkSpeed: enemyMove,
    cdoSnippet: cdo,
  };

  fs.writeFileSync('diag_chase_stop.out.json', JSON.stringify(out, null, 2));
  console.log('=== FINDINGS ===');
  for (const f of findings) console.log(`[${f.sev}] ${f.msg}`);
  console.log('\n=== KeepChase ===');
  keepEdges.forEach((e) =>
    console.log(`${e.from.title}@${e.from.pos} -${e.fromPin}-> ${e.to.title}@${e.to.pos}`)
  );
  console.log('\n=== Move inputs ===');
  moveInputs.forEach((e) => console.log(`${e.from}.${e.fromPin} -> ${e.to}.${e.toPin} @${e.toPos}`));
  console.log('\n=== Velocity-ish nodes ===');
  velocityRelated.forEach((n) => console.log(`${n.title} @${n.pos}`));
  mcp.kill();
})().catch((e) => {
  console.error(e);
  mcp.kill();
  process.exit(1);
});
