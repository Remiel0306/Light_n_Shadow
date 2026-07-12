/**
 * Inspect critical pin defaults: isChasing sets, Delay, AcceptanceRadius, wander gate.
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
    clientInfo: { name: 'scan_aic_pins' },
  });

  const g = await bp({ action: 'read_graph', path: AIC, assetPath: AIC, graphName: 'EventGraph' });
  const nodes = g.nodes || [];
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

  // From summary we know short ids - map via title+position matching from summary
  const summary = await bp({ action: 'read_graph_summary', path: AIC, assetPath: AIC, graphName: 'EventGraph' });
  // Build map shortId -> longId by matching? Actually summary ids ARE the graph ids used in edges.
  // But read_graph uses different ids? Let's check.

  const out = {
    readGraphIdSample: nodes.slice(0, 3).map((n) => ({ id: n.id, title: n.title })),
    summaryIdSample: (summary.nodes || []).slice(0, 3),
  };

  // Find all Set isChasing and read default value on isChasing pin
  const setChase = nodes.filter((n) => /Set isChasing/i.test(n.title || ''));
  out.setIsChasing = setChase.map((n) => ({
    id: n.id,
    pos: [n.posX, n.posY],
    pins: n.pins,
  }));

  const delays = nodes.filter((n) => /^Delay$/i.test((n.title || '').split('\n')[0]));
  out.delays = delays.map((n) => ({
    id: n.id,
    pos: [n.posX, n.posY],
    durationPin: (n.pins || []).find((p) => /Duration|InDuration/i.test(p.name)),
  }));

  const moveTos = nodes.filter((n) => /AI MoveTo/i.test(n.title || ''));
  out.moveTos = moveTos.map((n) => ({
    id: n.id,
    pos: [n.posX, n.posY],
    pins: (n.pins || []).filter((p) =>
      /Acceptance|Pawn|Destination|Target|execute|OnSuccess|OnFail|bStopOnOverlap/i.test(p.name)
    ),
  }));

  // Get isChasing used where?
  const getChase = nodes.filter((n) => /Get isChasing/i.test(n.title || ''));
  out.getIsChasing = getChase.map((n) => ({ id: n.id, pos: [n.posX, n.posY], pins: n.pins }));

  // Branches after wander - condition source
  const edges = summary.execEdges || (await bp({ action: 'read_graph_summary', path: AIC, assetPath: AIC, graphName: 'EventGraph' }));
  // re-read full summary with edges - already have in previous file. Use get from flow file via reading pins on wander branch.

  // Enemy capsule overlap
  const eg = await bp({ action: 'read_graph', path: ENEMY, assetPath: ENEMY, graphName: 'EventGraph' });
  out.enemyAllTitles = (eg.nodes || []).map((n) => (n.title || '').replace(/\n/g, ' | '));

  // Also try author/cleanup capabilities - list overridable on enemy for ActorBeginOverlap
  out.enemyOverridable = await bp({
    action: 'list_overridable_functions',
    path: ENEMY,
    assetPath: ENEMY,
  });

  fs.writeFileSync('scan_aic_pins.out.json', JSON.stringify(out, null, 2));
  console.log('setIsChasing count', out.setIsChasing.length);
  for (const s of out.setIsChasing) {
    const pin = (s.pins || []).find((p) => p.name === 'isChasing');
    console.log('Set isChasing', s.id.slice(0, 8), 'default=', pin?.defaultValue, 'connected=', pin?.connected);
  }
  for (const d of out.delays) {
    console.log('Delay', d.id.slice(0, 8), d.durationPin);
  }
  for (const m of out.moveTos) {
    console.log(
      'MoveTo',
      m.id.slice(0, 8),
      m.pins.map((p) => `${p.name}=${p.defaultValue}|c=${p.connected}`).join('; ')
    );
  }
  console.log('getIsChasing', out.getIsChasing.length);
  mcp.kill();
})().catch((e) => {
  console.error(e);
  mcp.kill();
  process.exit(1);
});
