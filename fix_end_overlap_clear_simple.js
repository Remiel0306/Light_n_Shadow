const { spawn } = require('child_process');

const BP = '/Game/BluePrint/BP_EnemyShadowLogic';
const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';

const BAD_NODE_IDS = ['CDqHsk3GqT0Q9XiHbyhL1g', 'J0B2mk-dKKXMAHG500QyDQ', 'WCGle0eDqQdLluuBqCwguw'];

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

async function main() {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fix-end-clear', version: '1.0' } });
  const g = await bp({ action: 'read_graph', path: BP, assetPath: BP, graphName: 'EventGraph' });
  const endOverlap = g.nodes.find((n) => (n.title || '').includes('On Component End Overlap (CapsuleComponent)'));
  if (!endOverlap) throw new Error('EndOverlap not found');

  for (const nid of BAD_NODE_IDS) {
    try {
      await bp({ action: 'delete_node', path: BP, assetPath: BP, graphName: 'EventGraph', nodeName: nid });
    } catch (_) {}
  }

  const setActive = await bp({
    action: 'add_node',
    path: BP,
    assetPath: BP,
    graphName: 'EventGraph',
    nodeClass: 'SetVar',
    nodeParams: { variableName: 'Active Ball' },
    posX: endOverlap.posX + 260,
    posY: endOverlap.posY + 120,
  });

  await bp({
    action: 'connect_pins',
    path: BP,
    assetPath: BP,
    graphName: 'EventGraph',
    sourceNode: endOverlap.id,
    sourcePin: 'then',
    targetNode: setActive.nodeId,
    targetPin: 'execute',
  });

  // leave Active Ball input unconnected => set None/Null
  await bp({ action: 'compile', path: BP, assetPath: BP });
  const v = await bp({ action: 'validate', path: BP, assetPath: BP });
  console.log('FIX_END_CLEAR_DONE', JSON.stringify({ valid: v.valid, errorCount: v.errorCount, warningCount: v.warningCount }));
  process.exit(0);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

