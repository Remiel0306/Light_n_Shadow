/**
 * Diagnose BP_EnemyAIController compile / CreateExecutionSchedule issues
 */
const fs = require('fs');
const { spawn } = require('child_process');

const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const AIC = '/Game/BluePrint/Enemy/BP_EnemyAIController';

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

function analyzeExecTopology(graphName, nodes, execEdges) {
  const issues = [];
  const nodeById = Object.fromEntries(nodes.map((n) => [n.id, n]));

  // Nodes that should never have exec OUT from pure-only contexts
  const pureOnlyClasses = new Set(['K2Node_VariableGet', 'K2Node_Self', 'K2Node_CallFunction']);

  for (const e of execEdges) {
    const fromN = nodeById[e.from];
    const toN = nodeById[e.to];
    if (!fromN) issues.push(`${graphName}: exec from missing node ${e.from}`);
    if (!toN) issues.push(`${graphName}: exec to missing node ${e.to}`);
    if (fromN && pureOnlyClasses.has(fromN.class)) {
      const title = fromN.title || '';
      if (!/Print|Move|Cast|Branch|Get Controlled|Is Valid|Random|Set Timer/i.test(title)) {
        issues.push(`${graphName}: suspicious exec FROM "${title}" (${fromN.class}) pin ${e.fromPin}`);
      }
    }
  }

  // Orphan exec outputs (dead ends OK) vs Move with no input
  for (const n of nodes) {
    if (/Move to Location/i.test(n.title || '')) {
      const hasIn = execEdges.some((e) => e.to === n.id);
      const hasOut = execEdges.some((e) => e.from === n.id);
      if (!hasIn) issues.push(`${graphName}: Move to Location has NO exec input`);
      if (!hasOut) issues.push(`${graphName}: Move to Location has NO exec output (OK but note)`);
    }
    if (n.class === 'K2Node_DynamicCast') {
      const thenOut = execEdges.filter((e) => e.from === n.id && e.fromPin === 'then');
      const failOut = execEdges.filter((e) => e.from === n.id && e.fromPin === 'CastFailed');
      const execIn = execEdges.filter((e) => e.to === n.id);
      if (!execIn.length) issues.push(`${graphName}: Cast has no exec input`);
      if (!thenOut.length && !failOut.length) issues.push(`${graphName}: Cast has no exec output`);
    }
    if (n.class === 'K2Node_IfThenElse') {
      const condData = true; // checked separately
      const trueOut = execEdges.filter((e) => e.from === n.id && e.fromPin === 'then');
      const elseOut = execEdges.filter((e) => e.from === n.id && e.fromPin === 'else');
      const execIn = execEdges.filter((e) => e.to === n.id);
      if (!execIn.length) issues.push(`${graphName}: Branch "${n.title}" no exec in`);
      if (!trueOut.length && !elseOut.length)
        issues.push(`${graphName}: Branch has neither True nor False exec out`);
    }
    if (n.class === 'K2Node_CallFunction' && /Get Actor Location|Get Random|Is Valid|Get Patrol/i.test(n.title || '')) {
      const execIn = execEdges.filter((e) => e.to === n.id);
      const execOut = execEdges.filter((e) => e.from === n.id);
      if (execIn.length || execOut.length) {
        issues.push(
          `${graphName}: PURE node "${n.title}" has exec wire (in:${execIn.length} out:${execOut.length}) — COMMON ICE CAUSE`
        );
      }
    }
  }

  // Multiple exec inputs to same node pin
  const inCount = {};
  for (const e of execEdges) {
    const key = `${e.to}:${e.toPin}`;
    inCount[key] = (inCount[key] || 0) + 1;
    if (inCount[key] > 1) {
      issues.push(`${graphName}: multiple exec wires TO ${nodeById[e.to]?.title || e.to} pin ${e.toPin}`);
    }
  }

  return issues;
}

async function main() {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'diagnose_compile', version: '1' },
  });

  const list = await bp({ action: 'list_graphs', path: AIC, assetPath: AIC });
  const report = { graphs: {}, compile: null, validate: null };

  for (const g of list.graphs || []) {
    const name = g.name;
    if (name === 'UserConstructionScript') continue;
    const full = await bp({ action: 'read_graph', path: AIC, assetPath: AIC, graphName: name });
    const nodes = full.nodes || [];
    const execEdges = full.execEdges || [];
    const dataEdges = full.dataEdges || [];
    const issues = analyzeExecTopology(name, nodes, execEdges);
    report.graphs[name] = {
      nodeCount: nodes.length,
      execEdgeCount: execEdges.length,
      issues,
      nodes: nodes.map((n) => ({ id: n.id, title: n.title, class: n.class })),
      execEdges,
    };
  }

  report.validate = await bp({ action: 'validate', path: AIC, assetPath: AIC });
  try {
    report.compile = await bp({ action: 'compile', path: AIC, assetPath: AIC });
  } catch (e) {
    report.compile = { error: String(e) };
  }

  fs.writeFileSync('diagnose_aic_compile_report.json', JSON.stringify(report, null, 2));

  console.log('\n=== AIC Compile Diagnosis ===\n');
  for (const [name, g] of Object.entries(report.graphs)) {
    if (g.issues.length) {
      console.log(`[${name}] ${g.nodeCount} nodes`);
      g.issues.forEach((i) => console.log('  !', i));
    }
  }
  const allIssues = Object.entries(report.graphs).flatMap(([n, g]) => g.issues.map((i) => `[${n}] ${i}`));
  if (!allIssues.length) console.log('No obvious exec topology issues from scan.');
  console.log('\nvalidate:', report.validate?.valid, 'errors:', report.validate?.errorCount);
  console.log('compile:', JSON.stringify(report.compile)?.slice(0, 500));
  console.log('\nWrote diagnose_aic_compile_report.json');

  mcp.kill();
}

main().catch((e) => {
  console.error(e);
  mcp.kill();
  process.exit(1);
});
