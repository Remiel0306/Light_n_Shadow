/**
 * Wire player touch -> Print "u dead" without breaking capsule light logic.
 * Uses a parallel Component Begin Overlap if possible, else ExecutionSequence.
 */
const fs = require('fs');
const { spawn } = require('child_process');

const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const ENEMY = '/Game/BluePrint/Enemy/BP_EnemyShadowLogic';
const EG = 'EventGraph';

const mcp = spawn('npx.cmd', ['ue-mcp', PROJECT], { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
let reqId = 1;
const pending = new Map();
let buf = '';

function rpc(method, params, ms = 180000) {
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

function parse(res) {
  try {
    return JSON.parse(res?.result?.content?.[0]?.text);
  } catch {
    return { success: false };
  }
}

async function bp(args, soft = false) {
  const p = parse(
    await rpc('tools/call', {
      name: 'blueprint',
      arguments: { path: ENEMY, assetPath: ENEMY, ...args },
    })
  );
  if (!soft && p.success === false && p.error) throw new Error(`${args.action}: ${p.error}`);
  return p;
}

async function tryConn(a, ap, b, tp) {
  for (const x of ap) {
    for (const y of tp) {
      const r = await bp(
        {
          action: 'connect_pins',
          graphName: EG,
          sourceNode: a,
          sourcePin: x,
          targetNode: b,
          targetPin: y,
        },
        true
      );
      if (r.success !== false) return `${x}->${y}`;
    }
  }
  return null;
}

async function addNode(nodeClass, nodeParams, x, y) {
  const r = await bp({
    action: 'add_node',
    graphName: EG,
    nodeClass,
    nodeParams: nodeParams || {},
    posX: x,
    posY: y,
  });
  if (!r.nodeId) throw new Error(`add_node ${nodeClass}: ${JSON.stringify(r).slice(0, 300)}`);
  return r.nodeId;
}

function titleOf(n) {
  return (n.title || '').split('\n')[0].trim();
}

(async () => {
  const log = [];
  const note = (s) => {
    console.log(s);
    log.push(s);
  };

  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'fix_udead_print' },
  });

  // Clean any leftover from failed Sequence attempt (pos around 2800,-400)
  let g = await bp({ action: 'read_graph', graphName: EG });
  for (const n of g.nodes || []) {
    if (n.posX >= 2700 && n.posX <= 4500 && n.posY <= -200 && n.posY >= -500) {
      await bp({ action: 'delete_node', graphName: EG, nodeName: n.id }, true);
      note(`cleaned ${titleOf(n)}`);
    }
    if (/ReceiveActorBeginOverlap/i.test(n.title || '')) {
      await bp({ action: 'delete_node', graphName: EG, nodeName: n.id }, true);
      note(`cleaned ${titleOf(n)}`);
    }
  }

  // Try Sequence class names
  let seq = null;
  for (const cls of ['K2Node_ExecutionSequence', 'ExecutionSequence', 'Sequence']) {
    try {
      seq = await addNode(cls, {}, 2800, -400);
      note(`seq ok with ${cls} = ${seq}`);
      break;
    } catch (e) {
      note(`seq fail ${cls}: ${e.message}`);
    }
  }

  g = await bp({ action: 'read_graph', graphName: EG });
  const capsule = (g.nodes || []).find((n) =>
    /On Component Begin Overlap \(CapsuleComponent\)/i.test(n.title || '')
  );
  if (!capsule) throw new Error('capsule overlap event missing');

  const sum = await bp({ action: 'read_graph_summary', graphName: EG });
  const capsuleShort = (sum.nodes || []).find((n) =>
    /On Component Begin Overlap \(CapsuleComponent\)/i.test(n.title || '')
  )?.id;
  const lightBranchShort = (sum.execEdges || []).find((e) => e.from === capsuleShort)?.to;

  // Map short->long
  const longs = {};
  for (const n of g.nodes || []) {
    const t = titleOf(n);
    (longs[t] = longs[t] || []).push(n.id);
  }
  const shorts = {};
  for (const n of sum.nodes || []) {
    (shorts[n.title] = shorts[n.title] || []).push(n.id);
  }
  const s2l = {};
  for (const t of Object.keys(shorts)) {
    if ((longs[t] || []).length === shorts[t].length) {
      shorts[t].forEach((s, i) => {
        s2l[s] = longs[t][i];
      });
    }
  }
  const lightBranch = s2l[lightBranchShort] || lightBranchShort;
  note(`capsule=${capsule.id} lightBranch=${lightBranch}`);

  if (!seq) {
    // Fallback: Custom Event PlayerTouched + call from a NEW component bound event
    // Try adding second Capsule begin overlap
    try {
      seq = await addNode(
        'K2Node_ComponentBoundEvent',
        {
          componentName: 'CapsuleComponent',
          delegateName: 'OnComponentBeginOverlap',
          eventName: 'OnComponentBeginOverlap',
        },
        2800,
        -400
      );
      note(`second capsule overlap event ${seq}`);
    } catch (e) {
      note(`second overlap fail: ${e.message}`);
    }
  }

  const getPlayer = await addNode(
    'CallFunction',
    { functionName: 'GetPlayerCharacter', targetClass: '/Script/Engine.GameplayStatics' },
    3200,
    -280
  );
  const eq = await addNode(
    'CallFunction',
    { functionName: 'EqualEqual_ObjectObject', targetClass: '/Script/Engine.KismetMathLibrary' },
    3500,
    -350
  );
  const br = await addNode('Branch', {}, 3800, -400);
  const print = await addNode(
    'CallFunction',
    { functionName: 'PrintString', targetClass: '/Script/Engine.KismetSystemLibrary' },
    4100,
    -400
  );

  if (seq && titleOf((await bp({ action: 'read_graph', graphName: EG })).nodes.find((n) => n.id === seq) || {}) === 'Sequence' ||
      /Sequence/i.test(titleOf((g.nodes || []).find((n) => n.id === seq) || {}))) {
    // Re-read
    g = await bp({ action: 'read_graph', graphName: EG });
    const seqNode = (g.nodes || []).find((n) => n.id === seq);
    note(`seq title=${seqNode?.title}`);

    await bp(
      {
        action: 'disconnect_pins',
        graphName: EG,
        sourceNode: capsule.id,
        sourcePin: 'then',
        targetNode: lightBranch,
        targetPin: 'execute',
      },
      true
    );
    note(`capsule->seq ${await tryConn(capsule.id, ['then'], seq, ['execute'])}`);
    note(`seq0->light ${await tryConn(seq, ['then_0', 'Then 0'], lightBranch, ['execute'])}`);
    note(`seq1->br ${await tryConn(seq, ['then_1', 'Then 1'], br, ['execute'])}`);
    await tryConn(capsule.id, ['OtherActor', 'Other Actor'], eq, ['A']);
  } else if (seq) {
    // Second overlap event - use it directly for player check only
    note(`use second overlap as entry ${await tryConn(seq, ['then'], br, ['execute'])}`);
    await tryConn(seq, ['OtherActor', 'Other Actor'], eq, ['A']);
  } else {
    // Last resort: custom event PlayerHit that we document for manual wire - OR
    // insert Branch before light: actually use Event Tick is bad.
    // Wire: create CustomEvent UDeadCheck and tell user - no, keep trying.
    throw new Error('Could not create Sequence or second overlap');
  }

  await tryConn(getPlayer, ['ReturnValue'], eq, ['B']);
  note(`eq cond ${await tryConn(eq, ['ReturnValue'], br, ['Condition'])}`);
  note(`print ${await tryConn(br, ['then'], print, ['execute'])}`);

  await bp(
    {
      action: 'set_node_property',
      graphName: EG,
      nodeName: print,
      propertyName: 'InString',
      value: 'u dead',
    },
    true
  );
  await bp(
    {
      action: 'set_node_property',
      graphName: EG,
      nodeName: print,
      pinName: 'InString',
      propertyName: 'InString',
      value: 'u dead',
    },
    true
  );

  await bp({ action: 'compile' }, true);
  const v = await bp({ action: 'validate' }, true);
  note(`valid=${v.valid} errors=${v.errorCount} ${JSON.stringify(v.messages || []).slice(0, 500)}`);

  // Verify capsule light path still connected
  const sum2 = await bp({ action: 'read_graph_summary', graphName: EG });
  const fromCap = (sum2.execEdges || []).filter((e) => {
    const n = (sum2.nodes || []).find((x) => x.id === e.from);
    return n && /CapsuleComponent/i.test(n.title || '');
  });
  note(`capsule outs: ${JSON.stringify(fromCap)}`);

  fs.writeFileSync('fix_udead_print.out.json', JSON.stringify({ log, v }, null, 2));
  console.log('DONE');
  mcp.kill();
})().catch((e) => {
  console.error('FAIL', e);
  mcp.kill();
  process.exit(1);
});
