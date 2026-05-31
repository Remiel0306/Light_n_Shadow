/**
 * Fix StartPatrol: wire Cast pawn -> Get PatrolOriginActor/PatrolRadius on ENEMY class
 */
const { spawn } = require('child_process');

const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const AIC = '/Game/BluePrint/Enemy/BP_EnemyAIController';
const ENEMY_CLASS = '/Game/BluePrint/BP_EnemyShadowLogic.BP_EnemyShadowLogic_C';
const FN = 'StartPatrol';

const mcp = spawn('npx.cmd', ['ue-mcp', PROJECT], { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
let id = 1,
  pending = new Map(),
  buf = '';

function rpc(m, p) {
  return new Promise((res, rej) => {
    const i = id++;
    const t = setTimeout(() => rej(new Error('timeout')), 120000);
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
async function tryConn(a, ap, b, tp) {
  for (const x of ap)
    for (const y of tp) {
      const r = await bp({
        action: 'connect_pins',
        path: AIC,
        assetPath: AIC,
        graphName: FN,
        sourceNode: a,
        sourcePin: x,
        targetNode: b,
        targetPin: y,
      });
      if (r.success !== false) return true;
    }
  return false;
}

(async () => {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fix_patrol' } });
  const g = await bp({ action: 'read_graph', path: AIC, assetPath: AIC, graphName: FN });
  const cast = (g.nodes || []).find((n) => /Cast.*EnemyShadow/i.test(n.title || ''));
  if (!cast) {
    console.log('No cast node');
    mcp.kill();
    return;
  }
  const castId = cast.id;
  const varGets = (g.nodes || []).filter((n) => /Get PatrolOrigin|Get PatrolRadius/i.test(n.title || ''));
  console.log('Cast', castId, 'varGets', varGets.length);
  for (const vg of varGets) {
    const ok = await tryConn(castId, ['AsBP Enemy Shadow Logic', 'AsBP_EnemyShadowLogic'], vg.id, ['self', 'Target']);
    console.log('wire cast->', vg.title, ok ? 'OK' : 'fail');
  }
  // Get Actor Location for origin should use PatrolOriginActor not cast pawn
  const getLocs = (g.nodes || []).filter((n) => /Get Actor Location/i.test(n.title || ''));
  const getOrigins = (g.nodes || []).filter((n) => /Get PatrolOrigin/i.test(n.title || ''));
  if (getOrigins[0] && getLocs[0]) {
    await tryConn(getOrigins[0].id, ['PatrolOriginActor'], getLocs[0].id, ['self', 'Target']);
    console.log('wire origin actor -> get location');
  }
  await bp({ action: 'compile', path: AIC, assetPath: AIC });
  const v = await bp({ action: 'validate', path: AIC, assetPath: AIC });
  console.log('validate', v.valid, v.errorCount);
  mcp.kill();
})().catch((e) => {
  console.error(e);
  mcp.kill();
});
