/**
 * BP_Enemy1: Make shadow collider root rotation parallel to the trace ray.
 * FindLookAtRotation was using (RootWorldLocation -> Farthest) which diverges
 * from the actual ray (TraceStart -> Farthest). Rewire Start to Trace Start.
 */
const { spawn } = require('child_process');

const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const BP = '/Game/BluePrint/BP_Enemy1';

const TRACE_START_REROUTE = '51XraES3z5-GkpOubQXjWQ';
const FIND_LOOK_AT = '-si6kUZiZMFtrOqJSL44mA';

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
        return { sourcePin, targetPin };
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
    clientInfo: { name: 'align-collider-ray', version: '1.0' },
  });

  const used = await connectAny(
    TRACE_START_REROUTE,
    ['OutputPin', 'ReturnValue'],
    FIND_LOOK_AT,
    ['Start', 'InStart']
  );
  console.log('Rewired FindLookAt Start from root to trace start:', used);

  await bp({ action: 'compile', path: BP, assetPath: BP });
  const v = await bp({ action: 'validate', path: BP, assetPath: BP });
  console.log(JSON.stringify(v, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
