/**
 * Fix EventGraph: exec chain + valid function call nodes
 */
const { spawn } = require('child_process');

const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const AIC = '/Game/BluePrint/Enemy/BP_EnemyAIController';
const AIC_CLASS = '/Game/BluePrint/Enemy/BP_EnemyAIController.BP_EnemyAIController_C';
const ENEMY_CLASS = '/Game/BluePrint/BP_EnemyShadowLogic.BP_EnemyShadowLogic_C';
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
      reject(new Error('timeout'));
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

async function bp(args, opt = false) {
  const res = await rpc('tools/call', { name: 'blueprint', arguments: args });
  const p = parseTool(res);
  if (!opt && p.success === false && p.error) throw new Error(p.error);
  return p;
}

async function tryConn(a, ap, b, tp) {
  for (const x of ap) {
    for (const y of tp) {
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
        if (r.success !== false) return true;
      } catch (_) {}
    }
  }
  return false;
}

async function main() {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'fix_aic_eg', version: '1' },
  });

  const g = await bp({ action: 'read_graph', path: AIC, assetPath: AIC, graphName: EG });
  const nodes = g.nodes || [];

  // Remove broken call nodes (function None)
  for (const n of nodes) {
    if (n.class === 'K2Node_CallFunction' && (n.title === 'CacheSettingsFromPawn' || n.title === 'StartPatrol' || n.title?.includes('None'))) {
      await bp(
        {
          action: 'delete_node',
          path: AIC,
          assetPath: AIC,
          graphName: EG,
          nodeName: n.id || n.nodeId,
        },
        true
      );
      console.log('deleted', n.title, n.id);
    }
  }

  const g2 = await bp({ action: 'read_graph', path: AIC, assetPath: AIC, graphName: EG });
  let begin = g2.nodes.find((n) => n.title === 'Event BeginPlay');
  let getPawn = g2.nodes.find((n) => n.title === 'Get Controlled Pawn');
  let cast = g2.nodes.find((n) => n.title?.includes('EnemyShadowLogic'));

  const addNode = async (nodeClass, nodeParams, x, y) => {
    const r = await bp({
      action: 'add_node',
      path: AIC,
      assetPath: AIC,
      graphName: EG,
      nodeClass,
      nodeParams,
      posX: x,
      posY: y,
    });
    return r.nodeId;
  };

  if (!getPawn) {
    getPawn = {
      id: await addNode('CallFunction', {
        functionName: 'K2_GetPawn',
        targetClass: '/Script/AIModule.AIController',
      }, 400, 0),
    };
  }
  if (!cast) {
    cast = {
      id: await addNode('K2Node_DynamicCast', { targetClass: ENEMY_CLASS }, 600, 0),
    };
  }

  const callCache = await addNode(
    'CallFunction',
    { functionName: 'CacheSettingsFromPawn', targetClass: AIC_CLASS },
    1000,
    0
  );
  const callPatrol = await addNode(
    'CallFunction',
    { functionName: 'StartPatrol', targetClass: AIC_CLASS },
    1200,
    0
  );

  const bid = (n) => n.id || n.nodeId;

  await tryConn(bid(begin), ['then'], bid(getPawn), ['execute']);
  await tryConn(bid(getPawn), ['then'], bid(cast), ['execute']);
  await tryConn(bid(cast), ['then'], callCache, ['execute']);
  await tryConn(bid(callCache), ['then'], callPatrol, ['execute']);
  await tryConn(bid(getPawn), ['ReturnValue'], bid(cast), ['Object']);

  const v = await bp({ action: 'validate', path: AIC, assetPath: AIC });
  console.log('validate', v.errorCount, v.valid, v.messages?.slice(0, 4));
  await bp({ action: 'compile', path: AIC, assetPath: AIC });
  console.log('compiled');
  mcp.kill();
}

main().catch((e) => {
  console.error(e);
  mcp.kill();
  process.exit(1);
});
