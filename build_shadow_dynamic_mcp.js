const { spawn } = require('child_process');

const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const BP = '/Game/BluePrint/BP_Enemy1';

const mcp = spawn('npx.cmd', ['ue-mcp', PROJECT], { shell: true });
let reqId = 1;
const pending = new Map();

function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const id = reqId++;
    pending.set(id, { resolve, reject });
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

function parseToolText(res) {
  const txt = res?.result?.content?.[0]?.text;
  if (!txt) return null;
  try { return JSON.parse(txt); } catch { return { raw: txt }; }
}

mcp.stdout.on('data', (data) => {
  for (const line of data.toString().split('\n')) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    } catch (_) {}
  }
});

async function callBlueprint(argumentsObj) {
  const res = await rpc('tools/call', { name: 'blueprint', arguments: argumentsObj });
  const payload = parseToolText(res);
  if (!payload?.success) {
    throw new Error(payload?.error || JSON.stringify(payload || res));
  }
  return payload;
}

async function addNode(nodeClass, nodeParams, posX, posY) {
  const payload = await callBlueprint({
    action: 'add_node',
    path: BP,
    assetPath: BP,
    graphName: 'EventGraph',
    nodeClass,
    nodeParams,
    posX,
    posY,
  });
  return payload.nodeId;
}

async function connect(sourceNodeId, sourcePinName, targetNodeId, targetPinName) {
  return callBlueprint({
    action: 'connect_pins',
    path: BP,
    assetPath: BP,
    graphName: 'EventGraph',
    sourceNode: sourceNodeId,
    sourcePin: sourcePinName,
    targetNode: targetNodeId,
    targetPin: targetPinName,
  });
}

async function connectAny(sourceNodeId, sourcePins, targetNodeId, targetPins) {
  let lastErr = null;
  for (const sp of sourcePins) {
    for (const tp of targetPins) {
      try {
        await connect(sourceNodeId, sp, targetNodeId, tp);
        return;
      } catch (e) {
        lastErr = e;
      }
    }
  }
  throw lastErr || new Error('connectAny failed');
}

async function setPin(nodeId, pinName, defaultValue) {
  return callBlueprint({
    action: 'set_node_property',
    path: BP,
    assetPath: BP,
    graphName: 'EventGraph',
    nodeId,
    pinName,
    defaultValue,
  });
}

async function main() {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'shadow-dynamic-mcp', version: '1.0' },
  });

  const graph = await callBlueprint({
    action: 'read_graph',
    path: BP,
    assetPath: BP,
    blueprintPath: BP,
    graphName: 'EventGraph',
  });

  const nodes = graph.nodes || [];
  const findTitle = (k) => nodes.find((n) => (n.title || '').includes(k));
  const lineTrace = findTitle('Line Trace By Channel');
  const breakHit = findTitle('Break Hit Result');
  if (!lineTrace || !breakHit) throw new Error('Missing existing LineTrace/BreakHit nodes');

  const x = (lineTrace.posX || -1200) + 450;
  const y = (lineTrace.posY || 1000) + 120;

  const setFarthest = await addNode('SetVar', { variableName: 'Shadow farthest location' }, x, y);
  const getRoot = await addNode('GetVar', { variableName: 'ShaodwColliderRoot' }, x + 220, y + 240);
  const getRootWorld = await addNode('CallFunction', { functionName: 'GetWorldLocation', targetClass: '/Script/Engine.SceneComponent' }, x + 420, y + 220);
  const subVec = await addNode('CallFunction', { functionName: 'Subtract_VectorVector', targetClass: '/Script/Engine.KismetMathLibrary' }, x + 650, y + 150);
  const vecLen = await addNode('CallFunction', { functionName: 'VectorLength', targetClass: '/Script/Engine.KismetMathLibrary' }, x + 860, y + 150);
  const setDist = await addNode('SetVar', { variableName: 'Shadow colision distance' }, x + 1060, y);
  const half = await addNode('CallFunction', { functionName: 'Divide_DoubleDouble', targetClass: '/Script/Engine.KismetMathLibrary' }, x + 1280, y + 150);
  const makeVec = await addNode('CallFunction', { functionName: 'MakeVector', targetClass: '/Script/Engine.KismetMathLibrary' }, x + 1480, y + 120);
  const getCollider = await addNode('GetVar', { variableName: 'ShadowCollider' }, x + 1480, y + 300);
  const setExtent = await addNode('CallFunction', { functionName: 'SetBoxExtent', targetClass: '/Script/Engine.BoxComponent' }, x + 1720, y + 120);

  await connectAny(lineTrace.id, ['then'], setFarthest, ['execute']);
  await connectAny(breakHit.id, ['Location', 'ImpactPoint'], setFarthest, ['Shadow farthest location', 'Input']);

  await connectAny(getRoot, ['ShaodwColliderRoot'], getRootWorld, ['self', 'Target']);
  await connectAny(breakHit.id, ['Location', 'ImpactPoint'], subVec, ['A', 'V1']);
  await connectAny(getRootWorld, ['ReturnValue'], subVec, ['B', 'V2']);
  await connectAny(subVec, ['ReturnValue'], vecLen, ['V', 'A']);

  await connectAny(setFarthest, ['then'], setDist, ['execute']);
  await connectAny(vecLen, ['ReturnValue'], setDist, ['Shadow colision distance', 'Input']);

  await connectAny(vecLen, ['ReturnValue'], half, ['A', 'Dividend']);
  await setPin(half, 'B', '2.0');

  await connectAny(half, ['ReturnValue'], makeVec, ['X']);
  await setPin(makeVec, 'Y', '20.0');
  await setPin(makeVec, 'Z', '120.0');

  await connectAny(getCollider, ['ShadowCollider'], setExtent, ['Target', 'self']);
  await connectAny(makeVec, ['ReturnValue'], setExtent, ['InBoxExtent', 'NewExtent']);
  await connectAny(setDist, ['then'], setExtent, ['execute']);
  await setPin(setExtent, 'bUpdateOverlaps', 'true');

  await callBlueprint({ action: 'compile', path: BP, assetPath: BP });
  console.log('SHADOW_DYNAMIC_MCP_DONE');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});

