/**
 * BP_Enemy1: End-overlap reset used Set Relative Rotation on ShadowCollider with default (0,0,0),
 * but ShadowCollider's authored relative rotation is Yaw -90 (see component defaults).
 * Wire Make Rotator (0, 0, -90) -> Set Relative Rotation NewRotation.
 * Also wire Get Root Location -> Set Relative Location NewLocation on the reset chain if missing.
 */
const { spawn } = require('child_process');

const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const BP = '/Game/BluePrint/BP_Enemy1';

const SET_REL_ROT = '0Nd0IUuyqD3aasGqnU4fZQ';
const SET_REL_LOC = 'sf73WUuf06e6TS2Xuc51tg';

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
  throw last || new Error(`connectAny failed ${sourceNode} -> ${targetNode}`);
}

async function main() {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'fix-shadow-reset-rot', version: '1.0' },
  });

  const makeRot = await addNode(
    'CallFunction',
    { functionName: 'MakeRotator', targetClass: '/Script/Engine.KismetMathLibrary' },
    3300,
    -200
  );
  await setPin(makeRot, 'Roll', '0.0');
  await setPin(makeRot, 'Pitch', '0.0');
  await setPin(makeRot, 'Yaw', '-90.0');

  await connectAny(makeRot, ['ReturnValue'], SET_REL_ROT, ['NewRotation', 'DesiredRotation', 'InRotation']);
  console.log('MakeRotator -> Set Relative Rotation:', makeRot);

  const getRootLoc = await addNode('GetVar', { variableName: 'Root Location' }, 3000, -520);
  await connectAny(getRootLoc, ['Root Location'], SET_REL_LOC, ['NewLocation', 'Location', 'RelativeLocation']);
  console.log('Root Location -> Set Relative Location');

  await bp({ action: 'compile', path: BP, assetPath: BP });
  console.log(JSON.stringify(await bp({ action: 'validate', path: BP, assetPath: BP }), null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
