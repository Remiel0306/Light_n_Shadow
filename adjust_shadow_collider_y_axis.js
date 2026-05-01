/**
 * BP_Enemy1: Shadow lengthens on local Y; wire (distance/2) into:
 * - Make Vector for Set Box Extent Y (already wired)
 * - Make Vector for Set Relative Location Y (was missing — offset followed wrong axis / none)
 * Set rel-loc X,Z to 0; keep extent cross-section X,Z literals on extent Make Vector.
 */
const { spawn } = require('child_process');

const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const BP = '/Game/BluePrint/BP_Enemy1';

const HALF_DIST = 'ddIBTUrp1cVr6xi_Lw5N_w';
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

async function bp(args) {
  const res = await rpc('tools/call', { name: 'blueprint', arguments: args });
  const body = parse(res);
  if (!body.success) throw new Error(body.error || JSON.stringify(body));
  return body;
}

async function setPin(nodeName, prop, val) {
  try {
    await bp({
      action: 'set_node_property',
      path: BP,
      assetPath: BP,
      graphName: 'EventGraph',
      nodeName,
      propertyName: prop,
      value: val,
    });
  } catch (_) {
    await bp({
      action: 'set_node_property',
      path: BP,
      assetPath: BP,
      graphName: 'EventGraph',
      nodeName,
      pinName: prop,
      defaultValue: val,
    });
  }
}

async function connectAny(sn, sps, tn, tps) {
  let last;
  for (const sp of sps) {
    for (const tp of tps) {
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
        return { sp, tp };
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
    clientInfo: { name: 'shadow-y-axis', version: '1.0' },
  });

  await connectAny(HALF_DIST, ['ReturnValue'], MAKE_LOC, ['Y']);
  await setPin(MAKE_LOC, 'X', '0.0');
  await setPin(MAKE_LOC, 'Z', '0.0');

  // Cross-section half-extents (edit in BP if your Origin colision size X/Z differ)
  await setPin(MAKE_EXTENT, 'X', '25.0');
  await setPin(MAKE_EXTENT, 'Z', '25.0');

  console.log('Half distance -> MakeVector Y -> Set Relative Location; extent X/Z literals set');

  await bp({ action: 'compile', path: BP, assetPath: BP });
  console.log(JSON.stringify(await bp({ action: 'validate', path: BP, assetPath: BP }), null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
