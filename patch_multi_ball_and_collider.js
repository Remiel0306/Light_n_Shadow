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

function parsePayload(msg) {
  const text = msg?.result?.content?.[0]?.text;
  if (!text) return { success: false, error: 'No payload' };
  try { return JSON.parse(text); } catch { return { success: false, error: text }; }
}

mcp.stdout.on('data', (d) => {
  for (const line of d.toString().split('\n')) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      const waiter = pending.get(msg.id);
      if (waiter) {
        pending.delete(msg.id);
        waiter(msg);
      }
    } catch (_) {}
  }
});

async function bp(argumentsObj) {
  const res = await rpc('tools/call', { name: 'blueprint', arguments: argumentsObj });
  const payload = parsePayload(res);
  if (!payload.success) throw new Error(payload.error || JSON.stringify(payload));
  return payload;
}

async function addNode(nodeClass, nodeParams, posX, posY) {
  const out = await bp({
    action: 'add_node',
    path: BP,
    assetPath: BP,
    graphName: 'EventGraph',
    nodeClass,
    nodeParams,
    posX,
    posY,
  });
  return out.nodeId;
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

async function connectAny(srcNode, srcPins, dstNode, dstPins) {
  let lastErr;
  for (const sp of srcPins) {
    for (const dp of dstPins) {
      try {
        await connect(srcNode, sp, dstNode, dp);
        return;
      } catch (e) {
        lastErr = e;
      }
    }
  }
  throw lastErr || new Error(`Failed connecting ${srcNode} -> ${dstNode}`);
}

async function setPin(nodeId, pinName, defaultValue) {
  return bp({
    action: 'set_node_property',
    path: BP,
    assetPath: BP,
    graphName: 'EventGraph',
    nodeName: nodeId,
    propertyName: pinName,
    value: defaultValue,
  });
}

async function main() {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'patch-multi-ball-collider', version: '1.0' },
  });

  const graph = await bp({ action: 'read_graph', path: BP, assetPath: BP, graphName: 'EventGraph' });
  const nodes = graph.nodes || [];
  const findTitle = (k) => nodes.find((n) => (n.title || '').includes(k));

  // Key existing nodes
  const forEach = findTitle('For Each Loop');
  const tickShadowCall = nodes.find((n) => (n.title || '').includes('Shadow Collision Change') && n.class === 'K2Node_CallFunction');
  const endOverlap = findTitle('On Component End Overlap (CapsuleComponent)');

  if (!forEach || !tickShadowCall || !endOverlap) {
    throw new Error('Required existing nodes not found (ForEach / ShadowCall / EndOverlap)');
  }

  // Find set distance node from execution flow to extend collider behavior.
  const shadowFlow = await bp({
    action: 'get_execution_flow',
    path: BP,
    assetPath: BP,
    graphName: 'EventGraph',
    entryPoint: 'Shadow Collision Change',
  });
  const setDistStep = (shadowFlow.steps || []).find((s) => (s.title || '').includes('Set Shadow colision distance'));
  if (!setDistStep) throw new Error('Set Shadow colision distance step not found');
  const setDistId = setDistStep.id;

  // Keep trace visible for debugging.
  const lineTrace = findTitle('Line Trace By Channel');
  if (lineTrace) {
    await setPin(lineTrace.id, 'DrawDebugType', 'ForDuration');
    await setPin(lineTrace.id, 'DrawTime', '5.0');
  }

  // ------------------------------------------------------------------
  // 1) Multi-ball fix: every ForEach loop element updates Active Ball.
  // ------------------------------------------------------------------
  const setActive = await addNode('SetVar', { variableName: 'Active Ball' }, forEach.posX + 280, forEach.posY + 120);
  await connectAny(forEach.id, ['LoopBody'], setActive, ['execute']);
  await connectAny(forEach.id, ['Array Element'], setActive, ['Active Ball', 'Input']);
  await connectAny(setActive, ['then'], tickShadowCall.id, ['execute']);

  // EndOverlap removes ball from Active Ball array relation.
  const getActiveEnd = await addNode('GetVar', { variableName: 'Active Ball' }, endOverlap.posX + 340, endOverlap.posY + 130);
  const removeItem = await addNode('CallFunction', { functionName: 'Array_RemoveItem', targetClass: '/Script/Engine.KismetArrayLibrary' }, endOverlap.posX + 620, endOverlap.posY + 120);
  await connectAny(endOverlap.id, ['then'], removeItem, ['execute']);
  await connectAny(getActiveEnd, ['Active Ball'], removeItem, ['TargetArray', 'Array']);
  await connectAny(endOverlap.id, ['OtherActor'], removeItem, ['Item', 'NewItem']);

  // ------------------------------------------------------------------
  // 2) Collider behavior fix: orient root to hit point and place box
  //    at half-distance so it does not become a stuck line in the air.
  // ------------------------------------------------------------------
  const baseX = forEach.posX + 1200;
  const baseY = forEach.posY + 260;

  const getRoot = await addNode('GetVar', { variableName: 'ShaodwColliderRoot' }, baseX, baseY + 220);
  const getRootLoc = await addNode('CallFunction', { functionName: 'K2_GetComponentLocation', targetClass: '/Script/Engine.SceneComponent' }, baseX + 220, baseY + 200);
  const getFar = await addNode('GetVar', { variableName: 'Shadow farthest location' }, baseX, baseY + 20);
  const lookAt = await addNode('CallFunction', { functionName: 'FindLookAtRotation', targetClass: '/Script/Engine.KismetMathLibrary' }, baseX + 460, baseY + 80);
  const setRootRot = await addNode('CallFunction', { functionName: 'K2_SetWorldRotation', targetClass: '/Script/Engine.SceneComponent' }, baseX + 700, baseY + 80);

  const divideHalf = await addNode('CallFunction', { functionName: 'Divide_DoubleDouble', targetClass: '/Script/Engine.KismetMathLibrary' }, baseX + 460, baseY + 280);
  const makeLoc = await addNode('CallFunction', { functionName: 'MakeVector', targetClass: '/Script/Engine.KismetMathLibrary' }, baseX + 700, baseY + 280);
  const getCollider = await addNode('GetVar', { variableName: 'ShadowCollider' }, baseX + 700, baseY + 450);
  const setRelLoc = await addNode('CallFunction', { functionName: 'K2_SetRelativeLocation', targetClass: '/Script/Engine.SceneComponent' }, baseX + 950, baseY + 280);

  const makeExtent = await addNode('CallFunction', { functionName: 'MakeVector', targetClass: '/Script/Engine.KismetMathLibrary' }, baseX + 950, baseY + 440);
  const setExtent = await addNode('CallFunction', { functionName: 'SetBoxExtent', targetClass: '/Script/Engine.BoxComponent' }, baseX + 1190, baseY + 440);

  await connectAny(getRoot, ['ShaodwColliderRoot'], getRootLoc, ['self', 'Target']);
  await connectAny(getRootLoc, ['ReturnValue'], lookAt, ['Start']);
  await connectAny(getFar, ['Shadow farthest location'], lookAt, ['Target']);
  await connectAny(getRoot, ['ShaodwColliderRoot'], setRootRot, ['self', 'Target']);
  await connectAny(lookAt, ['ReturnValue'], setRootRot, ['NewRotation', 'DesiredRotation']);

  await connectAny(setDistId, ['then'], setRootRot, ['execute']);
  await connectAny(setRootRot, ['then'], setRelLoc, ['execute']);
  await connectAny(setRelLoc, ['then'], setExtent, ['execute']);

  await connectAny(setDistId, ['Shadow colision distance', 'Output_Get'], divideHalf, ['A', 'Dividend']);
  await setPin(divideHalf, 'B', '2.0');

  await connectAny(divideHalf, ['ReturnValue'], makeLoc, ['X']);
  await setPin(makeLoc, 'Y', '0.0');
  await setPin(makeLoc, 'Z', '0.0');

  await connectAny(getCollider, ['ShadowCollider'], setRelLoc, ['self', 'Target']);
  await connectAny(makeLoc, ['ReturnValue'], setRelLoc, ['NewLocation', 'Location']);

  await connectAny(divideHalf, ['ReturnValue'], makeExtent, ['X']);
  await setPin(makeExtent, 'Y', '20.0');
  await setPin(makeExtent, 'Z', '120.0');
  await connectAny(getCollider, ['ShadowCollider'], setExtent, ['self', 'Target']);
  await connectAny(makeExtent, ['ReturnValue'], setExtent, ['InBoxExtent', 'NewExtent']);
  await setPin(setExtent, 'bUpdateOverlaps', 'true');

  await bp({ action: 'compile', path: BP, assetPath: BP });
  const valid = await bp({ action: 'validate', path: BP, assetPath: BP });
  console.log('PATCH_DONE', JSON.stringify({ valid: valid.valid, errorCount: valid.errorCount, warningCount: valid.warningCount }));
  process.exit(0);
}

main().catch((err) => {
  console.error('PATCH_FAILED:', err.message);
  process.exit(1);
});

