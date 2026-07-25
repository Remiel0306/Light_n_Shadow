/**
 * Diagnose why AI Perception debug viz might not show.
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

function rpc(method, params, ms = 180000) {
  return new Promise((resolve, reject) => {
    const i = id++;
    const t = setTimeout(() => {
      pending.delete(i);
      reject(new Error('timeout'));
    }, ms);
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
    clientInfo: { name: 'diag_perception_viz' },
  });

  const out = {};

  out.aicRead = await bp(AIC, { action: 'read' });
  out.enemyRead = await bp(ENEMY, { action: 'read' });

  // Component props
  for (const name of ['AIPerception', 'Perception', 'AIPerceptionComponent']) {
    try {
      const r = await bp(AIC, { action: 'read_component_properties', componentName: name });
      if (r && r.success !== false) out[`aicComp_${name}`] = r;
    } catch (e) {
      out[`aicComp_${name}_err`] = String(e.message || e);
    }
  }

  try {
    out.aicCdo = await bp(AIC, { action: 'get_cdo_properties' });
  } catch (e) {
    out.aicCdoErr = String(e.message || e);
  }

  try {
    out.enemyCdo = await bp(ENEMY, { action: 'get_cdo_properties' });
  } catch (e) {
    out.enemyCdoErr = String(e.message || e);
  }

  // BeginPlay perception activation
  const sum = await bp(AIC, { action: 'read_graph_summary', graphName: 'EventGraph' });
  const titles = Object.fromEntries((sum.nodes || []).map((n) => [n.id, n.title]));
  out.percEdges = (sum.execEdges || [])
    .filter((e) => /BeginPlay|Set Active|Perception|Request Stimuli|Wander|Possess/i.test(`${titles[e.from]} ${titles[e.to]}`))
    .map((e) => `${titles[e.from]} -${e.fromPin}-> ${titles[e.to]}`);

  out.nodeTitles = (sum.nodes || []).map((n) => n.title).filter((t) => /Perception|Sight|Active|BeginPlay|Possess/i.test(t || ''));

  // Enemy AI controller class
  try {
    out.enemyAIClass = await bp(ENEMY, {
      action: 'get_component_property',
      componentName: 'DefaultSceneRoot',
      propertyName: 'AIControllerClass',
    });
  } catch (_) {}

  try {
    out.enemyDefaults = await bp(ENEMY, { action: 'get_cdo_properties' });
  } catch (_) {}

  fs.writeFileSync('diag_perception_viz.out.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify({
    aicHasPerception: !!(out.aicComp_AIPerception || out.aicRead),
    percEdges: out.percEdges,
    nodeTitles: out.nodeTitles,
    aicReadKeys: out.aicRead ? Object.keys(out.aicRead).slice(0, 30) : null,
    aicCompKeys: out.aicComp_AIPerception ? Object.keys(out.aicComp_AIPerception).slice(0, 40) : null,
  }, null, 2));
  console.log('aicComp sample', JSON.stringify(out.aicComp_AIPerception || out.aicComp_Perception || {}).slice(0, 2000));
  console.log('enemy cdo ai', JSON.stringify(out.enemyDefaults || {}).slice(0, 1500));
  mcp.kill();
})().catch((e) => {
  console.error(e);
  mcp.kill();
  process.exit(1);
});
