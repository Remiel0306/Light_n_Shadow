/**
 * Deep check wander gate + print string pin.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const AIC = '/Game/BluePrint/System/BP_EnemyAIController';
const ENEMY = '/Game/BluePrint/Enemy/BP_EnemyShadowLogic';

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
async function bp(path, args) {
  return parse(await rpc('tools/call', { name: 'blueprint', arguments: { path, assetPath: path, ...args } }));
}

(async () => {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'deep' } });

  const g = await bp(AIC, { action: 'read_graph', graphName: 'EventGraph' });
  const wander = (g.nodes || []).find((n) => n.class === 'K2Node_CustomEvent' && /Wander/i.test(n.title || ''));
  const nearWander = (g.nodes || []).filter((n) => n.posX > -500 && n.posX < 400 && n.posY > 300 && n.posY < 550);
  console.log('near wander:', nearWander.map((n) => `${n.title}|${n.id.slice(0,8)}@${n.posX},${n.posY}`));

  // read condition of branch at -200
  const gate = nearWander.find((n) => /Branch/i.test(n.title || '') && n.posX < 0);
  if (gate) {
    const cond = await bp(AIC, {
      action: 'read_node_property',
      graphName: 'EventGraph',
      nodeName: gate.id,
      propertyName: 'Condition',
    });
    console.log('gate', gate.id, cond);
    // find data edges into this gate from summary
  }

  const sum = await bp(AIC, { action: 'read_graph_summary', graphName: 'EventGraph' });
  const titles = Object.fromEntries((sum.nodes || []).map((n) => [n.id, n.title]));
  // find wander custom - first wander in nodes with class
  const dataToBranches = (sum.dataEdges || []).filter((e) => titles[e.to] === 'Branch' && /isChasing/i.test(titles[e.from] || ''));
  console.log('isChasing->Branch data:', dataToBranches.map((e) => `${titles[e.from]} -> ${e.toPin} on ${e.to}`));

  const eg = await bp(ENEMY, { action: 'read_graph', graphName: 'EventGraph' });
  const prints = (eg.nodes || []).filter((n) => /Print String/i.test(n.title || ''));
  for (const p of prints) {
    const pin = (p.pins || []).find((x) => x.name === 'InString');
    console.log('print', p.id.slice(0, 8), `@${p.posX},${p.posY}`, 'str=', pin?.defaultValue);
  }

  // Fix print if needed
  const target = prints.find((p) => p.posX > 3800);
  if (target) {
    for (const attempt of [
      { action: 'set_node_property', graphName: 'EventGraph', nodeName: target.id, propertyName: 'InString', value: 'u dead' },
      { action: 'set_node_property', graphName: 'EventGraph', nodeName: target.id, pinName: 'InString', propertyName: 'InString', value: 'u dead' },
      { action: 'set_node_property', graphName: 'EventGraph', nodeName: target.id, propertyName: 'defaultValue', pinName: 'InString', value: 'u dead' },
    ]) {
      const r = await bp(ENEMY, attempt);
      console.log('set print', r.success, r.error || r);
    }
    const g2 = await bp(ENEMY, { action: 'read_graph', graphName: 'EventGraph' });
    const p2 = (g2.nodes || []).find((n) => n.id === target.id);
    console.log('after', (p2?.pins || []).find((x) => x.name === 'InString'));
  }

  await bp(ENEMY, { action: 'compile' });
  mcp.kill();
})().catch((e) => { console.error(e); mcp.kill(); process.exit(1); });
