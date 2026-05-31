/**
 * Per-enemy patrol area: PatrolOriginActor + PatrolRadius on pawn, read in StartPatrol
 */
const fs = require('fs');
const { spawn } = require('child_process');

const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const ENEMY = '/Game/BluePrint/Enemy/BP_EnemyShadowLogic';
const ENEMY_CLASS = '/Game/BluePrint/Enemy/BP_EnemyShadowLogic.BP_EnemyShadowLogic_C';
const AIC = '/Game/BluePrint/System/BP_EnemyAIController';
const AIC_CLASS = '/Game/BluePrint/System/BP_EnemyAIController.BP_EnemyAIController_C';
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
async function tryConn(a, ap, b, tp) {
  for (const x of ap) for (const y of tp) {
    const r = await bp({ action: 'connect_pins', path: AIC, assetPath: AIC, graphName: FN, sourceNode: a, sourcePin: x, targetNode: b, targetPin: y }, true);
    if (r.success !== false) return true;
  }
  return false;
}
async function addNode(nodeClass, nodeParams, x, y) {
  const r = await bp({ action: 'add_node', path: AIC, assetPath: AIC, graphName: FN, nodeClass, nodeParams, posX: x, posY: y });
  return r.nodeId;
}

async function ensureEnemyVars() {
  const vars = await bp({ action: 'list_variables', path: ENEMY, assetPath: ENEMY }, true);
  const names = (vars.variables || []).map((v) => v.name);
  if (!names.includes('PatrolOriginActor')) {
    await bp(
      {
        action: 'add_variable',
        path: ENEMY,
        assetPath: ENEMY,
        variableName: 'PatrolOriginActor',
        variableType: 'object',
        isInstanceEditable: true,
      },
      true
    );
    console.log('  added PatrolOriginActor on enemy');
  }
  if (!names.includes('PatrolRadius')) {
    await bp(
      {
        action: 'add_variable',
        path: ENEMY,
        assetPath: ENEMY,
        variableName: 'PatrolRadius',
        variableType: 'real',
        isInstanceEditable: true,
      },
      true
    );
    console.log('  added PatrolRadius on enemy');
  }
  try {
    await bp({
      action: 'set_variable_default',
      path: ENEMY,
      assetPath: ENEMY,
      variableName: 'PatrolRadius',
      defaultValue: 600,
    });
  } catch (_) {}
}

async function rebuildStartPatrol() {
  let g0 = await bp({ action: 'read_graph', path: AIC, assetPath: AIC, graphName: FN }, true);
  if (!g0.success || !(g0.nodes || []).length) {
    await bp({ action: 'create_function', path: AIC, assetPath: AIC, functionName: FN, onConflict: 'skip' });
    g0 = await bp({ action: 'read_graph', path: AIC, assetPath: AIC, graphName: FN });
  }
  for (const n of g0.nodes || []) {
    if (n.class === 'K2Node_FunctionEntry' || n.class === 'K2Node_FunctionResult') continue;
    await bp({ action: 'delete_node', path: AIC, assetPath: AIC, graphName: FN, nodeName: n.id }, true);
  }
  g0 = await bp({ action: 'read_graph', path: AIC, assetPath: AIC, graphName: FN });
  const entry = (g0.nodes || []).find((n) => n.class === 'K2Node_FunctionEntry');
  if (!entry) throw new Error('StartPatrol function entry missing');
  const eid = entry.id;

  const getPawn = await addNode('CallFunction', { functionName: 'K2_GetPawn', targetClass: '/Script/AIModule.AIController' }, 200, 0);
  const cast = await addNode('K2Node_DynamicCast', { targetClass: ENEMY_CLASS }, 450, 0);
  const getMove = await addNode('CallFunction', { functionName: 'GetMovementComponent', targetClass: '/Script/Engine.Pawn' }, 700, -60);
  const setSpeed = await addNode('CallFunction', { functionName: 'SetMaxWalkSpeed', targetClass: '/Script/Engine.CharacterMovementComponent' }, 950, -60);

  const getOriginVar = await addNode('GetVar', { variableName: 'PatrolOriginActor', ownerClass: ENEMY_CLASS }, 700, 80);
  const isValid = await addNode('CallFunction', { functionName: 'IsValid', targetClass: '/Script/Engine.KismetSystemLibrary' }, 950, 80);
  const branchOrigin = await addNode('Branch', {}, 1200, 80);

  const getOriginLoc = await addNode('CallFunction', { functionName: 'K2_GetActorLocation', targetClass: '/Script/Engine.Actor' }, 1450, 20);
  const getPawnLoc = await addNode('CallFunction', { functionName: 'K2_GetActorLocation', targetClass: '/Script/Engine.Actor' }, 1450, 180);

  const getRadius = await addNode('GetVar', { variableName: 'PatrolRadius', ownerClass: ENEMY_CLASS }, 1200, 320);
  const randomPt = await addNode('CallFunction', { functionName: 'K2_GetRandomReachablePointInRadius', targetClass: '/Script/Engine.NavigationSystemV1' }, 1700, 120);
  const branchRandom = await addNode('Branch', {}, 2000, 120);
  const selfRef = await addNode('K2Node_Self', {}, 2000, 280);
  const moveTo = await addNode('CallFunction', { functionName: 'MoveToLocation', targetClass: '/Script/AIModule.AIController' }, 2250, 120);

  const castPins = ['AsBP Enemy Shadow Logic', 'AsBP_EnemyShadowLogic'];

  await tryConn(eid, ['then'], getPawn, ['execute']);
  await tryConn(getPawn, ['then'], cast, ['execute']);
  await tryConn(getPawn, ['ReturnValue'], cast, ['Object']);
  await tryConn(cast, ['then'], getMove, ['execute']);
  await tryConn(cast, castPins, getMove, ['self', 'Target']);
  await tryConn(getMove, ['then'], setSpeed, ['execute']);
  await tryConn(getMove, ['ReturnValue'], setSpeed, ['self']);
  await tryConn(setSpeed, ['then'], branchOrigin, ['execute']);

  await tryConn(cast, castPins, getOriginVar, ['self', 'Target']);
  await tryConn(getOriginVar, ['PatrolOriginActor', 'ReturnValue'], isValid, ['InputObject', 'Object']);
  await tryConn(isValid, ['ReturnValue', 'bIsValid'], branchOrigin, ['Condition']);

  await tryConn(branchOrigin, ['then'], getOriginLoc, ['execute']);
  await tryConn(branchOrigin, ['else'], getPawnLoc, ['execute']);
  await tryConn(getOriginVar, ['PatrolOriginActor', 'ReturnValue'], getOriginLoc, ['self', 'Target']);
  await tryConn(cast, castPins, getPawnLoc, ['self', 'Target']);

  await tryConn(getOriginLoc, ['then'], randomPt, ['execute']);
  await tryConn(getPawnLoc, ['then'], randomPt, ['execute']);
  await tryConn(getOriginLoc, ['ReturnValue'], randomPt, ['Origin']);
  await tryConn(getPawnLoc, ['ReturnValue'], randomPt, ['Origin']);

  await tryConn(cast, castPins, getRadius, ['self', 'Target']);
  await tryConn(getRadius, ['PatrolRadius', 'ReturnValue'], randomPt, ['Radius']);

  await tryConn(randomPt, ['ReturnValue'], branchRandom, ['Condition']);
  await tryConn(randomPt, ['then'], branchRandom, ['execute']);
  await tryConn(branchRandom, ['then'], moveTo, ['execute']);
  await tryConn(randomPt, ['RandomLocation'], moveTo, ['Dest']);
  await tryConn(selfRef, ['self'], moveTo, ['self', 'Target']);

  for (const [node, prop, val] of [
    [setSpeed, 'NewMaxWalkSpeed', 200],
    [moveTo, 'AcceptanceRadius', 75],
  ]) {
    try { await bp({ action: 'set_node_property', path: AIC, assetPath: AIC, graphName: FN, nodeName: node, propertyName: prop, value: val }); } catch (_) {}
  }

  const g = await bp({ action: 'read_graph', path: AIC, assetPath: AIC, graphName: FN });
  for (const n of g.nodes || []) {
    if (n.title === 'None') await bp({ action: 'delete_node', path: AIC, assetPath: AIC, graphName: FN, nodeName: n.id }, true);
  }
  console.log('  StartPatrol: per-enemy origin + radius');
}

(async () => {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'per_enemy_patrol' } });
  await ensureEnemyVars();
  await rebuildStartPatrol();
  const v = await bp({ action: 'validate', path: AIC, assetPath: AIC });
  console.log('AIC valid:', v.valid, 'errors:', v.errorCount);
  await bp({ action: 'compile', path: AIC, assetPath: AIC });
  await bp({ action: 'compile', path: ENEMY, assetPath: ENEMY });
  fs.writeFileSync(
    'setup_per_enemy_patrol_report.json',
    JSON.stringify({ enemy: ENEMY, aic: AIC, valid: v.valid }, null, 2)
  );
  console.log('done — assign Target Point per enemy in level Details');
  mcp.kill();
})().catch((e) => { console.error(e); mcp.kill(); process.exit(1); });
