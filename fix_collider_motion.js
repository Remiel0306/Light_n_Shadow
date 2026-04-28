const { spawn } = require('child_process');

const BP = '/Game/BluePrint/BP_Enemy1';
const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';

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
  const t = msg?.result?.content?.[0]?.text;
  try { return JSON.parse(t); } catch { return { success: false, error: t || 'parse error' }; }
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
  const r = await rpc('tools/call', { name: 'blueprint', arguments: args });
  const p = parse(r);
  if (!p.success) throw new Error(p.error || JSON.stringify(p));
  return p;
}

async function addNode(nodeClass, nodeParams, x, y) {
  const n = await bp({
    action: 'add_node',
    path: BP,
    assetPath: BP,
    graphName: 'EventGraph',
    nodeClass,
    nodeParams,
    posX: x,
    posY: y,
  });
  return n.nodeId;
}

async function connectAny(srcNode, srcPins, dstNode, dstPins) {
  let last;
  for (const sp of srcPins) {
    for (const dp of dstPins) {
      try {
        await bp({
          action: 'connect_pins',
          path: BP,
          assetPath: BP,
          graphName: 'EventGraph',
          sourceNode: srcNode,
          sourcePin: sp,
          targetNode: dstNode,
          targetPin: dp,
        });
        return;
      } catch (e) {
        last = e;
      }
    }
  }
  throw last || new Error(`connectAny failed ${srcNode} -> ${dstNode}`);
}

async function setPin(nodeId, propertyName, value) {
  return bp({
    action: 'set_node_property',
    path: BP,
    assetPath: BP,
    graphName: 'EventGraph',
    nodeName: nodeId,
    propertyName,
    value,
  });
}

async function main() {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fix-collider-motion', version: '1.0' } });

  const g = await bp({ action: 'read_graph', path: BP, assetPath: BP, graphName: 'EventGraph' });
  const shadowFlow = await bp({ action: 'get_execution_flow', path: BP, assetPath: BP, graphName: 'EventGraph', entryPoint: 'Shadow Collision Change' });
  const setDist = (shadowFlow.steps || []).find((s) => (s.title || '').includes('Set Shadow colision distance'));
  if (!setDist) throw new Error('Set Shadow colision distance not found');

  const ref = g.nodes.find((n) => (n.title || '').includes('Set Box Extent')) || g.nodes.find((n) => (n.title || '').includes('Line Trace By Channel'));
  const baseX = (ref?.posX || 2000) + 1200;
  const baseY = (ref?.posY || 900) + 100;

  const getRoot = await addNode('GetVar', { variableName: 'ShaodwColliderRoot' }, baseX, baseY + 220);
  const getRootLoc = await addNode('CallFunction', { functionName: 'K2_GetComponentLocation', targetClass: '/Script/Engine.SceneComponent' }, baseX + 220, baseY + 200);
  const getFar = await addNode('GetVar', { variableName: 'Shadow farthest location' }, baseX, baseY + 20);
  const lookAt = await addNode('CallFunction', { functionName: 'FindLookAtRotation', targetClass: '/Script/Engine.KismetMathLibrary' }, baseX + 460, baseY + 80);
  const setRootRot = await addNode('CallFunction', { functionName: 'K2_SetWorldRotation', targetClass: '/Script/Engine.SceneComponent' }, baseX + 700, baseY + 80);

  const divideHalf = await addNode('CallFunction', { functionName: 'Divide_DoubleDouble', targetClass: '/Script/Engine.KismetMathLibrary' }, baseX + 460, baseY + 280);
  const makeLoc = await addNode('CallFunction', { functionName: 'MakeVector', targetClass: '/Script/Engine.KismetMathLibrary' }, baseX + 700, baseY + 280);
  const getCol = await addNode('GetVar', { variableName: 'ShadowCollider' }, baseX + 700, baseY + 450);
  const setRelLoc = await addNode('CallFunction', { functionName: 'K2_SetRelativeLocation', targetClass: '/Script/Engine.SceneComponent' }, baseX + 950, baseY + 280);

  const makeExtent = await addNode('CallFunction', { functionName: 'MakeVector', targetClass: '/Script/Engine.KismetMathLibrary' }, baseX + 950, baseY + 440);
  const setExtent = await addNode('CallFunction', { functionName: 'SetBoxExtent', targetClass: '/Script/Engine.BoxComponent' }, baseX + 1190, baseY + 440);

  await connectAny(getRoot, ['ShaodwColliderRoot'], getRootLoc, ['self', 'Target']);
  await connectAny(getRootLoc, ['ReturnValue'], lookAt, ['Start']);
  await connectAny(getFar, ['Shadow farthest location'], lookAt, ['Target']);
  await connectAny(getRoot, ['ShaodwColliderRoot'], setRootRot, ['self', 'Target']);
  await connectAny(lookAt, ['ReturnValue'], setRootRot, ['NewRotation', 'DesiredRotation']);

  await connectAny(setDist.id, ['then'], setRootRot, ['execute']);
  await connectAny(setRootRot, ['then'], setRelLoc, ['execute']);
  await connectAny(setRelLoc, ['then'], setExtent, ['execute']);

  await connectAny(setDist.id, ['Shadow colision distance', 'Output_Get'], divideHalf, ['A', 'Dividend']);
  await setPin(divideHalf, 'B', '2.0');

  await connectAny(divideHalf, ['ReturnValue'], makeLoc, ['X']);
  await setPin(makeLoc, 'Y', '0.0');
  await setPin(makeLoc, 'Z', '0.0');

  await connectAny(getCol, ['ShadowCollider'], setRelLoc, ['self', 'Target']);
  await connectAny(makeLoc, ['ReturnValue'], setRelLoc, ['NewLocation', 'Location']);

  await connectAny(divideHalf, ['ReturnValue'], makeExtent, ['X']);
  await setPin(makeExtent, 'Y', '20.0');
  await setPin(makeExtent, 'Z', '120.0');
  await connectAny(getCol, ['ShadowCollider'], setExtent, ['self', 'Target']);
  await connectAny(makeExtent, ['ReturnValue'], setExtent, ['InBoxExtent', 'NewExtent']);
  await setPin(setExtent, 'bUpdateOverlaps', 'true');

  await bp({ action: 'compile', path: BP, assetPath: BP });
  const v = await bp({ action: 'validate', path: BP, assetPath: BP });
  console.log('FIX_COLLIDER_MOTION_DONE', JSON.stringify({ valid: v.valid, errorCount: v.errorCount, warningCount: v.warningCount }));
  process.exit(0);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

