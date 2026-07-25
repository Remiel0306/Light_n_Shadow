/**
 * Re-scan chase stutter after user fixes.
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
      reject(new Error('timeout'));
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

(async () => {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'rescan_stutter' },
  });

  const sum = await bp({ action: 'read_graph_summary', graphName: 'EventGraph' });
  const g = await bp({ action: 'read_graph', graphName: 'EventGraph' });
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

  function pos(sid) {
    const n = s2l[sid];
    return n ? [n.posX, n.posY] : null;
  }

  const exec = sum.execEdges || [];
  const data = sum.dataEdges || [];

  function chainFrom(startShort, maxDepth = 12) {
    const out = [];
    let cur = [startShort];
    const seen = new Set();
    for (let d = 0; d < maxDepth && cur.length; d++) {
      const next = [];
      for (const sid of cur) {
        if (seen.has(sid)) continue;
        seen.add(sid);
        for (const e of exec) {
          if (e.from === sid) {
            out.push({
              d,
              from: titles[e.from],
              fromPos: pos(e.from),
              pin: e.fromPin,
              to: titles[e.to],
              toPos: pos(e.to),
            });
            next.push(e.to);
          }
        }
      }
      cur = next;
    }
    return out;
  }

  // All MoveTos
  const moveTos = (g.nodes || [])
    .filter((n) => /AI MoveTo/i.test(n.title || ''))
    .map((n) => {
      const pin = (name) => (n.pins || []).find((p) => p.name === name);
      // find short id
      let short = null;
      for (const [s, l] of Object.entries(s2l)) {
        if (l.id === n.id) short = s;
      }
      const inputs = data
        .filter((e) => e.to === short)
        .map((e) => `${titles[e.from]}.${e.fromPin}->${e.toPin}`);
      return {
        pos: [n.posX, n.posY],
        short,
        AR: pin('AcceptanceRadius')?.defaultValue,
        TargetActor: pin('TargetActor')?.connected,
        Destination: pin('Destination')?.connected,
        OnSuccess: pin('OnSuccess')?.connected,
        OnFail: pin('OnFail')?.connected,
        inputs,
        chain: short ? chainFrom(short, 10) : [],
      };
    });

  // KeepChase custom event
  const keepEv = (g.nodes || []).find(
    (n) => n.class === 'K2Node_CustomEvent' && /Keep Chase/i.test(n.title || '')
  );
  let keepShort = null;
  if (keepEv) {
    for (const [s, l] of Object.entries(s2l)) {
      if (l.id === keepEv.id) keepShort = s;
    }
  }

  // Delays near chase
  const delays = (g.nodes || [])
    .filter((n) => /^Delay/i.test((n.title || '').split('\n')[0]))
    .map((n) => ({
      pos: [n.posX, n.posY],
      dur: (n.pins || []).find((p) => p.name === 'Duration')?.defaultValue,
    }));

  // Who starts KeepChase / perception path into chase
  const intoKeep = exec
    .filter((e) => titles[e.to] === 'Keep Chase')
    .map((e) => `${titles[e.from]}@${pos(e.from)} -${e.fromPin}-> KeepChase@${pos(e.to)}`);

  // Perception / first chase path
  const perc = exec
    .filter((e) => {
      const a = `${titles[e.from]} ${titles[e.to]}`;
      return /Perception|isChasing|Keep Chase|Set MaxWalkSpeed|AI MoveTo/i.test(a);
    })
    .map((e) => `${titles[e.from]}@${pos(e.from)} -${e.fromPin}-> ${titles[e.to]}@${pos(e.to)}`);

  // Count simultaneous chase MoveTos
  const chaseMoves = moveTos.filter((m) => m.TargetActor || (m.Destination && !m.inputs.some((i) => /Random/i.test(i))));

  const findings = [];

  if (chaseMoves.length >= 2) {
    findings.push({
      sev: 'critical',
      msg: `仍有 ${chaseMoves.length} 顆追擊用 AI MoveTo，會互相取消路徑 → 跑跑頓一下`,
    });
  }

  for (const m of chaseMoves) {
    const successToKeep = m.chain.some(
      (c) => c.pin === 'OnSuccess' || (c.d > 0 && /Keep Chase/i.test(c.to))
    );
    // more precise: follow OnSuccess path specifically
    const successEdges = m.chain.filter((c) => c.d === 0 && c.pin === 'OnSuccess');
    const failEdges = m.chain.filter((c) => c.d === 0 && c.pin === 'OnFail');

    findings.push({
      sev: 'info',
      msg: `MoveTo@${m.pos} AR=${m.AR} TargetActor=${m.TargetActor} Dest=${m.Destination} OnSuccess→${successEdges.map((e) => e.to).join(',')} OnFail→${failEdges.map((e) => e.to).join(',')} inputs=[${m.inputs.join('; ')}]`,
    });

    // Does OnSuccess eventually reach KeepChase?
    const fromSuccess = new Set();
    // BFS only along edges reachable from success child
    if (m.short) {
      const successChildren = exec.filter((e) => e.from === m.short && e.fromPin === 'OnSuccess').map((e) => e.to);
      let cur = successChildren;
      const seen = new Set();
      let hitKeep = false;
      let hitWander = false;
      let hitPrint = false;
      const path = [];
      for (let d = 0; d < 12 && cur.length; d++) {
        const next = [];
        for (const s of cur) {
          if (seen.has(s)) continue;
          seen.add(s);
          path.push(titles[s]);
          if (/Keep Chase/i.test(titles[s] || '')) hitKeep = true;
          if (/Wander/i.test(titles[s] || '')) hitWander = true;
          if (/Print/i.test(titles[s] || '')) hitPrint = true;
          for (const e of exec) if (e.from === s) next.push(e.to);
        }
        cur = next;
      }
      if (!hitKeep && m.Destination) {
        findings.push({
          sev: 'critical',
          msg: `KeepChase MoveTo@${m.pos} OnSuccess 鏈沒到 KeepChase（${path.join('→')}）→ 每到一個前方點就刹停再等別處重啟 = 頓挫`,
        });
      } else if (hitKeep) {
        // check delay duration on success path
        findings.push({
          sev: 'ok',
          msg: `MoveTo@${m.pos} OnSuccess 有到 KeepChase：${path.join('→')}`,
        });
      }
      if (hitPrint && path[0] && /Print/i.test(path[0])) {
        findings.push({
          sev: 'warn',
          msg: `MoveTo@${m.pos} OnSuccess 先接 Print：${path.slice(0, 5).join('→')}`,
        });
      }
    }

    if (parseFloat(m.AR) >= 30) {
      findings.push({
        sev: 'warn',
        msg: `MoveTo@${m.pos} AcceptanceRadius=${m.AR} 仍偏大，靠近點會提前 Success+刹車`,
      });
    }
  }

  // Delay 0.01 or very short on chase path
  for (const d of delays) {
    if (d.pos[1] > 1400 && parseFloat(d.dur) <= 0.05) {
      findings.push({
        sev: 'warn',
        msg: `追擊區 Delay@${d.pos}=${d.dur} 太短，重下 MoveTo 會取消上一路徑造成頓挫`,
      });
    }
    if (d.pos[1] > 1400 && parseFloat(d.dur) >= 0.15 && parseFloat(d.dur) <= 0.5) {
      findings.push({
        sev: 'info',
        msg: `追擊區 Delay@${d.pos}=${d.dur}（每次重下前的空隙，可能造成可見頓一下）`,
      });
    }
  }

  // Perception also calling MoveTo while KeepChase runs?
  const firstSeeMove = chaseMoves.filter((m) => m.TargetActor);
  if (firstSeeMove.length && chaseMoves.some((m) => m.Destination)) {
    findings.push({
      sev: 'critical',
      msg: '同時有 TargetActor 追擊 + Destination 前方點追擊，兩套會互搶 → 跑跑頓',
    });
  }

  const out = {
    findings,
    moveTos,
    intoKeep,
    keepChain: keepShort ? chainFrom(keepShort, 12) : null,
    delays,
    percSample: perc.slice(0, 40),
  };

  fs.writeFileSync('rescan_stutter.out.json', JSON.stringify(out, null, 2));
  console.log('=== FINDINGS ===');
  findings.forEach((f) => console.log(`[${f.sev}] ${f.msg}`));
  console.log('\n=== into KeepChase ===');
  intoKeep.forEach((l) => console.log(l));
  console.log('\n=== KeepChase body ===');
  (out.keepChain || []).forEach((c) =>
    console.log(`${'  '.repeat(c.d)}${c.from}@${c.fromPos} -${c.pin}-> ${c.to}@${c.toPos}`)
  );
  console.log('\n=== Delays ===');
  delays.forEach((d) => console.log(d));
  mcp.kill();
})().catch((e) => {
  console.error(e);
  mcp.kill();
  process.exit(1);
});
