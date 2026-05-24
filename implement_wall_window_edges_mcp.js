/**
 * BP_WallShadowLogic: window edge lengths (A-B, B-C, C-D, D-A) for shadow colliders.
 * Requires Unreal Editor open with project loaded.
 */
const { spawn } = require("child_process");

const PROJECT = "D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject";
const BP = "/Game/BluePrint/BP_WallShadowLogic";
const FUNC_INIT = "ComputeWindowEdgeLengths";
const FUNC_APPLY = "ApplyShadowAlongEdge";

const mcp = spawn("npx.cmd", ["ue-mcp", PROJECT], { shell: true });
let reqId = 1;
const pending = new Map();

function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const id = reqId++;
    const t = setTimeout(() => {
      pending.delete(id);
      reject(new Error("timeout " + method));
    }, 180000);
    pending.set(id, (m) => {
      clearTimeout(t);
      resolve(m);
    });
    mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

function payload(res) {
  const txt = res?.result?.content?.[0]?.text;
  try {
    return JSON.parse(txt);
  } catch {
    return { success: false, error: txt || "parse failed" };
  }
}

async function bp(args) {
  const res = await rpc("tools/call", { name: "blueprint", arguments: args });
  const p = payload(res);
  if (p.success === false && p.error) throw new Error(p.error);
  return p;
}

async function add(graphName, nodeClass, nodeParams, posX, posY) {
  const n = await bp({
    action: "add_node",
    path: BP,
    assetPath: BP,
    graphName,
    nodeClass,
    nodeParams: nodeParams || {},
    posX,
    posY,
  });
  if (!n.nodeId) throw new Error("add_node failed: " + JSON.stringify(n));
  return n.nodeId;
}

async function connect(graphName, a, aps, b, bps) {
  let last;
  for (const ap of aps) {
    for (const bpPin of bps) {
      try {
        const r = await bp({
          action: "connect_pins",
          path: BP,
          assetPath: BP,
          graphName,
          sourceNode: a,
          sourcePin: ap,
          targetNode: b,
          targetPin: bpPin,
        });
        if (r.success !== false) return;
      } catch (e) {
        last = e;
      }
    }
  }
  throw last || new Error(`connect failed ${a} -> ${b}`);
}

async function setPin(graphName, nodeId, pin, value) {
  try {
    await bp({
      action: "set_node_property",
      path: BP,
      assetPath: BP,
      graphName,
      nodeId,
      pinName: pin,
      defaultValue: String(value),
    });
  } catch {
    await bp({
      action: "set_node_property",
      path: BP,
      assetPath: BP,
      graphName,
      nodeId,
      propertyName: pin,
      value: String(value),
    });
  }
}

async function ensureVar(name, variableType, isArray = false) {
  const lv = await bp({ action: "list_variables", path: BP, assetPath: BP });
  const vars = lv.variables || [];
  if (vars.some((v) => v.name === name)) {
    console.log("var exists:", name);
    return;
  }
  const r = await bp({
    action: "add_variable",
    path: BP,
    assetPath: BP,
    name,
    variableName: name,
    type: variableType,
    variableType,
    isArray,
  });
  console.log("add_variable", name, JSON.stringify(r));
}

async function buildInitFunction() {
  try {
    await bp({ action: "delete_function", path: BP, assetPath: BP, functionName: FUNC_INIT });
  } catch {}
  await bp({
    action: "create_function",
    path: BP,
    assetPath: BP,
    functionName: FUNC_INIT,
    onConflict: "replace",
  });

  const g = await bp({ action: "read_graph", path: BP, assetPath: BP, graphName: FUNC_INIT });
  const nodes = g.nodes || [];
  const entry = nodes.find((n) => n.class === "K2Node_FunctionEntry");
  const result = nodes.find((n) => n.class === "K2Node_FunctionResult");
  if (!entry || !result) throw new Error(FUNC_INIT + ": missing entry/result");

  const x0 = 400;
  const y0 = 0;

  const forLoop = await add(FUNC_INIT, "MacroInstance", { macroName: "ForLoop" }, x0, y0);
  await setPin(FUNC_INIT, forLoop, "FirstIndex", "0");
  await setPin(FUNC_INIT, forLoop, "LastIndex", "3");

  const getPoints = await add(FUNC_INIT, "GetVar", { variableName: "Light Through Points" }, x0 + 280, y0 + 40);
  const getEdges = await add(FUNC_INIT, "GetVar", { variableName: "Edge Lengths" }, x0 + 280, y0 + 200);

  const add1 = await add(
    FUNC_INIT,
    "CallFunction",
    { functionName: "Add_IntInt", targetClass: "/Script/Engine.KismetMathLibrary" },
    x0 + 520,
    y0 - 40
  );
  const mod4 = await add(
    FUNC_INIT,
    "CallFunction",
    { functionName: "Percent_IntInt", targetClass: "/Script/Engine.KismetMathLibrary" },
    x0 + 720,
    y0 - 40
  );
  await setPin(FUNC_INIT, mod4, "B", "4");

  const getA = await add(
    FUNC_INIT,
    "CallFunction",
    { functionName: "Array_Get", targetClass: "/Script/Engine.KismetArrayLibrary" },
    x0 + 520,
    y0 + 80
  );
  const getB = await add(
    FUNC_INIT,
    "CallFunction",
    { functionName: "Array_Get", targetClass: "/Script/Engine.KismetArrayLibrary" },
    x0 + 520,
    y0 + 220
  );

  const locA = await add(
    FUNC_INIT,
    "CallFunction",
    { functionName: "K2_GetComponentLocation", targetClass: "/Script/Engine.SceneComponent" },
    x0 + 760,
    y0 + 60
  );
  const locB = await add(
    FUNC_INIT,
    "CallFunction",
    { functionName: "K2_GetComponentLocation", targetClass: "/Script/Engine.SceneComponent" },
    x0 + 760,
    y0 + 240
  );

  const dist = await add(
    FUNC_INIT,
    "CallFunction",
    { functionName: "Vector_Distance", targetClass: "/Script/Engine.KismetMathLibrary" },
    x0 + 1000,
    y0 + 140
  );

  const setElem = await add(
    FUNC_INIT,
    "CallFunction",
    { functionName: "Array_Set", targetClass: "/Script/Engine.KismetArrayLibrary" },
    x0 + 1240,
    y0 + 140
  );

  await connect(FUNC_INIT, entry.id, ["then"], forLoop, ["execute"]);
  await connect(FUNC_INIT, forLoop, ["LoopBody"], setElem, ["execute"]);
  await connect(FUNC_INIT, forLoop, ["Completed"], result.id, ["execute"]);

  await connect(FUNC_INIT, forLoop, ["Index"], add1, ["A"]);
  await setPin(FUNC_INIT, add1, "B", "1");
  await connect(FUNC_INIT, add1, ["ReturnValue"], mod4, ["A"]);
  await connect(FUNC_INIT, forLoop, ["Index"], getA, ["Index"]);
  await connect(FUNC_INIT, getPoints, ["Light Through Points"], getA, ["TargetArray"]);
  await connect(FUNC_INIT, mod4, ["ReturnValue"], getB, ["Index"]);
  await connect(FUNC_INIT, getPoints, ["Light Through Points"], getB, ["TargetArray"]);

  await connect(FUNC_INIT, getA, ["Item"], locA, ["self"]);
  await connect(FUNC_INIT, getB, ["Item"], locB, ["self"]);
  await connect(FUNC_INIT, locA, ["ReturnValue"], dist, ["V1", "A"]);
  await connect(FUNC_INIT, locB, ["ReturnValue"], dist, ["V2", "B"]);

  await connect(FUNC_INIT, forLoop, ["Index"], setElem, ["Index"]);
  await connect(FUNC_INIT, getEdges, ["Edge Lengths"], setElem, ["TargetArray"]);
  await connect(FUNC_INIT, dist, ["ReturnValue"], setElem, ["Item"]);
  await setPin(FUNC_INIT, setElem, "bSizeToFit", "false");

  console.log(FUNC_INIT, "built");
}

async function buildApplyFunction() {
  try {
    await bp({ action: "delete_function", path: BP, assetPath: BP, functionName: FUNC_APPLY });
  } catch {}
  await bp({
    action: "create_function",
    path: BP,
    assetPath: BP,
    functionName: FUNC_APPLY,
    onConflict: "replace",
  });

  for (const [parameterName, parameterType] of [
    ["SideIndex", "int"],
    ["TargetRoot", "/Script/Engine.SceneComponent"],
    ["TargetCollider", "/Script/Engine.BoxComponent"],
  ]) {
    await bp({
      action: "add_function_parameter",
      path: BP,
      assetPath: BP,
      functionName: FUNC_APPLY,
      parameterName,
      parameterType,
    });
  }

  const g = await bp({ action: "read_graph", path: BP, assetPath: BP, graphName: FUNC_APPLY });
  const nodes = g.nodes || [];
  const entry = nodes.find((n) => n.class === "K2Node_FunctionEntry");
  const result = nodes.find((n) => n.class === "K2Node_FunctionResult");
  if (!entry || !result) throw new Error(FUNC_APPLY + ": missing entry/result");

  const x = 400;
  const y = 0;

  const getPoints = await add(FUNC_APPLY, "GetVar", { variableName: "Light Through Points" }, x, y + 80);
  const getEdges = await add(FUNC_APPLY, "GetVar", { variableName: "Edge Lengths" }, x, y + 260);
  const getOrigin = await add(FUNC_APPLY, "GetVar", { variableName: "Origin Collision Size" }, x + 200, y + 420);

  const add1 = await add(
    FUNC_APPLY,
    "CallFunction",
    { functionName: "Add_IntInt", targetClass: "/Script/Engine.KismetMathLibrary" },
    x + 200,
    y
  );
  const mod4 = await add(
    FUNC_APPLY,
    "CallFunction",
    { functionName: "Percent_IntInt", targetClass: "/Script/Engine.KismetMathLibrary" },
    x + 400,
    y
  );
  await setPin(FUNC_APPLY, mod4, "B", "4");

  const getA = await add(
    FUNC_APPLY,
    "CallFunction",
    { functionName: "Array_Get", targetClass: "/Script/Engine.KismetArrayLibrary" },
    x + 200,
    y + 120
  );
  const getB = await add(
    FUNC_APPLY,
    "CallFunction",
    { functionName: "Array_Get", targetClass: "/Script/Engine.KismetArrayLibrary" },
    x + 200,
    y + 280
  );
  const getEdgeLen = await add(
    FUNC_APPLY,
    "CallFunction",
    { functionName: "Array_Get", targetClass: "/Script/Engine.KismetArrayLibrary" },
    x + 200,
    y + 440
  );

  const locA = await add(
    FUNC_APPLY,
    "CallFunction",
    { functionName: "K2_GetComponentLocation", targetClass: "/Script/Engine.SceneComponent" },
    x + 440,
    y + 100
  );
  const locB = await add(
    FUNC_APPLY,
    "CallFunction",
    { functionName: "K2_GetComponentLocation", targetClass: "/Script/Engine.SceneComponent" },
    x + 440,
    y + 280
  );

  const addVec = await add(
    FUNC_APPLY,
    "CallFunction",
    { functionName: "Add_VectorVector", targetClass: "/Script/Engine.KismetMathLibrary" },
    x + 680,
    y + 180
  );
  const halfVec = await add(
    FUNC_APPLY,
    "CallFunction",
    { functionName: "Multiply_VectorFloat", targetClass: "/Script/Engine.KismetMathLibrary" },
    x + 900,
    y + 180
  );
  await setPin(FUNC_APPLY, halfVec, "B", "0.5");

  const lookRot = await add(
    FUNC_APPLY,
    "CallFunction",
    { functionName: "FindLookAtRotation", targetClass: "/Script/Engine.KismetMathLibrary" },
    x + 680,
    y - 80
  );
  const setLoc = await add(
    FUNC_APPLY,
    "CallFunction",
    { functionName: "K2_SetWorldLocation", targetClass: "/Script/Engine.SceneComponent" },
    x + 1120,
    y + 80
  );
  const setRot = await add(
    FUNC_APPLY,
    "CallFunction",
    { functionName: "K2_SetWorldRotation", targetClass: "/Script/Engine.SceneComponent" },
    x + 1360,
    y + 80
  );

  const halfLen = await add(
    FUNC_APPLY,
    "CallFunction",
    { functionName: "Divide_DoubleDouble", targetClass: "/Script/Engine.KismetMathLibrary" },
    x + 680,
    y + 400
  );
  await setPin(FUNC_APPLY, halfLen, "B", "2.0");

  const breakOrigin = await add(
    FUNC_APPLY,
    "CallFunction",
    { functionName: "BreakVector", targetClass: "/Script/Engine.KismetMathLibrary" },
    x + 440,
    y + 520
  );
  const makeExt = await add(
    FUNC_APPLY,
    "CallFunction",
    { functionName: "MakeVector", targetClass: "/Script/Engine.KismetMathLibrary" },
    x + 900,
    y + 480
  );
  const setExt = await add(
    FUNC_APPLY,
    "CallFunction",
    { functionName: "SetBoxExtent", targetClass: "/Script/Engine.BoxComponent" },
    x + 1120,
    y + 480
  );

  await connect(FUNC_APPLY, entry.id, ["then"], setLoc, ["execute"]);
  await connect(FUNC_APPLY, setLoc, ["then"], setRot, ["execute"]);
  await connect(FUNC_APPLY, setRot, ["then"], setExt, ["execute"]);
  await connect(FUNC_APPLY, setExt, ["then"], result.id, ["execute"]);

  await connect(FUNC_APPLY, entry.id, ["SideIndex"], add1, ["A"]);
  await setPin(FUNC_APPLY, add1, "B", "1");
  await connect(FUNC_APPLY, add1, ["ReturnValue"], mod4, ["A"]);

  await connect(FUNC_APPLY, entry.id, ["SideIndex"], getA, ["Index"]);
  await connect(FUNC_APPLY, getPoints, ["Light Through Points"], getA, ["TargetArray"]);
  await connect(FUNC_APPLY, mod4, ["ReturnValue"], getB, ["Index"]);
  await connect(FUNC_APPLY, getPoints, ["Light Through Points"], getB, ["TargetArray"]);
  await connect(FUNC_APPLY, entry.id, ["SideIndex"], getEdgeLen, ["Index"]);
  await connect(FUNC_APPLY, getEdges, ["Edge Lengths"], getEdgeLen, ["TargetArray"]);

  await connect(FUNC_APPLY, getA, ["Item"], locA, ["self"]);
  await connect(FUNC_APPLY, getB, ["Item"], locB, ["self"]);
  await connect(FUNC_APPLY, locA, ["ReturnValue"], lookRot, ["Start"]);
  await connect(FUNC_APPLY, locB, ["ReturnValue"], lookRot, ["Target"]);
  await connect(FUNC_APPLY, locA, ["ReturnValue"], addVec, ["A"]);
  await connect(FUNC_APPLY, locB, ["ReturnValue"], addVec, ["B"]);
  await connect(FUNC_APPLY, addVec, ["ReturnValue"], halfVec, ["A"]);

  await connect(FUNC_APPLY, entry.id, ["TargetRoot"], setLoc, ["self"]);
  await connect(FUNC_APPLY, halfVec, ["ReturnValue"], setLoc, ["NewLocation"]);
  await connect(FUNC_APPLY, entry.id, ["TargetRoot"], setRot, ["self"]);
  await connect(FUNC_APPLY, lookRot, ["ReturnValue"], setRot, ["NewRotation"]);

  await connect(FUNC_APPLY, getEdgeLen, ["Item"], halfLen, ["A"]);
  await connect(FUNC_APPLY, getOrigin, ["Origin Collision Size"], breakOrigin, ["InVec"]);
  await connect(FUNC_APPLY, breakOrigin, ["X"], makeExt, ["X"]);
  await connect(FUNC_APPLY, halfLen, ["ReturnValue"], makeExt, ["Y"]);
  await connect(FUNC_APPLY, breakOrigin, ["Z"], makeExt, ["Z"]);
  await connect(FUNC_APPLY, entry.id, ["TargetCollider"], setExt, ["self"]);
  await connect(FUNC_APPLY, makeExt, ["ReturnValue"], setExt, ["InBoxExtent"]);
  await setPin(FUNC_APPLY, setExt, "bUpdateOverlaps", "true");

  console.log(FUNC_APPLY, "built");
}

async function hookBeginPlay() {
  const sum = await bp({ action: "read_graph_summary", path: BP, assetPath: BP, graphName: "EventGraph" });
  const nodes = sum.nodes || [];
  const begin = nodes.find((n) => (n.title || "").includes("BeginPlay"));
  if (!begin) {
    console.log("WARN: Event BeginPlay not found in summary — hook manually: BeginPlay -> ComputeWindowEdgeLengths");
    return;
  }

  const callInit = await add(
    "EventGraph",
    "CallFunction",
    { functionName: FUNC_INIT, targetBlueprint: BP },
    (begin.posX || 0) + 300,
    begin.posY || 0
  );

  try {
    await connect("EventGraph", begin.id, ["then"], callInit, ["execute"]);
    const g2 = await bp({ action: "read_graph_summary", path: BP, assetPath: BP, graphName: "EventGraph" });
    const after = (g2.nodes || []).find((n) => n.id === callInit);
    const oldNext = begin.thenTarget;
    if (after && oldNext) {
      // try chain callInit.then -> old beginplay chain
    }
  } catch (e) {
    console.log("BeginPlay hook:", e.message);
    console.log("Manual: Event BeginPlay -> ComputeWindowEdgeLengths");
  }
}

async function main() {
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "wall-edges", version: "1" },
  });

  await ensureVar("Edge Lengths", "float", true);
  await buildInitFunction();
  await buildApplyFunction();
  await hookBeginPlay();

  const comp = await bp({ action: "compile", path: BP, assetPath: BP });
  console.log("compile:", JSON.stringify(comp));
  await bp({ action: "save", path: BP, assetPath: BP }).catch(() => {});

  console.log("\nDONE. In Shadow Collision Compute (or Update loop), add CALL:");
  console.log("  ApplyShadowAlongEdge(SideIndex, TargetRoot, TargetCollider)");
  console.log("before or instead of HitLocation -> SetBoxExtent.");
  mcp.kill();
  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  mcp.kill();
  process.exit(1);
});
