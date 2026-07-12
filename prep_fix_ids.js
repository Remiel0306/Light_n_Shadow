/**
 * Get enemy capsule overlap edges + AIC long-id map for fix.
 */
const fs = require('fs');
const { spawn } = require('child_process');

const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const ENEMY = '/Game/BluePrint/Enemy/BP_EnemyShadowLogic';
const AIC = '/Game/BluePrint/System/BP_EnemyAIController';

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
    clientInfo: { name: 'prep_fix_ids' },
  });

  const enemySum = await bp({
    action: 'read_graph_summary',
    path: ENEMY,
    assetPath: ENEMY,
    graphName: 'EventGraph',
  });
  const capsule = (enemySum.nodes || []).find((n) =>
    /On Component Begin Overlap \(CapsuleComponent\)/i.test(n.title || '')
  );
  const edgesFromCapsule = (enemySum.execEdges || []).filter(
    (e) => e.from === capsule?.id || e.to === capsule?.id
  );
  // Also any edge involving nodes near capsule - dump all edges that mention Print or Cast to player
  const nodeTitle = Object.fromEntries((enemySum.nodes || []).map((n) => [n.id, n.title]));
  const interesting = (enemySum.execEdges || []).filter((e) => {
    const a = nodeTitle[e.from] || '';
    const b = nodeTitle[e.to] || '';
    return /Capsule|Player|Print|Dead|Character|Overlap/i.test(a + b);
  });

  const aicG = await bp({ action: 'read_graph', path: AIC, assetPath: AIC, graphName: 'EventGraph' });
  const aicSum = await bp({
    action: 'read_graph_summary',
    path: AIC,
    assetPath: AIC,
    graphName: 'EventGraph',
  });

  // Map short->long by title order
  const longs = {};
  for (const n of aicG.nodes || []) {
    const t = (n.title || '').split('\n')[0].trim();
    (longs[t] = longs[t] || []).push({ id: n.id, x: n.posX, y: n.posY });
  }
  const shorts = {};
  for (const n of aicSum.nodes || []) {
    (shorts[n.title] = shorts[n.title] || []).push(n.id);
  }
  const map = {};
  const ambiguous = {};
  for (const t of Object.keys(shorts)) {
    if ((longs[t] || []).length === shorts[t].length) {
      shorts[t].forEach((s, i) => {
        map[s] = longs[t][i];
      });
    } else {
      ambiguous[t] = { short: shorts[t], long: longs[t] };
    }
  }

  // Critical nodes by position/value
  const critical = {
    wanderEvent: longs['Wander']?.find((n) => n.y < 500),
    wanderCalls: longs['Wander'],
    setChase: (aicG.nodes || [])
      .filter((n) => /Set isChasing/i.test(n.title || ''))
      .map((n) => ({
        id: n.id,
        x: n.posX,
        y: n.posY,
        val: (n.pins || []).find((p) => p.name === 'isChasing')?.defaultValue,
      })),
    delays: (aicG.nodes || [])
      .filter((n) => (n.title || '').startsWith('Delay'))
      .map((n) => ({
        id: n.id,
        x: n.posX,
        y: n.posY,
        dur: (n.pins || []).find((p) => p.name === 'Duration')?.defaultValue,
      })),
    moveTos: (aicG.nodes || [])
      .filter((n) => /AI MoveTo/i.test(n.title || ''))
      .map((n) => ({
        id: n.id,
        x: n.posX,
        y: n.posY,
        hasDest: (n.pins || []).find((p) => p.name === 'Destination')?.connected,
        hasTarget: (n.pins || []).find((p) => p.name === 'TargetActor')?.connected,
        onSuccess: (n.pins || []).find((p) => p.name === 'OnSuccess')?.connected,
        onFail: (n.pins || []).find((p) => p.name === 'OnFail')?.connected,
      })),
    firstWanderBranch: null,
  };

  // Resolve short edge endpoints to long
  const resolveEdges = (aicSum.execEdges || []).map((e) => ({
    ...e,
    fromLong: map[e.from]?.id,
    toLong: map[e.to]?.id,
    fromTitle: nodeTitle[e.from] || aicSum.nodes.find((n) => n.id === e.from)?.title,
    toTitle: aicSum.nodes.find((n) => n.id === e.to)?.title,
  }));

  const out = {
    capsule,
    edgesFromCapsule,
    interestingEnemyEdges: interesting.map((e) => ({
      ...e,
      fromTitle: nodeTitle[e.from],
      toTitle: nodeTitle[e.to],
    })),
    critical,
    resolveEdges: resolveEdges.filter((e) =>
      /Wander|MoveTo|isChasing|Perception|Delay|Branch|Check Sight/i.test(
        `${e.fromTitle} ${e.toTitle}`
      )
    ),
    ambiguous,
  };

  fs.writeFileSync('prep_fix_ids.out.json', JSON.stringify(out, null, 2));
  console.log('capsule edges', edgesFromCapsule.length, edgesFromCapsule);
  console.log('interesting', out.interestingEnemyEdges.slice(0, 20));
  console.log('moveTos', critical.moveTos);
  console.log('delays', critical.delays);
  console.log('setChase', critical.setChase);
  mcp.kill();
})().catch((e) => {
  console.error(e);
  mcp.kill();
  process.exit(1);
});
