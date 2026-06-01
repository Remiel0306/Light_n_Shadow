const { spawn } = require('child_process');
const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const BP_BALL = '/Game/BluePrint/Player/BP_LightBall';
const MAT_PATH = '/Game/Material/XRayVision/M_LightBall_XRayOverlay.M_LightBall_XRayOverlay';
const MPC = '/Game/Material/MPC_XRayVision.MPC_XRayVision';

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
    try { const msg = JSON.parse(line); const cb = pending.get(msg.id); if (cb) { pending.delete(msg.id); cb(msg); } } catch (_) {}
  }
});
function parse(res) {
  try { return JSON.parse(res?.result?.content?.[0]?.text); } catch { return { raw: res?.result?.content?.[0]?.text?.slice(0, 500) }; }
}
async function mat(args) {
  return parse(await rpc('tools/call', { name: 'material', arguments: { assetPath: MAT_PATH, path: MAT_PATH, materialPath: MAT_PATH, ...args } }));
}
async function bp(args) {
  return parse(await rpc('tools/call', { name: 'blueprint', arguments: { path: BP_BALL, assetPath: BP_BALL, ...args } }));
}
async function editor(args) {
  return parse(await rpc('tools/call', { name: 'editor', arguments: args }));
}

(async () => {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fix2' } });

  let r = await editor({ action: 'set_property', objectPath: MAT_PATH, propertyName: 'bDisableDepthTest', value: true });
  console.log('bDisableDepthTest:', JSON.stringify(r));
  r = await editor({ action: 'set_property', objectPath: MAT_PATH, propertyName: 'TwoSided', value: true });
  console.log('TwoSided:', JSON.stringify(r));

  // Fix vector default color
  const list = await mat({ action: 'list_expressions' });
  const glow = (list.expressions || []).find((e) => (e.description || '').includes('GlowColor'));
  if (glow?.index !== undefined) {
    r = await mat({
      action: 'set_expression_value',
      expressionIndex: glow.index,
      defaultValue: { r: 1, g: 0.82, b: 0.15, a: 1 },
    });
    console.log('GlowColor value:', JSON.stringify(r));
  }
  await mat({ action: 'recompile' });

  // Fix variable type: delete float var, add object MID var
  await bp({ action: 'delete_variable', variableName: 'XRayOverlayMID' });
  r = await bp({
    action: 'add_variable',
    name: 'XRayOverlayMID',
    variableType: 'object',
    variableSubType: '/Script/Engine.MaterialInstanceDynamic',
  });
  console.log('add MID var:', JSON.stringify(r));

  const EG = 'EventGraph';
  await bp({ action: 'cleanup_graph', graphName: EG });
  console.log('cleanup graph done');

  const ids = {};
  const add = async (k, p) => {
    r = await bp({ action: 'add_node', graphName: EG, ...p });
    ids[k] = r.nodeId;
    console.log('add', k, r.nodeId, r.error || '');
  };

  await add('bp', { nodeClass: 'K2Node_Event', eventName: 'ReceiveBeginPlay', posX: 0, posY: 0 });
  await add('tk', { nodeClass: 'K2Node_Event', eventName: 'ReceiveTick', posX: 0, posY: 500 });
  await add('ov', { nodeClass: 'K2Node_VariableGet', variableName: 'XRayOverlay', posX: 200, posY: 100 });
  await add('cr', {
    nodeClass: 'K2Node_CallFunction',
    functionName: 'CreateDynamicMaterialInstance',
    functionClass: '/Script/Engine.KismetMaterialLibrary',
    posX: 420,
    posY: 60,
  });
  await add('sm', {
    nodeClass: 'K2Node_CallFunction',
    functionName: 'SetMaterial',
    functionClass: '/Script/Engine.PrimitiveComponent',
    posX: 700,
    posY: 60,
  });
  await add('sv', { nodeClass: 'K2Node_VariableSet', variableName: 'XRayOverlayMID', posX: 920, posY: 60 });
  await add('gm', {
    nodeClass: 'K2Node_CallFunction',
    functionName: 'GetScalarParameterValue',
    functionClass: '/Script/Engine.KismetMaterialLibrary',
    posX: 220,
    posY: 520,
  });
  await add('gv', { nodeClass: 'K2Node_VariableGet', variableName: 'XRayOverlayMID', posX: 220, posY: 640 });
  await add('sg', {
    nodeClass: 'K2Node_CallFunction',
    functionName: 'SetScalarParameterValue',
    functionClass: '/Script/Engine.MaterialInstanceDynamic',
    posX: 520,
    posY: 540,
  });

  async function conn(a, ap, b, bps) {
    for (const sp of [].concat(ap)) {
      for (const tp of [].concat(bps)) {
        const c = await bp({
          action: 'connect_pins',
          graphName: EG,
          sourceNode: ids[a],
          sourcePin: sp,
          targetNode: ids[b],
          targetPin: tp,
        });
        if (c.success !== false) {
          console.log(`  ${a}.${sp} -> ${b}.${tp}`);
          return;
        }
      }
    }
  }

  await conn('bp', ['then'], 'cr', ['execute']);
  await conn('cr', ['then'], 'sm', ['execute']);
  await conn('sm', ['then'], 'sv', ['execute']);
  await conn('ov', ['XRayOverlay'], 'sm', ['self']);
  await conn('cr', ['ReturnValue'], 'sm', ['Material']);
  await conn('cr', ['ReturnValue'], 'sv', ['XRayOverlayMID']);

  await conn('tk', ['then'], 'gm', ['execute']);
  await conn('gm', ['then'], 'sg', ['execute']);
  await conn('gv', ['XRayOverlayMID'], 'sg', ['self']);
  await conn('gm', ['ReturnValue'], 'sg', ['Value']);

  for (const [k, pin, val] of [
    ['sm', 'Element Index', '0'],
    ['sg', 'Parameter Name', 'GlowStrength'],
    ['gm', 'Parameter Name', 'XRayOn'],
  ]) {
    await bp({ action: 'set_node_property', graphName: EG, nodeId: ids[k], pinName: pin, defaultValue: val });
  }

  await bp({ action: 'compile' });
  const v = await bp({ action: 'validate' });
  console.log('validate:', v.valid, v.errors || v.errorCount);

  mcp.kill();
})().catch((e) => { console.error(e); mcp.kill(); process.exit(1); });
