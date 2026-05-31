const { spawn } = require('child_process');
const AIC = '/Game/BluePrint/System/BP_EnemyAIController';
const AIC_CLASS = '/Game/BluePrint/System/BP_EnemyAIController.BP_EnemyAIController_C';
const FN = 'StartPatrol';
const EG = 'EventGraph';
const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';

const mcp = spawn('npx.cmd', ['ue-mcp', PROJECT], { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
let id = 1, pending = new Map(), buf = '';
function rpc(m, p) {
  return new Promise((res, rej) => {
    const i = id++;
    const t = setTimeout(() => rej(new Error('timeout')), 120000);
    pending.set(i, (msg) => { clearTimeout(t); res(msg); });
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method: m, params: p }) + '\n');
  });
}
mcp.stdout.on('data', (d) => {
  buf += d.toString();
  const lines = buf.split('\n'); buf = lines.pop();
  for (const line of lines) {
    try { const msg = JSON.parse(line); const cb = pending.get(msg.id); if (cb) cb(msg); } catch (_) {}
  }
});
function parse(res) {
  try { return JSON.parse(res?.result?.content?.[0]?.text); } catch { return {}; }
}
async function bp(args) {
  return parse(await rpc('tools/call', { name: 'blueprint', arguments: args }));
}
async function tryConn(a, ap, b, tp) {
  for (const x of ap) for (const y of tp) {
    const r = await bp({ action: 'connect_pins', path: AIC, assetPath: AIC, graphName: EG, sourceNode: a, sourcePin: x, targetNode: b, targetPin: y });
    if (r.success !== false) return true;
  }
  return false;
}

(async () => {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fix_timer' } });

  const g = await bp({ action: 'read_graph', path: AIC, assetPath: AIC, graphName: EG });
  for (const n of g.nodes || []) {
    if (n.title === 'None' || (n.class === 'K2Node_CallFunction' && n.title !== 'StartPatrol' && n.title !== 'Start Patrol')) {
      try { await bp({ action: 'delete_node', path: AIC, assetPath: AIC, graphName: EG, nodeName: n.id }); console.log('del', n.title); } catch (_) {}
    }
  }

  const g2 = await bp({ action: 'read_graph', path: AIC, assetPath: AIC, graphName: EG });
  const begin = g2.nodes.find((n) => /BeginPlay/i.test(n.title || ''));
  const patrol = g2.nodes.find((n) => /StartPatrol|Start Patrol/i.test(n.title || ''));

  const names = ['K2_SetTimer', 'SetTimer', 'K2_SetTimerByFunctionName', 'SetTimerByFunctionName'];
  let timerId = null;
  for (const fn of names) {
    try {
      const r = await bp({
        action: 'add_node',
        path: AIC,
        assetPath: AIC,
        graphName: EG,
        nodeClass: 'CallFunction',
        nodeParams: { functionName: fn, targetClass: '/Script/Engine.KismetSystemLibrary' },
        posX: 800,
        posY: 0,
      });
      const check = await bp({ action: 'read_graph', path: AIC, assetPath: AIC, graphName: EG });
      const node = check.nodes.find((n) => n.id === r.nodeId);
      if (node && node.title !== 'None') {
        timerId = r.nodeId;
        console.log('timer node ok:', node.title, fn);
        break;
      }
      await bp({ action: 'delete_node', path: AIC, assetPath: AIC, graphName: EG, nodeName: r.nodeId });
    } catch (e) {
      console.log('try', fn, e.message);
    }
  }

  if (!timerId) {
    // search node types
    const s = await bp({ action: 'search_node_types', path: AIC, assetPath: AIC, search: 'Set Timer' });
    console.log('search', JSON.stringify(s).slice(0, 800));
    mcp.kill();
    process.exit(1);
  }

  const selfId = (await bp({
    action: 'add_node',
    path: AIC,
    assetPath: AIC,
    graphName: EG,
    nodeClass: 'K2Node_Self',
    posX: 800,
    posY: 200,
  })).nodeId;

  if (patrol) await tryConn(patrol.id, ['then'], timerId, ['execute']);
  else if (begin) await tryConn(begin.id, ['then'], timerId, ['execute']);
  await tryConn(selfId, ['self'], timerId, ['Object', 'self']);

  for (const [prop, val] of [
    ['FunctionName', FN],
    ['Time', 5],
    ['bLooping', true],
  ]) {
    try {
      await bp({ action: 'set_node_property', path: AIC, assetPath: AIC, graphName: EG, nodeName: timerId, propertyName: prop, value: val });
    } catch (_) {}
  }

  const v = await bp({ action: 'validate', path: AIC, assetPath: AIC });
  console.log('valid', v.valid, 'errors', v.errorCount, v.messages?.map((m) => m.message));
  await bp({ action: 'compile', path: AIC, assetPath: AIC });
  mcp.kill();
})().catch((e) => { console.error(e); mcp.kill(); process.exit(1); });
