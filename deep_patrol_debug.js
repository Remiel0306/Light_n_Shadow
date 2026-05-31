/**
 * Deep debug: Target Point set but enemy won't move
 */
const fs = require('fs');
const { spawn } = require('child_process');

const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const AIC = '/Game/BluePrint/Enemy/BP_EnemyAIController';
const ENEMY = '/Game/BluePrint/BP_EnemyShadowLogic';

const mcp = spawn('npx.cmd', ['ue-mcp', PROJECT], { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
let reqId = 1;
const pending = new Map();
let buf = '';

function rpc(method, params, ms = 120000) {
  return new Promise((resolve, reject) => {
    const id = reqId++;
    const t = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout ${method}`));
    }, ms);
    pending.set(id, (m) => {
      clearTimeout(t);
      resolve(m);
    });
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

mcp.stdout.on('data', (d) => {
  buf += d.toString();
  const lines = buf.split('\n');
  buf = lines.pop();
  for (const line of lines) {
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

function parseTool(res) {
  const txt = res?.result?.content?.[0]?.text;
  try {
    return JSON.parse(txt);
  } catch {
    return { success: false, raw: txt };
  }
}

async function bp(args) {
  const res = await rpc('tools/call', { name: 'blueprint', arguments: args });
  return parseTool(res);
}

function findVarGetTarget(dataEdges, nodes, varGetId) {
  const selfWire = dataEdges.find((e) => e.to === varGetId && /self/i.test(e.toPin));
  if (!selfWire) return { wired: false, hint: 'PatrolOriginActor Get has NO target/self — reads wrong object!' };
  const fromNode = nodes.find((n) => n.id === selfWire.from);
  return {
    wired: true,
    fromTitle: fromNode?.title,
    fromClass: fromNode?.class,
    fromPin: selfWire.fromPin,
    ok: /Cast|EnemyShadow|As BP/i.test(fromNode?.title || '') || selfWire.fromPin?.includes('AsBP'),
  };
}

async function main() {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'deep_patrol', version: '1' },
  });

  const report = {};

  for (const [label, path] of [
    ['enemy', ENEMY],
    ['aic', AIC],
  ]) {
    report[label + '_vars'] = await bp({ action: 'list_variables', path, assetPath: path });
    report[label + '_defaults'] = await bp({ action: 'get_class_defaults', path, assetPath: path }).catch?.(() => null);
  }

  const sp = await bp({ action: 'read_graph', path: AIC, assetPath: AIC, graphName: 'StartPatrol' });
  const eg = await bp({ action: 'read_graph', path: AIC, assetPath: AIC, graphName: 'EventGraph' });
  const nodes = sp.nodes || [];
  const dataEdges = sp.dataEdges || [];
  const execEdges = sp.execEdges || [];

  report.startPatrol = {
    nodes: nodes.map((n) => ({ id: n.id, title: n.title, class: n.class })),
    execEdges,
    dataEdges,
    analysis: [],
  };

  const patrolGets = nodes.filter((n) => /PatrolOrigin/i.test(n.title || ''));
  for (const pg of patrolGets) {
    const t = findVarGetTarget(dataEdges, nodes, pg.id);
    report.startPatrol.analysis.push({ node: pg.title, id: pg.id, target: t });
  }

  const cast = nodes.find((n) => /Cast.*EnemyShadow/i.test(n.title || ''));
  const move = nodes.find((n) => /Move to Location/i.test(n.title || ''));
  const random = nodes.find((n) => /Random Reachable/i.test(n.title || ''));

  if (cast) {
    const castExecIn = execEdges.filter((e) => e.to === cast.id);
    const castThen = execEdges.filter((e) => e.from === cast.id && e.fromPin === 'then');
    report.startPatrol.castExec = { in: castExecIn.length, thenOut: castThen.length };
  }
  if (move) {
    const moveExecIn = execEdges.filter((e) => e.to === move.id);
    const dest = dataEdges.filter((e) => e.to === move.id && /Dest/i.test(e.toPin));
    const target = dataEdges.filter((e) => e.to === move.id && /self/i.test(e.toPin));
    report.startPatrol.move = { execIn: moveExecIn.length, destWired: dest.length, targetWired: target.length };
  }
  if (random) {
    const origin = dataEdges.filter((e) => e.to === random.id && /Origin/i.test(e.toPin));
    const radius = dataEdges.filter((e) => e.to === random.id && /Radius/i.test(e.toPin));
    const retToBranch = dataEdges.filter((e) => e.from === random.id && /Return/i.test(e.fromPin));
    report.startPatrol.random = { origin: origin.length, radius: radius.length, successBoolOut: retToBranch.length };
  }

  report.eventGraph = {
    nodes: (eg.nodes || []).map((n) => ({ title: n.title, class: n.class })),
    execEdges: eg.execEdges || [],
  };

  report.enemyPatrolVar = (report.enemy_vars?.variables || []).find((v) => /PatrolOrigin/i.test(v.name));
  report.enemyDefaults = await bp({ action: 'get_blueprint_defaults', path: ENEMY, assetPath: ENEMY }).catch(() =>
    bp({ action: 'read_class_defaults', path: ENEMY, assetPath: ENEMY }).catch(() => ({}))
  );

  // Try list class settings via component query
  const comp = await bp({ action: 'list_components', path: ENEMY, assetPath: ENEMY }).catch(() => ({}));
  report.enemyComponents = comp;

  report.validate = {
    aic: await bp({ action: 'validate', path: AIC, assetPath: AIC }),
    enemy: await bp({ action: 'validate', path: ENEMY, assetPath: ENEMY }),
  };

  fs.writeFileSync('deep_patrol_debug_report.json', JSON.stringify(report, null, 2));

  console.log('\n=== Deep Patrol Debug ===\n');
  const pv = report.enemyPatrolVar;
  console.log('PatrolOriginActor variable type:', pv?.type, 'instanceEditable:', pv?.instanceEditable);
  if (pv?.type !== 'object' && pv?.type !== 'actor') {
    console.log('  *** WRONG TYPE! Should be Actor/Object reference, not', pv?.type);
  }

  console.log('\nStartPatrol PatrolOriginActor getters:');
  for (const a of report.startPatrol.analysis) {
    console.log(' ', a.node, '->', JSON.stringify(a.target));
    if (a.target.wired && !a.target.ok) {
      console.log('    *** Target may NOT be Cast pawn — level TargetPoint ignored!');
    }
    if (!a.target.wired) {
      console.log('    *** No self wire — variable reads from WRONG context (AIC?)');
    }
  }

  console.log('\nExec/Move:', report.startPatrol.castExec, report.startPatrol.move, report.startPatrol.random);
  console.log('Exec edges count:', execEdges.length);
  console.log('\nEventGraph:', report.eventGraph.nodes.map((n) => n.title).join(' | '));

  const walk = (report.enemy_vars?.variables || []).find((v) => v.name === 'WalkSpeed');
  console.log('\nWalkSpeed default var exists:', !!walk);

  console.log('\nWrote deep_patrol_debug_report.json');
  mcp.kill();
}

main().catch((e) => {
  console.error(e);
  mcp.kill();
  process.exit(1);
});
