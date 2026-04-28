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
  throw last || new Error('connectAny failed');
}

async function main() {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fix-end-overlap', version: '1.0' } });
  const g = await bp({ action: 'read_graph', path: BP, assetPath: BP, graphName: 'EventGraph' });
  const endOverlap = g.nodes.find((n) => (n.title || '').includes('On Component End Overlap (CapsuleComponent)'));
  if (!endOverlap) throw new Error('End overlap node not found');

  const cast = await bp({
    action: 'add_node',
    path: BP,
    assetPath: BP,
    graphName: 'EventGraph',
    nodeClass: 'K2Node_DynamicCast',
    nodeParams: { targetClass: '/Game/BluePrint/BP_LightBall.BP_LightBall_C' },
    posX: endOverlap.posX + 220,
    posY: endOverlap.posY + 120,
  });

  const getActive = await bp({
    action: 'add_node',
    path: BP,
    assetPath: BP,
    graphName: 'EventGraph',
    nodeClass: 'GetVar',
    nodeParams: { variableName: 'Active Ball' },
    posX: endOverlap.posX + 420,
    posY: endOverlap.posY + 260,
  });

  const removeItem = await bp({
    action: 'add_node',
    path: BP,
    assetPath: BP,
    graphName: 'EventGraph',
    nodeClass: 'CallFunction',
    nodeParams: { functionName: 'Array_RemoveItem', targetClass: '/Script/Engine.KismetArrayLibrary' },
    posX: endOverlap.posX + 620,
    posY: endOverlap.posY + 140,
  });

  await connectAny(endOverlap.id, ['then'], cast.nodeId, ['execute']);
  await connectAny(endOverlap.id, ['OtherActor'], cast.nodeId, ['Object']);
  await connectAny(cast.nodeId, ['then'], removeItem.nodeId, ['execute']);

  await connectAny(getActive.nodeId, ['Active Ball'], removeItem.nodeId, ['TargetArray', 'Array']);
  await connectAny(cast.nodeId, ['AsBP Light Ball', 'As BP Light Ball'], removeItem.nodeId, ['Item', 'NewItem']);

  await bp({ action: 'compile', path: BP, assetPath: BP });
  console.log('FIX_END_OVERLAP_DONE');
  process.exit(0);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

