/**
 * BP_EnemyShadowLogic:
 * - BeginPlay (after Set Collision Enabled): cache ShadowCollider default
 *   relative translation via GetRelativeTransform -> Break Transform -> Set Root Location.
 * - On Component End Overlap: after Clear + Set Box Extent (Origin colision size),
 *   K2_SetRelativeLocation from Root Location, then K2_SetRelativeRotation (0,0,0)
 *   on ShaodwColliderRoot.
 */
const { spawn } = require('child_process');

const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const BP = '/Game/BluePrint/BP_EnemyShadowLogic';

const SET_COLLISION = '6fm-K0NCMx0BRNi_iHWsKw';
const GET_SHADOW_COLLIDER_BEGIN = 'e0667UL7Obx3gym7r2ntiQ';

const SET_EXTENT_RESET = 'AZFN1EnJQhkffi249IreUw';
const GET_SHADOW_COLLIDER_RESET = 'bYvFBEb_zt0nvJG-kmD70A';

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

async function setPin(nodeName, propertyName, value) {
  try {
    await bp({
      action: 'set_node_property',
      path: BP,
      assetPath: BP,
      graphName: 'EventGraph',
      nodeName,
      propertyName,
      value,
    });
  } catch (_) {
    await bp({
      action: 'set_node_property',
      path: BP,
      assetPath: BP,
      graphName: 'EventGraph',
      nodeName,
      pinName: propertyName,
      defaultValue: value,
    });
  }
}

async function connectAny(sourceNode, sourcePins, targetNode, targetPins) {
  let last;
  for (const sourcePin of sourcePins) {
    for (const targetPin of targetPins) {
      try {
        await bp({
          action: 'connect_pins',
          path: BP,
          assetPath: BP,
          graphName: 'EventGraph',
          sourceNode,
          sourcePin,
          targetNode,
          targetPin,
        });
        return { sourcePin, targetPin };
      } catch (e) {
        last = e;
      }
    }
  }
  throw last || new Error(`connectAny failed ${sourceNode} -> ${targetNode}`);
}

async function main() {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'end-overlap-restore', version: '1.0' },
  });

  // --- BeginPlay: cache ShadowCollider relative translation ---
  const getRelXform = await addNode(
    'CallFunction',
    { functionName: 'GetRelativeTransform', targetClass: '/Script/Engine.SceneComponent' },
    -520,
    -1180
  );
  const breakXform = await addNode(
    'CallFunction',
    { functionName: 'BreakTransform', targetClass: '/Script/Engine.KismetMathLibrary' },
    -300,
    -1180
  );
  const setRootLocVar = await addNode('SetVar', { variableName: 'Root Location' }, -80, -1180);

  await connectAny(GET_SHADOW_COLLIDER_BEGIN, ['ShadowCollider'], getRelXform, ['self', 'Target']);
  await connectAny(getRelXform, ['ReturnValue'], breakXform, ['InTransform', 'Transform']);
  await connectAny(breakXform, ['Location', 'Translation'], setRootLocVar, ['Root Location', 'Value']);

  await connectAny(SET_COLLISION, ['then'], setRootLocVar, ['execute']);

  console.log('BeginPlay cache:', { getRelXform, breakXform, setRootLocVar });

  // --- End Overlap tail: after reset extent, restore collider loc + root rot ---
  const getRootLocCached = await addNode('GetVar', { variableName: 'Root Location' }, 3120, -420);
  const setCollRelLoc = await addNode(
    'CallFunction',
    { functionName: 'K2_SetRelativeLocation', targetClass: '/Script/Engine.SceneComponent' },
    3360,
    -420
  );
  const makeRotZero = await addNode(
    'CallFunction',
    { functionName: 'MakeRotator', targetClass: '/Script/Engine.KismetMathLibrary' },
    3580,
    -300
  );
  const getShadowRoot = await addNode('GetVar', { variableName: 'ShaodwColliderRoot' }, 3360, -180);
  const setRootRelRot = await addNode(
    'CallFunction',
    { functionName: 'K2_SetRelativeRotation', targetClass: '/Script/Engine.SceneComponent' },
    3820,
    -260
  );

  await setPin(makeRotZero, 'Roll', '0.0');
  await setPin(makeRotZero, 'Pitch', '0.0');
  await setPin(makeRotZero, 'Yaw', '0.0');

  await connectAny(getRootLocCached, ['Root Location'], setCollRelLoc, ['NewLocation', 'Location', 'RelativeLocation']);
  await connectAny(GET_SHADOW_COLLIDER_RESET, ['ShadowCollider'], setCollRelLoc, ['self', 'Target']);

  await connectAny(makeRotZero, ['ReturnValue'], setRootRelRot, ['NewRotation', 'DesiredRotation', 'InRotation']);
  await connectAny(getShadowRoot, ['ShaodwColliderRoot'], setRootRelRot, ['self', 'Target']);

  await connectAny(SET_EXTENT_RESET, ['then'], setCollRelLoc, ['execute']);
  await connectAny(setCollRelLoc, ['then'], setRootRelRot, ['execute']);

  console.log('End overlap restore:', { getRootLocCached, setCollRelLoc, makeRotZero, getShadowRoot, setRootRelRot });

  await bp({ action: 'compile', path: BP, assetPath: BP });
  const v = await bp({ action: 'validate', path: BP, assetPath: BP });
  console.log(JSON.stringify(v, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
