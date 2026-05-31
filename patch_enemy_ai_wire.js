/**
 * Patch: fix function graphs (no FunctionResult required) + wire BeginPlay + AIPerception component
 */
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

async function tryConn(path, graph, a, aps, b, bps) {
  for (const ap of aps) {
    for (const tp of bps) {
      try {
        const r = await bp({
          action: 'connect_pins',
          path,
          assetPath: path,
          graphName: graph,
          sourceNode: a,
          sourcePin: ap,
          targetNode: b,
          targetPin: tp,
        });
        if (r.success !== false) return true;
      } catch (_) {}
    }
  }
  return false;
}

function nid(node) {
  return node?.id || node?.nodeId;
}

async function getEntry(path, fn) {
  const g = await bp({ action: 'read_graph', path, assetPath: path, graphName: fn });
  const entry = (g.nodes || []).find((n) => n.class === 'K2Node_FunctionEntry');
  if (!entry) throw new Error(`${fn}: no entry`);
  return nid(entry);
}

async function recreateFunc(name) {
  try {
    await bp({ action: 'delete_function', path: AIC, assetPath: AIC, functionName: name }, true);
  } catch (_) {}
  await bp({ action: 'create_function', path: AIC, assetPath: AIC, functionName: name, onConflict: 'replace' });
}

async function buildCacheFromPawn() {
  const FN = 'CacheSettingsFromPawn';
  await recreateFunc(FN);
  const eid = await getEntry(AIC, FN);
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

  let lastExec = setCenter;
  for (const vn of ['PatrolRadius', 'ChaseDuration', 'WalkSpeed', 'RunSpeed']) {
    const gP = await addNode(AIC, FN, 'GetVar', { variableName: vn, ownerClass: ENEMY_CLASS }, x0 + 420, 160);
    const gC = await addNode(AIC, FN, 'GetVar', { variableName: vn }, x0 + 620, 160);
    const sC = await addNode(AIC, FN, 'SetVar', { variableName: vn }, x0 + 820, 160);
    await tryConn(AIC, FN, cast, ['AsBP Enemy Shadow Logic', 'AsBP_EnemyShadowLogic'], gP, ['self', 'Target']);
    await tryConn(AIC, FN, gP, [vn, 'ReturnValue'], gC, [vn]);
    await tryConn(AIC, FN, gC, [vn], sC, [vn]);
    await tryConn(AIC, FN, lastExec, ['then'], sC, ['execute']);
    lastExec = sC;
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
  await tryConn(AIC, FN, getOrigin, ['PatrolOriginActor', 'ReturnValue'], getLocO, ['self']);
  await tryConn(AIC, FN, cast, ['AsBP Enemy Shadow Logic', 'AsBP_EnemyShadowLogic'], getLocP, ['self']);
  await tryConn(AIC, FN, getLocO, ['ReturnValue'], setCenter, ['PatrolCenter']);
  await tryConn(AIC, FN, getLocP, ['ReturnValue'], setCenter, ['PatrolCenter']);
  await tryConn(AIC, FN, getLocO, ['then'], setCenter, ['execute']);
  await tryConn(AIC, FN, getLocP, ['then'], setCenter, ['execute']);

  console.log('CacheSettingsFromPawn ok');
}

async function buildStartPatrol() {
  const FN = 'StartPatrol';
  await recreateFunc(FN);
  const eid = await getEntry(AIC, FN);

  const getPawn = await addNode(AIC, FN, 'CallFunction', {
    functionName: 'K2_GetPawn',
    targetClass: '/Script/AIModule.AIController',
  }, 400, 0);
  const cast = await addNode(AIC, FN, 'K2Node_DynamicCast', { targetClass: ENEMY_CLASS }, 600, 0);
  const getMove = await addNode(AIC, FN, 'CallFunction', {
    functionName: 'GetMovementComponent',
    targetClass: '/Script/Engine.Pawn',
  }, 800, 0);
  const getWalk = await addNode(AIC, FN, 'GetVar', { variableName: 'WalkSpeed' }, 800, 120);
  const setSpeed = await addNode(AIC, FN, 'CallFunction', {
    functionName: 'SetMaxWalkSpeed',
    targetClass: '/Script/Engine.CharacterMovementComponent',
  }, 1000, 60);
  const getCenter = await addNode(AIC, FN, 'GetVar', { variableName: 'PatrolCenter' }, 800, 240);
  const getRad = await addNode(AIC, FN, 'GetVar', { variableName: 'PatrolRadius' }, 800, 360);
  const randomPt = await addNode(AIC, FN, 'CallFunction', {
    functionName: 'K2_GetRandomReachablePointInRadius',
    targetClass: '/Script/Engine.NavigationSystemV1',
  }, 1000, 300);
  const moveTo = await addNode(AIC, FN, 'CallFunction', {
    functionName: 'MoveToLocation',
    targetClass: '/Script/AIModule.AIController',
  }, 1200, 200);

  await tryConn(AIC, FN, eid, ['then'], getPawn, ['execute']);
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

  console.log('StartPatrol ok');
}

async function buildStartChase() {
  const FN = 'StartChase';
  await recreateFunc(FN);
  const eid = await getEntry(AIC, FN);

  const getPawn = await addNode(AIC, FN, 'CallFunction', {
    functionName: 'K2_GetPawn',
    targetClass: '/Script/AIModule.AIController',
  }, 400, 0);
  const cast = await addNode(AIC, FN, 'K2Node_DynamicCast', { targetClass: ENEMY_CLASS }, 600, 0);
  const getMove = await addNode(AIC, FN, 'CallFunction', {
    functionName: 'GetMovementComponent',
    targetClass: '/Script/Engine.Pawn',
  }, 800, 0);
  const getRun = await addNode(AIC, FN, 'GetVar', { variableName: 'RunSpeed' }, 800, 120);
  const setSpeed = await addNode(AIC, FN, 'CallFunction', {
    functionName: 'SetMaxWalkSpeed',
    targetClass: '/Script/Engine.CharacterMovementComponent',
  }, 1000, 60);
  const getPlayer = await addNode(AIC, FN, 'CallFunction', {
    functionName: 'GetPlayerCharacter',
    targetClass: '/Script/Engine.GameplayStatics',
  }, 800, 240);
  await bp({
    action: 'set_node_property',
    path: AIC,
    assetPath: AIC,
    graphName: FN,
    nodeName: getPlayer,
    propertyName: 'PlayerIndex',
    value: '0',
  }, true);
  const moveActor = await addNode(AIC, FN, 'CallFunction', {
    functionName: 'MoveToActor',
    targetClass: '/Script/AIModule.AIController',
  }, 1000, 240);
  const getDur = await addNode(AIC, FN, 'GetVar', { variableName: 'ChaseDuration' }, 800, 400);
  const setTimer = await addNode(AIC, FN, 'CallFunction', {
    functionName: 'K2_SetTimer',
    targetClass: '/Script/Engine.KismetSystemLibrary',
  }, 1000, 400);

  await tryConn(AIC, FN, eid, ['then'], getPawn, ['execute']);
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

  console.log('StartChase ok');
}

async function buildStartReturn() {
  const FN = 'StartReturn';
  await recreateFunc(FN);
  const eid = await getEntry(AIC, FN);

  const getPawn = await addNode(AIC, FN, 'CallFunction', {
    functionName: 'K2_GetPawn',
    targetClass: '/Script/AIModule.AIController',
  }, 400, 0);
  const cast = await addNode(AIC, FN, 'K2Node_DynamicCast', { targetClass: ENEMY_CLASS }, 600, 0);
  const getMove = await addNode(AIC, FN, 'CallFunction', {
    functionName: 'GetMovementComponent',
    targetClass: '/Script/Engine.Pawn',
  }, 800, 0);
  const getWalk = await addNode(AIC, FN, 'GetVar', { variableName: 'WalkSpeed' }, 800, 120);
  const setSpeed = await addNode(AIC, FN, 'CallFunction', {
    functionName: 'SetMaxWalkSpeed',
    targetClass: '/Script/Engine.CharacterMovementComponent',
  }, 1000, 60);
  const getCenter = await addNode(AIC, FN, 'GetVar', { variableName: 'PatrolCenter' }, 900, 200);
  const moveTo = await addNode(AIC, FN, 'CallFunction', {
    functionName: 'MoveToLocation',
    targetClass: '/Script/AIModule.AIController',
  }, 1100, 200);

  await tryConn(AIC, FN, eid, ['then'], getPawn, ['execute']);
  await tryConn(AIC, FN, getPawn, ['then'], cast, ['execute']);
  await tryConn(AIC, FN, getPawn, ['ReturnValue'], cast, ['Object']);
  await tryConn(AIC, FN, cast, ['then'], getMove, ['execute']);
  await tryConn(AIC, FN, cast, ['AsBP Enemy Shadow Logic', 'AsBP_EnemyShadowLogic'], getMove, ['self']);
  await tryConn(AIC, FN, getWalk, ['WalkSpeed'], setSpeed, ['NewMaxWalkSpeed']);
  await tryConn(AIC, FN, getMove, ['ReturnValue'], setSpeed, ['self']);
  await tryConn(AIC, FN, setSpeed, ['then'], moveTo, ['execute']);
  await tryConn(AIC, FN, getCenter, ['PatrolCenter'], moveTo, ['Dest']);

  console.log('StartReturn ok');
}

async function wireBeginPlay() {
  const g = await bp({ action: 'read_graph_summary', path: AIC, assetPath: AIC, graphName: EG });
  const nodes = g.nodes || [];
  const begin = nodes.find((n) => n.title === 'Event BeginPlay');
  const getPawn = nodes.find((n) => n.title === 'Get Controlled Pawn');
  const cast = nodes.find((n) => n.title && n.title.includes('EnemyShadowLogic'));
  if (!begin || !getPawn || !cast) throw new Error(`nodes missing: ${nodes.map((n) => n.title).join(', ')}`);

  const callCache = await addNode(AIC, EG, 'CallFunction', {
    functionName: 'CacheSettingsFromPawn',
    targetClass: AIC_CLASS,
  }, 1000, 0);
  const callPatrol = await addNode(AIC, EG, 'CallFunction', {
    functionName: 'StartPatrol',
    targetClass: AIC_CLASS,
  }, 1200, 0);

  await tryConn(AIC, EG, nid(begin), ['then'], nid(getPawn), ['execute']);
  await tryConn(AIC, EG, nid(getPawn), ['then'], nid(cast), ['execute']);
  await tryConn(AIC, EG, nid(cast), ['then'], callCache, ['execute']);
  await tryConn(AIC, EG, callCache, ['then'], callPatrol, ['execute']);
  console.log('BeginPlay wired');
}

async function main() {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'patch_enemy_ai', version: '1' },
  });

  await bp({
    action: 'add_component',
    path: AIC,
    assetPath: AIC,
    componentClass: '/Script/AIModule.AIPerceptionComponent',
    componentName: 'AIPerceptionComp',
    onConflict: 'skip',
  }, true);

  for (const fn of [buildCacheFromPawn, buildStartPatrol, buildStartChase, buildStartReturn]) {
    try {
      await fn();
    } catch (e) {
      console.error(fn.name, e.message);
    }
  }

  try {
    await wireBeginPlay();
  } catch (e) {
    console.error('wireBeginPlay', e.message);
  }

  await bp({ action: 'compile', path: AIC, assetPath: AIC });
  await bp({ action: 'compile', path: ENEMY, assetPath: ENEMY });
  console.log('Compile done');
  mcp.kill();
}

main().catch((e) => {
  console.error(e);
  mcp.kill();
  process.exit(1);
});
