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
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'compare_abp' } });
  for (const p of paths) {
    try {
      const res = await rpc('tools/call', { name: 'animation', arguments: { action: 'read_anim_blueprint', assetPath: p } });
      const txt = res?.result?.content?.[0]?.text;
      console.log('\n===', p, '===');
      console.log(txt?.slice(0, 4000) || res);
    } catch (e) {
      console.log('\n===', p, 'FAIL', e.message);
    }
  }
  mcp.kill();
})().catch((e) => { console.error(e); mcp.kill(); });
