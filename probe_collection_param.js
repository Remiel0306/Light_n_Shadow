const { spawn } = require('child_process');
const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const MAT = '/Game/Material/XRayVision/M_LightBall_XRayOverlay';

const mcp = spawn('npx.cmd', ['ue-mcp', PROJECT], { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
let id = 1, pending = new Map(), buf = '';
function rpc(method, params, ms = 120000) {
  return new Promise((res, rej) => {
    const i = id++;
    const t = setTimeout(() => rej(new Error('timeout')), ms);
    pending.set(i, (m) => { clearTimeout(t); res(m); });
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n');
  });
}
function parse(res) {
  try { return JSON.parse(res?.result?.content?.[0]?.text); } catch { return { raw: res?.result?.content?.[0]?.text?.slice(0, 3000) }; }
}
async function mat(action, extra = {}) {
  return parse(await rpc('tools/call', { name: 'material', arguments: { action, assetPath: MAT, path: MAT, materialPath: MAT, ...extra } }));
}
async function asset(action, extra = {}) {
  return parse(await rpc('tools/call', { name: 'asset', arguments: { action, ...extra } }));
}

(async () => {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'probe-col' } });

  let r = await mat('add_expression', {
    expressionType: 'CollectionParameter',
    name: 'XRayOn',
    positionX: -400,
    positionY: 0,
    collection: '/Game/Material/MPC_XRayVision.MPC_XRayVision',
    parameterName: 'XRayOn',
  });
  console.log('add CollectionParameter:', JSON.stringify(r));

  r = await mat('list_expressions');
  console.log('expressions:', JSON.stringify(r.expressions || r, null, 2).slice(0, 4000));

  r = await asset('set_property', {
    assetPath: MAT,
    propertyName: 'bDisableDepthTest',
    value: true,
  });
  console.log('bDisableDepthTest:', JSON.stringify(r));

  mcp.kill();
})().catch((e) => { console.error(e); mcp.kill(); process.exit(1); });
