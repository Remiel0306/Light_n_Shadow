const { spawn } = require('child_process');

const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const BP = '/Game/BluePrint/BP_Enemy1';
const FUNC = 'UpdateOneShadowCollider';

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
      await bp({ action: 'connect_pins', path: BP, assetPath: BP, graphName: FUNC, sourceNode: a, sourcePin: ap, targetNode: b, targetPin: bpPin });
      return;
    } catch (e) { last = e; }
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
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'ensure-update-one-shadow-collider', version: '1.0' } });

  try { await bp({ action: 'delete_function', path: BP, assetPath: BP, functionName: FUNC }); } catch {}
  await bp({ action: 'create_function', path: BP, assetPath: BP, functionName: FUNC, onConflict: 'skip' });

  for (const [parameterName, parameterType, isOutput] of [
    ['TargetRoot', '/Script/Engine.SceneComponent', false],
    ['TargetCollider', '/Script/Engine.BoxComponent', false],
    ['Start', 'Vector', false],
    ['Dir', 'Vector', false],
    ['MaxDistance', 'Float', false],
    ['WidthX', 'Float', false],
    ['ThicknessZ', 'Float', false],
    ['DidHit', 'Bool', true],
  ]) {
    await bp({ action: 'add_function_parameter', path: BP, assetPath: BP, functionName: FUNC, parameterName, parameterType, isOutput });
  }

  const graph = await bp({ action: 'read_graph', path: BP, assetPath: BP, graphName: FUNC });
  const entry = graph.nodes.find((n) => n.class === 'K2Node_FunctionEntry');
  const result = graph.nodes.find((n) => n.class === 'K2Node_FunctionResult');
  if (!entry || !result) throw new Error('Function entry/result missing');

  const normal = await add('CallFunction', { functionName: 'Normal', targetClass: '/Script/Engine.KismetMathLibrary' }, 300, -120);
  const scale = await add('CallFunction', { functionName: 'Multiply_VectorFloat', targetClass: '/Script/Engine.KismetMathLibrary' }, 540, -120);
  const end = await add('CallFunction', { functionName: 'Add_VectorVector', targetClass: '/Script/Engine.KismetMathLibrary' }, 780, -120);
  const trace = await add('CallFunction', { functionName: 'LineTraceSingle', targetClass: '/Script/Engine.KismetSystemLibrary' }, 1040, -160);
  const breakHit = await add('CallFunction', { functionName: 'BreakHitResult', targetClass: '/Script/Engine.GameplayStatics' }, 1300, 80);
  const select = await add('CallFunction', { functionName: 'SelectVector', targetClass: '/Script/Engine.KismetMathLibrary' }, 1560, -40);
  const delta = await add('CallFunction', { functionName: 'Subtract_VectorVector', targetClass: '/Script/Engine.KismetMathLibrary' }, 1820, -40);
  const len = await add('CallFunction', { functionName: 'VSize', targetClass: '/Script/Engine.KismetMathLibrary' }, 2060, -40);
  const half = await add('CallFunction', { functionName: 'Divide_DoubleDouble', targetClass: '/Script/Engine.KismetMathLibrary' }, 2300, -40);
  const look = await add('CallFunction', { functionName: 'FindLookAtRotation', targetClass: '/Script/Engine.KismetMathLibrary' }, 1820, -300);
  const rootLoc = await add('CallFunction', { functionName: 'K2_SetWorldLocation', targetClass: '/Script/Engine.SceneComponent' }, 2060, -360);
  const rootRot = await add('CallFunction', { functionName: 'K2_SetWorldRotation', targetClass: '/Script/Engine.SceneComponent' }, 2300, -360);
  const makeLoc = await add('CallFunction', { functionName: 'MakeVector', targetClass: '/Script/Engine.KismetMathLibrary' }, 2540, 80);
  const setLoc = await add('CallFunction', { functionName: 'K2_SetRelativeLocation', targetClass: '/Script/Engine.SceneComponent' }, 2780, -100);
  const makeExt = await add('CallFunction', { functionName: 'MakeVector', targetClass: '/Script/Engine.KismetMathLibrary' }, 2780, 180);
  const setExt = await add('CallFunction', { functionName: 'SetBoxExtent', targetClass: '/Script/Engine.BoxComponent' }, 3040, -100);

  await connect(entry.id, ['then'], trace, ['execute']);
  await connect(trace, ['then'], rootLoc, ['execute']);
  await connect(rootLoc, ['then'], rootRot, ['execute']);
  await connect(rootRot, ['then'], setLoc, ['execute']);
  await connect(setLoc, ['then'], setExt, ['execute']);
  await connect(setExt, ['then'], result.id, ['execute']);

  await connect(entry.id, ['Dir'], normal, ['A']);
  await connect(normal, ['ReturnValue'], scale, ['A']);
  await connect(entry.id, ['MaxDistance'], scale, ['B']);
  await connect(entry.id, ['Start'], end, ['A']);
  await connect(scale, ['ReturnValue'], end, ['B']);
  await connect(entry.id, ['Start'], trace, ['Start']);
  await connect(end, ['ReturnValue'], trace, ['End']);
  await connect(trace, ['OutHit'], breakHit, ['Hit']);
  await connect(trace, ['ReturnValue'], select, ['bPickA']);
  await connect(breakHit, ['Location'], select, ['A']);
  await connect(end, ['ReturnValue'], select, ['B']);
  await connect(select, ['ReturnValue'], delta, ['A']);
  await connect(entry.id, ['Start'], delta, ['B']);
  await connect(delta, ['ReturnValue'], len, ['A']);
  await connect(len, ['ReturnValue'], half, ['A']);
  await setPin(half, 'B', '2.0');
  await connect(entry.id, ['Start'], look, ['Start']);
  await connect(select, ['ReturnValue'], look, ['Target']);
  await connect(entry.id, ['TargetRoot'], rootLoc, ['self']);
  await connect(entry.id, ['Start'], rootLoc, ['NewLocation']);
  await connect(entry.id, ['TargetRoot'], rootRot, ['self']);
  await connect(look, ['ReturnValue'], rootRot, ['NewRotation']);
  await connect(half, ['ReturnValue'], makeLoc, ['Y']);
  await setPin(makeLoc, 'X', '0.0');
  await setPin(makeLoc, 'Z', '0.0');
  await connect(entry.id, ['TargetCollider'], setLoc, ['self']);
  await connect(makeLoc, ['ReturnValue'], setLoc, ['NewLocation']);
  await connect(entry.id, ['WidthX'], makeExt, ['X']);
  await connect(half, ['ReturnValue'], makeExt, ['Y']);
  await connect(entry.id, ['ThicknessZ'], makeExt, ['Z']);
  await connect(entry.id, ['TargetCollider'], setExt, ['self']);
  await connect(makeExt, ['ReturnValue'], setExt, ['InBoxExtent']);
  await setPin(setExt, 'bUpdateOverlaps', 'true');
  await connect(trace, ['ReturnValue'], result.id, ['DidHit']);

  await bp({ action: 'compile', path: BP, assetPath: BP });
  const valid = await bp({ action: 'validate', path: BP, assetPath: BP });
  const check = await bp({ action: 'read_graph_summary', path: BP, assetPath: BP, graphName: FUNC });
  console.log(JSON.stringify({ valid, nodeCount: check.nodeCount, functionName: FUNC }, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
