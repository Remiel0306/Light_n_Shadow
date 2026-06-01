const { spawn } = require('child_process');
const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const BP_BALL = '/Game/BluePrint/Player/BP_LightBall';
const MAT = '/Game/Material/XRayVision/M_LightBall_XRayOverlay';
const MAT_PATH = `${MAT}.M_LightBall_XRayOverlay`;
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
  try { return JSON.parse(res?.result?.content?.[0]?.text); } catch { return { raw: res?.result?.content?.[0]?.text?.slice(0, 400) }; }
}
async function mat(args) {
  return parse(await rpc('tools/call', { name: 'material', arguments: { assetPath: MAT, path: MAT, materialPath: MAT, ...args } }));
}
async function bp(args) {
  return parse(await rpc('tools/call', { name: 'blueprint', arguments: { path: BP_BALL, assetPath: BP_BALL, ...args } }));
}
async function editor(args) {
  return parse(await rpc('tools/call', { name: 'editor', arguments: args }));
}

(async () => {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fix-lb' } });

  // Material: fix connections by expression description names
  const list = await mat({ action: 'list_expressions' });
  console.log('expressions:', (list.expressions || []).map((e) => e.name || e.description).join(', '));

  const byDesc = {};
  for (const e of list.expressions || []) {
    byDesc[e.description || e.name] = e.description || e.name;
  }

  const glowColor = byDesc["Param (0,0,0,0) 'GlowColor'"] || "Param (0,0,0,0) 'GlowColor'";
  const glowStr = byDesc["Param (0) 'GlowStrength'"] || "Param (0) 'GlowStrength'";
  const mul = byDesc.Multiply || 'Multiply';

  for (const [s, t, ti] of [
    [glowColor, mul, 'A'],
    [glowStr, mul, 'B'],
  ]) {
    const r = await mat({
      action: 'connect_expressions',
      sourceExpression: s,
      targetExpression: t,
      targetInput: ti,
    });
    console.log(`connect ${s} -> ${t}.${ti}:`, r.success !== false ? 'ok' : r.error || r.raw);
  }
  for (const [e, p] of [
    [mul, 'EmissiveColor'],
    [glowStr, 'Opacity'],
  ]) {
    const r = await mat({ action: 'connect_to_property', expressionName: e, property: p });
    console.log(`prop ${p}:`, r.success !== false ? 'ok' : r.error || r.raw);
  }

  await mat({ action: 'recompile' });
  const v = await mat({ action: 'validate' });
  console.log('validate:', v.valid, v.issues);

  // Disable depth test via editor tool
  let r = await editor({ action: 'set_property', objectPath: MAT_PATH, propertyName: 'bDisableDepthTest', value: true });
  console.log('editor bDisableDepthTest:', JSON.stringify(r));
  r = await editor({ action: 'set_property', objectPath: MAT_PATH, propertyName: 'TwoSided', value: true });
  console.log('editor TwoSided:', JSON.stringify(r));

  // Assign material to overlay
  r = await bp({
    action: 'set_component_property',
    componentName: 'XRayOverlay',
    propertyName: 'OverrideMaterials',
    value: [MAT_PATH],
  });
  console.log('OverrideMaterials:', JSON.stringify(r));

  // Variable
  const vars = await bp({ action: 'list_variables' });
  if (!(vars.variables || []).some((x) => x.name === 'XRayOverlayMID')) {
    r = await bp({ action: 'add_variable', name: 'XRayOverlayMID', type: 'object', subobject: '/Script/Engine.MaterialInstanceDynamic' });
    console.log('add_variable:', JSON.stringify(r));
  }

  // Connect blueprint pins (use node ids from previous run - re-read graph)
  const g = await bp({ action: 'read_graph_summary', graphName: 'EventGraph' });
  const nodes = g.nodes || g || [];
  const find = (t) => nodes.find((n) => (n.title || '').includes(t))?.id;
  const beginPlay = find('BeginPlay') || find('ReceiveBeginPlay');
  const tick = find('ReceiveTick');
  const createMID = find('CreateDynamicMaterialInstance');
  const setMat = find('SetMaterial');
  const setMIDvar = nodes.find((n) => n.class === 'K2Node_VariableSet')?.id;
  const getMPC = find('GetScalarParameterValue');
  const setGlow = nodes.filter((n) => (n.title || '').includes('SetScalarParameterValue')).pop()?.id;
  const getMID = nodes.find((n) => n.class === 'K2Node_VariableGet' && (n.title || '').includes('XRayOverlayMID'))?.id;
  const getOverlay = nodes.find((n) => (n.title || '').includes('XRayOverlay') && n.class === 'K2Node_VariableGet')?.id;

  console.log('nodes:', { beginPlay, tick, createMID, setMat, setMIDvar, getMPC, setGlow, getMID, getOverlay });

  async function conn(a, ap, b, bpins) {
    if (!a || !b) return;
    for (const sp of [].concat(ap)) {
      for (const tp of [].concat(bpins)) {
        const cr = await bp({
          action: 'connect_pins',
          graphName: 'EventGraph',
          sourceNode: a,
          sourcePin: sp,
          targetNode: b,
          targetPin: tp,
        });
        if (cr.success !== false) {
          console.log(`  linked ${sp} -> ${tp}`);
          return;
        }
      }
    }
  }

  if (beginPlay && createMID) {
    await conn(beginPlay, ['then', 'OutputDelegate'], createMID, ['execute', 'Exec']);
    await conn(createMID, ['then'], setMat, ['execute', 'Exec']);
    await conn(setMat, ['then'], setMIDvar, ['execute', 'Exec']);
    await conn(getOverlay, ['XRayOverlay'], setMat, ['self', 'Target']);
    await conn(createMID, ['ReturnValue'], setMat, ['Material']);
    await conn(createMID, ['ReturnValue'], setMIDvar, ['XRayOverlayMID']);
  }
  if (tick && getMPC && setGlow) {
    await conn(tick, ['then', 'OutputDelegate'], getMPC, ['execute', 'Exec']);
    await conn(getMPC, ['then'], setGlow, ['execute', 'Exec']);
    await conn(getMID, ['XRayOverlayMID'], setGlow, ['self']);
    await conn(getMPC, ['ReturnValue'], setGlow, ['Value']);
  }

  await bp({ action: 'compile' });
  const val = await bp({ action: 'validate' });
  console.log('BP validate:', val.valid, 'errors:', val.errorCount);

  mcp.kill();
})().catch((e) => { console.error(e); mcp.kill(); process.exit(1); });
