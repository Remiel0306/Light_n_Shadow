/**
 * Finish EventGraph stomp wiring using member var Current (object) for shadow primitive.
 * MCP add_variable type is broken (always float) — do not use StompedShadow.
 */
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
    for (const l of lines) {
      if (!l.trim()) continue;
      try {
        const m = JSON.parse(l);
        const cb = wait.get(m.id);
        if (cb) {
          wait.delete(m.id);
          cb(m);
        }
      } catch {}
    }
  });
  return {
    rpc(method, params) {
      return new Promise((resolve, reject) => {
        const i = id++;
        const t = setTimeout(() => reject(new Error(`timeout ${method}`)), 120000);
        wait.set(i, (m) => {
          clearTimeout(t);
          resolve(m);
        });
        mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n");
      });
    },
    kill: () => mcp.kill(),
  };
}

const BP = "/Game/BluePrint/BP_ThirdPersonCharacter";
const EG = "EventGraph";
const SC = "Shadows Connect";
const BP_CLASS = "/Game/BluePrint/BP_ThirdPersonCharacter.BP_ThirdPersonCharacter_C";
const BPI = "/Game/BluePrint/BPI_ShadowLink.BPI_ShadowLink_C";

const N = {
  stompInput: "hbcr8kwqJYG8rU2jYP5zkA",
  onShadowBranch: "f6GYpEiC8Kw2IM-jrlOPAg",
  getOnShadow: "mi07w0PvmQXnd9ykUySJIw",
  printOnShadow: "OYrUB0pLjAEVEdqiV9r17g",
  printNotOnShadow: "s5g9ck7Fbbpadf2cCYWy-g",
  beginOverlap: "BlB1M0TzA51JTg209cKV9A",
  setOnShadowTrue: "kzjCJEDZHJZHBNaxG1MD4w",
  setOnShadowFalse: "jGFz9kivBeXmjoOKm-4b2g",
};

const DELETE_NODES = [
  "BF083040426E0BCEACB08B9984E840D1",
  "4FD7539B498F0BD84C6981A49680836B",
  "255C506F4039D12DFBFB5ABF448B9A04",
  "9976CA59476D9FB05BEB0F88E74D269E",
  "F5DF752148787D22D75C46ACCCB23F71",
  "108A39EF4B298AD59A654FA06041D9CE",
  "F281B1E94896972A45FA8699FA7CFF8D",
  "B2477AB74F32B4A65B36F1AE62A3ED2F",
];

const EG_FOREACH = "dRQMNkn8f3_J6daDILX9zg";

async function bp(rpc, args, { soft = false } = {}) {
  const r = await rpc("tools/call", { name: "blueprint", arguments: args });
  const raw = r?.result?.content?.[0]?.text || "";
  let body = {};
  try {
    body = JSON.parse(raw);
  } catch {
    if (!soft) throw new Error(`${args.action}: ${raw.slice(0, 200)}`);
    return { raw };
  }
  if ((body.success === false || body.error) && !soft) throw new Error(`${args.action}: ${body.error || "failed"}`);
  return body;
}

async function connectSoft(rpc, label, sn, sp, tn, tp) {
  try {
    await connect(rpc, label, sn, sp, tn, tp);
  } catch (e) {
    if (/existed|already/i.test(String(e.message))) return;
    console.warn("connect skip:", label, e.message);
  }
}

async function connect(rpc, label, sn, sp, tn, tp) {
  return bp(rpc, {
    action: "connect_pins",
    path: BP,
    assetPath: BP,
    graphName: EG,
    sourceNode: sn,
    sourcePin: sp,
    targetNode: tn,
    targetPin: tp,
  });
}

(async () => {
  const { rpc, kill } = mkMCP();
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "finalize", version: "1" } });

  await bp(rpc, { action: "delete_variable", path: BP, assetPath: BP, name: "StompedShadow" }, { soft: true });
  for (const nid of DELETE_NODES) {
    await bp(rpc, { action: "delete_node", path: BP, assetPath: BP, graphName: EG, nodeName: nid }, { soft: true });
  }

  const setCurrentBegin = await bp(rpc, {
    action: "add_node",
    path: BP,
    assetPath: BP,
    graphName: EG,
    nodeClass: "SetVar",
    nodeParams: { variableName: "Current" },
    posX: 4300,
    posY: 2100,
  });

  const getCurrent = await bp(rpc, {
    action: "add_node",
    path: BP,
    assetPath: BP,
    graphName: EG,
    nodeClass: "GetVar",
    nodeParams: { variableName: "Current" },
    posX: 5100,
    posY: 2050,
  });

  let callSC = await bp(rpc, {
    action: "add_node",
    path: BP,
    assetPath: BP,
    graphName: EG,
    nodeClass: "CallFunction",
    nodeParams: { functionName: "Shadows Connect", targetClass: BP_CLASS },
    posX: 5400,
    posY: 2000,
  }, { soft: true });
  if (!callSC.nodeId) {
    const g = await bp(rpc, { action: "read_blueprint_graph", path: BP, assetPath: BP, graphName: EG });
    const found = (g.nodes || []).find((n) => /shadows connect/i.test(n.title || ""));
    if (!found) throw new Error("Shadows Connect call node missing");
    callSC = { nodeId: found.id };
  }

  const printDone = await bp(rpc, {
    action: "add_node",
    path: BP,
    assetPath: BP,
    graphName: EG,
    nodeClass: "CallFunction",
    nodeParams: { functionName: "PrintString", targetClass: "/Script/Engine.KismetSystemLibrary" },
    posX: 5800,
    posY: 2000,
  });

  await bp(rpc, {
    action: "set_node_property",
    path: BP,
    assetPath: BP,
    graphName: EG,
    nodeName: printDone.nodeId,
    propertyName: "InString",
    value: "SC Done",
  });

  const lenArr = await bp(rpc, {
    action: "add_node",
    path: BP,
    assetPath: BP,
    graphName: EG,
    nodeClass: "CallFunction",
    nodeParams: { functionName: "Array_Length", targetClass: "/Script/Engine.KismetArrayLibrary" },
    posX: 6000,
    posY: 2150,
  });

  const convInt = await bp(rpc, {
    action: "add_node",
    path: BP,
    assetPath: BP,
    graphName: EG,
    nodeClass: "CallFunction",
    nodeParams: { functionName: "Conv_IntToString", targetClass: "/Script/Engine.KismetStringLibrary" },
    posX: 6150,
    posY: 2150,
  });

  const appendCount = await bp(rpc, {
    action: "add_node",
    path: BP,
    assetPath: BP,
    graphName: EG,
    nodeClass: "CallFunction",
    nodeParams: { functionName: "Concat_StrStr", targetClass: "/Script/Engine.KismetStringLibrary" },
    posX: 6200,
    posY: 2100,
  });

  const printCount = await bp(rpc, {
    action: "add_node",
    path: BP,
    assetPath: BP,
    graphName: EG,
    nodeClass: "CallFunction",
    nodeParams: { functionName: "PrintString", targetClass: "/Script/Engine.KismetSystemLibrary" },
    posX: 6400,
    posY: 2000,
  });

  await bp(rpc, {
    action: "set_node_property",
    path: BP,
    assetPath: BP,
    graphName: EG,
    nodeName: appendCount.nodeId,
    propertyName: "A",
    value: "SC Enemy Count: ",
  });

  const getPawn = await bp(rpc, {
    action: "add_node",
    path: BP,
    assetPath: BP,
    graphName: EG,
    nodeClass: "CallFunction",
    nodeParams: { functionName: "GetPlayerPawn", targetClass: "/Script/Engine.GameplayStatics" },
    posX: 7000,
    posY: 2200,
  });

  // Clone For Each macro from existing EventGraph ball loop (duplicatable macro instance)
  let foreachId = null;
  const ex = await bp(rpc, {
    action: "export_nodes_t3d",
    path: BP,
    assetPath: BP,
    graphName: EG,
    nodeIds: [EG_FOREACH],
  }, { soft: true });
  if (ex.t3d && ex.t3d.length > 20) {
    const imp = await bp(rpc, {
      action: "import_nodes_t3d",
      path: BP,
      assetPath: BP,
      graphName: EG,
      t3d: ex.t3d,
      posX: 6600,
      posY: 2000,
    });
    foreachId = imp.nodeIds?.[0];
  }
  if (!foreachId) {
    console.log("ForEach T3D clone skipped; enemy loop omitted");
  }

  // ApplyShadowStomp: wire in editor via BPI message if C++ module is loaded.

  for (const [nid, text] of [
    [N.printOnShadow, "STOMP: On Shadow"],
    [N.printNotOnShadow, "STOMP: Not On Shadow"],
  ]) {
    await bp(rpc, {
      action: "set_node_property",
      path: BP,
      assetPath: BP,
      graphName: EG,
      nodeName: nid,
      propertyName: "InString",
      value: text,
    });
  }

  // Overlap: remember shadow primitive in Current
  await connectSoft(rpc, "setOn->setCurrent", N.setOnShadowTrue, "then", setCurrentBegin.nodeId, "execute");
  await connectSoft(rpc, "other->current", N.beginOverlap, "OtherComp", setCurrentBegin.nodeId, "Current");

  // Stomp chain
  await connectSoft(rpc, "stomp->branch", N.stompInput, "Started", N.onShadowBranch, "execute");
  await connectSoft(rpc, "getFlag->cond", N.getOnShadow, "isOnShadow?", N.onShadowBranch, "Condition");
  await connectSoft(rpc, "true->printOn", N.onShadowBranch, "then", N.printOnShadow, "execute");
  await connectSoft(rpc, "false->printOff", N.onShadowBranch, "else", N.printNotOnShadow, "execute");
  await connectSoft(rpc, "printOn->callSC", N.printOnShadow, "then", callSC.nodeId, "execute");
  await connectSoft(rpc, "getCurrent->start", getCurrent.nodeId, "Current", callSC.nodeId, "Start Shadow");
  await connectSoft(rpc, "sc->printDone", callSC.nodeId, "then", printDone.nodeId, "execute");
  await connectSoft(rpc, "scOut->len", callSC.nodeId, "Connected Enemies", lenArr.nodeId, "TargetArray");
  await connectSoft(rpc, "len->conv", lenArr.nodeId, "ReturnValue", convInt.nodeId, "InInt");
  await connectSoft(rpc, "conv->appendB", convInt.nodeId, "ReturnValue", appendCount.nodeId, "B");
  await connectSoft(rpc, "append->printCount", appendCount.nodeId, "ReturnValue", printCount.nodeId, "InString");
  await connectSoft(rpc, "printDone->printCount", printDone.nodeId, "then", printCount.nodeId, "execute");
  if (foreachId) {
    await connectSoft(rpc, "printCount->foreach", printCount.nodeId, "then", foreachId, "Exec");
    await connectSoft(rpc, "scOut->foreachArr", callSC.nodeId, "Connected Enemies", foreachId, "Array");
  }

  await bp(rpc, { action: "compile_blueprint", path: BP, assetPath: BP }, { soft: true });

  const val = await bp(rpc, { action: "validate", path: BP, assetPath: BP }, { soft: true });
  const out = {
    ok: true,
    validate: val,
    foreachId,
    callSC: callSC.nodeId,
    setCurrent: setCurrentBegin.nodeId,
    getCurrent: getCurrent.nodeId,
  };
  fs.writeFileSync("D:/Unreal Engine/Light_n_Shadow/_stomp_wire_result.json", JSON.stringify(out, null, 2));
  console.log("DONE", JSON.stringify(out, null, 2));
  kill();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
