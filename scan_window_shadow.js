const { spawn } = require('child_process');
const BP = '/Game/BluePrint/BP_WindowShadowLogic';

const mcp = spawn('npx.cmd', ['ue-mcp', 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject'], { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
let id = 1, pending = new Map(), buf = '';
function rpc(m, p, ms = 120000) {
  return new Promise((res, rej) => {
    const i = id++;
    const t = setTimeout(() => rej(new Error('timeout')), ms);
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
const parse = (r) => { try { return JSON.parse(r?.result?.content?.[0]?.text); } catch { return { raw: r?.result?.content?.[0]?.text?.slice(0, 2000) }; } };
const bp = async (a) => parse(await rpc('tools/call', { name: 'blueprint', arguments: { path: BP, assetPath: BP, ...a } }));

(async () => {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'scan-win' } });
  const read = await bp({ action: 'read' });
  console.log('read:', JSON.stringify(read, null, 2).slice(0, 3000));
  const sum = await bp({ action: 'read_graph_summary', graphName: 'EventGraph' });
  const nodes = sum.nodes || sum || [];
  const hit = nodes.filter((n) => {
    const t = (n.title || '') + (n.class || '');
    return /Select|Collision|None|Collider|Shadow/i.test(t);
  });
  console.log('\n=== nodes', hit.length, '===');
  hit.forEach((n) => console.log(n.id, n.class, '|', n.title));
  const ids = nodes.filter((n) => (n.title || '').includes('Set Collision Enabled')).map((n) => n.id);
  if (ids.length) {
    const ex = await bp({ action: 'export_nodes_t3d', graphName: 'EventGraph', nodeIds: ids });
    console.log('\n=== Set Collision T3D ===\n', (ex.t3d || '').slice(0, 8000));
  }
  const sel = nodes.filter((n) => (n.class || '').includes('Select'));
  if (sel.length) {
    const ex2 = await bp({ action: 'export_nodes_t3d', graphName: 'EventGraph', nodeIds: sel.map((n) => n.id) });
    console.log('\n=== Select T3D ===\n', (ex2.t3d || '').slice(0, 8000));
  }
  mcp.kill();
})().catch((e) => { console.error(e); mcp.kill(); });
