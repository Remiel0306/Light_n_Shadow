const { spawn } = require('child_process');
const BP = '/Game/BluePrint/Player/BP_LightBall';
const mcp = spawn('npx.cmd', ['ue-mcp', 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject'], { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
let id = 1, pending = new Map(), buf = '';
function rpc(m, p) {
  return new Promise((res, rej) => {
    const i = id++;
    const t = setTimeout(() => rej(new Error('timeout')), 120000);
    pending.set(i, (x) => { clearTimeout(t); res(x); });
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method: m, params: p }) + '\n');
  });
}
mcp.stdout.on('data', (d) => {
  buf += d.toString();
  const lines = buf.split('\n'); buf = lines.pop();
  for (const line of lines) {
    try { const msg = JSON.parse(line); const cb = pending.get(msg.id); if (cb) { pending.delete(msg.id); cb(msg); } } catch (_) {}
  }
});
const parse = (r) => { try { return JSON.parse(r?.result?.content?.[0]?.text); } catch { return {}; } };
const bp = async (a) => parse(await rpc('tools/call', { name: 'blueprint', arguments: { path: BP, assetPath: BP, ...a } }));

(async () => {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'clean' } });
  const g = await bp({ action: 'read_graph_summary', graphName: 'EventGraph' });
  const nodes = g.nodes || g || [];
  let n = 0;
  for (const node of nodes) {
    const t = (node.title || '').trim();
    if (node.class === 'K2Node_CallFunction' && (t === 'None' || t.startsWith('Event None'))) {
      const r = await bp({ action: 'delete_node', graphName: 'EventGraph', nodeName: node.id });
      console.log('del', node.id, t, r.success !== false ? 'ok' : r.error);
      n++;
    }
    // duplicate orphan ReceiveBeginPlay from our adds (not the real one) - delete Event None only
    if (node.class === 'K2Node_Event' && t === 'Event None') {
      await bp({ action: 'delete_node', graphName: 'EventGraph', nodeName: node.id });
      console.log('del event', node.id);
      n++;
    }
  }
  console.log('deleted', n);
  await bp({ action: 'compile' });
  console.log('validate', await bp({ action: 'validate' }));
  mcp.kill();
})().catch((e) => { console.error(e); mcp.kill(); });
