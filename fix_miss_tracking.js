const { spawn } = require('child_process');
const fs = require('fs');

const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const BP = '/Game/BluePrint/BP_EnemyShadowLogic';
const SNAPSHOT_PATH = 'D:/Unreal Engine/Light_n_Shadow/bp_enemy1_summary.json';

const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
const keepIds = new Set(snapshot.nodes.map(n => n.id));

const mcp = spawn('npx.cmd', ['ue-mcp', PROJECT], { shell: true });
let reqId = 1;
const pending = new Map();

function rpc(method, params) {
  return new Promise(resolve => {
    const id = reqId++;
    pending.set(id, resolve);
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

function parse(msg) {
  const t = msg?.result?.content?.[0]?.text;
  try { return JSON.parse(t); } catch { return { success: false, error: t }; }
}

mcp.stdout.on('data', d => {
  for (const line of d.toString().split('\n')) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      const cb = pending.get(msg.id);
      if (cb) { pending.delete(msg.id); cb(msg); }
    } catch (_) {}
  }
});

async function bpCall(args) {
  const res = await rpc('tools/call', { name: 'blueprint', arguments: args });
  const body = parse(res);
  if (!body.success) throw new Error(body.error || JSON.stringify(body));
  return body;
}

async function safeCall(args) {
  try { return await bpCall(args); } catch (_) { return null; }
}

async function connect(sn, sp, tn, tp) {
  return safeCall({ action: 'connect_pins', path: BP, assetPath: BP, graphName: 'EventGraph', sourceNode: sn, sourcePin: sp, targetNode: tn, targetPin: tp });
}

async function connectAny(sn, sps, tn, tps) {
  for (const sp of sps) for (const tp of tps) {
    const r = await safeCall({ action: 'connect_pins', path: BP, assetPath: BP, graphName: 'EventGraph', sourceNode: sn, sourcePin: sp, targetNode: tn, targetPin: tp });
    if (r) return true;
  }
  return false;
}

async function addNode(cls, params, x, y) {
  const r = await bpCall({ action: 'add_node', path: BP, assetPath: BP, graphName: 'EventGraph', nodeClass: cls, nodeParams: params, posX: x, posY: y });
  return r.nodeId;
}

async function setPin(node, prop, val) {
  await safeCall({ action: 'set_node_property', path: BP, assetPath: BP, graphName: 'EventGraph', nodeName: node, propertyName: prop, value: val });
  await safeCall({ action: 'set_node_property', path: BP, assetPath: BP, graphName: 'EventGraph', nodeName: node, pinName: prop, defaultValue: val });
}

async function main() {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fix-miss-tracking', version: '1.0' } });

  // 1. Clean: delete all non-snapshot nodes.
  const current = await bpCall({ action: 'read_graph_summary', path: BP, assetPath: BP, graphName: 'EventGraph' });
  let deleted = 0;
  for (const n of current.nodes || []) {
    if (!keepIds.has(n.id)) {
      await safeCall({ action: 'delete_node', path: BP, assetPath: BP, graphName: 'EventGraph', nodeName: n.id });
      deleted++;
    }
  }
  console.log(`Deleted ${deleted} non-snapshot nodes`);

  // 2. Restore snapshot wiring.
  for (const e of snapshot.execEdges || []) await connect(e.from, e.fromPin, e.to, e.toPin);
  for (const e of snapshot.dataEdges || []) await connect(e.from, e.fromPin, e.to, e.toPin);
  console.log('Snapshot wiring restored');

  // Known snapshot node IDs.
  const TRACE_START  = '51XraES3z5-GkpOubQXjWQ';
  const TRACE_END    = 'FC97YEOfVoT20meNoOpNmg';
  const LINE_TRACE   = 'sfFoNk8icJGtHU2-pIUNTg';
  const BREAK_HIT    = 'LuDvzUdFYf3j_2uQTvAILg';
  const SET_FARTHEST = 'P3q7jEvbSOY87PWPXUMm5A';
  const SET_DIST     = 'w6OeCkVSWJP2TLuIdKSyyg';
  const DIST_VALUE   = 'juG_A0eG54QHTjmk91aGGw'; // VSize output (Shadow colision distance)
  const GET_ROOT     = 'Tj2ehkMunWf7A6q32Meh2g';
  const GET_ROOT_LOC = 'hk4wdkvTSQx6JQWNwoAeyQ';
  const GET_COLLIDER = '8lGPJkrSM1DTHfqvupkliw';

  // 3. Add 2/3 fallback: miss point = Start + (End - Start) * (2/3)
  const sub    = await addNode('CallFunction', { functionName: 'Subtract_VectorVector', targetClass: '/Script/Engine.KismetMathLibrary' }, 2100, 760);
  const mul    = await addNode('CallFunction', { functionName: 'Multiply_VectorFloat',  targetClass: '/Script/Engine.KismetMathLibrary' }, 2320, 760);
  const addVec = await addNode('CallFunction', { functionName: 'Add_VectorVector',      targetClass: '/Script/Engine.KismetMathLibrary' }, 2540, 760);
  const sel    = await addNode('CallFunction', { functionName: 'SelectVector',           targetClass: '/Script/Engine.KismetMathLibrary' }, 2760, 760);
  console.log('2/3 nodes added:', { sub, mul, addVec, sel });

  await setPin(mul, 'B', '0.6666667');

  await connectAny(TRACE_END,   ['ReturnValue'],            sub,         ['A']);
  await connectAny(TRACE_START, ['OutputPin'],              sub,         ['B']);
  await connectAny(sub,         ['ReturnValue'],            mul,         ['A']);
  await connectAny(TRACE_START, ['OutputPin'],              addVec,      ['A']);
  await connectAny(mul,         ['ReturnValue'],            addVec,      ['B']);
  await connectAny(LINE_TRACE,  ['ReturnValue'],            sel,         ['PickA', 'bPickA']);
  await connectAny(BREAK_HIT,   ['Location','ImpactPoint'], sel,         ['A']);
  await connectAny(addVec,      ['ReturnValue'],            sel,         ['B']);
  await connectAny(sel,         ['ReturnValue'],            SET_FARTHEST,['Shadow farthest location']);
  // Always run SetFarthest (for both hit and miss).
  await connect(LINE_TRACE, 'then', SET_FARTHEST, 'execute');
  console.log('2/3 fallback wired');

  // 4. Root rotation: FindLookAtRotation(RootLoc, ShadowFarthestLoc) -> SetWorldRotation(Root)
  const getFarthest = await addNode('GetVar',       { variableName: 'Shadow farthest location' },                                          3000, 900);
  const lookAt      = await addNode('CallFunction', { functionName: 'FindLookAtRotation', targetClass: '/Script/Engine.KismetMathLibrary' }, 3200, 860);
  const setRootRot  = await addNode('CallFunction', { functionName: 'K2_SetWorldRotation', targetClass: '/Script/Engine.SceneComponent' },   3480, 860);
  console.log('Rotation nodes added:', { getFarthest, lookAt, setRootRot });

  await connectAny(GET_ROOT_LOC,  ['ReturnValue'],                 lookAt,     ['Start']);
  await connectAny(GET_ROOT,      ['ShaodwColliderRoot'],          GET_ROOT_LOC,['self','Target']);
  await connectAny(getFarthest,   ['Shadow farthest location'],    lookAt,     ['Target']);
  await connectAny(lookAt,        ['ReturnValue'],                 setRootRot, ['NewRotation','DesiredRotation','InRotation']);
  await connectAny(GET_ROOT,      ['ShaodwColliderRoot'],          setRootRot, ['self','Target']);
  await connect(SET_DIST, 'then', setRootRot, 'execute');
  console.log('Rotation wired');

  // 5. Half-distance for extent and position (Y axis = long axis due to box Yaw -90).
  const halfDiv    = await addNode('CallFunction', { functionName: 'Divide_FloatFloat',   targetClass: '/Script/Engine.KismetMathLibrary' }, 3480, 1060);
  const makeExtent = await addNode('CallFunction', { functionName: 'MakeVector',           targetClass: '/Script/Engine.KismetMathLibrary' }, 3720, 1060);
  const makeLoc    = await addNode('CallFunction', { functionName: 'MakeVector',           targetClass: '/Script/Engine.KismetMathLibrary' }, 3720, 1200);
  const setRelLoc  = await addNode('CallFunction', { functionName: 'K2_SetRelativeLocation', targetClass: '/Script/Engine.SceneComponent' }, 3960, 1200);
  const setExtent  = await addNode('CallFunction', { functionName: 'SetBoxExtent',          targetClass: '/Script/Engine.BoxComponent' },    3960, 1060);
  console.log('Half-dist nodes added:', { halfDiv, makeExtent, makeLoc, setRelLoc, setExtent });

  await setPin(halfDiv,    'B', '2.0');
  await setPin(makeExtent, 'X', '25.0');
  await setPin(makeExtent, 'Z', '25.0');
  await setPin(makeLoc,    'X', '0.0');
  await setPin(makeLoc,    'Z', '0.0');

  await connectAny(DIST_VALUE, ['ReturnValue'],       halfDiv,    ['A','Dividend']);
  await connectAny(halfDiv,    ['ReturnValue'],        makeExtent, ['Y']);
  await connectAny(halfDiv,    ['ReturnValue'],        makeLoc,    ['Y']);
  await connectAny(makeExtent, ['ReturnValue'],        setExtent,  ['InBoxExtent','NewExtent']);
  await connectAny(GET_COLLIDER,['ShadowCollider'],   setExtent,  ['self','Target']);
  await connectAny(makeLoc,    ['ReturnValue'],        setRelLoc,  ['NewLocation','Location','RelativeLocation']);
  await connectAny(GET_COLLIDER,['ShadowCollider'],   setRelLoc,  ['self','Target']);

  // Execution chain: SetDist -> SetRootRot -> SetExtent -> SetRelLoc
  await connect(setRootRot, 'then', setExtent,  'execute');
  await connect(setExtent,  'then', setRelLoc,  'execute');
  console.log('Half-dist wired');

  // 6. Compile & validate.
  await bpCall({ action: 'compile', path: BP, assetPath: BP });
  const v = await bpCall({ action: 'validate', path: BP, assetPath: BP });
  console.log(JSON.stringify(v, null, 2));
  process.exit(0);
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
