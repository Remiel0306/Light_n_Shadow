const { spawn } = require('child_process');
const BP = '/Game/BluePrint/BP_Enemy1';
const mcp = spawn('npx.cmd', ['ue-mcp', 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject'], { shell: true });
let reqId = 1;
const p = new Map();
function rpc(m, pr) {
  return new Promise((r) => {
    const id = reqId++;
    p.set(id, r);
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: m, params: pr }) + '\n');
  });
}
mcp.stdout.on('data', (d) => {
  for (const line of d.toString().split('\n')) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      const cb = p.get(msg.id);
      if (cb) {
        p.delete(msg.id);
        cb(msg);
      }
    } catch (_) {}
  }
});
async function bp(a) {
  const r = await rpc('tools/call', { name: 'blueprint', arguments: a });
  return JSON.parse(r?.result?.content?.[0]?.text || '{}');
}
(async () => {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'g', version: '1' } });
  const g = await bp({ action: 'read_graph_summary', path: BP, assetPath: BP, graphName: 'EventGraph' });
  for (const n of g.nodes || []) {
    const t = n.title || '';
    if (t.includes('OriginRoot') || t.includes('Break Transform') || t.includes('Get Relative Transform')) {
      console.log(n.id, t);
    }
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
