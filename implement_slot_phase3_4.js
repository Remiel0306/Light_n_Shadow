// Phase 3+4 only (Phase 1+2 already done)
// + Creates ResetOneShadowCollider function first
// Correct targetClass for local BP function calls: '/Game/BluePrint/BP_Enemy1.BP_Enemy1_C'

const { spawn } = require('child_process');
const PROJECT  = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const BP       = '/Game/BluePrint/BP_Enemy1';
const EG       = 'EventGraph';
const BP_CLASS = '/Game/BluePrint/BP_Enemy1.BP_Enemy1_C';

const ARR_CLS   = '/Script/Engine.KismetArrayLibrary';
const MATH_CLS  = '/Script/Engine.KismetMathLibrary';
const SYS_CLS   = '/Script/Engine.KismetSystemLibrary';
const SCENE_CLS = '/Script/Engine.SceneComponent';
const BOX_CLS   = '/Script/Engine.BoxComponent';

const mcp = spawn('npx.cmd', ['ue-mcp', PROJECT], { shell: true });
let reqId = 1;
const pending = new Map();
function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const id = reqId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timeout ${method}`)); }, 30000);
    pending.set(id, msg => { clearTimeout(timer); resolve(msg); });
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
mcp.stdout.on('data', data => {
  for (const line of data.toString().split('\n')) {
    if (!line.trim()) continue;
    try { const m = JSON.parse(line); const cb = pending.get(m.id); if (cb) { pending.delete(m.id); cb(m); } } catch (_) {}
  }
});
function payload(res) {
  const txt = res?.result?.content?.[0]?.text;
  try { return JSON.parse(txt); } catch { return { success: false, error: txt || 'fail' }; }
}
async function bp(args) {
  const res = await rpc('tools/call', { name: 'blueprint', arguments: args });
  const p = payload(res);
  if (!p.success) throw new Error(p.error || JSON.stringify(p));
  return p;
}
const addN = (graph, cls, params, x, y) => bp({ action: 'add_node', path: BP, assetPath: BP, graphName: graph, nodeClass: cls, nodeParams: params, posX: x, posY: y }).then(r => r.nodeId);
const N    = (cls, params, x, y) => addN(EG, cls, params, x, y);
const VARGET  = (v, x, y)    => N('K2Node_VariableGet', { variableName: v }, x, y);
const BRANCH  = (x, y)       => N('K2Node_IfThenElse', {}, x, y);
const CF      = (fn, tc, x, y) => N('CallFunction', { functionName: fn, targetClass: tc || '' }, x, y);
const ARR_GET = (x, y)       => N('CallFunction', { functionName: 'Array_Get', targetClass: ARR_CLS }, x, y);
const ARR_SET = (x, y)       => N('CallFunction', { functionName: 'Array_Set', targetClass: ARR_CLS }, x, y);
const IS_VALID = (x, y)      => N('CallFunction', { functionName: 'IsValid', targetClass: SYS_CLS }, x, y);
const EQ_OBJ   = (x, y)     => N('CallFunction', { functionName: 'EqualEqual_ObjectObject', targetClass: MATH_CLS }, x, y);
const BRK_VEC  = (x, y)     => N('CallFunction', { functionName: 'BreakVector', targetClass: MATH_CLS }, x, y);
const NORM     = (x, y)     => N('CallFunction', { functionName: 'Normal', targetClass: MATH_CLS }, x, y);
const SUB_VV   = (x, y)     => N('CallFunction', { functionName: 'Subtract_VectorVector', targetClass: MATH_CLS }, x, y);
const GET_CL   = (x, y)     => N('CallFunction', { functionName: 'K2_GetComponentLocation', targetClass: SCENE_CLS }, x, y);
const UPD_CALL = (x, y)     => N('CallFunction', { functionName: 'UpdateOneShadowCollider', targetClass: BP_CLASS }, x, y);
const RST_CALL = (x, y)     => N('CallFunction', { functionName: 'ResetOneShadowCollider', targetClass: BP_CLASS }, x, y);

async function conn(from, fp, to, tp) {
  const fps = Array.isArray(fp) ? fp : [fp];
  const tps = Array.isArray(tp) ? tp : [tp];
  let last;
  for (const f of fps) for (const t of tps) {
    try { await bp({ action: 'connect_pins', path: BP, assetPath: BP, graphName: EG, sourceNode: from, sourcePin: f, targetNode: to, targetPin: t }); return; }
    catch (e) { last = e; }
  }
  throw new Error(`conn ${from}(${fps}) → ${to}(${tps}): ${last?.message?.substring(0, 100)}`);
}
async function connG(graph, from, fp, to, tp) {
  await bp({ action: 'connect_pins', path: BP, assetPath: BP, graphName: graph, sourceNode: from, sourcePin: fp, targetNode: to, targetPin: tp });
}
async function disc(from, fp, to, tp) {
  try { await bp({ action: 'disconnect_pins', path: BP, assetPath: BP, graphName: EG, sourceNode: from, sourcePin: fp, targetNode: to, targetPin: tp }); }
  catch (e) { console.log(`  [skip disc] ${e.message?.substring(0, 80)}`); }
}
async function setPin(nodeId, pin, value) {
  for (const args of [
    { action: 'set_node_property', path: BP, assetPath: BP, graphName: EG, nodeName: nodeId, propertyName: pin, value },
    { action: 'set_node_property', path: BP, assetPath: BP, graphName: EG, nodeName: nodeId, pinName: pin, defaultValue: value },
  ]) {
    try { await bp(args); return; } catch (_) {}
  }
  console.log(`  [warn setPin] ${nodeId}.${pin}`);
}
async function setPinG(graph, nodeId, pin, value) {
  for (const args of [
    { action: 'set_node_property', path: BP, assetPath: BP, graphName: graph, nodeName: nodeId, propertyName: pin, value },
    { action: 'set_node_property', path: BP, assetPath: BP, graphName: graph, nodeName: nodeId, pinName: pin, defaultValue: value },
  ]) {
    try { await bp(args); return; } catch (_) {}
  }
}

// ── Existing node IDs ──────────────────────────────────────────────────────────
const ID = {
  forEach:         'jJbwdk7ygBo1U6mM9tSkqw',
  sccCall:         'jpIs6konDQtHVMqzwLx-2w',
  ballActorLoc:    'fZK8201rUXdK6eaEXmwMeQ',
  compEndOvlp:     'nKCLHECZm8GUnhOtMrnQ1g',
  clearActiveBall: '7XGCn0kHwNRQzn6lHyZxwA',
};

// ── Helpers ────────────────────────────────────────────────────────────────────
async function slotEqCheck(idx, ballNode, ballPin, x, y) {
  const gAB   = await VARGET('Active Ball', x, y + 60);
  const getI  = await ARR_GET(x + 220, y);
  const eq    = await EQ_OBJ(x + 460, y);
  const br    = await BRANCH(x + 720, y);
  await conn(gAB, 'Active Ball', getI, 'TargetArray');
  await setPin(getI, 'Index', String(idx));
  await conn(getI, 'Item',        eq, 'A');
  await conn(ballNode, ballPin,   eq, 'B');
  await conn(eq, 'ReturnValue',   br, 'Condition');
  return { br };
}

async function updateForSlot(idx, brNode, topLocNode, normNode, x, y) {
  const gR   = await VARGET('Shadow Roots',         x, y - 250);
  const gRI  = await ARR_GET(x + 220, y - 250);
  const gC   = await VARGET('ShadowColliders',      x, y - 100);
  const gCI  = await ARR_GET(x + 220, y - 100);
  const gMax = await VARGET('MaxDistance',          x, y + 80);
  const gOrg = await VARGET('Origin colision size', x, y + 230);
  const brkV = await BRK_VEC(x + 220, y + 230);
  const call = await UPD_CALL(x + 480, y - 170);

  await conn(gR, 'Shadow Roots', gRI, 'TargetArray');         await setPin(gRI, 'Index', String(idx));
  await conn(gC, 'ShadowColliders', gCI, 'TargetArray');      await setPin(gCI, 'Index', String(idx));
  await conn(gOrg, 'Origin colision size', brkV, 'InVec');
  await conn(gRI, 'Item',           call, 'TargetRoot');
  await conn(gCI, 'Item',           call, 'TargetCollider');
  await conn(topLocNode, 'ReturnValue', call, 'Start');
  await conn(normNode, 'ReturnValue',   call, 'Dir');
  await conn(gMax, 'MaxDistance',       call, 'MaxDistance');
  await conn(brkV, 'X',                 call, 'WidthX');
  await conn(brkV, 'Z',                 call, 'ThicknessZ');
  await conn(brNode, 'then',            call, 'execute');
}

async function resetForSlot(idx, brNode, x, y) {
  const gR   = await VARGET('Shadow Roots',    x, y - 200);
  const gRI  = await ARR_GET(x + 220, y - 200);
  const gC   = await VARGET('ShadowColliders', x, y - 60);
  const gCI  = await ARR_GET(x + 220, y - 60);
  const rst  = await RST_CALL(x + 460, y - 130);
  const gAB  = await VARGET('Active Ball',     x + 700, y - 130);
  const setI = await ARR_SET(x + 920, y - 130);

  await conn(gR, 'Shadow Roots',    gRI, 'TargetArray');    await setPin(gRI, 'Index', String(idx));
  await conn(gC, 'ShadowColliders', gCI, 'TargetArray');    await setPin(gCI, 'Index', String(idx));
  await conn(gRI, 'Item', rst, 'TargetRoot');
  await conn(gCI, 'Item', rst, 'TargetCollider');
  await conn(gAB, 'Active Ball', setI, 'TargetArray');
  await setPin(setI, 'Index', String(idx));
  // setI.Item left empty = null
  await conn(brNode, 'then', rst, 'execute');
  await conn(rst,    'then', setI, 'execute');
}

// ── Create ResetOneShadowCollider function ────────────────────────────────────
async function createResetFunction() {
  const FUNC = 'ResetOneShadowCollider';
  console.log(`  Creating ${FUNC}...`);
  try { await bp({ action: 'delete_function', path: BP, assetPath: BP, functionName: FUNC }); } catch {}
  await bp({ action: 'create_function', path: BP, assetPath: BP, functionName: FUNC, onConflict: 'skip' });
  for (const [parameterName, parameterType, isOutput] of [
    ['TargetRoot',     SCENE_CLS, false],
    ['TargetCollider', BOX_CLS,   false],
  ]) {
    await bp({ action: 'add_function_parameter', path: BP, assetPath: BP, functionName: FUNC, parameterName, parameterType, isOutput });
  }

  const g = await bp({ action: 'read_graph', path: BP, assetPath: BP, graphName: FUNC });
  const entry = g.nodes.find(n => n.class === 'K2Node_FunctionEntry');
  if (!entry) throw new Error('FunctionEntry missing in ' + FUNC);

  const addFN = (cls, params, x, y) => addN(FUNC, cls, params, x, y);
  const cfFN  = (fn, tc, x, y) => addFN('CallFunction', { functionName: fn, targetClass: tc }, x, y);

  // Get Origin colision size variable
  const gOrig = await addFN('K2Node_VariableGet', { variableName: 'Origin colision size' }, 200, 80);
  // Set Box Extent (reset collider size)
  const setExt = await cfFN('SetBoxExtent', BOX_CLS, 440, 0);
  // Set Collision Enabled = No Collision
  const setCol = await cfFN('SetCollisionEnabled', BOX_CLS, 720, 0);
  // Make Vector (0,0,0) for relative location reset
  const makeVec = await cfFN('MakeVector', MATH_CLS, 440, 200);
  // Set Relative Location on collider
  const setLoc = await cfFN('K2_SetRelativeLocation', SCENE_CLS, 720, 200);
  // Set World Rotation on root = default (make rotator 0,0,0)
  const makeRot = await addFN('CallFunction', { functionName: 'MakeRotator', targetClass: MATH_CLS }, 440, 380);
  const setRot = await cfFN('K2_SetWorldRotation', SCENE_CLS, 720, 380);

  // Connect entry TargetRoot/TargetCollider
  await connG(FUNC, entry.id, 'TargetCollider', setExt, 'self');
  await connG(FUNC, gOrig, 'Origin colision size', setExt, 'InBoxExtent');
  await connG(FUNC, entry.id, 'TargetCollider', setCol, 'self');
  await connG(FUNC, entry.id, 'TargetCollider', setLoc, 'self');
  await connG(FUNC, makeVec, 'ReturnValue', setLoc, 'NewLocation');
  await connG(FUNC, entry.id, 'TargetRoot', setRot, 'self');
  await connG(FUNC, makeRot, 'ReturnValue', setRot, 'NewRotation');

  // Exec chain: entry → setExt → setCol → setLoc → setRot
  await connG(FUNC, entry.id, 'then',   setExt, 'execute');
  await connG(FUNC, setExt,   'then',   setCol, 'execute');
  await connG(FUNC, setCol,   'then',   setLoc, 'execute');
  await connG(FUNC, setLoc,   'then',   setRot, 'execute');

  // Set collision mode = NoCollision (enum value 0)
  await setPinG(FUNC, setCol, 'NewType', 'ECollisionEnabled::NoCollision');

  console.log(`  ${FUNC} created`);
}

async function main() {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'phase34', version: '1.0' } });
  console.log('=== Phase 3+4 + ResetOneShadowCollider ===\n');

  // ─ Step 0: Create ResetOneShadowCollider ─────────────────────────────────────
  console.log('[0] Creating ResetOneShadowCollider...');
  await createResetFunction();

  // ─ Phase 3: ForEach slot lookup → UpdateOneShadowCollider ────────────────────
  console.log('\n[3] ForEach slot update...');
  await disc(ID.forEach, 'LoopBody', ID.sccCall, 'execute');

  const FX = 1600, FY = -2000;
  const feTop  = await VARGET('Top', FX, FY + 200);
  const feTopL = await GET_CL(FX + 220, FY + 200);
  const feSub  = await SUB_VV(FX + 480, FY + 100);
  const feNorm = await NORM(FX + 720, FY + 100);
  await conn(feTop, 'Top', feTopL, 'self');
  await conn(ID.ballActorLoc, 'ReturnValue', feSub, 'A');
  await conn(feTopL, 'ReturnValue', feSub, 'B');
  await conn(feSub, 'ReturnValue', feNorm, 'A');

  const eq0 = await slotEqCheck(0, ID.forEach, 'Array Element', FX + 1000, FY - 300);
  await updateForSlot(0, eq0.br, feTopL, feNorm, FX + 1950, FY - 300);
  const eq1 = await slotEqCheck(1, ID.forEach, 'Array Element', FX + 1000, FY + 100);
  await updateForSlot(1, eq1.br, feTopL, feNorm, FX + 1950, FY + 100);
  const eq2 = await slotEqCheck(2, ID.forEach, 'Array Element', FX + 1000, FY + 500);
  await updateForSlot(2, eq2.br, feTopL, feNorm, FX + 1950, FY + 500);

  await conn(ID.forEach, 'LoopBody', eq0.br, 'execute');
  await conn(eq0.br, 'else', eq1.br, 'execute');
  await conn(eq1.br, 'else', eq2.br, 'execute');
  console.log('  done');

  // ─ Phase 4: EndOverlap slot release ──────────────────────────────────────────
  console.log('\n[4] EndOverlap slot release...');
  await disc(ID.compEndOvlp, 'then', ID.clearActiveBall, 'execute');

  const EX = -6000, EY = 0;
  const eoEq0 = await slotEqCheck(0, ID.compEndOvlp, 'OtherActor', EX, EY);
  await resetForSlot(0, eoEq0.br, EX + 950, EY);
  const eoEq1 = await slotEqCheck(1, ID.compEndOvlp, 'OtherActor', EX, EY + 700);
  await resetForSlot(1, eoEq1.br, EX + 950, EY + 700);
  const eoEq2 = await slotEqCheck(2, ID.compEndOvlp, 'OtherActor', EX, EY + 1400);
  await resetForSlot(2, eoEq2.br, EX + 950, EY + 1400);

  await conn(ID.compEndOvlp, 'then',   eoEq0.br, 'execute');
  await conn(eoEq0.br, 'else', eoEq1.br, 'execute');
  await conn(eoEq1.br, 'else', eoEq2.br, 'execute');
  console.log('  done');

  // ─ Compile ────────────────────────────────────────────────────────────────────
  console.log('\n[5] Compiling...');
  try {
    const c = await bp({ action: 'compile', path: BP, assetPath: BP });
    console.log('  Result:', JSON.stringify(c).substring(0, 300));
  } catch (e) {
    console.log('  Error:', e.message.substring(0, 300));
  }

  console.log('\n=== Done ===');
  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
