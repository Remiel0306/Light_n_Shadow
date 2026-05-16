/**
 * BP_EnemyShadowLogic: When line trace misses floor, use 2/3 along the ray for
 * Shadow farthest location (instead of full trace End).
 * Hit case unchanged (SelectVector A = hit location).
 */
const { spawn } = require('child_process');

const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const BP = '/Game/BluePrint/BP_EnemyShadowLogic';

const TRACE_START = '51XraES3z5-GkpOubQXjWQ';
const TRACE_END_VEC = 'FC97YEOfVoT20meNoOpNmg';
const SELECT = 'ZRZmyUy5eL_V7FGlI5OeRA';

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
        return true;
      } catch (e) {
        last = e;
      }
    }
  }
  throw last || new Error('connectAny failed');
}

async function main() {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'miss-twothirds', version: '1.0' },
  });

  // missPoint = Start + (End - Start) * (2/3)
  const sub = await addNode(
    'CallFunction',
    { functionName: 'Subtract_VectorVector', targetClass: '/Script/Engine.KismetMathLibrary' },
    2480,
    620
  );
  const mul = await addNode(
    'CallFunction',
    { functionName: 'Multiply_VectorFloat', targetClass: '/Script/Engine.KismetMathLibrary' },
    2700,
    620
  );
  const add = await addNode(
    'CallFunction',
    { functionName: 'Add_VectorVector', targetClass: '/Script/Engine.KismetMathLibrary' },
    2920,
    620
  );

  await setPin(mul, 'B', '0.6666667');

  await connectAny(TRACE_END_VEC, ['ReturnValue'], sub, ['A']);
  await connectAny(TRACE_START, ['OutputPin'], sub, ['B']);
  await connectAny(sub, ['ReturnValue'], mul, ['A']);
  await connectAny(TRACE_START, ['OutputPin'], add, ['A']);
  await connectAny(mul, ['ReturnValue'], add, ['B']);
  await connectAny(add, ['ReturnValue'], SELECT, ['B']);

  console.log('Nodes:', { sub, mul, add });

  await bp({ action: 'compile', path: BP, assetPath: BP });
  const v = await bp({ action: 'validate', path: BP, assetPath: BP });
  console.log(JSON.stringify(v, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
