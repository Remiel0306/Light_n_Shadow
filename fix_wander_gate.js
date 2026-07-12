/**
 * Ensure Wander starts with isChasing gate; confirm delay gates.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const AIC = '/Game/BluePrint/System/BP_EnemyAIController';
const EG = 'EventGraph';

const mcp = spawn('npx.cmd', ['ue-mcp', PROJECT], { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
let id = 1, pending = new Map(), buf = '';
function rpc(m, p, ms = 120000) {
  return new Promise((res, rej) => {
    const i = id++;
    const t = setTimeout(() => rej(new Error('timeout')), ms);
    pending.set(i, (msg) => { clearTimeout(t); res(msg); });
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method: m, params: p }) + '\n');
  });
}
mcp.stdout.on('data', (d) => {
  buf += d.toString();
  const lines = buf.split('\n'); buf = lines.pop();
  for (const line of lines) {
    try { const msg = JSON.parse(line); const cb = pending.get(msg.id); if (cb) cb(msg); } catch {}
  }
});
function parse(res) {
  try { return JSON.parse(res?.result?.content?.[0]?.text); } catch { return res; }
}
async function bp(args, soft = false) {
  const p = parse(await rpc('tools/call', { name: 'blueprint', arguments: { path: AIC, assetPath: AIC, ...args } }));
  if (!soft && p.success === false && p.error) throw new Error(p.error);
  return p;
}
async function tryConn(a, ap, b, tp) {
  for (const x of ap) for (const y of tp) {
    const r = await bp({ action: 'connect_pins', graphName: EG, sourceNode: a, sourcePin: x, targetNode: b, targetPin: y }, true);
    if (r.success !== false) return `${x}->${y}`;
  }
  return null;
}

(async () => {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fix_wander_gate' } });

  const sum = await bp({ action: 'read_graph_summary', graphName: EG });
  const titles = Object.fromEntries((sum.nodes || []).map((n) => [n.id, n.title]));
  const g = await bp({ action: 'read_graph', graphName: EG });

  // Map short->long
  const longs = {};
  for (const n of g.nodes || []) {
    const t = (n.title || '').split('\n')[0].trim();
    (longs[t] = longs[t] || []).push(n);
  }
  const shorts = {};
  for (const n of sum.nodes || []) (shorts[n.title] = shorts[n.title] || []).push(n.id);
  const s2l = {};
  for (const t of Object.keys(shorts)) {
    if ((longs[t] || []).length === shorts[t].length) {
      shorts[t].forEach((s, i) => { s2l[s] = longs[t][i].id; });
    }
  }

  // isChasing data edges
  for (const e of sum.dataEdges || []) {
    if (/isChasing/i.test(titles[e.from] || '') && titles[e.to] === 'Branch') {
      const longId = s2l[e.to];
      const node = (g.nodes || []).find((n) => n.id === longId);
      console.log(`Get isChasing -> Branch ${e.to} / ${longId} @ ${node?.posX},${node?.posY}`);
    }
  }

  const wander = (g.nodes || []).find((n) => n.class === 'K2Node_CustomEvent' && /Wander/i.test(n.title || ''));
  const validBranch = (g.nodes || []).find((n) => n.id === '2E5E46F1433FD4D17E5E7AB9208F938A');

  // What does Wander connect to?
  const wanderOuts = (sum.execEdges || []).filter((e) => s2l[e.from] === wander.id || e.from === wander.id);
  console.log('Wander outs:', wanderOuts.map((e) => `${e.fromPin}->${titles[e.to]}(${s2l[e.to] || e.to})`));

  // If Wander goes directly to Is Valid branch, insert gate
  const goesToValid = wanderOuts.some((e) => (s2l[e.to] || e.to) === validBranch?.id);
  const gateBranches = (g.nodes || []).filter((n) => {
    if (!/Branch/i.test(n.title || '')) return false;
    // has isChasing as condition - check via data edges
    return true;
  });

  // Find branch that has isChasing AND is between wander and valid - by position left of valid
  const chaseGates = [];
  for (const e of sum.dataEdges || []) {
    if (!/isChasing/i.test(titles[e.from] || '') || titles[e.to] !== 'Branch') continue;
    const bid = s2l[e.to] || e.to;
    const node = (g.nodes || []).find((n) => n.id === bid);
    if (!node) continue;
    // Check exec: does else go toward wander body?
    const outs = (sum.execEdges || []).filter((x) => (s2l[x.from] || x.from) === bid);
    chaseGates.push({ id: bid, pos: [node.posX, node.posY], outs: outs.map((x) => `${x.fromPin}->${titles[x.to]}`) });
  }
  console.log('chaseGates', JSON.stringify(chaseGates, null, 2));

  if (goesToValid || !chaseGates.some((g) => g.outs.some((o) => /Set MaxWalkSpeed|Branch/i.test(o) && o.startsWith('else')))) {
    console.log('Need to (re)install wander start gate');
    // Disconnect wander -> valid
    await bp({
      action: 'disconnect_pins',
      graphName: EG,
      sourceNode: wander.id,
      sourcePin: 'then',
      targetNode: validBranch.id,
      targetPin: 'execute',
    }, true);

    const br = (await bp({
      action: 'add_node',
      graphName: EG,
      nodeClass: 'Branch',
      posX: -200,
      posY: 384,
    })).nodeId;
    const getC = (await bp({
      action: 'add_node',
      graphName: EG,
      nodeClass: 'GetVar',
      nodeParams: { variableName: 'isChasing' },
      posX: -400,
      posY: 450,
    })).nodeId;

    console.log('wander->gate', await tryConn(wander.id, ['then'], br, ['execute']));
    console.log('getC->cond', await tryConn(getC, ['isChasing', 'ReturnValue'], br, ['Condition']));
    console.log('gate else->valid', await tryConn(br, ['else'], validBranch.id, ['execute']));
  } else {
    console.log('Wander start gate appears present');
  }

  await bp({ action: 'compile' }, true);
  const v = await bp({ action: 'validate' }, true);
  console.log('valid', v.valid, v.errorCount);

  // Final wander outs
  const sum2 = await bp({ action: 'read_graph_summary', graphName: EG });
  const t2 = Object.fromEntries((sum2.nodes || []).map((n) => [n.id, n.title]));
  // rebuild map roughly - just print wander-related edges
  for (const e of sum2.execEdges || []) {
    if (t2[e.from] === 'Wander' || (t2[e.to] === 'Wander' && e.fromPin !== 'then')) {
      console.log(`EDGE ${t2[e.from]} -${e.fromPin}-> ${t2[e.to]}`);
    }
  }
  // Also edges from Branch that has else to Delay (confirm)
  let delayGates = 0;
  for (const e of sum2.execEdges || []) {
    if (e.fromPin === 'else' && t2[e.to] === 'Delay') delayGates++;
  }
  console.log('else->Delay count', delayGates);

  fs.writeFileSync('fix_wander_gate.out.json', JSON.stringify({ chaseGates, goesToValid, v }, null, 2));
  mcp.kill();
})().catch((e) => { console.error(e); mcp.kill(); process.exit(1); });
