/**
 * Diagnose StartPatrol: print works but enemy doesn't move
 */
const fs = require('fs');
const { spawn } = require('child_process');

const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const AIC = '/Game/BluePrint/Enemy/BP_EnemyAIController';
const ENEMY = '/Game/BluePrint/BP_EnemyShadowLogic';
const EG = 'EventGraph';

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

function analyzeGraph(g, name) {
  const nodes = g.nodes || [];
  const execEdges = g.execEdges || [];
  const dataEdges = g.dataEdges || [];

  const byTitle = {};
  for (const n of nodes) {
    byTitle[n.title] = byTitle[n.title] || [];
    byTitle[n.title].push(n);
  }

  const issues = [];
  const checks = [];

  const hasMove = nodes.some((n) => /Move to Location|MoveTo/i.test(n.title || ''));
  const hasRandom = nodes.some((n) => /Random Reachable/i.test(n.title || ''));
  const hasCast = nodes.some((n) => /Cast.*EnemyShadow/i.test(n.title || ''));
  const hasPrint = nodes.some((n) => /Print String/i.test(n.title || ''));

  checks.push({ item: 'Has Move to Location', ok: hasMove });
  checks.push({ item: 'Has Get Random Reachable Point', ok: hasRandom });
  checks.push({ item: 'Has Cast to EnemyShadowLogic', ok: hasCast });

  // Exec chain from function entry
  const entry = nodes.find((n) => n.class === 'K2Node_FunctionEntry' || n.title === name);
  const moveNodes = nodes.filter((n) => /Move to Location|MoveTo/i.test(n.title || ''));
  const randomNodes = nodes.filter((n) => /Random Reachable/i.test(n.title || ''));

  for (const mv of moveNodes) {
    const execIn = execEdges.filter((e) => e.to === mv.id);
    if (execIn.length === 0) {
      issues.push(`Move to Location (${mv.id}) has NO incoming exec wire - enemy won't move`);
    } else {
      checks.push({ item: 'Move to Location has exec input', ok: true, from: execIn.map((e) => e.from) });
    }
    const destIn = dataEdges.filter((e) => e.to === mv.id && /Dest/i.test(e.toPin));
    if (destIn.length === 0) {
      issues.push('Move to Location Dest not connected - may move to (0,0,0) or fail');
    } else {
      checks.push({ item: 'Move to Location Dest connected', ok: true });
    }
  }

  for (const rn of randomNodes) {
    const radiusIn = dataEdges.filter((e) => e.to === rn.id && /Radius/i.test(e.toPin));
    const originIn = dataEdges.filter((e) => e.to === rn.id && /Origin/i.test(e.toPin));
    if (radiusIn.length === 0) issues.push('Random Point Radius not wired - may be 0');
    if (originIn.length === 0) issues.push('Random Point Origin not wired');
    const retOut = dataEdges.filter((e) => e.from === rn.id && /Return Value/i.test(e.fromPin));
    const branchCond = dataEdges.filter((e) =>
      nodes.some((n) => n.class === 'K2Node_IfThenElse' && e.to === n.id && /Condition/i.test(e.toPin) && e.from === rn.id)
    );
    if (retOut.length === 0 && branchCond.length === 0) {
      issues.push('Random Point success bool not connected to Branch - may never reach Move To');
    }
  }

  // Branch false-only path to move?
  const branches = nodes.filter((n) => n.title === 'Branch' || n.class === 'K2Node_IfThenElse');
  for (const br of branches) {
    const trueOut = execEdges.filter((e) => e.from === br.id && e.fromPin === 'then');
    const elseOut = execEdges.filter((e) => e.from === br.id && e.fromPin === 'else');
    if (moveNodes.length && trueOut.length) {
      const trueGoesMove = trueOut.some((e) => moveNodes.some((m) => m.id === e.to));
      if (!trueGoesMove && elseOut.some((e) => moveNodes.some((m) => m.id === e.to))) {
        issues.push('Move To wired to Branch FALSE instead of TRUE - invert condition or rewire');
      }
    }
  }

  const castNodes = nodes.filter((n) => /Cast.*EnemyShadow/i.test(n.title || ''));
  for (const c of castNodes) {
    const castFailExec = execEdges.filter((e) => e.from === c.id && e.fromPin === 'CastFailed');
    const castSuccExec = execEdges.filter((e) => e.from === c.id && e.fromPin === 'then');
    if (castSuccExec.length === 0) {
      issues.push('Cast success (then) not connected - patrol logic never runs after cast');
    }
    const castFailToMove = castFailExec.some((e) => moveNodes.some((m) => m.id === e.to));
    if (castFailToMove) issues.push('Exec goes to Move on Cast FAILED path');
  }

  return { name, nodeCount: nodes.length, checks, issues, nodes: nodes.map((n) => ({ title: n.title, class: n.class, id: n.id })), execEdges, dataEdges };
}

async function main() {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'scan_startpatrol', version: '1' },
  });

  const report = { scannedAt: new Date().toISOString(), graphs: {}, summary: { issues: [], likelyCauses: [] } };

  for (const [graphName, path] of [
    ['EventGraph', AIC],
    ['StartPatrol', AIC],
  ]) {
    const summary = await bp({ action: 'read_graph_summary', path, assetPath: path, graphName });
    const full = await bp({ action: 'read_graph', path, assetPath: path, graphName });
    report.graphs[graphName] = analyzeGraph(
      { nodes: full.nodes || summary.nodes, execEdges: summary.execEdges || full.execEdges, dataEdges: summary.dataEdges || full.dataEdges },
      graphName
    );
  }

  const validateAIC = await bp({ action: 'validate', path: AIC, assetPath: AIC });
  const validateEnemy = await bp({ action: 'validate', path: ENEMY, assetPath: ENEMY });
  report.validate = { AIC: validateAIC, Enemy: validateEnemy };

  const enemyVars = await bp({ action: 'list_variables', path: ENEMY, assetPath: ENEMY });
  report.enemyVariables = (enemyVars.variables || []).filter((v) =>
    /Patrol|Walk|Run|Chase/i.test(v.name)
  );

  // Collect all issues
  for (const g of Object.values(report.graphs)) {
    report.summary.issues.push(...g.issues.map((i) => `[${g.name}] ${i}`));
  }

  // Event graph specific
  const eg = report.graphs.EventGraph;
  if (eg) {
    const hasCallPatrol = eg.nodes.some((n) => /StartPatrol|Start Patrol/i.test(n.title || ''));
    const callPatrolExec = eg.execEdges.some((e) =>
      eg.nodes.some((n) => /StartPatrol|Start Patrol/i.test(n.title) && e.to === n.id)
    );
    if (!hasCallPatrol) report.summary.issues.push('[EventGraph] No Call StartPatrol - only Print runs');
    if (hasCallPatrol && !callPatrolExec) report.summary.issues.push('[EventGraph] StartPatrol node exists but no exec wire TO it');

    const beginPlay = eg.nodes.find((n) => n.title === 'Event BeginPlay');
    if (beginPlay) {
      const bpToPatrol = eg.execEdges.filter((e) => e.from === beginPlay.id);
      const reachesPatrol = hasCallPatrol && eg.execEdges.some((e) =>
        eg.nodes.some((n) => /StartPatrol|Start Patrol/i.test(n.title) && (e.to === n.id || e.from === beginPlay.id))
      );
      if (!reachesPatrol) report.summary.issues.push('[EventGraph] BeginPlay may not reach Call StartPatrol (only Print?)');
    }
  }

  // Likely causes heuristic
  const sp = report.graphs.StartPatrol;
  if (sp) {
    if (sp.issues.some((i) => /NO incoming exec/i.test(i))) report.summary.likelyCauses.push('Move To 沒有接到 Branch True 白線');
    if (sp.issues.some((i) => /Dest not connected/i.test(i))) report.summary.likelyCauses.push('Move To 的 Dest 沒接 Random Location');
    if (sp.issues.some((i) => /Radius not wired/i.test(i))) report.summary.likelyCauses.push('Random Point 半徑為 0 或未接 Patrol Radius');
    if (sp.issues.some((i) => /Cast success/i.test(i))) report.summary.likelyCauses.push('Cast 成功後 then 沒往下接');
    if (sp.issues.some((i) => /FALSE instead of TRUE/i.test(i))) report.summary.likelyCauses.push('Branch 接反：Move 在 False 上');
    if (sp.issues.some((i) => /success bool not connected/i.test(i))) report.summary.likelyCauses.push('隨機點失敗時不會 Move（Condition 沒接 Return Value）');
    if (sp.checks.find((c) => c.item === 'Has Move to Location' && c.ok) && sp.issues.length === 0) {
      report.summary.likelyCauses.push('Blueprint 接線看起來完整 → 查關卡：Patrol Origin=None、NavMesh、敵人腳下無綠網、Auto Possess');
    }
  }

  fs.writeFileSync('scan_startpatrol_report.json', JSON.stringify(report, null, 2));

  console.log('\n=== StartPatrol 診斷 ===\n');
  console.log('節點:', sp?.nodeCount, sp?.nodes?.map((n) => n.title).join(' | '));
  console.log('\n檢查:');
  (sp?.checks || []).forEach((c) => console.log(' ', c.ok ? 'OK' : '??', c.item, c.from ? JSON.stringify(c.from) : ''));
  console.log('\n問題:');
  if (report.summary.issues.length === 0) console.log('  (掃描未發現明顯斷線 - 見下方可能原因)');
  else report.summary.issues.forEach((i) => console.log('  -', i));
  console.log('\n可能原因（有 Print 但不動）:');
  [...new Set(report.summary.likelyCauses)].forEach((c) => console.log('  -', c));
  console.log('\nAIC validate:', validateAIC.valid, 'errors:', validateAIC.errorCount);
  console.log('Enemy patrol vars:', report.enemyVariables?.map((v) => v.name).join(', '));
  console.log('\nWrote scan_startpatrol_report.json');

  mcp.kill();
}

main().catch((e) => {
  console.error(e);
  mcp.kill();
  process.exit(1);
});
