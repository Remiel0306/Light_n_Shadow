/**
 * Inspect enemy capsule begin-overlap branch condition.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const ENEMY = '/Game/BluePrint/Enemy/BP_EnemyShadowLogic';

const mcp = spawn('npx.cmd', ['ue-mcp', PROJECT], { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
let id = 1, pending = new Map(), buf = '';
function rpc(m, p, ms = 120000) {
  return new Promise((res, rej) => {
    const i = id++;
    const t = setTimeout(() => rej(new Error('timeout')), ms);
    pending.set(i, (msg) => { clearTimeout(t); res(msg); });
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method: m, params: p }) + '\n');
  });
}
mcp.stdout.on('data', (d) => {
  buf += d.toString();
  const lines = buf.split('\n'); buf = lines.pop();
  for (const line of lines) {
    try { const msg = JSON.parse(line); const cb = pending.get(msg.id); if (cb) cb(msg); } catch (_) {}
  }
});
function parse(res) {
  try { return JSON.parse(res?.result?.content?.[0]?.text); } catch { return res; }
}
async function bp(args) {
  return parse(await rpc('tools/call', { name: 'blueprint', arguments: args }));
}

(async () => {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'cap' } });
  const sum = await bp({ action: 'read_graph_summary', path: ENEMY, assetPath: ENEMY, graphName: 'EventGraph' });
  const titles = Object.fromEntries((sum.nodes || []).map((n) => [n.id, n.title]));
  const capsule = 'kCeAXku2Xz37OKmQVsleuQ';
  const branch = 'd7ZEIkocNUBrO_CAWUBZCg';

  // BFS from capsule via exec edges
  const edges = sum.execEdges || [];
  const data = sum.dataEdges || [];
  const visited = new Set();
  const queue = [capsule];
  const chain = [];
  while (queue.length) {
    const cur = queue.shift();
    if (visited.has(cur)) continue;
    visited.add(cur);
    chain.push(titles[cur] || cur);
    for (const e of edges) {
      if (e.from === cur && !visited.has(e.to)) queue.push(e.to);
    }
  }

  const cond = data.filter((e) => e.to === branch);
  const condInfo = cond.map((e) => ({
    ...e,
    fromTitle: titles[e.from],
    toTitle: titles[e.to],
  }));

  // Also follow then/else from branch a few steps
  const fromBranch = edges.filter((e) => e.from === branch).map((e) => ({
    pin: e.fromPin,
    to: titles[e.to],
    toId: e.to,
  }));

  const out = { chain, condInfo, fromBranch };
  // one more level
  out.next = {};
  for (const b of fromBranch) {
    out.next[b.pin] = edges.filter((e) => e.from === b.toId).map((e) => `${e.fromPin}->${titles[e.to]}`);
  }

  fs.writeFileSync('capsule_chain.out.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  mcp.kill();
})().catch((e) => { console.error(e); mcp.kill(); process.exit(1); });
