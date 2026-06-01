const { spawn } = require('child_process');
const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const BP = '/Game/BluePrint/Player/BP_LightBall';
const MAT = '/Game/Material/XRayVision/M_LightBall_XRayOverlay';

const mcp = spawn('npx.cmd', ['ue-mcp', PROJECT], { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
let id = 1, pending = new Map(), buf = '';
function rpc(method, params, ms = 180000) {
  return new Promise((res, rej) => {
    const i = id++;
    const t = setTimeout(() => rej(new Error('timeout')), ms);
    pending.set(i, (m) => { clearTimeout(t); res(m); });
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n');
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
  try { return JSON.parse(res?.result?.content?.[0]?.text); } catch { return { raw: res?.result?.content?.[0]?.text?.slice(0, 2000) }; }
}
async function mat(action, extra = {}) {
  return parse(await rpc('tools/call', { name: 'material', arguments: { action, assetPath: MAT, path: MAT, ...extra } }));
}
async function bp(action, extra = {}) {
  return parse(await rpc('tools/call', { name: 'blueprint', arguments: { action, path: BP, assetPath: BP, ...extra } }));
}

(async () => {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'probe-mat' } });

  let r = await mat('create', { name: 'M_LightBall_XRayOverlay', packagePath: '/Game/Material/XRayVision', onConflict: 'skip' });
  console.log('create:', JSON.stringify(r));

  r = await mat('read');
  console.log('read:', JSON.stringify(r).slice(0, 3000));

  r = await mat('list_expression_types');
  console.log('expr types sample:', (r.types || r.expressionTypes || []).slice(0, 20));

  r = await mat('create_simple', { template: 'unlit_emissive', emissiveColor: [1, 0.85, 0.2] });
  console.log('create_simple:', JSON.stringify(r));

  r = await bp('read_component_properties', { componentName: 'LightBall' });
  console.log('LightBall props:', JSON.stringify(r, null, 2).slice(0, 4000));

  mcp.kill();
})().catch((e) => { console.error(e); mcp.kill(); process.exit(1); });
