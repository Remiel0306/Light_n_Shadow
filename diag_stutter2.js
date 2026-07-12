/**
 * Deeper stutter diagnosis: KeepChase / Wander conflict edges.
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
    clientInfo: { name: 'diag_stutter2' },
  });

  const sum = await bp({ action: 'read_graph_summary', graphName: 'EventGraph' });
  const g = await bp({ action: 'read_graph', graphName: 'EventGraph' });
  const titles = Object.fromEntries((sum.nodes || []).map((n) => [n.id, n.title]));

  // All exec edges with positions via long map
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

  function info(shortId) {
    const n = s2l[shortId];
    if (!n) return { title: titles[shortId], shortId };
    return {
      title: titles[shortId],
      shortId,
      longId: n.id,
      pos: [n.posX, n.posY],
    };
  }

  const edges = (sum.execEdges || []).map((e) => ({
    from: info(e.from),
    fromPin: e.fromPin,
    to: info(e.to),
    toPin: e.toPin,
  }));

  // Focus KeepChase related
  const keep = edges.filter(
    (e) =>
      /KeepChase|Keep Chase/i.test(e.from.title || '') ||
      /KeepChase|Keep Chase/i.test(e.to.title || '')
  );

  // Focus each AI MoveTo by Y position
  const moveEdges = edges.filter((e) => e.from.title === 'AI MoveTo' || e.to.title === 'AI MoveTo');

  // Perception path
  const perc = edges.filter(
    (e) =>
      /Perception|Successfully|isChasing|Set isChasing/i.test(`${e.from.title} ${e.to.title}`) ||
      (e.from.title === 'Branch' && e.to.title === 'Set isChasing')
  );

  // Wander start gates
  const wander = edges.filter(
    (e) => /Wander/i.test(e.from.title || '') || /Wander/i.test(e.to.title || '')
  );

  // MoveTo pin details full
  const moveDetails = (g.nodes || [])
    .filter((n) => /AI MoveTo/i.test(n.title || ''))
    .map((n) => ({
      pos: [n.posX, n.posY],
      AcceptanceRadius: (n.pins || []).find((p) => p.name === 'AcceptanceRadius'),
      TargetActor: (n.pins || []).find((p) => p.name === 'TargetActor'),
      Destination: (n.pins || []).find((p) => p.name === 'Destination'),
      OnSuccess: (n.pins || []).find((p) => p.name === 'OnSuccess'),
      OnFail: (n.pins || []).find((p) => p.name === 'OnFail'),
    }));

  const out = { keep, moveEdges, wander, moveDetails };
  fs.writeFileSync('diag_stutter2.out.json', JSON.stringify(out, null, 2));

  console.log('--- KeepChase edges ---');
  keep.forEach((e) =>
    console.log(
      `${e.from.title}@${e.from.pos} -${e.fromPin}-> ${e.to.title}@${e.to.pos}`
    )
  );
  console.log('--- MoveTo edges ---');
  moveEdges.forEach((e) =>
    console.log(
      `${e.from.title}@${e.from.pos} -${e.fromPin}-> ${e.to.title}@${e.to.pos}`
    )
  );
  console.log('--- MoveTo details ---');
  console.log(JSON.stringify(moveDetails, null, 2));
  console.log('--- Wander edges (sample) ---');
  wander.slice(0, 30).forEach((e) =>
    console.log(`${e.from.title}@${e.from.pos} -${e.fromPin}-> ${e.to.title}@${e.to.pos}`)
  );
  mcp.kill();
})().catch((e) => {
  console.error(e);
  mcp.kill();
  process.exit(1);
});
