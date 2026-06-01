const { spawn } = require('child_process');
const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const BP = '/Game/BluePrint/Player/BP_LightBall';
const MAT_LB = '/Game/Material/XRayVision/M_XRayVIsion_LightBall';

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
mcp.stdout.on('data', (d) => {
  buf += d.toString();
  const lines = buf.split('\n'); buf = lines.pop();
  for (const line of lines) {
    try { const msg = JSON.parse(line); const cb = pending.get(msg.id); if (cb) cb(msg); } catch (_) {}
  }
});
function parse(res) {
  try { return JSON.parse(res?.result?.content?.[0]?.text); } catch { return { raw: res?.result?.content?.[0]?.text }; }
}
async function tool(name, args) {
  return parse(await rpc('tools/call', { name, arguments: args }));
}

(async () => {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'inspect-lb' } });

  const bpRead = await tool('blueprint', { action: 'read', path: BP, assetPath: BP });
  console.log('=== BP read keys ===', Object.keys(bpRead));
  console.log(JSON.stringify(bpRead, null, 2).slice(0, 8000));

  const comps = await tool('blueprint', { action: 'list_components', path: BP, assetPath: BP });
  console.log('\n=== components ===', JSON.stringify(comps, null, 2));

  const matRead = await tool('material', { action: 'read_material', path: MAT_LB, assetPath: MAT_LB });
  console.log('\n=== M_LightBall PP mat ===', matRead.expressionCount || matRead.expressions?.length, 'exprs');
  if (matRead.expressions) {
    matRead.expressions.slice(0, 15).forEach((e) => console.log(e.index, e.class, e.description));
  }

  // list material tool actions via trying help
  const matActions = await tool('material', { action: 'list_actions', path: MAT_LB, assetPath: MAT_LB });
  console.log('\n=== material list_actions ===', JSON.stringify(matActions, null, 2));

  mcp.kill();
})().catch((e) => { console.error(e); mcp.kill(); process.exit(1); });
