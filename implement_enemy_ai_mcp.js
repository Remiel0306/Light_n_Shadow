/**
 * Enemy AI: BP_EnemyShadowLogic (pawn) + BP_EnemyAIController
 * Requires Unreal Editor + UE_MCP_Bridge.
 */
const fs = require('fs');
const { spawn } = require('child_process');

const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const ENEMY = '/Game/BluePrint/BP_EnemyShadowLogic';
const ENEMY_CLASS = '/Game/BluePrint/BP_EnemyShadowLogic.BP_EnemyShadowLogic_C';
const AIC = '/Game/BluePrint/Enemy/BP_EnemyAIController';
const AIC_CLASS = '/Game/BluePrint/Enemy/BP_EnemyAIController.BP_EnemyAIController_C';
const EG = 'EventGraph';

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

async function bridge(method, args, opt = false) {
  const res = await rpc('tools/call', { name: method, arguments: args });
  const p = parseTool(res);
  if (!opt && p.success === false && p.error) throw new Error(p.error || JSON.stringify(p));
  return p;
}

async function ensureVar(path, name, type) {
  const lv = await bp({ action: 'list_variables', path, assetPath: path });
  if ((lv.variables || []).some((v) => v.name === name)) {
    console.log('  var ok:', name);
    return;
  }
  await bp({
    action: 'add_variable',
    path,
    assetPath: path,
    name,
    variableName: name,
    type,
    variableType: type,
    instanceEditable: true,
  });
  console.log('  added var:', name);
}

async function addNode(path, graph, nodeClass, nodeParams, x, y) {
  const r = await bp({
    action: 'add_node',
    path,
    assetPath: path,
    graphName: graph,
    nodeClass,
    nodeParams: nodeParams || {},
    posX: x,
    posY: y,
  });
  if (!r.nodeId) throw new Error(`add_node failed: ${JSON.stringify(r)}`);
  return r.nodeId;
}

async function conn(path, graph, a, ap, b, bpin) {
  return bp({
    action: 'connect_pins',
    path,
    assetPath: path,
    graphName: graph,
    sourceNode: a,
    sourcePin: ap,
    targetNode: b,
    targetPin: bpin,
  });
}

async function tryConn(path, graph, a, aps, b, bps) {
  for (const ap of aps) {
    for (const tp of bps) {
      try {
        const r = await conn(path, graph, a, ap, b, tp);
        if (r.success !== false) return true;
      } catch (_) {}
    }
  }
  return false;
}

async function createFunc(name) {
  try {
    await bp({ action: 'delete_function', path: AIC, assetPath: AIC, functionName: name }, true);
  } catch (_) {}
  await bp({
    action: 'create_function',
    path: AIC,
    assetPath: AIC,
    functionName: name,
    onConflict: 'replace',
  });
}

async function buildCacheFromPawn() {
  const FN = 'CacheSettingsFromPawn';
  await createFunc(FN);
  const g = await bp({ action: 'read_graph', path: AIC, assetPath: AIC, graphName: FN });
  const entry = (g.nodes || []).find((n) => n.class === 'K2Node_FunctionEntry');
  const result = (g.nodes || []).find((n) => n.class === 'K2Node_FunctionResult');
  if (!entry || !result) throw new Error(`${FN}: missing entry/result`);
  const eid = entry.id || entry.nodeId;
  const rid = result.id || result.nodeId;

  const x0 = 300;
  const getPawn = await addNode(AIC, FN, 'CallFunction', {
    functionName: 'K2_GetPawn',
    targetClass: '/Script/AIModule.AIController',
  }, x0, 0);
  const cast = await addNode(AIC, FN, 'K2Node_DynamicCast', { targetClass: ENEMY_CLASS }, x0 + 200, 0);
  const getOrigin = await addNode(
    AIC,
    FN,
    'GetVar',
    { variableName: 'PatrolOriginActor', ownerClass: ENEMY_CLASS },
    x0 + 420,
    -80
  );
  const isValid = await addNode(AIC, FN, 'CallFunction', {
    functionName: 'IsValid',
    targetClass: '/Script/Engine.KismetSystemLibrary',
  }, x0 + 620, -80);
  const branch = await addNode(AIC, FN, 'Branch', {}, x0 + 820, -80);
  const getLocO = await addNode(AIC, FN, 'CallFunction', {
    functionName: 'K2_GetActorLocation',
    targetClass: '/Script/Engine.Actor',
  }, x0 + 1040, -140);
  const getLocP = await addNode(AIC, FN, 'CallFunction', {
    functionName: 'K2_GetActorLocation',
    targetClass: '/Script/Engine.Actor',
  }, x0 + 1040, 20);
  const setCenter = await addNode(AIC, FN, 'SetVar', { variableName: 'PatrolCenter' }, x0 + 1260, -40);

  const copyVars = ['PatrolRadius', 'ChaseDuration', 'WalkSpeed', 'RunSpeed'];
  let lastExec = setCenter;
  let xCopy = x0 + 420;
  for (const vn of copyVars) {
    const gP = await addNode(AIC, FN, 'GetVar', { variableName: vn, ownerClass: ENEMY_CLASS }, xCopy, 120);
    const gC = await addNode(AIC, FN, 'GetVar', { variableName: vn }, xCopy + 200, 220);
    const sC = await addNode(AIC, FN, 'SetVar', { variableName: vn }, xCopy + 400, 220);
    await tryConn(AIC, FN, cast, ['AsBP Enemy Shadow Logic', 'AsBP_EnemyShadowLogic'], gP, ['self', 'Target']);
    await tryConn(AIC, FN, gP, [vn], gC, [vn]);
    await tryConn(AIC, FN, gC, [vn], sC, [vn]);
    await tryConn(AIC, FN, lastExec, ['then'], sC, ['execute']);
    lastExec = sC;
    xCopy += 40;
  }

  await tryConn(AIC, FN, eid, ['then'], getPawn, ['execute']);
  await tryConn(AIC, FN, getPawn, ['ReturnValue'], cast, ['Object']);
  await tryConn(AIC, FN, getPawn, ['then'], cast, ['execute']);
  await tryConn(AIC, FN, cast, ['AsBP Enemy Shadow Logic', 'AsBP_EnemyShadowLogic'], getOrigin, ['self', 'Target']);
  await tryConn(AIC, FN, getOrigin, ['PatrolOriginActor', 'ReturnValue'], isValid, ['Object', 'InputObject']);
  await tryConn(AIC, FN, isValid, ['ReturnValue', 'bIsValid'], branch, ['Condition']);
  await tryConn(AIC, FN, cast, ['then'], branch, ['execute']);
  await tryConn(AIC, FN, branch, ['then'], getLocO, ['execute']);
  await tryConn(AIC, FN, branch, ['else'], getLocP, ['execute']);
  await tryConn(AIC, FN, getOrigin, ['PatrolOriginActor'], getLocO, ['self']);
  await tryConn(AIC, FN, cast, ['AsBP Enemy Shadow Logic', 'AsBP_EnemyShadowLogic'], getLocP, ['self']);
  await tryConn(AIC, FN, getLocO, ['ReturnValue'], setCenter, ['PatrolCenter']);
  await tryConn(AIC, FN, getLocP, ['ReturnValue'], setCenter, ['PatrolCenter']);
  await tryConn(AIC, FN, getLocO, ['then'], setCenter, ['execute']);
  await tryConn(AIC, FN, getLocP, ['then'], setCenter, ['execute']);
  await tryConn(AIC, FN, lastExec, ['then'], rid, ['execute']);

  console.log('  built', FN);
}

async function buildStartPatrol() {
  const FN = 'StartPatrol';
  await createFunc(FN);
  const g = await bp({ action: 'read_graph', path: AIC, assetPath: AIC, graphName: FN });
  const entry = (g.nodes || []).find((n) => n.class === 'K2Node_FunctionEntry');
  const result = (g.nodes || []).find((n) => n.class === 'K2Node_FunctionResult');
  const eid = entry.id || entry.nodeId;
  const rid = result.id || result.nodeId;

  const setState = await addNode(AIC, FN, 'SetVar', { variableName: 'CurrentState' }, 300, 0);
  const getPawn = await addNode(AIC, FN, 'CallFunction', {
    functionName: 'K2_GetPawn',
    targetClass: '/Script/AIModule.AIController',
  }, 500, 0);
  const cast = await addNode(AIC, FN, 'K2Node_DynamicCast', { targetClass: ENEMY_CLASS }, 700, 0);
  const getMove = await addNode(AIC, FN, 'CallFunction', {
    functionName: 'GetMovementComponent',
    targetClass: '/Script/Engine.Pawn',
  }, 900, 0);
  const getWalk = await addNode(AIC, FN, 'GetVar', { variableName: 'WalkSpeed' }, 900, 120);
  const setSpeed = await addNode(AIC, FN, 'CallFunction', {
    functionName: 'SetMaxWalkSpeed',
    targetClass: '/Script/Engine.CharacterMovementComponent',
  }, 1100, 60);
  const getCenter = await addNode(AIC, FN, 'GetVar', { variableName: 'PatrolCenter' }, 900, 240);
  const getRad = await addNode(AIC, FN, 'GetVar', { variableName: 'PatrolRadius' }, 900, 360);
  const randomPt = await addNode(AIC, FN, 'CallFunction', {
    functionName: 'K2_GetRandomReachablePointInRadius',
    targetClass: '/Script/Engine.NavigationSystemV1',
  }, 1100, 300);
  const moveTo = await addNode(AIC, FN, 'CallFunction', {
    functionName: 'MoveToLocation',
    targetClass: '/Script/AIModule.AIController',
  }, 1300, 200);

  await tryConn(AIC, FN, eid, ['then'], setState, ['execute']);
  await tryConn(AIC, FN, setState, ['then'], getPawn, ['execute']);
  await tryConn(AIC, FN, getPawn, ['then'], cast, ['execute']);
  await tryConn(AIC, FN, getPawn, ['ReturnValue'], cast, ['Object']);
  await tryConn(AIC, FN, cast, ['then'], getMove, ['execute']);
  await tryConn(AIC, FN, cast, ['AsBP Enemy Shadow Logic', 'AsBP_EnemyShadowLogic'], getMove, ['self']);
  await tryConn(AIC, FN, getWalk, ['WalkSpeed'], setSpeed, ['NewMaxWalkSpeed']);
  await tryConn(AIC, FN, getMove, ['ReturnValue'], setSpeed, ['self']);
  await tryConn(AIC, FN, getMove, ['then'], setSpeed, ['execute']);
  await tryConn(AIC, FN, setSpeed, ['then'], randomPt, ['execute']);
  await tryConn(AIC, FN, getCenter, ['PatrolCenter'], randomPt, ['Origin']);
  await tryConn(AIC, FN, getRad, ['PatrolRadius'], randomPt, ['Radius']);
  await tryConn(AIC, FN, randomPt, ['then'], moveTo, ['execute']);
  await tryConn(AIC, FN, randomPt, ['RandomLocation', 'ReturnValue'], moveTo, ['Dest']);
  await tryConn(AIC, FN, moveTo, ['then'], rid, ['execute']);

  console.log('  built', FN);
}

async function buildStartChase() {
  const FN = 'StartChase';
  await createFunc(FN);
  const g = await bp({ action: 'read_graph', path: AIC, assetPath: AIC, graphName: FN });
  const entry = (g.nodes || []).find((n) => n.class === 'K2Node_FunctionEntry');
  const result = (g.nodes || []).find((n) => n.class === 'K2Node_FunctionResult');
  const eid = entry.id || entry.nodeId;
  const rid = result.id || result.nodeId;

  const setState = await addNode(AIC, FN, 'SetVar', { variableName: 'CurrentState' }, 300, 0);
  const getPawn = await addNode(AIC, FN, 'CallFunction', {
    functionName: 'K2_GetPawn',
    targetClass: '/Script/AIModule.AIController',
  }, 500, 0);
  const cast = await addNode(AIC, FN, 'K2Node_DynamicCast', { targetClass: ENEMY_CLASS }, 700, 0);
  const getMove = await addNode(AIC, FN, 'CallFunction', {
    functionName: 'GetMovementComponent',
    targetClass: '/Script/Engine.Pawn',
  }, 900, 0);
  const getRun = await addNode(AIC, FN, 'GetVar', { variableName: 'RunSpeed' }, 900, 120);
  const setSpeed = await addNode(AIC, FN, 'CallFunction', {
    functionName: 'SetMaxWalkSpeed',
    targetClass: '/Script/Engine.CharacterMovementComponent',
  }, 1100, 60);
  const getPlayer = await addNode(AIC, FN, 'CallFunction', {
    functionName: 'GetPlayerCharacter',
    targetClass: '/Script/Engine.GameplayStatics',
  }, 900, 240);
  const moveActor = await addNode(AIC, FN, 'CallFunction', {
    functionName: 'MoveToActor',
    targetClass: '/Script/AIModule.AIController',
  }, 1100, 240);
  const getDur = await addNode(AIC, FN, 'GetVar', { variableName: 'ChaseDuration' }, 900, 400);
  const setTimer = await addNode(AIC, FN, 'CallFunction', {
    functionName: 'K2_SetTimer',
    targetClass: '/Script/Engine.KismetSystemLibrary',
  }, 1100, 400);

  await tryConn(AIC, FN, eid, ['then'], setState, ['execute']);
  await tryConn(AIC, FN, setState, ['then'], getPawn, ['execute']);
  await tryConn(AIC, FN, getPawn, ['then'], cast, ['execute']);
  await tryConn(AIC, FN, getPawn, ['ReturnValue'], cast, ['Object']);
  await tryConn(AIC, FN, cast, ['then'], getMove, ['execute']);
  await tryConn(AIC, FN, cast, ['AsBP Enemy Shadow Logic', 'AsBP_EnemyShadowLogic'], getMove, ['self']);
  await tryConn(AIC, FN, getRun, ['RunSpeed'], setSpeed, ['NewMaxWalkSpeed']);
  await tryConn(AIC, FN, getMove, ['ReturnValue'], setSpeed, ['self']);
  await tryConn(AIC, FN, setSpeed, ['then'], getPlayer, ['execute']);
  await tryConn(AIC, FN, getPlayer, ['then'], moveActor, ['execute']);
  await tryConn(AIC, FN, getPlayer, ['ReturnValue'], moveActor, ['Goal']);
  await tryConn(AIC, FN, moveActor, ['then'], setTimer, ['execute']);
  await tryConn(AIC, FN, getDur, ['ChaseDuration'], setTimer, ['Time']);
  await tryConn(AIC, FN, setTimer, ['then'], rid, ['execute']);

  console.log('  built', FN);
}

async function buildStartReturn() {
  const FN = 'StartReturn';
  await createFunc(FN);
  const g = await bp({ action: 'read_graph', path: AIC, assetPath: AIC, graphName: FN });
  const entry = (g.nodes || []).find((n) => n.class === 'K2Node_FunctionEntry');
  const result = (g.nodes || []).find((n) => n.class === 'K2Node_FunctionResult');
  const eid = entry.id || entry.nodeId;
  const rid = result.id || result.nodeId;

  const setState = await addNode(AIC, FN, 'SetVar', { variableName: 'CurrentState' }, 300, 0);
  const getWalk = await addNode(AIC, FN, 'GetVar', { variableName: 'WalkSpeed' }, 500, 120);
  const getPawn = await addNode(AIC, FN, 'CallFunction', {
    functionName: 'K2_GetPawn',
    targetClass: '/Script/AIModule.AIController',
  }, 500, 0);
  const cast = await addNode(AIC, FN, 'K2Node_DynamicCast', { targetClass: ENEMY_CLASS }, 700, 0);
  const getMove = await addNode(AIC, FN, 'CallFunction', {
    functionName: 'GetMovementComponent',
    targetClass: '/Script/Engine.Pawn',
  }, 900, 0);
  const setSpeed = await addNode(AIC, FN, 'CallFunction', {
    functionName: 'SetMaxWalkSpeed',
    targetClass: '/Script/Engine.CharacterMovementComponent',
  }, 1100, 60);
  const getCenter = await addNode(AIC, FN, 'GetVar', { variableName: 'PatrolCenter' }, 900, 200);
  const moveTo = await addNode(AIC, FN, 'CallFunction', {
    functionName: 'MoveToLocation',
    targetClass: '/Script/AIModule.AIController',
  }, 1100, 200);

  await tryConn(AIC, FN, eid, ['then'], setState, ['execute']);
  await tryConn(AIC, FN, setState, ['then'], getPawn, ['execute']);
  await tryConn(AIC, FN, getPawn, ['then'], cast, ['execute']);
  await tryConn(AIC, FN, getPawn, ['ReturnValue'], cast, ['Object']);
  await tryConn(AIC, FN, cast, ['then'], getMove, ['execute']);
  await tryConn(AIC, FN, cast, ['AsBP Enemy Shadow Logic', 'AsBP_EnemyShadowLogic'], getMove, ['self']);
  await tryConn(AIC, FN, getWalk, ['WalkSpeed'], setSpeed, ['NewMaxWalkSpeed']);
  await tryConn(AIC, FN, getMove, ['ReturnValue'], setSpeed, ['self']);
  await tryConn(AIC, FN, setSpeed, ['then'], moveTo, ['execute']);
  await tryConn(AIC, FN, getCenter, ['PatrolCenter'], moveTo, ['Dest']);
  await tryConn(AIC, FN, moveTo, ['then'], rid, ['execute']);

  console.log('  built', FN);
}

async function buildOnChaseTimeout() {
  const FN = 'OnChaseTimeout';
  await createFunc(FN);
  const g = await bp({ action: 'read_graph', path: AIC, assetPath: AIC, graphName: FN });
  const entry = (g.nodes || []).find((n) => n.class === 'K2Node_FunctionEntry');
  const eid = entry.id || entry.nodeId;
  const callRet = await addNode(AIC, FN, 'CallFunction', {
    functionName: 'StartReturn',
    targetClass: AIC_CLASS,
  }, 500, 0);
  await tryConn(AIC, FN, eid, ['then'], callRet, ['execute']);
  console.log('  built', FN);
}

async function buildOnPerception() {
  const FN = 'OnPerceptionUpdated';
  await createFunc(FN);
  const g = await bp({ action: 'read_graph', path: AIC, assetPath: AIC, graphName: FN });
  const entry = (g.nodes || []).find((n) => n.class === 'K2Node_FunctionEntry');
  const eid = entry.id || entry.nodeId;
  // Params: Actor, Stimulus - add later; minimal: always try chase if patrol
  const getState = await addNode(AIC, FN, 'GetVar', { variableName: 'CurrentState' }, 400, 0);
  const eqPatrol = await addNode(AIC, FN, 'CallFunction', {
    functionName: 'EqualEqual_ByteByte',
    targetClass: '/Script/Engine.KismetMathLibrary',
  }, 600, 0);
  const branch = await addNode(AIC, FN, 'Branch', {}, 800, 0);
  const callChase = await addNode(AIC, FN, 'CallFunction', {
    functionName: 'StartChase',
    targetClass: AIC_CLASS,
  }, 1000, -40);

  await tryConn(AIC, FN, eid, ['then'], branch, ['execute']);
  await tryConn(AIC, FN, getState, ['CurrentState'], eqPatrol, ['A']);
  await tryConn(AIC, FN, eqPatrol, ['ReturnValue'], branch, ['Condition']);
  await tryConn(AIC, FN, branch, ['then'], callChase, ['execute']);
  console.log('  built', FN);
}

async function wireEventGraphBeginPlay() {
  const g = await bp({ action: 'read_graph', path: AIC, assetPath: AIC, graphName: EG });
  const nodes = g.nodes || [];
  const begin = nodes.find((n) => n.title === 'Event BeginPlay');
  const getPawn = nodes.find((n) => n.title === 'Get Controlled Pawn');
  const cast = nodes.find((n) => n.title === 'Cast To BP_EnemyShadowLogic');

  if (!begin || !getPawn || !cast) throw new Error('BeginPlay chain nodes missing');

  const callCache = await addNode(AIC, EG, 'CallFunction', {
    functionName: 'CacheSettingsFromPawn',
    targetClass: AIC_CLASS,
  }, 1000, 0);
  const callPatrol = await addNode(AIC, EG, 'CallFunction', {
    functionName: 'StartPatrol',
    targetClass: AIC_CLASS,
  }, 1200, 0);

  await tryConn(AIC, EG, begin.id, ['then'], getPawn.id, ['execute']);
  await tryConn(AIC, EG, getPawn.id, ['then'], cast.id, ['execute']);
  await tryConn(AIC, EG, cast.id, ['then'], callCache, ['execute']);
  await tryConn(AIC, EG, callCache, ['then'], callPatrol, ['execute']);

  console.log('  wired BeginPlay chain');
}

async function main() {
  const report = { steps: [] };
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'implement_enemy_ai_v2', version: '1' },
  });

  console.log('=== Enemy pawn:', ENEMY, '===');
  for (const [n, t] of [
    ['PatrolOriginActor', 'object'],
    ['PatrolRadius', 'real'],
    ['ChaseDuration', 'real'],
    ['WalkSpeed', 'real'],
    ['RunSpeed', 'real'],
  ]) {
    await ensureVar(ENEMY, n, t);
  }

  for (const [prop, val] of [
    ['AIControllerClass', AIC_CLASS],
    ['AutoPossessAI', 'PlacedInWorld'],
  ]) {
    try {
      const r = await bp({
        action: 'set_class_default',
        path: ENEMY,
        assetPath: ENEMY,
        propertyName: prop,
        value: val,
      });
      console.log('  CDO', prop, r.success !== false ? 'ok' : r);
      report.steps.push({ prop, ok: r.success !== false });
    } catch (e) {
      console.log('  CDO', prop, 'fail', e.message);
      report.steps.push({ prop, error: e.message });
    }
  }

  console.log('=== AIPerception on Controller ===');
  try {
    const r = await bridge('create_ai_perception_config', { blueprintPath: AIC, addSight: true }, true);
    console.log('  perception', JSON.stringify(r));
  } catch (e) {
    try {
      await bp({
        action: 'add_component',
        path: AIC,
        assetPath: AIC,
        componentClass: '/Script/AIModule.AIPerceptionComponent',
        componentName: 'AIPerceptionComp',
        onConflict: 'skip',
      });
      console.log('  add_component AIPerceptionComp ok');
    } catch (e2) {
      console.log('  perception skip:', e.message, e2.message);
    }
  }

  for (const [n, d] of [
    ['PatrolRadius', '600'],
    ['ChaseDuration', '7'],
    ['WalkSpeed', '200'],
    ['RunSpeed', '450'],
  ]) {
    await bp(
      {
        action: 'set_variable_default',
        path: AIC,
        assetPath: AIC,
        variableName: n,
        defaultValue: d,
      },
      true
    );
  }

  console.log('=== Build AI functions ===');
  const fns = [
    buildCacheFromPawn,
    buildStartPatrol,
    buildStartChase,
    buildStartReturn,
    buildOnChaseTimeout,
    buildOnPerception,
  ];
  for (const fn of fns) {
    try {
      await fn();
      report.steps.push({ fn: fn.name, ok: true });
    } catch (e) {
      console.error('  FAIL', fn.name, e.message);
      report.steps.push({ fn: fn.name, error: e.message });
    }
  }

  try {
    await wireEventGraphBeginPlay();
    report.steps.push({ wireBeginPlay: true });
  } catch (e) {
    console.error('  BeginPlay wire:', e.message);
    report.steps.push({ wireBeginPlay: e.message });
  }

  console.log('=== Compile ===');
  const c0 = await bp({ action: 'compile', path: ENEMY, assetPath: ENEMY });
  const c1 = await bp({ action: 'compile', path: AIC, assetPath: AIC });
  console.log('  enemy compile', c0);
  console.log('  aic compile', c1);

  fs.writeFileSync('implement_enemy_ai_report.json', JSON.stringify(report, null, 2));
  console.log('\nDone. Report: implement_enemy_ai_report.json');
  console.log('Level: add NavMesh + TargetPoint, set Patrol Origin Actor on enemy instance.');
  mcp.kill();
}

main().catch((e) => {
  console.error(e);
  mcp.kill();
  process.exit(1);
});
