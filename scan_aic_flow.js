/**
 * Deep scan AIC exec flow for chase bug.
 */
const fs = require('fs');
const { spawn } = require('child_process');

const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const AIC = '/Game/BluePrint/System/BP_EnemyAIController';
const ENEMY = '/Game/BluePrint/Enemy/BP_EnemyShadowLogic';

const mcp = spawn('npx.cmd', ['ue-mcp', PROJECT], { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
let id = 1;
const pending = new Map();
let buf = '';

function rpc(method, params, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const i = id++;
    const t = setTimeout(() => {
      pending.delete(i);
      reject(new Error(`timeout ${method}`));
    }, timeoutMs);
    pending.set(i, (msg) => {
      clearTimeout(t);
      resolve(msg);
    });
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n');
  });
}

mcp.stdout.on('data', (d) => {
  buf += d.toString();
  const lines = buf.split('\n');
  buf = lines.pop();
  for (const line of lines) {
    try {
      const msg = JSON.parse(line);
      const cb = pending.get(msg.id);
      if (cb) cb(msg);
    } catch (_) {}
  }
});

function parse(res) {
  try {
    return JSON.parse(res?.result?.content?.[0]?.text);
  } catch {
    return res;
  }
}

async function bp(args) {
  return parse(await rpc('tools/call', { name: 'blueprint', arguments: args }));
}

(async () => {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'scan_aic_flow' },
  });

  const out = {};
  out.flow = await bp({ action: 'get_execution_flow', path: AIC, assetPath: AIC, graphName: 'EventGraph' });
  out.summary = await bp({ action: 'read_graph_summary', path: AIC, assetPath: AIC, graphName: 'EventGraph' });

  // Raw node dump with all pin fields for key nodes
  const g = await bp({ action: 'read_graph', path: AIC, assetPath: AIC, graphName: 'EventGraph' });
  const key = (g.nodes || []).filter((n) =>
    /BeginPlay|Wander|Check Sight|Timer|Perception|AI MoveTo|isChasing|Set Active|Branch|Delay|Print/i.test(
      n.title || ''
    )
  );
  out.keyNodes = key.map((n) => ({
    id: n.id,
    title: (n.title || '').replace(/\n/g, ' | '),
    pins: n.pins,
  }));

  // Timer Time property
  const timer = (g.nodes || []).find((n) => /Set Timer by Event/i.test(n.title || ''));
  if (timer) {
    out.timerProps = {};
    for (const prop of ['Time', 'bLooping', 'bMaxOncePerFrame']) {
      out.timerProps[prop] = await bp({
        action: 'read_node_property',
        path: AIC,
        assetPath: AIC,
        graphName: 'EventGraph',
        nodeName: timer.id,
        propertyName: prop,
      });
    }
  }

  // Enemy overlap / begin play related
  const eg = await bp({ action: 'read_graph', path: ENEMY, assetPath: ENEMY, graphName: 'EventGraph' });
  out.enemyNodeTitles = (eg.nodes || []).map((n) => (n.title || '').replace(/\n/g, ' | '));

  fs.writeFileSync('scan_aic_flow.out.json', JSON.stringify(out, null, 2));
  console.log('wrote scan_aic_flow.out.json');
  console.log('flow keys', Object.keys(out.flow || {}));
  if (out.summary) console.log('summary sample', JSON.stringify(out.summary).slice(0, 500));
  mcp.kill();
})().catch((e) => {
  console.error(e);
  mcp.kill();
  process.exit(1);
});
