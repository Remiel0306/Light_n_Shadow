/**
 * Scan BP_EnemyAIController + enemy for chase/wander conflict.
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

function rpc(method, params, timeoutMs = 120000) {
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
    return { success: false, raw: res };
  }
}

async function bp(args) {
  return parse(await rpc('tools/call', { name: 'blueprint', arguments: args }));
}

function summarizeGraph(g) {
  const nodes = (g.nodes || []).map((n) => ({
    id: n.id,
    title: n.title,
    class: n.class,
    x: n.posX ?? n.x,
    y: n.posY ?? n.y,
    pins: (n.pins || []).map((p) => ({
      name: p.name,
      direction: p.direction,
      connected: !!(p.linkedTo && p.linkedTo.length),
      links: (p.linkedTo || []).map((l) => `${l.nodeId || l.node}:${l.pinName || l.pin}`),
    })),
  }));
  return { nodeCount: nodes.length, nodes };
}

(async () => {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'scan_aic_chase' },
  });

  const out = {};

  out.aicVars = await bp({ action: 'list_variables', path: AIC, assetPath: AIC });
  out.aicFuncs = await bp({ action: 'list_functions', path: AIC, assetPath: AIC });
  out.aicComponents = await bp({ action: 'list_components', path: AIC, assetPath: AIC });

  const eg = await bp({ action: 'read_graph', path: AIC, assetPath: AIC, graphName: 'EventGraph' });
  out.eventGraph = summarizeGraph(eg);

  // Also try common custom event / function names
  for (const name of ['Wander', 'StartPatrol', 'Check Sight', 'CheckSight', 'Chase', 'StartChase']) {
    try {
      const g = await bp({ action: 'read_graph', path: AIC, assetPath: AIC, graphName: name });
      if (g.nodes) out[`graph_${name}`] = summarizeGraph(g);
    } catch (_) {}
  }

  out.enemyDefaults = await bp({
    action: 'get_class_defaults',
    path: ENEMY,
    assetPath: ENEMY,
  });
  out.enemyComponents = await bp({ action: 'list_components', path: ENEMY, assetPath: ENEMY });
  const enemyEg = await bp({ action: 'read_graph', path: ENEMY, assetPath: ENEMY, graphName: 'EventGraph' });
  // Only keep AI/overlap related titles to keep file small
  const interesting = (enemyEg.nodes || []).filter((n) =>
    /Overlap|Print|Chase|Wander|Move|Perception|Dead|Kill|BeginPlay|Timer/i.test(n.title || '')
  );
  out.enemyInterestingNodes = interesting.map((n) => ({ id: n.id, title: n.title, class: n.class }));

  fs.writeFileSync('scan_aic_chase_issue.out.json', JSON.stringify(out, null, 2));
  console.log('wrote scan_aic_chase_issue.out.json');
  console.log('AIC nodes:', out.eventGraph.nodeCount);
  console.log(
    'titles:',
    out.eventGraph.nodes.map((n) => n.title).join(' | ')
  );
  mcp.kill();
})().catch((e) => {
  console.error(e);
  mcp.kill();
  process.exit(1);
});
