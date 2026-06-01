const { spawn } = require('child_process');
const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const BP = '/Game/BluePrint/Player/BP_LightBall';
const MAT = '/Game/Material/XRayVision/M_LightBall_XRayOverlay';

const mcp = spawn('npx.cmd', ['ue-mcp', PROJECT], { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
let id = 1, pending = new Map(), buf = '';
function rpc(m, p) {
  return new Promise((res, rej) => {
    const i = id++;
    const t = setTimeout(() => rej(new Error('timeout')), 60000);
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
const parse = (r) => { try { return JSON.parse(r?.result?.content?.[0]?.text); } catch { return { raw: r?.result?.content?.[0]?.text }; } };

(async () => {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'verify' } });
  const bp = parse(await rpc('tools/call', { name: 'blueprint', arguments: { action: 'read', path: BP, assetPath: BP } }));
  console.log('=== BP_LightBall components ===');
  for (const c of bp.components || []) {
    console.log(`- ${c.name} (${c.class}) mesh=${c.staticMesh || '-'} materials=${JSON.stringify(c.materials)}`);
  }
  const mat = parse(await rpc('tools/call', {
    name: 'material',
    arguments: { action: 'read', assetPath: MAT, path: MAT },
  }));
  console.log('\n=== M_LightBall_XRayOverlay ===');
  console.log('blend:', mat.blendMode, 'shading:', mat.shadingModel);
  console.log('expressions:', mat.expressionCount);
  console.log('connections:', JSON.stringify(mat.connections, null, 2));
  mcp.kill();
})().catch((e) => { console.error(e); mcp.kill(); });
