const { spawn } = require('child_process');
const AIC = '/Game/BluePrint/System/BP_EnemyAIController';
const mcp = spawn('npx.cmd', ['ue-mcp', 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject'], { shell: true });
let id = 1, pending = new Map(), buf = '';
function rpc(m, p) {
  return new Promise((res) => {
    const i = id++;
    pending.set(i, (msg) => { pending.delete(i); res(msg); });
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
(async () => {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'v' } });
  const r = await rpc('tools/call', { name: 'blueprint', arguments: { action: 'validate', path: AIC, assetPath: AIC } });
  console.log(r?.result?.content?.[0]?.text);
  const g = await rpc('tools/call', { name: 'blueprint', arguments: { action: 'read_graph_summary', path: AIC, assetPath: AIC, graphName: 'EventGraph' } });
  console.log('EG:', g?.result?.content?.[0]?.text?.slice(0, 2000));
  mcp.kill();
})();
