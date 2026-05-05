/**
 * Creates ResetOneShadowCollider on BP_Enemy1:
 * TargetRoot (SceneComponent), TargetCollider (BoxComponent)
 * Exec: SetBoxExtent(Origin colision size) -> SetRelativeLocation(Root Location) -> SetCollisionEnabled(NoCollision)
 *
 * Requires UE editor + MCP bridge running.
 */
const { spawn } = require('child_process');

const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const BP = '/Game/BluePrint/BP_Enemy1';
const FUNC = 'ResetOneShadowCollider';

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

function payload(res) {
  const txt = res?.result?.content?.[0]?.text;
  try { return JSON.parse(txt); } catch { return { success: false, error: txt || 'parse failed' }; }
}

mcp.stdout.on('data', (data) => {
  for (const line of data.toString().split('\n')) {
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
  const p = payload(res);
  if (!p.success) throw new Error(p.error || JSON.stringify(p));
  return p;
}

async function add(nodeClass, nodeParams, posX, posY) {
  const n = await bp({ action: 'add_node', path: BP, assetPath: BP, graphName: FUNC, nodeClass, nodeParams, posX, posY });
  return n.nodeId;
}

async function connect(a, aps, b, bps) {
  let last;
  for (const ap of aps) for (const bpPin of bps) {
    try {
      await bp({
        action: 'connect_pins',
        path: BP,
        assetPath: BP,
        graphName: FUNC,
        sourceNode: a,
        sourcePin: ap,
        targetNode: b,
        targetPin: bpPin,
      });
      return;
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

async function setPin(node, pin, value) {
  try {
    await bp({ action: 'set_node_property', path: BP, assetPath: BP, graphName: FUNC, nodeName: node, propertyName: pin, value });
  } catch {
    await bp({ action: 'set_node_property', path: BP, assetPath: BP, graphName: FUNC, nodeName: node, pinName: pin, defaultValue: value });
  }
}

async function main() {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'create-reset-shadow', version: '1.0' } });

  try {
    await bp({ action: 'delete_function', path: BP, assetPath: BP, functionName: FUNC });
  } catch (_) {}

  await bp({ action: 'create_function', path: BP, assetPath: BP, functionName: FUNC, onConflict: 'skip' });

  for (const [parameterName, parameterType, isOutput] of [
    ['TargetRoot', '/Script/Engine.SceneComponent', false],
    ['TargetCollider', '/Script/Engine.BoxComponent', false],
  ]) {
    await bp({ action: 'add_function_parameter', path: BP, assetPath: BP, functionName: FUNC, parameterName, parameterType, isOutput });
  }

  const graph = await bp({ action: 'read_graph', path: BP, assetPath: BP, graphName: FUNC });
  const entry = graph.nodes.find((n) => n.class === 'K2Node_FunctionEntry');
  if (!entry) throw new Error('Function entry missing');

  const getOrigin = await add('GetVar', { variableName: 'Origin colision size' }, 200, -80);
  const getRootLoc = await add('GetVar', { variableName: 'Root Location' }, 200, 80);
  const setExt = await add('CallFunction', { functionName: 'SetBoxExtent', targetClass: '/Script/Engine.BoxComponent' }, 520, -40);
  const setRel = await add('CallFunction', { functionName: 'K2_SetRelativeLocation', targetClass: '/Script/Engine.SceneComponent' }, 820, -40);
  let setCol;
  try {
    setCol = await add('CallFunction', { functionName: 'SetCollisionEnabled', targetClass: '/Script/Engine.PrimitiveComponent' }, 1120, -40);
  } catch {
    setCol = await add('CallFunction', { functionName: 'SetCollisionEnabled', targetClass: '/Script/Engine.BoxComponent' }, 1120, -40);
  }

  await connect(entry.id, ['then'], setExt, ['execute']);
  await connect(setExt, ['then'], setRel, ['execute']);
  await connect(setRel, ['then'], setCol, ['execute']);

  await connect(entry.id, ['TargetCollider'], setExt, ['self']);
  await connect(entry.id, ['TargetCollider'], setRel, ['self']);
  await connect(entry.id, ['TargetCollider'], setCol, ['self']);

  await connect(getOrigin, ['Origin colision size', 'ReturnValue'], setExt, ['InBoxExtent', 'NewExtent']);
  await connect(getRootLoc, ['Root Location', 'ReturnValue'], setRel, ['NewLocation', 'Location']);

  // Enum: try common Blueprint literal strings
  const enumTries = [
    'ECollisionEnabled::No Collision',
    'NoCollision',
    'ECollisionEnabled::NoCollision',
    '0',
  ];
  let setColOk = false;
  for (const v of enumTries) {
    try {
      await setPin(setCol, 'NewType', v);
      setColOk = true;
      break;
    } catch (_) {}
  }
  if (!setColOk) {
    console.warn('Could not set NewType via set_node_property; set manually in editor.');
  }

  await setPin(setExt, 'bUpdateOverlaps', 'true');

  await bp({ action: 'compile', path: BP, assetPath: BP });
  const validation = await bp({ action: 'validate', path: BP, assetPath: BP });
  const check = await bp({ action: 'read_graph_summary', path: BP, assetPath: BP, graphName: FUNC });
  console.log(JSON.stringify({ validation, nodeCount: check.nodeCount, functionName: FUNC }, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
