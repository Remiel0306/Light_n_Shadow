/**
 * Light ball always renders on top of other XRay objects when XRay mode is on.
 * - M_LightBall_XRayOverlay: Translucent Unlit, DisableDepthTest, GlowStrength * GlowColor
 * - BP_LightBall: XRayOverlay mesh + Tick syncs GlowStrength from MPC_XRayVision.XRayOn
 * - BP_EnemyShadowLogic: CustomDepth stencil 1
 * - BP_LightBall meshes: CustomDepth stencil 2
 */
const { spawn } = require('child_process');
const fs = require('fs');

const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const BP_BALL = '/Game/BluePrint/Player/BP_LightBall';
const BP_ENEMY = '/Game/BluePrint/Enemy/BP_EnemyShadowLogic';
const MAT = '/Game/Material/XRayVision/M_LightBall_XRayOverlay';
const MAT_PATH = `${MAT}.M_LightBall_XRayOverlay`;
const MPC = '/Game/Material/MPC_XRayVision.MPC_XRayVision';
const MESH_SPHERE = '/Engine/BasicShapes/Sphere.Sphere';

const TIMEOUT = 240000;

const mcp = spawn('npx.cmd', ['ue-mcp', PROJECT], { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
let reqId = 1;
const pending = new Map();
let buf = '';

function rpc(method, params, ms = TIMEOUT) {
  return new Promise((resolve, reject) => {
    const id = reqId++;
    const t = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout ${method}`));
    }, ms);
    pending.set(id, (m) => {
      clearTimeout(t);
      resolve(m);
    });
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
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

function parseTool(res) {
  const txt = res?.result?.content?.[0]?.text;
  try {
    return JSON.parse(txt);
  } catch {
    return { success: false, raw: txt?.slice?.(0, 500) || txt };
  }
}

async function mat(args) {
  return parseTool(await rpc('tools/call', { name: 'material', arguments: { assetPath: MAT, path: MAT, materialPath: MAT, ...args } }));
}

async function asset(args) {
  return parseTool(await rpc('tools/call', { name: 'asset', arguments: args }));
}

async function bp(path, args, optional = false) {
  const r = parseTool(
    await rpc('tools/call', { name: 'blueprint', arguments: { path, assetPath: path, ...args } })
  );
  if (!optional && r.success === false && r.error) throw new Error(r.error);
  return r;
}

async function tryMat(action, extra = {}) {
  try {
    return await mat({ action, ...extra });
  } catch (e) {
    return { success: false, error: String(e.message) };
  }
}

async function tryBp(path, args) {
  try {
    return await bp(path, args, true);
  } catch (e) {
    return { success: false, error: String(e.message) };
  }
}

async function connectMat(from, to, so = '', ti = '') {
  const body = {
    action: 'connect_expressions',
    sourceExpression: from,
    targetExpression: to,
  };
  if (so) body.sourceOutput = so;
  if (ti) body.targetInput = ti;
  return tryMat('connect_expressions', body);
}

async function connectProp(expr, prop, out = '0') {
  return tryMat('connect_to_property', { expressionName: expr, property: prop, outputName: out });
}

async function setupMaterial() {
  console.log('\n=== Material M_LightBall_XRayOverlay ===');

  let r = await tryMat('create', { name: 'M_LightBall_XRayOverlay', packagePath: '/Game/Material/XRayVision', onConflict: 'skip' });
  console.log('  create:', r.created ? 'new' : r.existed ? 'exists' : JSON.stringify(r).slice(0, 120));

  const list = await tryMat('list_expressions');
  for (const e of list.expressions || []) {
    if (e.index !== undefined) {
      await tryMat('delete_expression', { expressionName: e.name || e.description || String(e.index) });
    }
  }

  await tryMat('set_blend_mode', { blendMode: 'Translucent' });
  await tryMat('set_shading_model', { shadingModel: 'Unlit' });
  console.log('  blend/shading: Translucent Unlit');

  r = await asset({ action: 'set_property', assetPath: MAT_PATH, propertyName: 'bDisableDepthTest', value: true });
  console.log('  bDisableDepthTest:', r.success !== false ? 'ok' : r.error || r.raw);

  r = await asset({ action: 'set_property', assetPath: MAT_PATH, propertyName: 'TwoSided', value: true });
  console.log('  TwoSided:', r.success !== false ? 'ok' : r.error || r.raw);

  const nodes = {};
  const add = async (label, type, extra = {}) => {
    const res = await tryMat('add_expression', {
      action: 'add_expression',
      expressionType: type,
      name: label,
      ...extra,
    });
    nodes[label] = res.description || label;
    console.log(`  + ${label}:`, res.success === false ? res.error || res.raw : res.description || 'ok');
    return res;
  };

  await add('GlowColor', 'VectorParameter', {
    parameterName: 'GlowColor',
    defaultValue: { r: 1, g: 0.82, b: 0.15, a: 1 },
    positionX: -600,
    positionY: 0,
  });
  await add('GlowStrength', 'ScalarParameter', {
    parameterName: 'GlowStrength',
    defaultValue: 0,
    positionX: -600,
    positionY: 160,
  });
  await add('EmissiveMul', 'Multiply', { positionX: -300, positionY: 40 });

  // Emissive = GlowColor * GlowStrength; Opacity = GlowStrength (BP Tick sets GlowStrength from MPC XRayOn)
  await connectMat('GlowColor', 'EmissiveMul', '', 'A');
  await connectMat('GlowStrength', 'EmissiveMul', '', 'B');
  await connectProp('EmissiveMul', 'EmissiveColor');
  await connectProp('GlowStrength', 'Opacity');

  await tryMat('recompile');
  const val = await tryMat('validate');
  console.log('  validate:', val.valid, 'issues:', (val.issues || []).length);
}

async function setMeshXRaySettings(path, compNames, stencil) {
  for (const comp of compNames) {
    for (const [prop, val] of [
      ['bRenderCustomDepth', true],
      ['CustomDepthStencilValue', stencil],
      ['CastShadow', false],
    ]) {
      const r = await tryBp(path, {
        action: 'set_component_property',
        componentName: comp,
        propertyName: prop,
        value: val,
      });
      console.log(`  ${path.split('/').pop()} ${comp}.${prop}=`, r.success !== false ? 'ok' : r.error || 'fail');
    }
  }
}

async function setupLightBallBP() {
  console.log('\n=== BP_LightBall component + overlay ===');

  const existing = await tryBp(BP_BALL, { action: 'read' });
  const hasOverlay = (existing.components || []).some((c) => c.name === 'XRayOverlay');

  if (!hasOverlay) {
    const r = await tryBp(BP_BALL, {
      action: 'add_component',
      componentClass: 'StaticMeshComponent',
      componentName: 'XRayOverlay',
      parentComponent: 'Sphere',
    });
    console.log('  add XRayOverlay:', r.success !== false ? 'ok' : r.error || r.raw);
  } else {
    console.log('  XRayOverlay: already exists');
  }

  for (const [prop, val] of [
    ['StaticMesh', MESH_SPHERE],
    ['bVisibleInGame', true],
    ['CastShadow', false],
    ['TranslucencySortPriority', 100],
    ['RelativeScale3D', { x: 1.02, y: 1.02, z: 1.02 }],
  ]) {
    await tryBp(BP_BALL, {
      action: 'set_component_property',
      componentName: 'XRayOverlay',
      propertyName: prop,
      value: val,
    });
  }

  const rMat = await tryBp(BP_BALL, {
    action: 'set_component_override_materials',
    componentName: 'XRayOverlay',
    materialPaths: [MAT_PATH],
  });
  console.log('  overlay material:', rMat.success !== false ? 'ok' : rMat.error || rMat.raw);

  await setMeshXRaySettings(BP_BALL, ['XRayOverlay', 'Sphere', 'LightBall'], 2);

  await tryBp(BP_BALL, {
    action: 'set_actor_tick_settings',
    bCanEverTick: true,
    bStartWithTickEnabled: true,
    tickInterval: 0,
  });
  console.log('  actor tick: enabled');

  await wireLightBallEventGraph();
  await tryBp(BP_BALL, { action: 'compile' });
}

async function wireLightBallEventGraph() {
  console.log('\n=== BP_LightBall EventGraph (MPC -> MID) ===');
  const EG = 'EventGraph';

  let vars = await tryBp(BP_BALL, { action: 'list_variables' });
  const varNames = (vars.variables || []).map((v) => v.name);
  if (!varNames.includes('XRayOverlayMID')) {
    const r = await tryBp(BP_BALL, {
      action: 'add_variable',
      variableName: 'XRayOverlayMID',
      variableType: 'object',
      subType: '/Script/Engine.MaterialInstanceDynamic',
    });
    console.log('  var XRayOverlayMID:', r.success !== false ? 'ok' : r.error);
  }

  const sum = await tryBp(BP_BALL, { action: 'read_graph_summary', graphName: EG });
  const nodes = sum.nodes || sum || [];
  const hasTickSync = nodes.some(
    (n) => (n.title || '').includes('SetScalarParameterValue') && (n.title || '').includes('GlowStrength')
  );
  if (hasTickSync) {
    console.log('  tick sync nodes: already present, skip');
    return;
  }

  const ids = {};
  const add = async (key, args) => {
    const r = await tryBp(BP_BALL, { action: 'add_node', graphName: EG, ...args });
    ids[key] = r.nodeId;
    console.log(`  node ${key}:`, r.nodeId || r.error || 'fail');
    return r.nodeId;
  };

  const conn = async (a, ap, b, bp) => {
    const pins = Array.isArray(ap) ? ap : [ap];
    const tpins = Array.isArray(bp) ? bp : [bp];
    for (const sp of pins) {
      for (const tp of tpins) {
        const r = await tryBp(BP_BALL, {
          action: 'connect_pins',
          graphName: EG,
          sourceNode: a,
          sourcePin: sp,
          targetNode: b,
          targetPin: tp,
        });
        if (r.success !== false) return true;
      }
    }
    return false;
  };

  await add('beginPlay', { nodeClass: 'K2Node_Event', eventName: 'ReceiveBeginPlay', posX: 0, posY: 0 });
  await add('tick', { nodeClass: 'K2Node_Event', eventName: 'ReceiveTick', posX: 0, posY: 400 });
  await add('getOverlay', { nodeClass: 'K2Node_VariableGet', variableName: 'XRayOverlay', posX: 200, posY: 120 });
  await add('createMID', {
    nodeClass: 'K2Node_CallFunction',
    functionName: 'CreateDynamicMaterialInstance',
    functionClass: '/Script/Engine.KismetMaterialLibrary',
    posX: 400,
    posY: 80,
  });
  await add('setMat', {
    nodeClass: 'K2Node_CallFunction',
    functionName: 'SetMaterial',
    functionClass: '/Script/Engine.PrimitiveComponent',
    posX: 700,
    posY: 80,
  });
  await add('setMIDvar', { nodeClass: 'K2Node_VariableSet', variableName: 'XRayOverlayMID', posX: 900, posY: 80 });

  await add('getMPC', {
    nodeClass: 'K2Node_CallFunction',
    functionName: 'GetScalarParameterValue',
    functionClass: '/Script/Engine.KismetMaterialLibrary',
    posX: 250,
    posY: 420,
  });
  await add('getMID', { nodeClass: 'K2Node_VariableGet', variableName: 'XRayOverlayMID', posX: 250, posY: 540 });
  await add('setGlow', {
    nodeClass: 'K2Node_CallFunction',
    functionName: 'SetScalarParameterValue',
    functionClass: '/Script/Engine.MaterialInstanceDynamic',
    posX: 550,
    posY: 460,
  });

  // Pin wiring (best-effort pin names)
  await conn(ids.beginPlay, 'then', ids.createMID, 'execute');
  await conn(ids.createMID, 'then', ids.setMat, 'execute');
  await conn(ids.setMat, 'then', ids.setMIDvar, 'execute');
  await conn(ids.getOverlay, 'XRayOverlay', ids.setMat, 'self');
  await conn(ids.createMID, 'ReturnValue', ids.setMat, 'Material');
  await conn(ids.createMID, 'ReturnValue', ids.setMIDvar, 'XRayOverlayMID');

  await conn(ids.tick, 'then', ids.getMPC, 'execute');
  await conn(ids.getMPC, 'then', ids.setGlow, 'execute');
  await conn(ids.getMID, 'XRayOverlayMID', ids.setGlow, 'self');
  await conn(ids.getMPC, 'ReturnValue', ids.setGlow, 'Value');

  // Defaults on call nodes
  for (const [node, pin, val] of [
    ['createMID', 'ElementIndex', '0'],
    ['setMat', 'ElementIndex', '0'],
    ['setGlow', 'ParameterName', 'GlowStrength'],
    ['getMPC', 'ParameterName', 'XRayOn'],
  ]) {
    await tryBp(BP_BALL, {
      action: 'set_node_property',
      graphName: EG,
      nodeId: ids[node],
      pinName: pin,
      defaultValue: val,
    });
  }

  // Parent material + MPC object refs on createMID / getMPC
  await tryBp(BP_BALL, {
    action: 'set_node_property',
    graphName: EG,
    nodeId: ids.createMID,
    pinName: 'Parent',
    defaultValue: MAT_PATH,
  });
  await tryBp(BP_BALL, {
    action: 'set_node_property',
    graphName: EG,
    nodeId: ids.getMPC,
    pinName: 'Collection',
    defaultValue: MPC,
  });
}

async function setupEnemy() {
  console.log('\n=== BP_EnemyShadowLogic CustomDepth stencil 1 ===');
  await setMeshXRaySettings(BP_ENEMY, ['Mesh', 'CharacterMesh0', 'SkeletalMeshComponent'], 1);
  await tryBp(BP_ENEMY, { action: 'compile' });
}

async function main() {
  const log = [];
  const origLog = console.log;
  console.log = (...a) => {
    origLog(...a);
    log.push(a.join(' '));
  };

  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'setup_lightball_xray', version: '1' },
  });

  console.log('=== Light ball XRay always-on-top setup ===\n');
  await setupMaterial();
  await setupLightBallBP();
  await setupEnemy();

  fs.writeFileSync('setup_lightball_xray_on_top_log.txt', log.join('\n'), 'utf8');
  console.log('\nDone. Log: setup_lightball_xray_on_top_log.txt');
  mcp.kill();
  process.exit(0);
}

main().catch((e) => {
  console.error('FATAL:', e);
  mcp.kill();
  process.exit(1);
});
