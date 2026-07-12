/**
 * Follow-up: chase retry via KeepChase event; player touch print via Capsule Sequence.
 */
const fs = require('fs');
const { spawn } = require('child_process');

const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const AIC = '/Game/BluePrint/System/BP_EnemyAIController';
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
  try {
    return JSON.parse(res?.result?.content?.[0]?.text);
  } catch {
    return { success: false, raw: res };
  }
}

async function bp(path, args, soft = false) {
  const p = parseTool(
    await rpc('tools/call', { name: 'blueprint', arguments: { path, assetPath: path, ...args } })
  );
  if (!soft && p.success === false && p.error) throw new Error(`${args.action}: ${p.error}`);
  return p;
}

async function tryConn(path, graph, a, ap, b, tp) {
  for (const x of ap) {
    for (const y of tp) {
      const r = await bp(
        path,
        {
          action: 'connect_pins',
          graphName: graph,
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

async function tryDisconnect(path, graph, a, ap, b, tp) {
  return (
    (
      await bp(
        path,
        {
          action: 'disconnect_pins',
          graphName: graph,
          sourceNode: a,
          sourcePin: ap,
          targetNode: b,
          targetPin: tp,
        },
        true
      )
    ).success !== false
  );
}

function titleOf(n) {
  return (n.title || '').split('\n')[0].trim();
}

async function addNode(path, graph, nodeClass, nodeParams, x, y) {
  const r = await bp(path, {
    action: 'add_node',
    graphName: graph,
    nodeClass,
    nodeParams: nodeParams || {},
    posX: x,
    posY: y,
  });
  if (!r.nodeId) throw new Error(`add_node ${nodeClass}: ${JSON.stringify(r).slice(0, 200)}`);
  return r.nodeId;
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
    clientInfo: { name: 'fix_chase_followup' },
  });

  // ===== AIC: KeepChase custom event =====
  let g = await bp(AIC, { action: 'read_graph', graphName: EG });
  let nodes = g.nodes || [];

  // Remove broken ReceiveActorBeginOverlap leftovers on enemy later.

  const chaseMoveTo = nodes.find(
    (n) => titleOf(n) === 'AI MoveTo' && (n.pins || []).find((p) => p.name === 'TargetActor')?.connected
  );
  const setFalseSuccess = nodes.find(
    (n) =>
      titleOf(n) === 'Set isChasing' &&
      n.posX > 2000 &&
      n.posY > 1700 &&
      (n.pins || []).find((p) => p.name === 'isChasing')?.defaultValue === 'false'
  );
  // After previous run it may be true now
  const setOnSuccess = nodes.find(
    (n) => titleOf(n) === 'Set isChasing' && Math.abs(n.posX - 2144) < 80 && Math.abs(n.posY - 1824) < 80
  );

  note(`chaseMoveTo=${chaseMoveTo?.id}`);
  note(`setOnSuccess=${setOnSuccess?.id} val=${(setOnSuccess?.pins || []).find((p) => p.name === 'isChasing')?.defaultValue}`);

  // Delete old set-on-success if still linked, create KeepChase
  // Custom event KeepChase → AI MoveTo (reuse existing chase MoveTo by Call? Can't easily.
  // Better: Custom Event KeepChase that duplicates minimal chase: GetEnemy, GetPlayer, MoveTo new node.

  // Remove existing KeepChase if any
  for (const n of nodes) {
    if (/KeepChase/i.test(n.title || '')) {
      await bp(AIC, { action: 'delete_node', graphName: EG, nodeName: n.id }, true);
    }
  }

  const keepEv = await addNode(AIC, EG, 'K2Node_CustomEvent', { eventName: 'KeepChase' }, 2400, 1776);
  // Rename if needed via property
  await bp(
    AIC,
    {
      action: 'set_node_property',
      graphName: EG,
      nodeName: keepEv,
      propertyName: 'CustomFunctionName',
      value: 'KeepChase',
    },
    true
  );

  // Wire: KeepChase → existing chase MoveTo execute
  let ok = await tryConn(AIC, EG, keepEv, ['then'], chaseMoveTo.id, ['execute']);
  note(`KeepChase -> MoveTo: ${ok}`);

  // Disconnect OnSuccess from Set isChasing, connect to Call KeepChase
  if (setOnSuccess) {
    await tryDisconnect(AIC, EG, chaseMoveTo.id, 'OnSuccess', setOnSuccess.id, 'execute');
    // delete the set node so it can't clear chase
    await bp(AIC, { action: 'delete_node', graphName: EG, nodeName: setOnSuccess.id }, true);
    note('deleted chase-success Set isChasing');
  }

  // Add CallFunction KeepChase for OnSuccess and OnFail
  const callKeep1 = await addNode(
    AIC,
    EG,
    'CallFunction',
    { functionName: 'KeepChase', targetClass: '/Game/BluePrint/System/BP_EnemyAIController.BP_EnemyAIController_C' },
    2200,
    1776
  );
  const callKeep2 = await addNode(
    AIC,
    EG,
    'CallFunction',
    { functionName: 'KeepChase', targetClass: '/Game/BluePrint/System/BP_EnemyAIController.BP_EnemyAIController_C' },
    2200,
    1920
  );

  // If CallFunction title is None, search and use CustomEvent call differently
  g = await bp(AIC, { action: 'read_graph', graphName: EG });
  const ck1 = (g.nodes || []).find((n) => n.id === callKeep1);
  const ck2 = (g.nodes || []).find((n) => n.id === callKeep2);
  note(`callKeep1 title=${ck1?.title} callKeep2 title=${ck2?.title}`);

  if (ck1 && titleOf(ck1) !== 'None') {
    ok = await tryConn(AIC, EG, chaseMoveTo.id, ['OnSuccess'], callKeep1, ['execute']);
    note(`OnSuccess->KeepChase call: ${ok}`);
    ok = await tryConn(AIC, EG, chaseMoveTo.id, ['OnFail'], callKeep2, ['execute']);
    note(`OnFail->KeepChase call: ${ok}`);
  } else {
    // Fallback: OnSuccess/OnFail directly to KeepChase custom event? Can't - need call node.
    // Use Delay 0.1 then re-execute via connecting to a second AI MoveTo copy.
    note('KeepChase CallFunction failed, creating second MoveTo for retry');
    if (ck1) await bp(AIC, { action: 'delete_node', graphName: EG, nodeName: callKeep1 }, true);
    if (ck2) await bp(AIC, { action: 'delete_node', graphName: EG, nodeName: callKeep2 }, true);

    // Wire OnSuccess/OnFail → Delay 0.05 → KeepChase event via assigning... 
    // Actually connect OnSuccess to KeepChase event by using "Call" from search
    const search = await bp(AIC, { action: 'search_node_types', search: 'KeepChase' }, true);
    note(`search KeepChase: ${JSON.stringify(search).slice(0, 400)}`);

    // Create delay + reconnect KeepChase event exec from OnSuccess by making OnSuccess call the custom event
    // In UE, custom events are called via CallFunction with the event name after compile.
    await bp(AIC, { action: 'compile' }, true);
    const callAgain = await addNode(
      AIC,
      EG,
      'CallFunction',
      { functionName: 'KeepChase' },
      2200,
      1776
    );
    const callAgain2 = await addNode(AIC, EG, 'CallFunction', { functionName: 'KeepChase' }, 2200, 1920);
    g = await bp(AIC, { action: 'read_graph', graphName: EG });
    note(`after compile call titles: ${titleOf((g.nodes || []).find((n) => n.id === callAgain))} / ${titleOf((g.nodes || []).find((n) => n.id === callAgain2))}`);
    ok = await tryConn(AIC, EG, chaseMoveTo.id, ['OnSuccess'], callAgain, ['execute']);
    note(`OnSuccess->KeepChase: ${ok}`);
    ok = await tryConn(AIC, EG, chaseMoveTo.id, ['OnFail'], callAgain2, ['execute']);
    note(`OnFail->KeepChase: ${ok}`);
  }

  await bp(AIC, { action: 'compile' }, true);

  // ===== ENEMY: remove broken ActorBeginOverlap, splice Sequence on Capsule =====
  g = await bp(ENEMY, { action: 'read_graph', graphName: EG });
  nodes = g.nodes || [];
  for (const n of nodes) {
    if (/ReceiveActorBeginOverlap|Actor Begin Overlap/i.test(n.title || '')) {
      // delete the whole broken chain we added (far right)
      if (n.posX > 3000 || /ReceiveActorBeginOverlap/i.test(n.title || '')) {
        await bp(ENEMY, { action: 'delete_node', graphName: EG, nodeName: n.id }, true);
        note(`del enemy node ${titleOf(n)}`);
      }
    }
  }
  // Also delete orphan Print/Branch/Equal we added near 3200,-800
  g = await bp(ENEMY, { action: 'read_graph', graphName: EG });
  for (const n of g.nodes || []) {
    if (n.posX >= 3100 && n.posY <= -600 && n.posY >= -900) {
      await bp(ENEMY, { action: 'delete_node', graphName: EG, nodeName: n.id }, true);
      note(`del orphan ${titleOf(n)} @ ${n.posX},${n.posY}`);
    }
  }

  const sum = await bp(ENEMY, { action: 'read_graph_summary', graphName: EG });
  const capsule = (sum.nodes || []).find((n) =>
    /On Component Begin Overlap \(CapsuleComponent\)/i.test(n.title || '')
  );
  const lightBranch = (sum.execEdges || []).find((e) => e.from === capsule?.id)?.to;
  note(`capsule=${capsule?.id} lightBranch=${lightBranch}`);

  // Need long ids for enemy nodes
  g = await bp(ENEMY, { action: 'read_graph', graphName: EG });
  const capsuleLong = (g.nodes || []).find((n) =>
    /On Component Begin Overlap \(CapsuleComponent\)/i.test(n.title || '')
  );
  // Map short lightBranch to long via title order Branch
  const enemyLongs = {};
  for (const n of g.nodes || []) {
    const t = titleOf(n);
    (enemyLongs[t] = enemyLongs[t] || []).push(n.id);
  }
  const enemyShorts = {};
  for (const n of sum.nodes || []) {
    (enemyShorts[n.title] = enemyShorts[n.title] || []).push(n.id);
  }
  const es2l = {};
  for (const t of Object.keys(enemyShorts)) {
    if ((enemyLongs[t] || []).length === enemyShorts[t].length) {
      enemyShorts[t].forEach((s, i) => {
        es2l[s] = enemyLongs[t][i];
      });
    }
  }
  const lightBranchLong = es2l[lightBranch] || lightBranch;

  // Sequence approach: Capsule -> Sequence -> then_0 light, then_1 player check
  const seq = await addNode(ENEMY, EG, 'Sequence', {}, 2800, -400);
  await tryDisconnect(ENEMY, EG, capsuleLong.id, 'then', lightBranchLong, 'execute');
  ok = await tryConn(ENEMY, EG, capsuleLong.id, ['then'], seq, ['execute']);
  note(`capsule->seq: ${ok}`);
  ok = await tryConn(ENEMY, EG, seq, ['then_0', 'Then 0', '0'], lightBranchLong, ['execute']);
  note(`seq0->light: ${ok}`);

  // Player check on then_1
  const getPlayer = await addNode(
    ENEMY,
    EG,
    'CallFunction',
    { functionName: 'GetPlayerCharacter', targetClass: '/Script/Engine.GameplayStatics' },
    3100,
    -280
  );
  const eq = await addNode(
    ENEMY,
    EG,
    'CallFunction',
    { functionName: 'EqualEqual_ObjectObject', targetClass: '/Script/Engine.KismetMathLibrary' },
    3400,
    -350
  );
  const br = await addNode(ENEMY, EG, 'Branch', {}, 3700, -400);
  const print = await addNode(
    ENEMY,
    EG,
    'CallFunction',
    { functionName: 'PrintString', targetClass: '/Script/Engine.KismetSystemLibrary' },
    4000,
    -400
  );

  ok = await tryConn(ENEMY, EG, seq, ['then_1', 'Then 1', '1'], br, ['execute']);
  note(`seq1->branch: ${ok}`);
  // Other Actor from capsule event
  await tryConn(ENEMY, EG, capsuleLong.id, ['OtherActor', 'Other Actor'], eq, ['A']);
  await tryConn(ENEMY, EG, getPlayer, ['ReturnValue'], eq, ['B']);
  ok = await tryConn(ENEMY, EG, eq, ['ReturnValue'], br, ['Condition']);
  note(`eq->cond: ${ok}`);
  ok = await tryConn(ENEMY, EG, br, ['then'], print, ['execute']);
  note(`branch->print: ${ok}`);

  for (const args of [
    { propertyName: 'InString', value: 'u dead' },
    { propertyName: 'InString', pinName: 'InString', value: 'u dead' },
    { propertyName: 'bPrintToScreen', value: true },
  ]) {
    await bp(
      ENEMY,
      { action: 'set_node_property', graphName: EG, nodeName: print, ...args },
      true
    );
  }

  await bp(AIC, { action: 'compile' }, true);
  await bp(ENEMY, { action: 'compile' }, true);
  const v1 = await bp(AIC, { action: 'validate' }, true);
  const v2 = await bp(ENEMY, { action: 'validate' }, true);
  note(`AIC valid=${v1.valid} err=${v1.errorCount}`);
  note(`Enemy valid=${v2.valid} err=${v2.errorCount} msg=${JSON.stringify(v2.messages || []).slice(0, 400)}`);

  fs.writeFileSync('fix_chase_followup.out.json', JSON.stringify({ log, v1, v2 }, null, 2));
  console.log('DONE');
  mcp.kill();
})().catch((e) => {
  console.error('FAIL', e);
  mcp.kill();
  process.exit(1);
});
