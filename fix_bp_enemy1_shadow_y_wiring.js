/**
 * BP_EnemyShadowLogic — shadow length on Y: repair half-distance divide + extent/offset MakeVector literals.
 *
 * Live graph had: VectorLength -> Divide A only (B unwired); half -> MakeVector Y -> SetBoxExtent / SetRelLoc (OK).
 * Missing B=2 breaks half-length. Optionally set cross-section on extent MakeVector X,Z and zero X,Z on offset vector.
 *
 * Requires Unreal Editor with project + UE_MCP_Bridge.
 */
const fs = require('fs');
const { spawn } = require('child_process');

const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const BP = '/Game/BluePrint/BP_EnemyShadowLogic';
const GRAPH = 'EventGraph';

const DIVIDE_HALF = 'ddIBTUrp1cVr6xi_Lw5N_w';
const MAKE_EXTENT = 'CWzIa0MoTpQW0LWbfxUt9Q';
const MAKE_LOC = 'KbKiXUuAPIDGYBmgT7G76g';

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

function parseText(res) {
  const txt = res?.result?.content?.[0]?.text;
  try {
    return JSON.parse(txt);
  } catch {
    return { success: false, error: txt || 'parse failed' };
  }
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
  const payload = parseText(res);
  if (!payload.success) throw new Error(payload.error || JSON.stringify(payload));
  return payload;
}

async function setPin(nodeId, pinName, defaultValue) {
  try {
    await bp({
      action: 'set_node_property',
      path: BP,
      assetPath: BP,
      graphName: GRAPH,
      nodeName: nodeId,
      propertyName: pinName,
      value: defaultValue,
    });
  } catch (_) {
    await bp({
      action: 'set_node_property',
      path: BP,
      assetPath: BP,
      graphName: GRAPH,
      nodeName: nodeId,
      pinName,
      defaultValue,
    });
  }
}

async function main() {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'fix-shadow-y', version: '1.0' },
  });

  const sum = await bp({
    action: 'read_graph_summary',
    path: BP,
    assetPath: BP,
    graphName: GRAPH,
  });
  fs.writeFileSync(`${__dirname}/_bp_enemy1_summary_live.json`, JSON.stringify(sum, null, 2), 'utf8');

  const divide = sum.nodes.find((n) => n.id === DIVIDE_HALF);
  if (!divide) throw new Error(`Divide node ${DIVIDE_HALF} not found — open BP_EnemyShadowLogic and re-export summary.`);

  // Half of trace distance for box half-extent along Y and collider center offset along Y
  await setPin(DIVIDE_HALF, 'B', '2.0');

  // Cross-section half-extents (local X,Z); tune in BP if needed
  await setPin(MAKE_EXTENT, 'X', '25.0');
  await setPin(MAKE_EXTENT, 'Z', '25.0');

  // Relative location: only move along elongated Y from root
  await setPin(MAKE_LOC, 'X', '0.0');
  await setPin(MAKE_LOC, 'Z', '0.0');

  await bp({ action: 'compile', path: BP, assetPath: BP });
  const v = await bp({ action: 'validate', path: BP, assetPath: BP });
  console.log(JSON.stringify(v, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
