/**
 * Inspect enemy Capsule Begin Overlap flow before adding death print.
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
    clientInfo: { name: 'scan_enemy_overlap' },
  });

  const summary = await bp({
    action: 'read_graph_summary',
    path: ENEMY,
    assetPath: ENEMY,
    graphName: 'EventGraph',
  });

  const capsule = (summary.nodes || []).find((n) =>
    /On Component Begin Overlap \(CapsuleComponent\)/i.test(n.title || '')
  );

  let flow = null;
  if (capsule) {
    flow = await bp({
      action: 'get_execution_flow',
      path: ENEMY,
      assetPath: ENEMY,
      graphName: 'EventGraph',
      entryId: capsule.id,
    });
  }

  // Map AIC nodes: match summary short ids to read_graph by walking execEdges titles
  const aicSum = await bp({
    action: 'read_graph_summary',
    path: AIC,
    assetPath: AIC,
    graphName: 'EventGraph',
  });
  const aicGraph = await bp({
    action: 'read_graph',
    path: AIC,
    assetPath: AIC,
    graphName: 'EventGraph',
  });

  // Build title+pos index for long ids
  function key(n) {
    return `${(n.title || '').split('\n')[0]}@${Math.round(n.posX || n.x || 0)},${Math.round(n.posY || n.y || 0)}`;
  }
  // summary may not have positions - match by sequential title occurrence
  const longByTitle = {};
  for (const n of aicGraph.nodes || []) {
    const t = (n.title || '').split('\n')[0];
    (longByTitle[t] = longByTitle[t] || []).push(n);
  }
  const shortByTitle = {};
  for (const n of aicSum.nodes || []) {
    (shortByTitle[n.title] = shortByTitle[n.title] || []).push(n.id);
  }

  const map = {};
  for (const t of Object.keys(shortByTitle)) {
    const shorts = shortByTitle[t];
    const longs = longByTitle[t] || [];
    if (shorts.length === longs.length) {
      for (let i = 0; i < shorts.length; i++) map[shorts[i]] = longs[i].id;
    } else {
      map[`AMBIG:${t}`] = { shorts, longCount: longs.length, longIds: longs.map((x) => x.id) };
    }
  }

  const out = {
    capsuleId: capsule?.id,
    capsuleFlow: flow,
    relevantEdges: (aicSum.execEdges || []).filter((e) =>
      [
        'Z8VzH0HLkN-te0-GEqgJXg',
        't3nP3Uu0sKGE4ryl1Aa3PA',
        'WR6EH0R7IrPwvaGaJNdayg',
        'JwD1xkYxBtaG_Fuhy-5LDg',
        'LDJlS0NeUFXRLAeHm_nVdA',
        'BBYntEtf8-FeKqqS7Qr8kg',
        'TV6ECU3OA3WiOqmfZ1oIrg',
        'NOFGQUslosrRfMSUCZEIIQ',
        'SBdIA0hcJpCK0nO31kmn4A',
        'uQaq5E-pz4Igb7uZv7n2PQ',
      ].includes(e.from) ||
      [
        'Z8VzH0HLkN-te0-GEqgJXg',
        't3nP3Uu0sKGE4ryl1Aa3PA',
        'WR6EH0R7IrPwvaGaJNdayg',
        'JwD1xkYxBtaG_Fuhy-5LDg',
        'LDJlS0NeUFXRLAeHm_nVdA',
        'BBYntEtf8-FeKqqS7Qr8kg',
        'TV6ECU3OA3WiOqmfZ1oIrg',
        'NOFGQUslosrRfMSUCZEIIQ',
        'SBdIA0hcJpCK0nO31kmn4A',
      ].includes(e.to)
    ),
    idMapSample: Object.fromEntries(Object.entries(map).slice(0, 40)),
    setIsChasingLong: (aicGraph.nodes || [])
      .filter((n) => /Set isChasing/i.test(n.title || ''))
      .map((n) => ({
        id: n.id,
        pos: [n.posX, n.posY],
        val: (n.pins || []).find((p) => p.name === 'isChasing')?.defaultValue,
      })),
  };

  fs.writeFileSync('scan_enemy_overlap.out.json', JSON.stringify(out, null, 2));
  console.log('capsule flow steps', (flow?.steps || []).map((s) => s.title).join(' -> '));
  console.log('setIsChasing', out.setIsChasingLong);
  mcp.kill();
})().catch((e) => {
  console.error(e);
  mcp.kill();
  process.exit(1);
});
