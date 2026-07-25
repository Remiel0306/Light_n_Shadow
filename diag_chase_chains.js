/**
 * Trace OnSuccess/OnFail chains for chase MoveTos + KeepChase body.
 */
const fs = require('fs');
const { spawn } = require('child_process');

const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const AIC = '/Game/BluePrint/System/BP_EnemyAIController';

const mcp = spawn('npx.cmd', ['ue-mcp', PROJECT], { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
let id = 1;
const pending = new Map();
let buf = '';

function rpc(method, params, ms = 120000) {
  return new Promise((resolve, reject) => {
    const i = id++;
    const t = setTimeout(() => reject(new Error('timeout')), ms);
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
    clientInfo: { name: 'diag_chase_chains' },
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

  function posOf(sid) {
    const n = s2l[sid];
    return n ? [n.posX, n.posY] : null;
  }

  const exec = sum.execEdges || [];
  const data = sum.dataEdges || [];

  // BFS exec from a short id
  function chainFrom(startShort, maxDepth = 8) {
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
              depth: d,
              from: titles[e.from],
              fromPos: posOf(e.from),
              pin: e.fromPin,
              to: titles[e.to],
              toPos: posOf(e.to),
            });
            next.push(e.to);
          }
        }
      }
      cur = next;
    }
    return out;
  }

  // Find MoveTo short ids by matching long positions
  const moveLongs = (g.nodes || []).filter((n) => /AI MoveTo/i.test(n.title || ''));
  const moveShorts = [];
  for (const n of sum.nodes || []) {
    if (n.title !== 'AI MoveTo') continue;
    const long = s2l[n.id];
    moveShorts.push({
      short: n.id,
      pos: long ? [long.posX, long.posY] : null,
      longId: long?.id,
    });
  }

  const report = {};
  for (const m of moveShorts) {
    report[`MoveTo@${m.pos}`] = {
      successChain: chainFrom(m.short).filter((c) => c.depth === 0 || true),
      // only edges starting from this moveto first, then full bfs
    };
    // Better: only follow from this node
    report[`MoveTo@${m.pos}`] = chainFrom(m.short, 10);
  }

  // KeepChase custom event body
  const keepCustom = (sum.nodes || []).find((n) => {
    const long = s2l[n.id];
    return n.title === 'Keep Chase' && long && long.class === 'K2Node_CustomEvent';
  });
  // Find by class
  let keepEvShort = null;
  for (const n of sum.nodes || []) {
    if (n.title !== 'Keep Chase') continue;
    const long = s2l[n.id];
    if (long && long.class === 'K2Node_CustomEvent') keepEvShort = n.id;
  }
  // Fallback: custom event from read_graph
  const keepEvLong = (g.nodes || []).find(
    (n) => n.class === 'K2Node_CustomEvent' && /Keep Chase/i.test(n.title || '')
  );
  if (keepEvLong) {
    for (const [s, l] of Object.entries(s2l)) {
      if (l.id === keepEvLong.id) keepEvShort = s;
    }
  }

  // Data graph for predictive point at 2432,2576
  const predictiveData = data
    .filter((e) => {
      const tp = posOf(e.to);
      const fp = posOf(e.from);
      // around keepchase area y>2400
      return (tp && tp[1] > 2400) || (fp && fp[1] > 2400) || (tp && tp[1] > 2000 && tp[0] > 1200);
    })
    .map((e) => `${titles[e.from]}.${e.fromPin} -> ${titles[e.to]}.${e.toPin} @${posOf(e.to)}`);

  // Who calls KeepChase / starts chase from perception
  const callers = exec
    .filter((e) => titles[e.to] === 'Keep Chase' || titles[e.to] === 'Set isChasing')
    .map((e) => `${titles[e.from]}@${posOf(e.from)} -${e.fromPin}-> ${titles[e.to]}@${posOf(e.to)}`);

  // Print after OnSuccess - does it continue?
  const prints = (g.nodes || [])
    .filter((n) => /Print String/i.test(n.title || ''))
    .map((n) => {
      const str = (n.pins || []).find((p) => p.name === 'InString')?.defaultValue;
      return { pos: [n.posX, n.posY], str };
    });

  // Chase speeds
  let defaults = {};
  try {
    const cdo = await bp({ action: 'get_cdo_properties' });
    defaults = cdo;
  } catch (_) {}

  // Also read variable defaults via set_variable if possible
  const varList = await bp({ action: 'list_variables' });

  const out = {
    moveChains: report,
    keepEvShort,
    keepChain: keepEvShort ? chainFrom(keepEvShort, 12) : null,
    callers,
    predictiveData,
    prints,
    varList,
    defaults,
  };

  fs.writeFileSync('diag_chase_chains.out.json', JSON.stringify(out, null, 2));

  console.log('=== Callers ===');
  callers.forEach((c) => console.log(c));
  console.log('\n=== KeepChase body ===');
  (out.keepChain || []).forEach((c) =>
    console.log(`  ${'  '.repeat(c.depth)}${c.from}@${c.fromPos} -${c.pin}-> ${c.to}@${c.toPos}`)
  );
  console.log('\n=== Each MoveTo chain ===');
  for (const [k, chain] of Object.entries(report)) {
    console.log('\n' + k);
    chain.slice(0, 20).forEach((c) =>
      console.log(`  ${'  '.repeat(c.depth)}${c.from} -${c.pin}-> ${c.to}`)
    );
  }
  console.log('\n=== Prints ===');
  prints.forEach((p) => console.log(p));
  console.log('\n=== Predictive data (y>2000) sample ===');
  predictiveData.slice(0, 40).forEach((l) => console.log(l));
  mcp.kill();
})().catch((e) => {
  console.error(e);
  mcp.kill();
  process.exit(1);
});
