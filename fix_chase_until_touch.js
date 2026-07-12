/**
 * Fix chase: once seen, only chase until touch; gate Wander; print u dead on player overlap.
 * Requires Unreal Editor + UE_MCP_Bridge.
 */
const fs = require('fs');
const { spawn } = require('child_process');

const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const AIC = '/Game/BluePrint/System/BP_EnemyAIController';
const AIC_CLASS = '/Game/BluePrint/System/BP_EnemyAIController.BP_EnemyAIController_C';
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
  const txt = res?.result?.content?.[0]?.text;
  try {
    return JSON.parse(txt);
  } catch {
    return { success: false, raw: txt };
  }
}

async function bp(path, args, soft = false) {
  const res = await rpc('tools/call', {
    name: 'blueprint',
    arguments: { path, assetPath: path, ...args },
  });
  const p = parseTool(res);
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
  // Some MCP builds lack disconnect_pins; try then fall back to delete target.
  const r = await bp(
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
  );
  return r.success !== false;
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
  if (!r.nodeId) throw new Error(`add_node failed: ${JSON.stringify(r).slice(0, 200)}`);
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
    clientInfo: { name: 'fix_chase_until_touch' },
  });

  // ---------- AIC ----------
  let g = await bp(AIC, { action: 'read_graph', graphName: EG });
  let nodes = g.nodes || [];
  const byTitle = {};
  for (const n of nodes) {
    const t = titleOf(n);
    (byTitle[t] = byTitle[t] || []).push(n);
  }

  const wanderEvent = byTitle['Wander']?.find((n) => n.class === 'K2Node_CustomEvent');
  if (!wanderEvent) throw new Error('Wander custom event not found');

  const wanderMoveTo = byTitle['AI MoveTo']?.find(
    (n) => (n.pins || []).find((p) => p.name === 'Destination')?.connected
  );
  const chaseMoveTo = byTitle['AI MoveTo']?.find(
    (n) => (n.pins || []).find((p) => p.name === 'TargetActor')?.connected
  );
  const delay02 = byTitle['Delay']?.find(
    (n) => (n.pins || []).find((p) => p.name === 'Duration')?.defaultValue === '0.2'
  );
  const delay05 = byTitle['Delay']?.find((n) => {
    const v = (n.pins || []).find((p) => p.name === 'Duration')?.defaultValue;
    return v === '0.500000' || v === '0.5';
  });

  const setChaseFalseOnSuccess = byTitle['Set isChasing']?.find(
    (n) =>
      n.posX > 2000 &&
      n.posY > 1700 &&
      (n.pins || []).find((p) => p.name === 'isChasing')?.defaultValue === 'false'
  );
  const setChaseFalseLost = byTitle['Set isChasing']?.find(
    (n) =>
      Math.abs(n.posX - 912) < 50 &&
      Math.abs(n.posY - 2080) < 50 &&
      (n.pins || []).find((p) => p.name === 'isChasing')?.defaultValue === 'false'
  );
  const setChaseTrueSense = byTitle['Set isChasing']?.find(
    (n) =>
      Math.abs(n.posX - 912) < 50 &&
      Math.abs(n.posY - 1792) < 50 &&
      (n.pins || []).find((p) => p.name === 'isChasing')?.defaultValue === 'true'
  );

  note(`wanderEvent=${wanderEvent.id}`);
  note(`wanderMoveTo=${wanderMoveTo?.id}`);
  note(`chaseMoveTo=${chaseMoveTo?.id}`);
  note(`delay02=${delay02?.id} delay05=${delay05?.id}`);
  note(`setFalseSuccess=${setChaseFalseOnSuccess?.id}`);
  note(`setFalseLost=${setChaseFalseLost?.id}`);
  note(`setTrueSense=${setChaseTrueSense?.id}`);

  // Find first branch after Wander event via summary edges
  const sum = await bp(AIC, { action: 'read_graph_summary', graphName: EG });
  // Map short->long by title order
  const longs = {};
  for (const n of nodes) {
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

  // Find Wander custom event short id
  const wanderShort = (sum.nodes || []).find((n) => n.title === 'Wander' && n.class === 'K2Node_CustomEvent')?.id
    || (sum.nodes || []).find((n) => n.title === 'Wander' && (sum.execEdges || []).some((e) => e.from === n.id))?.id;

  // Actually summary may collapse title - find edge from first Wander that is custom event
  // Use long id wanderEvent and find who it connects to from read pins
  const wanderThenPin = (wanderEvent.pins || []).find((p) => p.name === 'then');
  // connected flag true but no link list in this dump - use summary
  const wanderOut = (sum.execEdges || []).find((e) => s2l[e.from] === wanderEvent.id || e.from === wanderEvent.id);
  let firstBranchId = wanderOut ? s2l[wanderOut.to] || wanderOut.to : null;
  // Fallback: known pattern Branch at ~0,384 area
  if (!firstBranchId) {
    firstBranchId = byTitle['Branch']?.find((n) => n.posY > 300 && n.posY < 500 && n.posX < 400)?.id;
  }
  note(`firstBranch after Wander = ${firstBranchId}`);

  // Clean leftover nodes from a previous partial run (our gates sit left of Wander)
  for (const n of nodes) {
    const t = titleOf(n);
    if (
      (t === 'Branch' && n.posX < 0 && n.posY > 300 && n.posY < 500) ||
      (t === 'Branch' && n.posX >= 1350 && n.posX <= 1450 && (n.posY === 400 || n.posY === 560)) ||
      (t === 'Get isChasing' && n.posX < 0)
    ) {
      await bp(AIC, { action: 'delete_node', graphName: EG, nodeName: n.id }, true);
      note(`cleaned leftover ${t} ${n.id}`);
    }
  }
  g = await bp(AIC, { action: 'read_graph', graphName: EG });
  nodes = g.nodes || [];

  // ===== 1) Gate Wander start: if isChasing -> stop =====
  const chaseGate = await addNode(AIC, EG, 'Branch', {}, -200, 384);
  const getChase1 = await addNode(AIC, EG, 'GetVar', { variableName: 'isChasing' }, -400, 450);
  // Disconnect Wander -> firstBranch, reconnect Wander -> chaseGate else -> firstBranch
  if (firstBranchId) {
    await tryDisconnect(AIC, EG, wanderEvent.id, 'then', firstBranchId, 'execute');
    // If disconnect unsupported, delete won't work for edge - try connect anyway (may create double)
    await tryConn(AIC, EG, wanderEvent.id, ['then'], chaseGate, ['execute']);
    await tryConn(AIC, EG, getChase1, ['isChasing', 'ReturnValue'], chaseGate, ['Condition']);
    // True (chasing): do nothing. False: continue original wander.
    const ok = await tryConn(AIC, EG, chaseGate, ['else'], firstBranchId, ['execute']);
    note(`wander isChasing gate: else->firstBranch ${ok}`);
  }

  // ===== 2) Gate Wander MoveTo OnSuccess/OnFail before Delay =====
  async function gateBeforeDelay(moveToId, pinName, delayId, label) {
    if (!moveToId || !delayId) {
      note(`skip ${label}: missing nodes`);
      return;
    }
    const br = await addNode(AIC, EG, 'Branch', {}, 1400, pinName === 'OnSuccess' ? 400 : 560);
    const getC = await addNode(
      AIC,
      EG,
      'GetVar',
      { variableName: 'isChasing' },
      1200,
      pinName === 'OnSuccess' ? 460 : 620
    );
    await tryDisconnect(AIC, EG, moveToId, pinName, delayId, 'execute');
    await tryConn(AIC, EG, moveToId, [pinName], br, ['execute']);
    await tryConn(AIC, EG, getC, ['isChasing', 'ReturnValue'], br, ['Condition']);
    // if chasing: do NOT restart wander. if not chasing: Delay as before.
    const ok = await tryConn(AIC, EG, br, ['else'], delayId, ['execute']);
    note(`${label} gate ${ok}`);
  }
  await gateBeforeDelay(wanderMoveTo?.id, 'OnSuccess', delay02?.id, 'wander OnSuccess');
  await gateBeforeDelay(wanderMoveTo?.id, 'OnFail', delay05?.id, 'wander OnFail');

  // ===== 3) Lost sight: do NOT clear chase / return to Wander =====
  // Delete the Wander call after lost-sight branch, and change Set isChasing false -> true
  // so even if path runs it keeps chasing.
  if (setChaseFalseLost) {
    await bp(
      AIC,
      {
        action: 'set_node_property',
        graphName: EG,
        nodeName: setChaseFalseLost.id,
        propertyName: 'isChasing',
        value: true,
      },
      true
    );
    // Also try pin default
    await bp(
      AIC,
      {
        action: 'set_node_property',
        graphName: EG,
        nodeName: setChaseFalseLost.id,
        propertyName: 'isChasing',
        pinName: 'isChasing',
        value: 'true',
      },
      true
    );
    note('lost-sight Set isChasing forced true (ignore lose sight)');
  }

  // Delete wander call nodes that are NOT the custom event - specifically ones at lost-sight / check-sight
  // Keep custom event. Delete call nodes that reconnect wander from chase-lost paths.
  g = await bp(AIC, { action: 'read_graph', graphName: EG });
  nodes = g.nodes || [];
  const wanderCalls = nodes.filter(
    (n) => titleOf(n) === 'Wander' && n.class === 'K2Node_CallFunction' && n.posY > 1000
  );
  for (const n of wanderCalls) {
    await bp(AIC, { action: 'delete_node', graphName: EG, nodeName: n.id }, true);
    note(`deleted wander call ${n.id} @ ${n.posX},${n.posY}`);
  }

  // ===== 4) Chase OnSuccess: keep chasing (retry MoveTo), don't clear isChasing =====
  if (chaseMoveTo && setChaseFalseOnSuccess) {
    await tryDisconnect(AIC, EG, chaseMoveTo.id, 'OnSuccess', setChaseFalseOnSuccess.id, 'execute');
    // Re-issue same MoveTo by calling a small delay then execute chase move again is hard;
    // simpler: connect OnSuccess back to Set MaxWalkSpeed / re-enter chase chain.
    // Easiest reliable: OnSuccess -> Chase MoveTo execute again (self loop).
    const ok = await tryConn(AIC, EG, chaseMoveTo.id, ['OnSuccess'], chaseMoveTo.id, ['execute']);
    note(`chase OnSuccess -> retry MoveTo: ${ok}`);
    // Also force the old set-false node to true in case still linked somehow
    await bp(
      AIC,
      {
        action: 'set_node_property',
        graphName: EG,
        nodeName: setChaseFalseOnSuccess.id,
        propertyName: 'isChasing',
        value: true,
      },
      true
    );
  }

  // ===== 5) Chase OnFail: retry MoveTo =====
  if (chaseMoveTo) {
    const ok = await tryConn(AIC, EG, chaseMoveTo.id, ['OnFail'], chaseMoveTo.id, ['execute']);
    note(`chase OnFail -> retry MoveTo: ${ok}`);
  }

  // ===== 6) Perception first-see only: if already chasing, skip re-MoveTo =====
  // Insert before setChaseTrueSense: Branch isChasing, True=skip, False=continue set+move
  if (setChaseTrueSense) {
    // Find who executes into setChaseTrueSense
    const sum2 = await bp(AIC, { action: 'read_graph_summary', graphName: EG });
    // rebuild map
    g = await bp(AIC, { action: 'read_graph', graphName: EG });
    nodes = g.nodes || [];
    const longs2 = {};
    for (const n of nodes) {
      const t = titleOf(n);
      (longs2[t] = longs2[t] || []).push(n.id);
    }
    const shorts2 = {};
    for (const n of sum2.nodes || []) {
      (shorts2[n.title] = shorts2[n.title] || []).push(n.id);
    }
    const s2l2 = {};
    for (const t of Object.keys(shorts2)) {
      if ((longs2[t] || []).length === shorts2[t].length) {
        shorts2[t].forEach((s, i) => {
          s2l2[s] = longs2[t][i];
        });
      }
    }
    const into = (sum2.execEdges || []).find((e) => (s2l2[e.to] || e.to) === setChaseTrueSense.id);
    if (into) {
      const fromId = s2l2[into.from] || into.from;
      const already = await addNode(AIC, EG, 'Branch', {}, 700, 1792);
      const getC = await addNode(AIC, EG, 'GetVar', { variableName: 'isChasing' }, 500, 1860);
      await tryDisconnect(AIC, EG, fromId, into.fromPin, setChaseTrueSense.id, 'execute');
      await tryConn(AIC, EG, fromId, [into.fromPin, 'then'], already, ['execute']);
      await tryConn(AIC, EG, getC, ['isChasing', 'ReturnValue'], already, ['Condition']);
      // False = not yet chasing -> start chase chain
      const ok = await tryConn(AIC, EG, already, ['else'], setChaseTrueSense.id, ['execute']);
      note(`first-see-only gate: ${ok} from ${fromId}`);
    } else {
      note('could not find edge into Set isChasing true (sense)');
    }
  }

  // ===== 7) Stop Movement when starting chase (after set true) =====
  // Insert StopMovement between setChaseTrueSense and next node if possible - optional.
  // Skip if complex; gates above should be enough.

  await bp(AIC, { action: 'compile' }, true);

  // ---------- ENEMY: ActorBeginOverlap -> if player -> Print "u dead" ----------
  const egEnemy = await bp(ENEMY, { action: 'read_graph', graphName: EG });
  // Place far from shadow graph
  const overlapEv = await addNode(ENEMY, EG, 'K2Node_Event', { eventName: 'ReceiveActorBeginOverlap' }, 3200, -800);
  const getPlayer = await addNode(
    ENEMY,
    EG,
    'CallFunction',
    { functionName: 'GetPlayerCharacter', targetClass: '/Script/Engine.GameplayStatics' },
    3500,
    -700
  );
  const eq = await addNode(
    ENEMY,
    EG,
    'CallFunction',
    { functionName: 'EqualEqual_ObjectObject', targetClass: '/Script/Engine.KismetMathLibrary' },
    3800,
    -760
  );
  // Try alternate Equal
  let eqId = eq;
  const br = await addNode(ENEMY, EG, 'Branch', {}, 4100, -800);
  const print = await addNode(
    ENEMY,
    EG,
    'CallFunction',
    { functionName: 'PrintString', targetClass: '/Script/Engine.KismetSystemLibrary' },
    4400,
    -800
  );

  await tryConn(ENEMY, EG, overlapEv, ['then'], br, ['execute']);
  // Wire Other Actor == Player
  // Event has OtherActor pin
  await tryConn(ENEMY, EG, overlapEv, ['OtherActor', 'Other'], eqId, ['A', 'self']);
  await tryConn(ENEMY, EG, getPlayer, ['ReturnValue'], eqId, ['B', 'A']);
  let condOk = await tryConn(ENEMY, EG, eqId, ['ReturnValue'], br, ['Condition']);
  if (!condOk) {
    // recreate Equal (Object)
    const eq2 = await addNode(ENEMY, EG, 'CallFunction', { functionName: 'EqualEqual_ObjectObject' }, 3800, -760);
    eqId = eq2;
    await tryConn(ENEMY, EG, overlapEv, ['OtherActor', 'Other'], eqId, ['A']);
    await tryConn(ENEMY, EG, getPlayer, ['ReturnValue'], eqId, ['B']);
    condOk = await tryConn(ENEMY, EG, eqId, ['ReturnValue'], br, ['Condition']);
  }
  await tryConn(ENEMY, EG, br, ['then'], print, ['execute']);
  await bp(
    ENEMY,
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
    ENEMY,
    {
      action: 'set_node_property',
      graphName: EG,
      nodeName: print,
      propertyName: 'InString',
      pinName: 'InString',
      value: 'u dead',
    },
    true
  );
  note(`player overlap print: cond=${condOk}`);

  await bp(ENEMY, { action: 'compile' }, true);

  // Validate
  const v1 = await bp(AIC, { action: 'validate' }, true);
  const v2 = await bp(ENEMY, { action: 'validate' }, true);
  note(`validate AIC: ${JSON.stringify(v1).slice(0, 300)}`);
  note(`validate Enemy: ${JSON.stringify(v2).slice(0, 300)}`);

  fs.writeFileSync('fix_chase_until_touch.out.json', JSON.stringify({ log, v1, v2 }, null, 2));
  console.log('DONE');
  mcp.kill();
})().catch((e) => {
  console.error('FAIL', e);
  mcp.kill();
  process.exit(1);
});
