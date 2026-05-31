const { spawn } = require('child_process');
const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const paths = [
  '/Game/Characters/Mannequins/Anims/Unarmed/ABP_Unarmed',
  '/Game/Characters/Mannequins/Anims/Unarmed/ABP_Enmey',
];

const mcp = spawn('npx.cmd', ['ue-mcp', PROJECT], { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
let id = 1, pending = new Map(), buf = '';
function rpc(m, p) {
  return new Promise((res, rej) => {
    const i = id++;
    const t = setTimeout(() => rej(new Error('timeout')), 90000);
    pending.set(i, (m) => { clearTimeout(t); res(m); });
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
(async () => {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'abp_eg' } });
  for (const p of paths) {
    for (const action of ['list_graphs', 'read_graph_summary']) {
      try {
        const res = await rpc('tools/call', { name: 'animation', arguments: { action, assetPath: p, graphName: 'EventGraph' } });
        const txt = res?.result?.content?.[0]?.text;
        const j = JSON.parse(txt);
        console.log('\n', p, action);
        const nodes = j.nodes || j.graphs || [];
        if (Array.isArray(nodes)) {
          nodes.filter(n => n.title && /Speed|Velocity|Character|Update|Pawn|Ground/i.test(n.title || JSON.stringify(n)))
            .slice(0, 30)
            .forEach(n => console.log(' ', n.title || n.name, n.class));
        } else if (j.graphs) {
          console.log(' graphs:', j.graphs.map(g => g.name + ' nodes=' + g.nodeCount).join(', '));
        }
      } catch (e) {
        console.log(p, action, e.message);
      }
    }
  }
  mcp.kill();
})().catch(e => { console.error(e); mcp.kill(); });
