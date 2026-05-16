/**
 * BP_EnemyShadowLogic:
 * - BeginPlay: after Set Root Location, cache ShaodwColliderRoot world rotation (Roll/Pitch/Yaw floats).
 * - End overlap reset: wire Set Relative Location NewLocation from Root Location; replace
 *   Set Relative Rotation on ShadowCollider with K2_SetWorldRotation on ShaodwColliderRoot
 *   using cached euler (matches runtime Set World Rotation on root).
 */
const { spawn } = require('child_process');

const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const BP = '/Game/BluePrint/BP_EnemyShadowLogic';

const SET_ROOT_LOC = '0mcqikEqnqmWzGK1Vu_WzA';
// Same variable get used by runtime Set World Rotation on shadow root.
const GET_SHADOW_ROOT = '_ppbJE67Vh-wNnexoqzseg';

const SF73_SET_REL_LOC = 'sf73WUuf06e6TS2Xuc51tg';
const OLD_SET_REL_ROT = '0Nd0IUuyqD3aasGqnU4fZQ';
const REROUTE_A5YP = 'A5YPFUxUdQ3GixS5SnpbXQ';
const REROUTE_HKnD = 'HKnDjUeznjbGsIq64PJ3oQ';

const mcp = spawn('npx.cmd', ['ue-mcp', PROJECT], { shell: true });
let reqId = 1;
const pending = new Map();

function rpc(method, params) {
  return new Promise((resolve) => {
    const id = reqId++;
    pending.set(id, resolve);
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

function parse(msg) {
  const text = msg?.result?.content?.[0]?.text;
  try {
    return JSON.parse(text);
  } catch {
    return { success: false, error: text || 'parse failed' };
  }
}

mcp.stdout.on('data', (d) => {
  for (const line of d.toString().split('\n')) {
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

async function bp(args) {
  const res = await rpc('tools/call', { name: 'blueprint', arguments: args });
  const body = parse(res);
  if (!body.success) throw new Error(body.error || JSON.stringify(body));
  return body;
}

async function addNode(nodeClass, nodeParams, posX, posY) {
  const n = await bp({
    action: 'add_node',
    path: BP,
    assetPath: BP,
    graphName: 'EventGraph',
    nodeClass,
    nodeParams,
    posX,
    posY,
  });
  return n.nodeId;
}

async function connectAny(sourceNode, sourcePins, targetNode, targetPins) {
  let last;
  for (const sp of sourcePins) {
    for (const tp of targetPins) {
      try {
        await bp({
          action: 'connect_pins',
          path: BP,
          assetPath: BP,
          graphName: 'EventGraph',
          sourceNode,
          sourcePin: sp,
          targetNode,
          targetPin: tp,
        });
        return { sp, tp };
      } catch (e) {
        last = e;
      }
    }
  }
  throw last || new Error(`connectAny ${sourceNode}->${targetNode}`);
}

async function main() {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'fix-world-rot-reset', version: '1.0' },
  });

  // --- BeginPlay: cache world rotation of shadow collider root ---
  const getWorldRot = await addNode(
    'CallFunction',
    { functionName: 'K2_GetWorldRotation', targetClass: '/Script/Engine.SceneComponent' },
    -200,
    -1320
  );
  const breakRot = await addNode(
    'CallFunction',
    { functionName: 'BreakRotator', targetClass: '/Script/Engine.KismetMathLibrary' },
    40,
    -1320
  );
  const setRoll = await addNode('SetVar', { variableName: 'OriginRootRotRoll' }, 260, -1380);
  const setPitch = await addNode('SetVar', { variableName: 'OriginRootRotPitch' }, 260, -1280);
  const setYaw = await addNode('SetVar', { variableName: 'OriginRootRotYaw' }, 260, -1180);

  await connectAny(GET_SHADOW_ROOT, ['ShaodwColliderRoot'], getWorldRot, ['Target']);
  await connectAny(getWorldRot, ['ReturnValue'], breakRot, ['Rotation', 'InRot', 'InRotator']);
  await connectAny(breakRot, ['Roll', 'X'], setRoll, ['OriginRootRotRoll', 'Value']);
  await connectAny(breakRot, ['Pitch', 'Y'], setPitch, ['OriginRootRotPitch', 'Value']);
  await connectAny(breakRot, ['Yaw', 'Z'], setYaw, ['OriginRootRotYaw', 'Value']);

  await connectAny(SET_ROOT_LOC, ['then'], setRoll, ['execute']);
  await connectAny(setRoll, ['then'], setPitch, ['execute']);
  await connectAny(setPitch, ['then'], setYaw, ['execute']);

  console.log('BeginPlay rot cache:', { getWorldRot, breakRot, setRoll, setPitch, setYaw });

  // --- Reset chain: Root Location -> Set Relative Location ---
  const getRootLoc = await addNode('GetVar', { variableName: 'Root Location' }, 3000, -520);
  await connectAny(getRootLoc, ['Root Location'], SF73_SET_REL_LOC, ['NewLocation', 'Location', 'RelativeLocation']);
  console.log('sf73 NewLocation wired');

  // --- Replace Set Relative Rotation with Set World Rotation on root ---
  await bp({ action: 'delete_node', path: BP, assetPath: BP, graphName: 'EventGraph', nodeName: OLD_SET_REL_ROT });
  await bp({ action: 'delete_node', path: BP, assetPath: BP, graphName: 'EventGraph', nodeName: REROUTE_A5YP });
  await bp({ action: 'delete_node', path: BP, assetPath: BP, graphName: 'EventGraph', nodeName: REROUTE_HKnD });

  const getRoll = await addNode('GetVar', { variableName: 'OriginRootRotRoll' }, 3180, -380);
  const getPitch = await addNode('GetVar', { variableName: 'OriginRootRotPitch' }, 3180, -320);
  const getYaw = await addNode('GetVar', { variableName: 'OriginRootRotYaw' }, 3180, -260);
  const makeRot = await addNode(
    'CallFunction',
    { functionName: 'MakeRotator', targetClass: '/Script/Engine.KismetMathLibrary' },
    3420,
    -320
  );
  const setWorldRot = await addNode(
    'CallFunction',
    { functionName: 'K2_SetWorldRotation', targetClass: '/Script/Engine.SceneComponent' },
    3680,
    -320
  );

  await connectAny(getRoll, ['OriginRootRotRoll'], makeRot, ['Roll']);
  await connectAny(getPitch, ['OriginRootRotPitch'], makeRot, ['Pitch']);
  await connectAny(getYaw, ['OriginRootRotYaw'], makeRot, ['Yaw']);
  await connectAny(makeRot, ['ReturnValue'], setWorldRot, ['NewRotation', 'DesiredRotation', 'InRotation']);
  await connectAny(GET_SHADOW_ROOT, ['ShaodwColliderRoot'], setWorldRot, ['Target']);

  await connectAny(SF73_SET_REL_LOC, ['then'], setWorldRot, ['execute']);

  console.log('SetWorldRotation reset:', { getRoll, getPitch, getYaw, makeRot, setWorldRot });

  await bp({ action: 'compile', path: BP, assetPath: BP });
  console.log(JSON.stringify(await bp({ action: 'validate', path: BP, assetPath: BP }), null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
