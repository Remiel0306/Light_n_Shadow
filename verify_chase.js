/**
 * Verify chase-until-touch wiring.
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

function rpc(method, params, ms = 120000) {
  return new Promise((resolve, reject) => {
    const i = id++;
    const t = setTimeout(() => reject(new Error('timeout')), ms);
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

async function bp(path, args) {
  return parse(
    await rpc('tools/call', {
      name: 'blueprint',
      arguments: { path, assetPath: path, ...args },
    })
  );
}

(async () => {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'verify_chase' },
  });

  const aic = await bp(AIC, { action: 'read_graph_summary', graphName: 'EventGraph' });
  const titles = Object.fromEntries((aic.nodes || []).map((n) => [n.id, n.title]));
  const edges = (aic.execEdges || []).map((e) => `${titles[e.from]} --${e.fromPin}--> ${titles[e.to]}`);

  const interesting = edges.filter((s) =>
    /Wander|KeepChase|Keep Chase|isChasing|AI MoveTo|Perception|Delay|Branch/i.test(s)
  );

  const enemy = await bp(ENEMY, { action: 'read_graph_summary', graphName: 'EventGraph' });
  const et = Object.fromEntries((enemy.nodes || []).map((n) => [n.id, n.title]));
  const eedges = (enemy.execEdges || [])
    .map((e) => `${et[e.from]} --${e.fromPin}--> ${et[e.to]}`)
    .filter((s) => /Capsule|Sequence|Print|Branch|u dead/i.test(s));

  const g = await bp(ENEMY, { action: 'read_graph', graphName: 'EventGraph' });
  const print = (g.nodes || []).find(
    (n) => /Print String/i.test(n.title || '') && n.posX > 3800
  );
  const printStr = (print?.pins || []).find((p) => p.name === 'InString')?.defaultValue;

  const v1 = await bp(AIC, { action: 'validate' });
  const v2 = await bp(ENEMY, { action: 'validate' });

  const out = {
    aicValid: v1.valid,
    enemyValid: v2.valid,
    printStr,
    interesting,
    eedges,
  };
  fs.writeFileSync('verify_chase.out.json', JSON.stringify(out, null, 2));
  console.log('AIC valid', v1.valid, 'Enemy valid', v2.valid, 'print', printStr);
  console.log('--- AIC ---');
  interesting.forEach((s) => console.log(s));
  console.log('--- Enemy ---');
  eedges.forEach((s) => console.log(s));
  mcp.kill();
})().catch((e) => {
  console.error(e);
  mcp.kill();
  process.exit(1);
});
