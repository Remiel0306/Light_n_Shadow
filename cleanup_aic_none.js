const { spawn } = require('child_process');
const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const AIC = '/Game/BluePrint/Enemy/BP_EnemyAIController';
const mcp = spawn('npx.cmd', ['ue-mcp', PROJECT], { shell: true });
let reqId = 1,
  pending = new Map(),
  buf = '';

function rpc(m, p) {
  return new Promise((res, rej) => {
    const i = reqId++;
    const t = setTimeout(() => rej(new Error('timeout')), 120000);
    pending.set(i, (msg) => {
      clearTimeout(t);
      res(msg);
    });
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method: m, params: p }) + '\n');
  });
}
mcp.stdout.on('data', (d) => {
  buf += d.toString();
  const lines = buf.split('\n');
  buf = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      const cb = pending.get(msg.id);
      if (cb) {
        pending.delete(msg.id);
        cb(msg);
      }
    } catch (_) {}
  }
});
async function bp(args, opt = false) {
  const r = await rpc('tools/call', { name: 'blueprint', arguments: args });
  const p = JSON.parse(r.result.content[0].text);
  if (!opt && p.error) throw new Error(p.error);
  return p;
}
(async () => {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'cleanup' } });
  const lg = await bp({ action: 'list_graphs', path: AIC, assetPath: AIC });
  for (const gr of lg.graphs || []) {
    const g = await bp({ action: 'read_graph', path: AIC, assetPath: AIC, graphName: gr.name });
    for (const n of g.nodes || []) {
      const t = (n.title || '').trim();
      const bad =
        t === 'None' ||
        t.startsWith('None') ||
        (n.class === 'K2Node_CallFunction' && !t) ||
        (gr.name === 'EventGraph' && (t === 'CacheSettingsFromPawn' || t === 'StartPatrol'));
      if (bad) {
        try {
          await bp({
            action: 'delete_node',
            path: AIC,
            assetPath: AIC,
            graphName: gr.name,
            nodeName: n.id,
          });
          console.log('deleted', gr.name, t, n.id);
        } catch (e) {
          console.log('skip', gr.name, t, e.message);
        }
      }
    }
  }
  const v = await bp({ action: 'validate', path: AIC, assetPath: AIC }, true);
  console.log('validate errors', v.errorCount, 'valid', v.valid);
  if (v.messages) v.messages.forEach((m) => console.log(' ', m.severity, m.message.slice(0, 80)));
  await bp({ action: 'compile', path: AIC, assetPath: AIC });
  mcp.kill();
})().catch((e) => {
  console.error(e);
  mcp.kill();
});
