/** Insert K2_SetWorldRotation(0,0,0) on ShaodwColliderRoot between AZFN1 and sf73. */
const { spawn } = require('child_process');
const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const BP = '/Game/BluePrint/BP_Enemy1';
const AZFN1 = 'AZFN1EnJQhkffi249IreUw';
const SF73 = 'sf73WUuf06e6TS2Xuc51tg';
const GET_ROOT = '_ppbJE67Vh-wNnexoqzseg';

const mcp = spawn('npx.cmd', ['ue-mcp', PROJECT], { shell: true });
let reqId = 1;
const pending = new Map();
function rpc(m, p) {
  return new Promise((r) => {
    const id = reqId++;
    pending.set(id, r);
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: m, params: p }) + '\n');
  });
}
function parse(msg) {
  try {
    return JSON.parse(msg?.result?.content?.[0]?.text);
  } catch {
    return {};
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
async function bp(a) {
  const res = await rpc('tools/call', { name: 'blueprint', arguments: a });
  const b = parse(res);
  if (!b.success) throw new Error(b.error || JSON.stringify(b));
  return b;
}
async function connectAny(sn, sps, tn, tps) {
  let last;
  for (const sp of sps) for (const tp of tps) {
    try {
      await bp({
        action: 'connect_pins',
        path: BP,
        assetPath: BP,
        graphName: 'EventGraph',
        sourceNode: sn,
        sourcePin: sp,
        targetNode: tn,
        targetPin: tp,
      });
      return;
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

(async () => {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { n: 'i', v: '1' } });

  const makeZero = await bp({
    action: 'add_node',
    path: BP,
    assetPath: BP,
    graphName: 'EventGraph',
    nodeClass: 'CallFunction',
    nodeParams: { functionName: 'MakeRotator', targetClass: '/Script/Engine.KismetMathLibrary' },
    posX: 2920,
    posY: -420,
  });
  const idMake = makeZero.nodeId;
  for (const [k, v] of [
    ['Roll', '0.0'],
    ['Pitch', '0.0'],
    ['Yaw', '0.0'],
  ]) {
    try {
      await bp({ action: 'set_node_property', path: BP, assetPath: BP, graphName: 'EventGraph', nodeName: idMake, propertyName: k, value: v });
    } catch (_) {
      await bp({ action: 'set_node_property', path: BP, assetPath: BP, graphName: 'EventGraph', nodeName: idMake, pinName: k, defaultValue: v });
    }
  }

  const setWR = await bp({
    action: 'add_node',
    path: BP,
    assetPath: BP,
    graphName: 'EventGraph',
    nodeClass: 'CallFunction',
    nodeParams: { functionName: 'K2_SetWorldRotation', targetClass: '/Script/Engine.SceneComponent' },
    posX: 3080,
    posY: -420,
  });
  const idSet = setWR.nodeId;

  await connectAny(idMake, ['ReturnValue'], idSet, ['NewRotation', 'DesiredRotation', 'InRotation']);
  await connectAny(GET_ROOT, ['ShaodwColliderRoot'], idSet, ['self', 'Target']);

  await connectAny(AZFN1, ['then'], idSet, ['execute']);
  await connectAny(idSet, ['then'], SF73, ['execute']);

  console.log({ idMake, idSet });
  await bp({ action: 'compile', path: BP, assetPath: BP });
  console.log(JSON.stringify(await bp({ action: 'validate', path: BP, assetPath: BP }), null, 2));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
