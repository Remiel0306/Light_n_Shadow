const { spawn } = require('child_process');

const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const BP = '/Game/BluePrint/BP_Enemy1';

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

function parseText(res) {
  const txt = res?.result?.content?.[0]?.text;
  try { return JSON.parse(txt); } catch { return { success: false, error: txt || 'Unknown error' }; }
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

async function bpCall(args) {
  const res = await rpc('tools/call', { name: 'blueprint', arguments: args });
  const payload = parseText(res);
  if (!payload.success) throw new Error(payload.error || 'Blueprint call failed');
  return payload;
}

async function addNode(nodeClass, nodeParams, posX, posY) {
  const n = await bpCall({
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

async function connect(sourceNode, sourcePin, targetNode, targetPin) {
  return bpCall({
    action: 'connect_pins',
    path: BP,
    assetPath: BP,
    graphName: 'EventGraph',
    sourceNode,
    sourcePin,
    targetNode,
    targetPin,
  });
}

async function setPin(nodeId, pinName, defaultValue) {
  return bpCall({
    action: 'set_node_property',
    path: BP,
    assetPath: BP,
    graphName: 'EventGraph',
    nodeName: nodeId,
    pinName,
    defaultValue,
  });
}

async function main() {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'wire-shadow-clean', version: '1.0' },
  });

  const g = await bpCall({ action: 'read_graph', path: BP, assetPath: BP, graphName: 'EventGraph' });
  const lineTrace = g.nodes.find((n) => (n.title || '').includes('Line Trace By Channel'));
  const breakHit = g.nodes.find((n) => (n.title || '').includes('Break Hit Result'));
  if (!lineTrace || !breakHit) throw new Error('LineTrace/BreakHit not found');

  const x = (lineTrace.posX || -1200) + 2600;
  const y = (lineTrace.posY || 1000);

  const setFarthest = await addNode('SetVar', { variableName: 'Shadow farthest location' }, x, y);
  const getRoot = await addNode('GetVar', { variableName: 'ShaodwColliderRoot' }, x + 200, y + 250);
  const getRootLoc = await addNode('CallFunction', { functionName: 'K2_GetComponentLocation', targetClass: '/Script/Engine.SceneComponent' }, x + 420, y + 230);
  const subVec = await addNode('CallFunction', { functionName: 'Subtract_VectorVector', targetClass: '/Script/Engine.KismetMathLibrary' }, x + 680, y + 180);
  const vSize = await addNode('CallFunction', { functionName: 'VSize', targetClass: '/Script/Engine.KismetMathLibrary' }, x + 920, y + 180);
  const setDist = await addNode('SetVar', { variableName: 'Shadow colision distance' }, x + 1120, y + 20);
  const makeVec = await addNode('CallFunction', { functionName: 'MakeVector', targetClass: '/Script/Engine.KismetMathLibrary' }, x + 1340, y + 150);
  const getCollider = await addNode('GetVar', { variableName: 'ShadowCollider' }, x + 1340, y + 320);
  const setExtent = await addNode('CallFunction', { functionName: 'SetBoxExtent', targetClass: '/Script/Engine.BoxComponent' }, x + 1580, y + 150);

  await connect(lineTrace.id, 'then', setFarthest, 'execute');
  try { await connect(breakHit.id, 'Location', setFarthest, 'Shadow farthest location'); }
  catch { await connect(breakHit.id, 'ImpactPoint', setFarthest, 'Shadow farthest location'); }

  await connect(getRoot, 'ShaodwColliderRoot', getRootLoc, 'self');
  await connect(breakHit.id, 'Location', subVec, 'A');
  await connect(getRootLoc, 'ReturnValue', subVec, 'B');
  await connect(subVec, 'ReturnValue', vSize, 'A');

  await connect(setFarthest, 'then', setDist, 'execute');
  await connect(vSize, 'ReturnValue', setDist, 'Shadow colision distance');

  await connect(vSize, 'ReturnValue', makeVec, 'X');
  await setPin(makeVec, 'Y', '20.0');
  await setPin(makeVec, 'Z', '120.0');

  await connect(getCollider, 'ShadowCollider', setExtent, 'self');
  await connect(makeVec, 'ReturnValue', setExtent, 'InBoxExtent');
  await connect(setDist, 'then', setExtent, 'execute');
  await setPin(setExtent, 'bUpdateOverlaps', 'true');

  await bpCall({ action: 'compile', path: BP, assetPath: BP });
  console.log('WIRE_SHADOW_CHAIN_DONE');
  process.exit(0);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

