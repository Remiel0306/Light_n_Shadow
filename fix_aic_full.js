/**
 * Repair AIC: EventGraph + StartPatrol, fix None nodes
 */
const fs = require('fs');
const { spawn } = require('child_process');
const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const ENEMY = '/Game/BluePrint/Enemy/BP_EnemyShadowLogic';
const ENEMY_CLASS = '/Game/BluePrint/Enemy/BP_EnemyShadowLogic.BP_EnemyShadowLogic_C';
const AIC = '/Game/BluePrint/System/BP_EnemyAIController';
const AIC_CLASS = '/Game/BluePrint/System/BP_EnemyAIController.BP_EnemyAIController_C';
const ABP_CLASS = '/Game/Characters/Mannequins/Anims/Unarmed/ABP_Unarmed.ABP_Unarmed_C';
const EG = 'EventGraph';
const FN = 'StartPatrol';

const mcp = spawn('npx.cmd', ['ue-mcp', PROJECT], { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
let id = 1, pending = new Map(), buf = '';
function rpc(m, p, ms = 180000) {
  return new Promise((res, rej) => {
    const i = id++;
    const t = setTimeout(() => rej(new Error('timeout')), ms);
    pending.set(i, (msg) => { clearTimeout(t); res(msg); });
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method: m, params: p }) + '\n');
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
  try { return JSON.parse(res?.result?.content?.[0]?.text); } catch { return { success: false }; }
}
async function bp(args, soft = false) {
  const p = parse(await rpc('tools/call', { name: 'blueprint', arguments: args }));
  if (!soft && p.success === false && p.error) throw new Error(p.error);
  return p;
}
async function tryConn(graph, a, ap, b, tp) {
  for (const x of ap) for (const y of tp) {
    const r = await bp({ action: 'connect_pins', path: AIC, assetPath: AIC, graphName: graph, sourceNode: a, sourcePin: x, targetNode: b, targetPin: y }, true);
    if (r.success !== false) return true;
  }
  return false;
}
async function addNode(graph, nodeClass, nodeParams, x, y) {
  const r = await bp({ action: 'add_node', path: AIC, assetPath: AIC, graphName: graph, nodeClass, nodeParams, posX: x, posY: y });
  return r.nodeId;
}
async function cleanNone(graph) {
  const g = await bp({ action: 'read_graph', path: AIC, assetPath: AIC, graphName: graph });
  for (const n of g.nodes || []) {
    if (n.title === 'None' || (n.class === 'K2Node_CallFunction' && /^None$/i.test((n.title || '').trim()))) {
      await bp({ action: 'delete_node', path: AIC, assetPath: AIC, graphName: graph, nodeName: n.id }, true);
      console.log('  del None in', graph);
    }
  }
}
async function deleteGraphExceptEvents(graph) {
  const g = await bp({ action: 'read_graph', path: AIC, assetPath: AIC, graphName: graph });
  for (const n of g.nodes || []) {
    if (['K2Node_Event', 'K2Node_FunctionEntry', 'K2Node_FunctionResult'].includes(n.class)) continue;
    await bp({ action: 'delete_node', path: AIC, assetPath: AIC, graphName: graph, nodeName: n.id }, true);
  }
}

async function buildStartPatrol() {
  try { await bp({ action: 'delete_function', path: AIC, assetPath: AIC, functionName: FN }, true); } catch (_) {}
  await bp({ action: 'create_function', path: AIC, assetPath: AIC, functionName: FN, onConflict: 'replace' });
  const g0 = await bp({ action: 'read_graph', path: AIC, assetPath: AIC, graphName: FN });
  const eid = g0.nodes.find((n) => n.class === 'K2Node_FunctionEntry').id;

  const getPawn = await addNode(FN, 'CallFunction', { functionName: 'K2_GetPawn', targetClass: '/Script/AIModule.AIController' }, 400, 0);
  const cast = await addNode(FN, 'K2Node_DynamicCast', { targetClass: ENEMY_CLASS }, 650, 0);
  const getMove = await addNode(FN, 'CallFunction', { functionName: 'GetMovementComponent', targetClass: '/Script/Engine.Pawn' }, 900, -40);
  const setSpeed = await addNode(FN, 'CallFunction', { functionName: 'SetMaxWalkSpeed', targetClass: '/Script/Engine.CharacterMovementComponent' }, 1150, -40);
  const getLoc = await addNode(FN, 'CallFunction', { functionName: 'K2_GetActorLocation', targetClass: '/Script/Engine.Actor' }, 900, 120);
  const randomPt = await addNode(FN, 'CallFunction', { functionName: 'K2_GetRandomReachablePointInRadius', targetClass: '/Script/Engine.NavigationSystemV1' }, 1150, 120);
  const branch = await addNode(FN, 'Branch', {}, 1450, 120);
  const selfRef = await addNode(FN, 'K2Node_Self', {}, 1450, 280);
  const moveTo = await addNode(FN, 'CallFunction', { functionName: 'MoveToLocation', targetClass: '/Script/AIModule.AIController' }, 1700, 120);

  await tryConn(FN, eid, ['then'], getPawn, ['execute']);
  await tryConn(FN, getPawn, ['then'], cast, ['execute']);
  await tryConn(FN, getPawn, ['ReturnValue'], cast, ['Object']);
  await tryConn(FN, cast, ['then'], getMove, ['execute']);
  await tryConn(FN, cast, ['AsBP Enemy Shadow Logic', 'AsBP_EnemyShadowLogic'], getMove, ['self', 'Target']);
  await tryConn(FN, getMove, ['then'], setSpeed, ['execute']);
  await tryConn(FN, getMove, ['ReturnValue'], setSpeed, ['self']);
  await tryConn(FN, setSpeed, ['then'], branch, ['execute']);
  await tryConn(FN, cast, ['AsBP Enemy Shadow Logic', 'AsBP_EnemyShadowLogic'], getLoc, ['self', 'Target']);
  await tryConn(FN, getLoc, ['ReturnValue'], randomPt, ['Origin']);
  await tryConn(FN, randomPt, ['ReturnValue'], branch, ['Condition']);
  await tryConn(FN, branch, ['then'], moveTo, ['execute']);
  await tryConn(FN, randomPt, ['RandomLocation'], moveTo, ['Dest']);
  await tryConn(FN, selfRef, ['self'], moveTo, ['self', 'Target']);

  for (const [node, prop, val] of [
    [randomPt, 'Radius', 600],
    [setSpeed, 'NewMaxWalkSpeed', 200],
    [moveTo, 'AcceptanceRadius', 75],
  ]) {
    try { await bp({ action: 'set_node_property', path: AIC, assetPath: AIC, graphName: FN, nodeName: node, propertyName: prop, value: val }); } catch (_) {}
  }
  await cleanNone(FN);
}

async function buildEventGraph() {
  await deleteGraphExceptEvents(EG);
  await cleanNone(EG);
  let g = await bp({ action: 'read_graph', path: AIC, assetPath: AIC, graphName: EG });
  let begin = g.nodes.find((n) => /BeginPlay/i.test(n.title || ''));
  if (!begin) {
    await addNode(EG, 'K2Node_Event', { eventName: 'ReceiveBeginPlay' }, 0, 0);
    g = await bp({ action: 'read_graph', path: AIC, assetPath: AIC, graphName: EG });
    begin = g.nodes.find((n) => /BeginPlay/i.test(n.title || ''));
  }

  const callPatrol = await addNode(EG, 'CallFunction', { functionName: FN, targetClass: AIC_CLASS }, 450, 0);
  const timer = await addNode(EG, 'CallFunction', { functionName: 'K2_SetTimer', targetClass: '/Script/Engine.KismetSystemLibrary' }, 700, 0);
  const selfRef = await addNode(EG, 'K2Node_Self', {}, 700, 180);

  await tryConn(EG, begin.id, ['then'], callPatrol, ['execute']);
  await tryConn(EG, callPatrol, ['then'], timer, ['execute']);
  await tryConn(EG, selfRef, ['self'], timer, ['Object', 'self']);
  for (const [prop, val] of [
    ['FunctionName', FN],
    ['Time', 5],
    ['bLooping', true],
  ]) {
    try { await bp({ action: 'set_node_property', path: AIC, assetPath: AIC, graphName: EG, nodeName: timer, propertyName: prop, value: val }); } catch (_) {}
  }
  await cleanNone(EG);
}

async function setupEnemy() {
  for (const [prop, val] of [
    ['AIControllerClass', AIC_CLASS],
    ['AutoPossessAI', 'PlacedInWorldOrSpawned'],
  ]) {
    await bp({ action: 'set_class_default', path: ENEMY, assetPath: ENEMY, propertyName: prop, value: val }, true);
  }
  await bp({ action: 'set_component_property', path: ENEMY, assetPath: ENEMY, componentName: 'CharacterMesh0', propertyName: 'AnimClass', value: ABP_CLASS }, true);
  await bp({ action: 'set_component_property', path: ENEMY, assetPath: ENEMY, componentName: 'CharacterMesh0', propertyName: 'AnimationMode', value: 'AnimationBlueprint' }, true);
  await bp({ action: 'set_component_property', path: ENEMY, assetPath: ENEMY, componentName: 'CharMoveComp', propertyName: 'MaxWalkSpeed', value: 200 }, true);
  await bp({ action: 'set_component_property', path: ENEMY, assetPath: ENEMY, componentName: 'CharMoveComp', propertyName: 'bOrientRotationToMovement', value: true }, true);
}

(async () => {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fix_full' } });
  console.log('setup enemy defaults...');
  await setupEnemy();
  console.log('build StartPatrol...');
  await buildStartPatrol();
  console.log('build EventGraph...');
  await buildEventGraph();
  const v = await bp({ action: 'validate', path: AIC, assetPath: AIC });
  console.log('AIC valid:', v.valid, 'errors:', v.errorCount);
  if (v.messages) v.messages.forEach((m) => console.log(' ', m.severity, m.message.split('\n')[0]));
  await bp({ action: 'compile', path: AIC, assetPath: AIC });
  await bp({ action: 'compile', path: ENEMY, assetPath: ENEMY });
  console.log('done');
  mcp.kill();
})().catch((e) => { console.error(e); mcp.kill(); process.exit(1); });
