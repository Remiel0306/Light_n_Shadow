const { spawn } = require('child_process');

const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const BP = '/Game/BluePrint/BP_EnemyShadowLogic';

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
  throw last || new Error(`connectAny failed ${sourceNode} -> ${targetNode}`);
}

async function main() {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'apply-miss-full-length-only', version: '1.0' },
  });

  // Existing nodes from the working hit-only graph.
  const traceEnd = 'FC97YEOfVoT20meNoOpNmg';
  const lineTrace = 'sfFoNk8icJGtHU2-pIUNTg';
  const breakHit = 'LuDvzUdFYf3j_2uQTvAILg';
  const setFarthest = 'P3q7jEvbSOY87PWPXUMm5A';

  // Hit: use ground hit location. Miss: use trace End, so the collider uses the full ray length.
  const select = await addNode(
    'CallFunction',
    { functionName: 'SelectVector', targetClass: '/Script/Engine.KismetMathLibrary' },
    2760,
    760
  );

  await connectAny(lineTrace, ['ReturnValue'], select, ['PickA', 'bPickA']);
  await connectAny(breakHit, ['Location', 'ImpactPoint'], select, ['A']);
  await connectAny(traceEnd, ['ReturnValue'], select, ['B']);
  await connectAny(select, ['ReturnValue'], setFarthest, ['Shadow farthest location']);

  // Set Shadow farthest location must run for both hit and miss.
  await connectAny(lineTrace, ['then'], setFarthest, ['execute']);

  await bp({ action: 'compile', path: BP, assetPath: BP });
  const validation = await bp({ action: 'validate', path: BP, assetPath: BP });
  console.log(JSON.stringify(validation, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
