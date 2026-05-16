const { spawn } = require('child_process');

const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const BP = '/Game/BluePrint/BP_EnemyShadowLogic';

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

function parsePayload(msg) {
  const text = msg?.result?.content?.[0]?.text;
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

mcp.stdout.on('data', (d) => {
  for (const line of d.toString().split('\n')) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      const waiter = pending.get(msg.id);
      if (waiter) {
        pending.delete(msg.id);
        waiter.resolve(msg);
      }
    } catch (_) {}
  }
});

mcp.stderr.on('data', () => {});

async function bp(args) {
  const res = await rpc('tools/call', { name: 'blueprint', arguments: args });
  const payload = parsePayload(res);
  if (!payload?.success) {
    throw new Error(payload?.error || JSON.stringify(payload));
  }
  return payload;
}

async function addNode(nodeClass, nodeParams, x, y) {
  const p = await bp({
    action: 'add_node',
    path: BP,
    assetPath: BP,
    graphName: 'EventGraph',
    nodeClass,
    nodeParams,
    posX: x,
    posY: y,
  });
  return p.nodeId;
}

async function connect(srcNode, srcPin, dstNode, dstPin) {
  return bp({
    action: 'connect_pins',
    path: BP,
    assetPath: BP,
    graphName: 'EventGraph',
    sourceNode: srcNode,
    sourcePin: srcPin,
    targetNode: dstNode,
    targetPin: dstPin,
  });
}

async function setPin(nodeId, pinName, value) {
  return bp({
    action: 'set_node_property',
    path: BP,
    assetPath: BP,
    graphName: 'EventGraph',
    nodeName: nodeId,
    pinName,
    defaultValue: value,
  });
}

async function main() {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'shadow-chain-debug', version: '1.0' },
  });

  const graph = await bp({ action: 'read_graph', path: BP, assetPath: BP, graphName: 'EventGraph' });
  const nodes = graph.nodes || [];
  const find = (k) => nodes.find((n) => (n.title || '').includes(k));

  const lineTrace = find('Line Trace By Channel');
  const breakHit = find('Break Hit Result');
  if (!lineTrace || !breakHit) throw new Error('Missing LineTrace or BreakHit');

  const baseX = (lineTrace.posX || -1280) + 3200;
  const baseY = (lineTrace.posY || 1000);

  // Make trace visible for verification.
  await setPin(lineTrace.id, 'DrawDebugType', 'ForDuration');
  await setPin(lineTrace.id, 'DrawTime', '5.0');

  const setFarthest = await addNode('SetVar', { variableName: 'Shadow farthest location' }, baseX, baseY + 40);
  const getRoot = await addNode('GetVar', { variableName: 'ShaodwColliderRoot' }, baseX + 240, baseY + 260);
  const rootLoc = await addNode('CallFunction', { functionName: 'K2_GetComponentLocation', targetClass: '/Script/Engine.SceneComponent' }, baseX + 430, baseY + 240);
  const sub = await addNode('CallFunction', { functionName: 'Subtract_VectorVector', targetClass: '/Script/Engine.KismetMathLibrary' }, baseX + 700, baseY + 170);
  const vlen = await addNode('CallFunction', { functionName: 'VSize', targetClass: '/Script/Engine.KismetMathLibrary' }, baseX + 930, baseY + 170);
  const setDist = await addNode('SetVar', { variableName: 'Shadow colision distance' }, baseX + 1160, baseY + 40);
  const makeVec = await addNode('CallFunction', { functionName: 'MakeVector', targetClass: '/Script/Engine.KismetMathLibrary' }, baseX + 1400, baseY + 150);
  const getCol = await addNode('GetVar', { variableName: 'ShadowCollider' }, baseX + 1400, baseY + 320);
  const setExtent = await addNode('CallFunction', { functionName: 'SetBoxExtent', targetClass: '/Script/Engine.BoxComponent' }, baseX + 1640, baseY + 150);

  await connect(lineTrace.id, 'then', setFarthest, 'execute');
  try { await connect(breakHit.id, 'Location', setFarthest, 'Shadow farthest location'); }
  catch { await connect(breakHit.id, 'ImpactPoint', setFarthest, 'Shadow farthest location'); }

  await connect(getRoot, 'ShaodwColliderRoot', rootLoc, 'self');
  await connect(breakHit.id, 'Location', sub, 'A');
  await connect(rootLoc, 'ReturnValue', sub, 'B');
  await connect(sub, 'ReturnValue', vlen, 'A');

  await connect(setFarthest, 'then', setDist, 'execute');
  await connect(vlen, 'ReturnValue', setDist, 'Shadow colision distance');

  await connect(vlen, 'ReturnValue', makeVec, 'X');
  await setPin(makeVec, 'Y', '20.0');
  await setPin(makeVec, 'Z', '120.0');

  await connect(getCol, 'ShadowCollider', setExtent, 'self');
  await connect(makeVec, 'ReturnValue', setExtent, 'InBoxExtent');
  await connect(setDist, 'then', setExtent, 'execute');
  await setPin(setExtent, 'bUpdateOverlaps', 'true');

  await bp({ action: 'compile', path: BP, assetPath: BP });
  await bp({ action: 'validate', path: BP, assetPath: BP });
  console.log('DONE_SHADOW_CHAIN_DEBUG');
  process.exit(0);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

