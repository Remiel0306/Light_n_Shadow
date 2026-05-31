/**
 * Complete enemy walk + loop patrol + walk animation
 * Requires Unreal Editor + UE_MCP_Bridge running
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
const PATROL_RADIUS = 600;
const WALK_SPEED = 200;
const TIMER_SEC = 5;

const mcp = spawn('npx.cmd', ['ue-mcp', PROJECT], { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
let reqId = 1;
const pending = new Map();
let buf = '';

function rpc(method, params, ms = 180000) {
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
    return { success: false, raw: txt };
  }
}

async function bp(args, opt = false) {
  const res = await rpc('tools/call', { name: 'blueprint', arguments: args });
  const p = parseTool(res);
  if (!opt && p.success === false && p.error) throw new Error(p.error);
  return p;
}

async function tryConn(graph, a, ap, b, tp) {
  for (const x of ap) {
    for (const y of tp) {
      try {
        const r = await bp({
          action: 'connect_pins',
          path: AIC,
          assetPath: AIC,
          graphName: graph,
          sourceNode: a,
          sourcePin: x,
          targetNode: b,
          targetPin: y,
        });
        if (r.success !== false) return true;
      } catch (_) {}
    }
  }
  return false;
}

async function addNode(graph, nodeClass, nodeParams, x, y) {
  const r = await bp({
    action: 'add_node',
    path: AIC,
    assetPath: AIC,
    graphName: graph,
    nodeClass,
    nodeParams,
    posX: x,
    posY: y,
  });
  return r.nodeId;
}

async function deleteAllNodes(graph) {
  const g = await bp({ action: 'read_graph', path: AIC, assetPath: AIC, graphName: graph });
  for (const n of g.nodes || []) {
    if (n.class === 'K2Node_FunctionEntry' || n.class === 'K2Node_FunctionResult') continue;
    if (n.class === 'K2Node_Event' || n.class === 'K2Node_CustomEvent') continue;
    try {
      await bp(
        {
          action: 'delete_node',
          path: AIC,
          assetPath: AIC,
          graphName: graph,
          nodeName: n.id,
        },
        true
      );
    } catch (_) {}
  }
}

async function getEntry(graph) {
  const g = await bp({ action: 'read_graph', path: AIC, assetPath: AIC, graphName: graph });
  const entry = (g.nodes || []).find((n) => n.class === 'K2Node_FunctionEntry');
  if (!entry) throw new Error(`no entry in ${graph}`);
  return entry.id;
}

async function recreateStartPatrol() {
  try {
    await bp({ action: 'delete_function', path: AIC, assetPath: AIC, functionName: FN }, true);
  } catch (_) {}
  await bp({ action: 'create_function', path: AIC, assetPath: AIC, functionName: FN, onConflict: 'replace' });

  const eid = await getEntry(FN);

  const getPawn = await addNode(FN, 'CallFunction', {
    functionName: 'K2_GetPawn',
    targetClass: '/Script/AIModule.AIController',
  }, 400, 0);
  const cast = await addNode(FN, 'K2Node_DynamicCast', { targetClass: ENEMY_CLASS }, 650, 0);
  const getMove = await addNode(FN, 'CallFunction', {
    functionName: 'GetMovementComponent',
    targetClass: '/Script/Engine.Pawn',
  }, 900, -40);
  const setSpeed = await addNode(FN, 'CallFunction', {
    functionName: 'SetMaxWalkSpeed',
    targetClass: '/Script/Engine.CharacterMovementComponent',
  }, 1150, -40);
  const getLoc = await addNode(FN, 'CallFunction', {
    functionName: 'K2_GetActorLocation',
    targetClass: '/Script/Engine.Actor',
  }, 900, 120);
  const randomPt = await addNode(FN, 'CallFunction', {
    functionName: 'K2_GetRandomReachablePointInRadius',
    targetClass: '/Script/Engine.NavigationSystemV1',
  }, 1150, 120);
  const branch = await addNode(FN, 'Branch', {}, 1450, 120);
  const selfRef = await addNode(FN, 'K2Node_Self', {}, 1450, 280);
  const moveTo = await addNode(FN, 'CallFunction', {
    functionName: 'MoveToLocation',
    targetClass: '/Script/AIModule.AIController',
  }, 1700, 120);

  // Literal radius on random node
  try {
    await bp({
      action: 'set_node_property',
      path: AIC,
      assetPath: AIC,
      graphName: FN,
      nodeName: randomPt,
      propertyName: 'Radius',
      value: PATROL_RADIUS,
    });
  } catch (_) {}

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
  await tryConn(FN, getLoc, ['then'], randomPt, ['execute']);
  await tryConn(FN, randomPt, ['ReturnValue'], branch, ['Condition']);
  await tryConn(FN, branch, ['then'], moveTo, ['execute']);
  await tryConn(FN, randomPt, ['RandomLocation'], moveTo, ['Dest']);
  await tryConn(FN, selfRef, ['self'], moveTo, ['self', 'Target']);

  try {
    await bp({
      action: 'set_node_property',
      path: AIC,
      assetPath: AIC,
      graphName: FN,
      nodeName: setSpeed,
      propertyName: 'NewMaxWalkSpeed',
      value: WALK_SPEED,
    });
  } catch (_) {}

  try {
    await bp({
      action: 'set_node_property',
      path: AIC,
      assetPath: AIC,
      graphName: FN,
      nodeName: moveTo,
      propertyName: 'AcceptanceRadius',
      value: 75,
    });
  } catch (_) {}

  console.log('  StartPatrol rebuilt');
}

async function wireEventGraph() {
  await deleteAllNodes(EG);

  let g = await bp({ action: 'read_graph', path: AIC, assetPath: AIC, graphName: EG });
  let begin = (g.nodes || []).find((n) => n.title === 'Event BeginPlay');
  if (!begin) {
    const added = await addNode(EG, 'K2Node_Event', { eventName: 'ReceiveBeginPlay' }, 0, 0);
    g = await bp({ action: 'read_graph', path: AIC, assetPath: AIC, graphName: EG });
    begin = (g.nodes || []).find((n) => n.id === added) || (g.nodes || []).find((n) => /BeginPlay/i.test(n.title || ''));
  }
  if (!begin) throw new Error('no BeginPlay');
  const bid = begin.id;

  const callPatrol1 = await addNode(EG, 'CallFunction', { functionName: FN, targetClass: AIC_CLASS }, 500, 0);
  let setTimer = await addNode(EG, 'CallFunction', {
    functionName: 'K2_SetTimer',
    targetClass: '/Script/Engine.KismetSystemLibrary',
  }, 750, 0);
  const selfRef = await addNode(EG, 'K2Node_Self', {}, 750, 200);

  await tryConn(EG, bid, ['then'], callPatrol1, ['execute']);
  await tryConn(EG, callPatrol1, ['then'], setTimer, ['execute']);
  await tryConn(EG, selfRef, ['self'], setTimer, ['Object', 'self']);

  const timerProps = [
    ['FunctionName', FN],
    ['Time', TIMER_SEC],
    ['bLooping', true],
  ];
  for (const [prop, val] of timerProps) {
    try {
      await bp({
        action: 'set_node_property',
        path: AIC,
        assetPath: AIC,
        graphName: EG,
        nodeName: setTimer,
        propertyName: prop,
        value: val,
      });
    } catch (_) {}
  }

  console.log('  EventGraph: BeginPlay -> StartPatrol -> looping timer');
}

async function setupEnemyDefaults() {
  for (const [prop, val] of [
    ['AIControllerClass', AIC_CLASS],
    ['AutoPossessAI', 'PlacedInWorldOrSpawned'],
  ]) {
    try {
      const r = await bp({
        action: 'set_class_default',
        path: ENEMY,
        assetPath: ENEMY,
        propertyName: prop,
        value: val,
      });
      console.log('  enemy', prop, r.value || 'ok');
    } catch (e) {
      console.log('  enemy', prop, 'warn:', e.message);
    }
  }

  for (const comp of ['Mesh', 'CharacterMesh0', 'SkeletalMeshComponent']) {
    for (const [prop, val] of [
      ['AnimClass', ABP_CLASS],
      ['AnimationMode', 'AnimationBlueprint'],
    ]) {
      try {
        await bp({
          action: 'set_component_property',
          path: ENEMY,
          assetPath: ENEMY,
          componentName: comp,
          propertyName: prop,
          value: val,
        });
        console.log('  mesh', comp, prop, 'ok');
        break;
      } catch (e) {
        /* try next comp name */
      }
    }
  }

  try {
    await bp({
      action: 'set_component_property',
      path: ENEMY,
      assetPath: ENEMY,
      componentName: 'CharMoveComp',
      propertyName: 'MaxWalkSpeed',
      value: WALK_SPEED,
    });
    await bp({
      action: 'set_component_property',
      path: ENEMY,
      assetPath: ENEMY,
      componentName: 'CharMoveComp',
      propertyName: 'bOrientRotationToMovement',
      value: true,
    });
    console.log('  CharacterMovement ok');
  } catch (e) {
    console.log('  CharacterMovement warn:', e.message);
  }
}

async function main() {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'setup_enemy_walk', version: '1' },
  });

  console.log('=== Enemy walk + anim setup ===\n');

  const check = await bp({ action: 'read', path: AIC, assetPath: AIC }, true);
  if (!check.success) throw new Error('AIC not found: ' + AIC);

  await setupEnemyDefaults();
  await recreateStartPatrol();
  await wireEventGraph();

  const v1 = await bp({ action: 'validate', path: AIC, assetPath: AIC });
  const v2 = await bp({ action: 'validate', path: ENEMY, assetPath: ENEMY });
  console.log('\nvalidate AIC:', v1.valid, 'errors:', v1.errorCount);
  console.log('validate Enemy:', v2.valid, 'errors:', v2.errorCount);

  await bp({ action: 'compile', path: AIC, assetPath: AIC });
  await bp({ action: 'compile', path: ENEMY, assetPath: ENEMY });
  console.log('compiled both');

  const report = {
    done: true,
    enemy: ENEMY,
    aic: AIC,
    animClass: ABP_CLASS,
    timerSec: TIMER_SEC,
    patrolRadius: PATROL_RADIUS,
  };
  fs.writeFileSync('setup_enemy_walk_report.json', JSON.stringify(report, null, 2));
  console.log('\nDone. Wrote setup_enemy_walk_report.json');
  console.log('Level: ensure Nav Mesh Bounds Volume + enemy on green nav (P key).');

  mcp.kill();
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  mcp.kill();
  process.exit(1);
});
