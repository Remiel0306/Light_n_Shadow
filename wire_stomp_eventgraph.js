const { spawn } = require("child_process");
const fs = require("fs");

function mkMCP() {
  const mcp = spawn("npx.cmd", ["ue-mcp", "D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject"], { shell: true });
  let id = 1;
  const wait = new Map();
  let buf = "";
  mcp.stdout.on("data", (d) => {
    buf += d.toString();
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        const cb = wait.get(msg.id);
        if (cb) {
          wait.delete(msg.id);
          cb(msg);
        }
      } catch {}
    }
  });
  function rpc(method, params) {
    return new Promise((resolve, reject) => {
      const i = id++;
      const t = setTimeout(() => {
        wait.delete(i);
        reject(new Error(`timeout ${method}`));
      }, 120000);
      wait.set(i, (m) => {
        clearTimeout(t);
        resolve(m);
      });
      mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n");
    });
  }
  async function bp(args) {
    const r = await rpc("tools/call", { name: "blueprint", arguments: args });
    const t = r?.result?.content?.[0]?.text || "";
    try {
      return JSON.parse(t);
    } catch {
      return { raw: t };
    }
  }
  return { rpc, bp, kill: () => mcp.kill() };
}

const BP = "/Game/BluePrint/BP_ThirdPersonCharacter";
const EG = "EventGraph";
const BP_CLASS = "/Game/BluePrint/BP_ThirdPersonCharacter.BP_ThirdPersonCharacter_C";

const N = {
  stompInput: "hbcr8kwqJYG8rU2jYP5zkA",
  onShadowBranch: "f6GYpEiC8Kw2IM-jrlOPAg",
  getOnShadow: "mi07w0PvmQXnd9ykUySJIw",
  printOnShadow: "OYrUB0pLjAEVEdqiV9r17g",
  printNotOnShadow: "s5g9ck7Fbbpadf2cCYWy-g",
  beginOverlap: "BlB1M0TzA51JTg209cKV9A",
  setOnShadowTrue: "kzjCJEDZHJZHBNaxG1MD4w",
  endOverlap: "pajApE9XQlXZONKGmsXLaA",
  setOnShadowFalse: "jGFz9kivBeXmjoOKm-4b2g",
};

// Partial nodes from failed run — delete if present
const PARTIAL = [
  "88869DE346C00D30D352C387B8F1DAC2",
  "033E63EA49C7B19609383A9BDAAF764B",
  "338FBAB1419ED5DC2910AC955203AACC",
  "58A96BB247EF8F4F358486953257EC6E",
  "01C050A94FE734A49870A58BFBBC45F3",
];

async function call(bp, label, args, { optional = false } = {}) {
  const r = await bp(args);
  console.log(label, JSON.stringify(r));
  if ((r?.success === false || r?.error) && !optional) throw new Error(`${label} failed`);
  return r;
}

async function connect(bp, label, sourceNode, sourcePin, targetNode, targetPin) {
  return call(bp, label, {
    action: "connect_pins",
    path: BP,
    assetPath: BP,
    graphName: EG,
    sourceNode,
    sourcePin,
    targetNode,
    targetPin,
  });
}

(async () => {
  const { rpc, bp, kill } = mkMCP();
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "wire-stomp-eg", version: "2" },
  });

  await call(bp, "delete bad StompedShadow var", {
    action: "delete_variable",
    path: BP,
    assetPath: BP,
    name: "StompedShadow",
  }, { optional: true });

  for (const nid of PARTIAL) {
    await call(bp, `delete partial ${nid.slice(0, 8)}`, {
      action: "delete_node",
      path: BP,
      assetPath: BP,
      graphName: EG,
      nodeName: nid,
    }, { optional: true });
  }

  await call(bp, "add-var StompedShadow", {
    action: "add_variable",
    path: BP,
    assetPath: BP,
    name: "StompedShadow",
    type: "PrimitiveComponent",
    onConflict: "error",
  });

  const setStompedBegin = await call(bp, "add Set StompedShadow begin", {
    action: "add_node",
    path: BP,
    assetPath: BP,
    graphName: EG,
    nodeClass: "SetVar",
    nodeParams: { variableName: "StompedShadow" },
    posX: 4200,
    posY: 2100,
  });

  const setStompedEnd = await call(bp, "add Set StompedShadow end", {
    action: "add_node",
    path: BP,
    assetPath: BP,
    graphName: EG,
    nodeClass: "SetVar",
    nodeParams: { variableName: "StompedShadow" },
    posX: 4200,
    posY: 2400,
  });

  const getStomped = await call(bp, "add Get StompedShadow", {
    action: "add_node",
    path: BP,
    assetPath: BP,
    graphName: EG,
    nodeClass: "GetVar",
    nodeParams: { variableName: "StompedShadow" },
    posX: 5000,
    posY: 2050,
  });

  const callShadowsConnect = await call(bp, "add Call Shadows Connect", {
    action: "add_node",
    path: BP,
    assetPath: BP,
    graphName: EG,
    nodeClass: "CallFunction",
    nodeParams: { functionName: "Shadows Connect", targetClass: BP_CLASS },
    posX: 5400,
    posY: 2000,
  });

  const printDone = await call(bp, "add Print Done", {
    action: "add_node",
    path: BP,
    assetPath: BP,
    graphName: EG,
    nodeClass: "CallFunction",
    nodeParams: { functionName: "PrintString", targetClass: "/Script/Engine.KismetSystemLibrary" },
    posX: 5800,
    posY: 2000,
  });

  await call(bp, "set Print Done text", {
    action: "set_node_property",
    path: BP,
    assetPath: BP,
    graphName: EG,
    nodeName: printDone.nodeId,
    propertyName: "InString",
    value: "SC Done (check log)",
  });

  const foreachEnemies = await call(bp, "add ForEach enemies", {
    action: "add_node",
    path: BP,
    assetPath: BP,
    graphName: EG,
    nodeClass: "K2Node_MacroInstance",
    nodeParams: { macroName: "ForEachLoop" },
    posX: 6200,
    posY: 2000,
  });

  const getDisplayName = await call(bp, "add GetDisplayName", {
    action: "add_node",
    path: BP,
    assetPath: BP,
    graphName: EG,
    nodeClass: "CallFunction",
    nodeParams: { functionName: "GetDisplayName", targetClass: "/Script/Engine.KismetSystemLibrary" },
    posX: 6500,
    posY: 2150,
  });

  const appendEnemy = await call(bp, "add Append", {
    action: "add_node",
    path: BP,
    assetPath: BP,
    graphName: EG,
    nodeClass: "CallFunction",
    nodeParams: { functionName: "Concat_StrStr", targetClass: "/Script/Engine.KismetStringLibrary" },
    posX: 6550,
    posY: 2100,
  });

  await call(bp, "set append A", {
    action: "set_node_property",
    path: BP,
    assetPath: BP,
    graphName: EG,
    nodeName: appendEnemy.nodeId,
    propertyName: "A",
    value: "SC Stomp -> ",
  });

  const printEnemy = await call(bp, "add Print enemy", {
    action: "add_node",
    path: BP,
    assetPath: BP,
    graphName: EG,
    nodeClass: "CallFunction",
    nodeParams: { functionName: "PrintString", targetClass: "/Script/Engine.KismetSystemLibrary" },
    posX: 6800,
    posY: 2000,
  });

  const getPlayerPawn = await call(bp, "add GetPlayerPawn", {
    action: "add_node",
    path: BP,
    assetPath: BP,
    graphName: EG,
    nodeClass: "CallFunction",
    nodeParams: { functionName: "GetPlayerPawn", targetClass: "/Script/Engine.GameplayStatics" },
    posX: 7000,
    posY: 2150,
  });

  for (const [nid, text] of [
    [N.printOnShadow, "STOMP: On Shadow"],
    [N.printNotOnShadow, "STOMP: Not On Shadow"],
  ]) {
    await call(bp, `set print ${text}`, {
      action: "set_node_property",
      path: BP,
      assetPath: BP,
      graphName: EG,
      nodeName: nid,
      propertyName: "InString",
      value: text,
    });
  }

  // Overlap detection: save OtherComp + isOnShadow
  await connect(bp, "setOnTrue->setStomped", N.setOnShadowTrue, "then", setStompedBegin.nodeId, "execute");
  await connect(bp, "otherComp->stomped", N.beginOverlap, "OtherComp", setStompedBegin.nodeId, "StompedShadow");
  await connect(bp, "setFalse->clearStomped", N.setOnShadowFalse, "then", setStompedEnd.nodeId, "execute");

  // Stomp input chain
  await connect(bp, "stomp->branch", N.stompInput, "Started", N.onShadowBranch, "execute");
  await connect(bp, "getOnShadow->cond", N.getOnShadow, "isOnShadow?", N.onShadowBranch, "Condition");
  await connect(bp, "branchTrue->printOn", N.onShadowBranch, "then", N.printOnShadow, "execute");
  await connect(bp, "branchFalse->printOff", N.onShadowBranch, "else", N.printNotOnShadow, "execute");
  await connect(bp, "printOn->callSC", N.printOnShadow, "then", callShadowsConnect.nodeId, "execute");
  await connect(bp, "getStomped->startShadow", getStomped.nodeId, "StompedShadow", callShadowsConnect.nodeId, "Start Shadow");
  await connect(bp, "callSC->printDone", callShadowsConnect.nodeId, "then", printDone.nodeId, "execute");
  await connect(bp, "printDone->foreach", printDone.nodeId, "then", foreachEnemies.nodeId, "Exec");
  await connect(
    bp,
    "connected->foreach",
    callShadowsConnect.nodeId,
    "Connected Enemies",
    foreachEnemies.nodeId,
    "Array"
  );
  await connect(bp, "foreachBody->printEnemy", foreachEnemies.nodeId, "LoopBody", printEnemy.nodeId, "execute");
  await connect(bp, "elem->displayName", foreachEnemies.nodeId, "Array Element", getDisplayName.nodeId, "Object");
  await connect(bp, "name->appendB", getDisplayName.nodeId, "ReturnValue", appendEnemy.nodeId, "B");
  await connect(bp, "append->printStr", appendEnemy.nodeId, "ReturnValue", printEnemy.nodeId, "InString");

  const val = await call(bp, "validate", { action: "validate", path: BP, assetPath: BP });
  const sum = await call(bp, "summary EG", { action: "read_graph_summary", path: BP, assetPath: BP, graphName: EG });
  const hasCall = (sum.nodes || []).some((n) => /shadows connect/i.test(n.title || ""));
  const stompWired = (sum.execEdges || []).some((e) => e.from === N.stompInput && e.fromPin === "Started");

  console.log("FINAL validate errors/warnings:", val.errorCount, val.warningCount);
  console.log("FINAL has Shadows Connect:", hasCall);
  console.log("FINAL stomp Started wired:", stompWired);

  fs.writeFileSync(
    "D:/Unreal Engine/Light_n_Shadow/_stomp_wire_result.json",
    JSON.stringify({ hasCall, stompWired, validate: val }, null, 2)
  );
  kill();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
