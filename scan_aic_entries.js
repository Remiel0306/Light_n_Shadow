/**
 * Get exec flows for Wander / Check Sight / Perception entry points.
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

function compactFlow(flow) {
  return {
    entry: flow.entryPoint,
    steps: (flow.steps || []).map((s) => ({
      title: s.title,
      id: s.id,
      branches: (s.branches || []).map((b) => `${b.pin}->${b.toId}`),
    })),
  };
}

(async () => {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'scan_aic_entries' },
  });

  const summary = await bp({ action: 'read_graph_summary', path: AIC, assetPath: AIC, graphName: 'EventGraph' });
  const byTitle = {};
  for (const n of summary.nodes || []) {
    byTitle[n.title] = byTitle[n.title] || [];
    byTitle[n.title].push(n.id);
  }

  const out = { byTitle };
  for (const title of ['Wander', 'Check Sight', 'On Target Perception Updated (AIPerception)']) {
    const ids = byTitle[title] || [];
    out[title] = [];
    for (const entryId of ids) {
      const flow = await bp({
        action: 'get_execution_flow',
        path: AIC,
        assetPath: AIC,
        graphName: 'EventGraph',
        entryId,
      });
      out[title].push(compactFlow(flow));
    }
  }

  // Timer properties
  const timerId = (byTitle['Set Timer by Event'] || [])[0];
  if (timerId) {
    out.timer = {};
    for (const prop of ['Time', 'bLooping']) {
      out.timer[prop] = await bp({
        action: 'read_node_property',
        path: AIC,
        assetPath: AIC,
        graphName: 'EventGraph',
        nodeName: timerId,
        propertyName: prop,
      });
    }
  }

  // Who binds to Set Timer Event pin - read full graph node for timer
  const g = await bp({ action: 'read_graph', path: AIC, assetPath: AIC, graphName: 'EventGraph' });
  const timerNode = (g.nodes || []).find((n) => n.id === timerId || /Set Timer by Event/i.test(n.title || ''));
  out.timerNodePins = timerNode?.pins;
  out.wanderCustom = (g.nodes || []).find((n) => n.class === 'K2Node_CustomEvent' && /Wander/i.test(n.title || ''));
  out.checkSightCustom = (g.nodes || []).find((n) => n.class === 'K2Node_CustomEvent' && /Check Sight/i.test(n.title || ''));
  out.perception = (g.nodes || []).find((n) => /On Target Perception Updated/i.test(n.title || ''));

  // Enemy: look for overlap
  const eg = await bp({ action: 'read_graph', path: ENEMY, assetPath: ENEMY, graphName: 'EventGraph' });
  out.enemyOverlap = (eg.nodes || [])
    .filter((n) => /Overlap|BeginPlay|Print|Capsule/i.test(n.title || ''))
    .map((n) => ({ id: n.id, title: n.title, class: n.class }));

  fs.writeFileSync('scan_aic_entries.out.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out.Wander, null, 2));
  console.log('--- Check Sight ---');
  console.log(JSON.stringify(out['Check Sight'], null, 2));
  console.log('--- Perception ---');
  console.log(JSON.stringify(out['On Target Perception Updated (AIPerception)'], null, 2));
  console.log('timer', JSON.stringify(out.timer));
  mcp.kill();
})().catch((e) => {
  console.error(e);
  mcp.kill();
  process.exit(1);
});
