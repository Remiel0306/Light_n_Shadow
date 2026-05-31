/**
 * Scan BP_Enemy1 + BP_EnemyAIController for AI setup gaps.
 */
const { spawn } = require('child_process');
const fs = require('fs');

const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const ENEMY_PATHS = [
  '/Game/BluePrint/BP_EnemyShadowLogic',
  '/Game/BluePrint/Enemy/BP_EnemyShadowLogic',
  '/Game/BluePrint/BP_Enemy1',
];
const AIC = '/Game/BluePrint/Enemy/BP_EnemyAIController';

const mcp = spawn('npx.cmd', ['ue-mcp', PROJECT], { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
let reqId = 1;
const pending = new Map();
let buf = '';

function rpc(method, params, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const id = reqId++;
    const t = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout ${method}`));
    }, timeoutMs);
    pending.set(id, (msg) => {
      clearTimeout(t);
      resolve(msg);
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

async function bp(action, extra = {}) {
  const res = await rpc('tools/call', { name: 'blueprint', arguments: { action, ...extra } });
  return parseTool(res);
}

async function main() {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'scan_enemy_ai', version: '1' },
  });

  const report = { scannedAt: new Date().toISOString(), assets: {} };

  for (const path of [...ENEMY_PATHS, AIC]) {
    const vars = await bp('list_variables', { path, assetPath: path });
    const graphs = await bp('list_graphs', { path, assetPath: path });
    const summary = await bp('read_graph_summary', {
      path,
      assetPath: path,
      graphName: 'EventGraph',
    });
    const validate = await bp('validate', { path, assetPath: path });
    const cdo = await bp('get_cdo_properties', { path, assetPath: path });
    report.assets[path] = { vars, graphs, summary, validate, cdo };
  }

  const out = 'scan_enemy_ai_report.json';
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log('Wrote', out);

  // Human summary
  for (const path of [...ENEMY_PATHS, AIC]) {
    const v = report.assets[path].vars;
    const s = report.assets[path].summary;
    console.log('\n===', path, '===');
    if (!v?.success) console.log('vars:', v?.error || v?.raw || 'FAIL');
    else console.log('variables:', (v.variables || []).map((x) => x.name).join(', ') || '(none)');
    if (!s?.success) console.log('graph:', s?.error || s?.raw || 'FAIL');
    else {
      const nodes = s.nodes || [];
      console.log('EventGraph nodes:', nodes.length);
      const titles = nodes.map((n) => n.title).filter(Boolean);
      const key = titles.filter((t) =>
        /Perception|Patrol|Chase|Return|Move To|BeginPlay|Timer|CurrentState|PatrolOrigin/i.test(t)
      );
      console.log('AI-related:', key.slice(0, 30).join(' | ') || '(none)');
    }
  }

  mcp.kill();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  mcp.kill();
  process.exit(1);
});
