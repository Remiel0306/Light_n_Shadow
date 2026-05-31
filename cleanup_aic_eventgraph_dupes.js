/** Keep one BeginPlay chain; delete duplicate Cache/Patrol/GetPawn nodes in EventGraph */
const { spawn } = require('child_process');
const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const AIC = '/Game/BluePrint/Enemy/BP_EnemyAIController';
const AIC_CLASS = '/Game/BluePrint/Enemy/BP_EnemyAIController.BP_EnemyAIController_C';
const EG = 'EventGraph';

const KEEP = new Set([
  'pJGqaUwLKBY214uAMyp0kQ', // BeginPlay
  'RijWOE30wV2fJ2W7BWLKHA', // Tick
  'M2GvUEkJFSxFRf6eT58FdQ', // Get Controlled Pawn
  'dOn3KULa4-QbtomnevSdfQ', // Cast
  'dRq_tU9XnRrr3_-ZbO_vsw', // Cache
  '1jz5eUZOZliGIHWbBiKzIQ', // StartPatrol
]);

const mcp = spawn('npx.cmd', ['ue-mcp', PROJECT], { shell: true });
let id = 1,
  pending = new Map(),
  buf = '';
function rpc(m, p) {
  return new Promise((res, rej) => {
    const i = id++;
    const t = setTimeout(() => rej(new Error('timeout')), 90000);
    pending.set(i, (m) => {
      clearTimeout(t);
      res(m);
    });
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method: m, params: p }) + '\n');
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
      if (cb) {
        pending.delete(msg.id);
        cb(msg);
      }
    } catch (_) {}
  }
});
async function bp(args) {
  const r = await rpc('tools/call', { name: 'blueprint', arguments: args });
  return JSON.parse(r.result.content[0].text);
}
async function tryConn(a, ap, b, bpins) {
  for (const x of ap) for (const y of bpins) {
    try {
      const r = await bp({
        action: 'connect_pins',
        path: AIC,
        assetPath: AIC,
        graphName: EG,
        sourceNode: a,
        sourcePin: x,
        targetNode: b,
        targetPin: y,
      });
      if (r.success !== false) return;
    } catch (_) {}
  }
}
(async () => {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'dedupe' } });
  const g = await bp({ action: 'read_graph', path: AIC, assetPath: AIC, graphName: EG });
  for (const n of g.nodes || []) {
    if (!KEEP.has(n.id)) {
      try {
        await bp({ action: 'delete_node', path: AIC, assetPath: AIC, graphName: EG, nodeName: n.id });
        console.log('del', n.title, n.id);
      } catch (_) {}
    }
  }
  await tryConn('pJGqaUwLKBY214uAMyp0kQ', ['then'], 'M2GvUEkJFSxFRf6eT58FdQ', ['execute']);
  await tryConn('M2GvUEkJFSxFRf6eT58FdQ', ['then'], 'dOn3KULa4-QbtomnevSdfQ', ['execute']);
  await tryConn('dOn3KULa4-QbtomnevSdfQ', ['then'], 'dRq_tU9XnRrr3_-ZbO_vsw', ['execute']);
  await tryConn('dRq_tU9XnRrr3_-ZbO_vsw', ['then'], '1jz5eUZOZliGIHWbBiKzIQ', ['execute']);
  await tryConn('M2GvUEkJFSxFRf6eT58FdQ', ['ReturnValue'], 'dOn3KULa4-QbtomnevSdfQ', ['Object']);
  const v = await bp({ action: 'validate', path: AIC, assetPath: AIC });
  console.log('valid', v.valid, 'errors', v.errorCount);
  await bp({ action: 'compile', path: AIC, assetPath: AIC });
  mcp.kill();
})().catch((e) => {
  console.error(e);
  mcp.kill();
});
