// Slot System v3 — Correct node classes and pin names confirmed
// Active Ball array = SlotOwners (no new variable needed)
// All array ops via CallFunction + KismetArrayLibrary
//
// BeginPlay:    Clear(AB) → Add(null)×3      [fixed 3-slot init]
// BeginOverlap: bypass Add, use Array_Set at first empty slot
// ForEach body: slot lookup → UpdateOneShadowCollider
// EndOverlap:   slot lookup → ResetOneShadowCollider + Array_Set(null)

const { spawn } = require('child_process');
const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const BP      = '/Game/BluePrint/BP_Enemy1';
const EG      = 'EventGraph';

const ARR_CLS   = '/Script/Engine.KismetArrayLibrary';
const MATH_CLS  = '/Script/Engine.KismetMathLibrary';
const SYS_CLS   = '/Script/Engine.KismetSystemLibrary';
const SCENE_CLS = '/Script/Engine.SceneComponent';

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
  try { return JSON.parse(txt); } catch { return { success: false, error: txt || 'parse fail' }; }
}
async function bp(args) {
  const res = await rpc('tools/call', { name: 'blueprint', arguments: args });
  const p = payload(res);
  if (!p.success) throw new Error(p.error || JSON.stringify(p));
  return p;
}

// Node creators
const N       = (cls, params, x, y) => bp({ action: 'add_node', path: BP, assetPath: BP, graphName: EG, nodeClass: cls, nodeParams: params, posX: x, posY: y }).then(r => r.nodeId);
const VARGET  = (v, x, y)  => N('K2Node_VariableGet', { variableName: v }, x, y);
const BRANCH  = (x, y)     => N('K2Node_IfThenElse', {}, x, y);
const CF      = (fn, tc, x, y) => N('CallFunction', { functionName: fn, targetClass: tc }, x, y);
const ARR_CLEAR = (x, y)   => CF('Array_Clear', ARR_CLS, x, y);
const ARR_ADD   = (x, y)   => CF('Array_Add',   ARR_CLS, x, y);
const ARR_GET   = (x, y)   => CF('Array_Get',   ARR_CLS, x, y);
const ARR_SET   = (x, y)   => CF('Array_Set',   ARR_CLS, x, y);
const IS_VALID  = (x, y)   => CF('IsValid',      SYS_CLS, x, y);
const EQ_OBJ    = (x, y)   => CF('EqualEqual_ObjectObject', MATH_CLS, x, y);
const BRK_VEC   = (x, y)   => CF('BreakVector',  MATH_CLS, x, y);
const NORM      = (x, y)   => CF('Normal',        MATH_CLS, x, y);
const SUB_VV    = (x, y)   => CF('Subtract_VectorVector', MATH_CLS, x, y);
const GET_COMP_LOC = (x, y) => CF('K2_GetComponentLocation', SCENE_CLS, x, y);

// Connections
async function conn(from, fp, to, tp) {
  const fps = Array.isArray(fp) ? fp : [fp];
  const tps = Array.isArray(tp) ? tp : [tp];
  let last;
  for (const f of fps) for (const t of tps) {
    try { await bp({ action: 'connect_pins', path: BP, assetPath: BP, graphName: EG, sourceNode: from, sourcePin: f, targetNode: to, targetPin: t }); return; }
    catch (e) { last = e; }
  }
  throw new Error(`conn ${from}(${fp}) → ${to}(${tp}): ${last?.message?.substring(0, 100)}`);
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
  console.log(`  [warn setPin] ${nodeId}.${pin} = ${value}`);
}

// ── Existing node IDs ──────────────────────────────────────────────────────────
const ID = {
  setCollEnabled:  '6fm-K0NCMx0BRNi_iHWsKw',  // BeginPlay end
  castToBall:      'nlwGpEu8MFTGTCSUJxfrPA',  // Cast To BP_LightBall
  addActiveBall:   'v0ss2E_wc74cr5WRrHAxnQ',  // Add (Active Ball) — to be bypassed
  setIsInChecker:  'js5YkULyKJO5JLunztUrBw',  // Set isInChecker
  compBeginOvlp:   'kCeAXku2Xz37OKmQVsleuQ',  // Component Begin Overlap
  forEach:         'jJbwdk7ygBo1U6mM9tSkqw',  // For Each Loop
  sccCall:         'jpIs6konDQtHVMqzwLx-2w',  // Call Shadow Collision Change
  ballActorLoc:    'fZK8201rUXdK6eaEXmwMeQ',  // Get Actor Location (ForEach ball)
  compEndOvlp:     'nKCLHECZm8GUnhOtMrnQ1g',  // Component End Overlap
  clearActiveBall: '7XGCn0kHwNRQzn6lHyZxwA',  // Clear (Active Ball) in old EndOverlap
};

// ── Helper: slot IsValid check — True=occupied, False=empty ───────────────────
async function slotIsValidCheck(idx, x, y) {
  const gAB   = await VARGET('Active Ball', x,       y + 60);
  const getI  = await ARR_GET(              x + 220, y);
  const iv    = await IS_VALID(             x + 460, y - 60);
  const br    = await BRANCH(               x + 700, y);
  await conn(gAB, 'Active Ball', getI, 'TargetArray');
  await setPin(getI, 'Index', String(idx));
  await conn(getI, 'Item',        iv, 'Object');
  await conn(iv,   'ReturnValue', br, 'Condition');
  return { br };
}

// ── Helper: slot assign — Array_Set(Active Ball, idx, actor) ──────────────────
async function slotAssign(idx, actorNode, actorPin, x, y) {
  const gAB  = await VARGET('Active Ball', x,       y + 60);
  const setI = await ARR_SET(              x + 220, y);
  await conn(gAB,      'Active Ball', setI, 'TargetArray');
  await setPin(setI, 'Index', String(idx));
  await conn(actorNode, actorPin, setI, 'Item');
  return { setI };
}

// ── Helper: slot equality check — True=ball matches, False=no match ───────────
async function slotEqCheck(idx, ballNode, ballPin, x, y) {
  const gAB   = await VARGET('Active Ball', x,       y + 60);
  const getI  = await ARR_GET(              x + 220, y);
  const eq    = await EQ_OBJ(               x + 460, y);
  const br    = await BRANCH(               x + 720, y);
  await conn(gAB,      'Active Ball', getI, 'TargetArray');
  await setPin(getI, 'Index', String(idx));
  await conn(getI, 'Item',        eq, 'A');
  await conn(ballNode, ballPin,   eq, 'B');
  await conn(eq,   'ReturnValue', br, 'Condition');
  return { br };
}

// ── Helper: UpdateOneShadowCollider call for slot idx ─────────────────────────
async function updateForSlot(idx, brNode, topLocNode, normNode, x, y) {
  const gR   = await VARGET('Shadow Roots',         x,       y - 250);
  const gRI  = await ARR_GET(                       x + 220, y - 250);
  const gC   = await VARGET('ShadowColliders',      x,       y - 100);
  const gCI  = await ARR_GET(                       x + 220, y - 100);
  const gMax = await VARGET('MaxDistance',          x,       y +  80);
  const gOrg = await VARGET('Origin colision size', x,       y + 230);
  const brkV = await BRK_VEC(                       x + 220, y + 230);
  const call = await CF('UpdateOneShadowCollider', '', x + 480, y - 160);

  await conn(gR,   'Shadow Roots',         gRI,  'TargetArray');   await setPin(gRI,  'Index', String(idx));
  await conn(gC,   'ShadowColliders',      gCI,  'TargetArray');   await setPin(gCI,  'Index', String(idx));
  await conn(gOrg, 'Origin colision size', brkV, 'InVec');

  await conn(gRI,      'Item',         call, 'TargetRoot');
  await conn(gCI,      'Item',         call, 'TargetCollider');
  await conn(topLocNode,'ReturnValue', call, 'Start');
  await conn(normNode,  'ReturnValue', call, 'Dir');
  await conn(gMax,     'MaxDistance',  call, 'MaxDistance');
  await conn(brkV,     'X',           call, 'WidthX');
  await conn(brkV,     'Z',           call, 'ThicknessZ');
  await conn(brNode,   'then',        call, 'execute');
  return { call };
}

// ── Helper: ResetOneShadowCollider + clear slot ───────────────────────────────
async function resetForSlot(idx, brNode, x, y) {
  const gR   = await VARGET('Shadow Roots',    x,       y - 200);
  const gRI  = await ARR_GET(                  x + 220, y - 200);
  const gC   = await VARGET('ShadowColliders', x,       y -  60);
  const gCI  = await ARR_GET(                  x + 220, y -  60);
  const rst  = await CF('ResetOneShadowCollider', '', x + 460, y - 130);
  const gAB  = await VARGET('Active Ball',     x + 700, y - 130);
  const setI = await ARR_SET(                  x + 920, y - 130);

  await conn(gR,  'Shadow Roots',    gRI,  'TargetArray'); await setPin(gRI,  'Index', String(idx));
  await conn(gC,  'ShadowColliders', gCI,  'TargetArray'); await setPin(gCI,  'Index', String(idx));
  await conn(gRI, 'Item',  rst,  'TargetRoot');
  await conn(gCI, 'Item',  rst,  'TargetCollider');
  await conn(gAB, 'Active Ball', setI, 'TargetArray');
  await setPin(setI, 'Index', String(idx));
  // setI.Item left unconnected = null = clears slot
  await conn(brNode, 'then', rst,  'execute');
  await conn(rst,    'then', setI, 'execute');
  return { rst, setI };
}

async function main() {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'slot-v3', version: '1.0' } });
  console.log('=== Slot System v3 ===\n');

  // ─ Phase 1: BeginPlay — init Active Ball to [null, null, null] ──────────────
  console.log('[1] BeginPlay init...');
  const P1X = -1600, P1Y = 500;
  const p1c   = await ARR_CLEAR(P1X + 200, P1Y);
  const p1g0  = await VARGET('Active Ball', P1X,        P1Y + 80);
  const p1a0  = await ARR_ADD(P1X + 620,   P1Y);
  const p1g1  = await VARGET('Active Ball', P1X + 420,  P1Y + 80);
  const p1a1  = await ARR_ADD(P1X + 1040,  P1Y);
  const p1g2  = await VARGET('Active Ball', P1X + 840,  P1Y + 80);
  const p1a2  = await ARR_ADD(P1X + 1460,  P1Y);
  const p1g3  = await VARGET('Active Ball', P1X + 1260, P1Y + 80);

  await conn(p1g0, 'Active Ball', p1c,  'TargetArray');
  await conn(p1g1, 'Active Ball', p1a0, 'TargetArray');
  await conn(p1g2, 'Active Ball', p1a1, 'TargetArray');
  await conn(p1g3, 'Active Ball', p1a2, 'TargetArray');
  // NewItem on each Add left unconnected = null slot

  await conn(ID.setCollEnabled, 'then', p1c,  'execute');
  await conn(p1c,  'then', p1a0, 'execute');
  await conn(p1a0, 'then', p1a1, 'execute');
  await conn(p1a1, 'then', p1a2, 'execute');
  console.log('  done');

  // ─ Phase 2: BeginOverlap — bypass Add, fill first null slot ─────────────────
  console.log('[2] BeginOverlap slot assignment...');
  await disc(ID.castToBall,   'then', ID.addActiveBall,  'execute');
  await disc(ID.addActiveBall,'then', ID.setIsInChecker, 'execute');
  await conn(ID.castToBall, 'then', ID.setIsInChecker, 'execute');

  const BO_X = -3200, BO_Y = 700;

  const s0 = await slotIsValidCheck(0, BO_X,        BO_Y);
  const a0 = await slotAssign(0, ID.compBeginOvlp, 'OtherActor', BO_X,        BO_Y + 420);
  const s1 = await slotIsValidCheck(1, BO_X + 1000, BO_Y);
  const a1 = await slotAssign(1, ID.compBeginOvlp, 'OtherActor', BO_X + 1000, BO_Y + 420);
  const s2 = await slotIsValidCheck(2, BO_X + 2000, BO_Y);
  const a2 = await slotAssign(2, ID.compBeginOvlp, 'OtherActor', BO_X + 2000, BO_Y + 420);

  // Chain: SetIsInChecker → Br0: True→Br1 False→Set0; Br1: True→Br2 False→Set1; Br2: else→Set2
  await conn(ID.setIsInChecker, 'then', s0.br, 'execute');
  await conn(s0.br, 'then',  s1.br,  'execute');
  await conn(s0.br, 'else',  a0.setI, 'execute');
  await conn(s1.br, 'then',  s2.br,  'execute');
  await conn(s1.br, 'else',  a1.setI, 'execute');
  await conn(s2.br, 'else',  a2.setI, 'execute');
  console.log('  done');

  // ─ Phase 3: ForEach — slot lookup → UpdateOneShadowCollider ──────────────────
  console.log('[3] ForEach slot update (replacing SCC call)...');
  await disc(ID.forEach, 'LoopBody', ID.sccCall, 'execute');

  // Shared pure computation: TopLoc and Dir
  const FX = 1600, FY = -2000;
  const feTop  = await VARGET('Top', FX,       FY + 200);
  const feTopL = await GET_COMP_LOC(FX + 220,  FY + 200);
  const feSub  = await SUB_VV(       FX + 480,  FY + 100);
  const feNorm = await NORM(         FX + 720,  FY + 100);

  await conn(feTop, 'Top',          feTopL, 'self');
  await conn(ID.ballActorLoc, 'ReturnValue', feSub, 'A');
  await conn(feTopL, 'ReturnValue', feSub,  'B');
  await conn(feSub,  'ReturnValue', feNorm, 'A');

  // Slot 0
  const eq0 = await slotEqCheck(0, ID.forEach, 'Array Element', FX + 1000, FY - 300);
  await updateForSlot(0, eq0.br, feTopL, feNorm, FX + 1950, FY - 300);

  // Slot 1
  const eq1 = await slotEqCheck(1, ID.forEach, 'Array Element', FX + 1000, FY + 100);
  await updateForSlot(1, eq1.br, feTopL, feNorm, FX + 1950, FY + 100);

  // Slot 2
  const eq2 = await slotEqCheck(2, ID.forEach, 'Array Element', FX + 1000, FY + 500);
  await updateForSlot(2, eq2.br, feTopL, feNorm, FX + 1950, FY + 500);

  // Exec chain: ForEach.LoopBody → eq0.br → else→eq1 → else→eq2
  await conn(ID.forEach, 'LoopBody', eq0.br, 'execute');
  await conn(eq0.br, 'else', eq1.br, 'execute');
  await conn(eq1.br, 'else', eq2.br, 'execute');
  console.log('  done');

  // ─ Phase 4: EndOverlap — slot release ────────────────────────────────────────
  console.log('[4] EndOverlap slot release...');
  await disc(ID.compEndOvlp, 'then', ID.clearActiveBall, 'execute');

  const EX = -6000, EY = 0;

  const eoEq0 = await slotEqCheck(0, ID.compEndOvlp, 'OtherActor', EX,        EY);
  await resetForSlot(0, eoEq0.br, EX + 950, EY);

  const eoEq1 = await slotEqCheck(1, ID.compEndOvlp, 'OtherActor', EX,        EY + 700);
  await resetForSlot(1, eoEq1.br, EX + 950, EY + 700);

  const eoEq2 = await slotEqCheck(2, ID.compEndOvlp, 'OtherActor', EX,        EY + 1400);
  await resetForSlot(2, eoEq2.br, EX + 950, EY + 1400);

  await conn(ID.compEndOvlp, 'then',  eoEq0.br, 'execute');
  await conn(eoEq0.br, 'else', eoEq1.br, 'execute');
  await conn(eoEq1.br, 'else', eoEq2.br, 'execute');
  console.log('  done');

  // ─ Phase 5: Compile ──────────────────────────────────────────────────────────
  console.log('\n[5] Compiling...');
  try {
    const c = await bp({ action: 'compile', path: BP, assetPath: BP });
    console.log('  Result:', JSON.stringify(c).substring(0, 300));
  } catch (e) {
    console.log('  Compile error:', e.message.substring(0, 300));
  }

  console.log('\n=== Done ===');
  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
