/**
 * BP_WindowShadowLogic: guard ResetOneShadowCollider when Target Collider is None.
 */
const { spawn } = require("child_process");

const BP = "/Game/BluePrint/BP_WindowShadowLogic";
const FN = "ResetOneShadowCollider";

const mcp = spawn("npx.cmd", ["ue-mcp", "D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject"], { shell: true });
let reqId = 1;
const pending = new Map();

function rpc(method, params, ms = 120000) {
  return new Promise((resolve, reject) => {
    const id = reqId++;
    const t = setTimeout(() => {
      pending.delete(id);
      reject(new Error("timeout " + method));
    }, ms);
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
  const res = await rpc("tools/call", { name: "blueprint", arguments: { path: BP, assetPath: BP, ...args } });
  const p = payload(res);
  if (p.success === false && p.error) throw new Error(p.error);
  return p;
}

async function connect(graphName, a, aps, b, bps) {
  for (const ap of aps) {
    for (const bpPin of bps) {
      try {
        const r = await bp({
          action: "connect_pins",
          graphName,
          sourceNode: a,
          sourcePin: ap,
          targetNode: b,
          targetPin: bpPin,
        });
        if (r.success !== false) return { ap, bpPin };
      } catch (_) {}
    }
  }
  throw new Error(`connect failed ${a} -> ${b}`);
}

(async () => {
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "fix-win-reset" } });

  const g = await bp({ action: "read_graph", graphName: FN });
  const nodes = g.nodes || [];
  console.log(
    "nodes:",
    nodes.map((n) => `${n.id} ${n.class} ${n.title}`)
  );

  const entry = nodes.find((n) => n.class === "K2Node_FunctionEntry");
  const setExtent = nodes.find((n) => (n.title || "").includes("Set Box Extent"));
  if (!entry || !setExtent) throw new Error("missing entry or Set Box Extent");

  const existingValid = nodes.find((n) => (n.title || "").includes("Is Valid"));
  if (existingValid) {
    console.log("Is Valid already exists, skip add");
    mcp.kill();
    return;
  }

  const validId = (
    await bp({
      action: "add_node",
      graphName: FN,
      nodeClass: "K2Node_MacroInstance",
      nodeParams: { MacroName: "IsValid" },
      posX: 200,
      posY: 0,
    })
  ).nodeId;
  console.log("validId", validId);

  const retId = (
    await bp({
      action: "add_node",
      graphName: FN,
      nodeClass: "K2Node_FunctionResult",
      nodeParams: {},
      posX: 200,
      posY: 200,
    })
  ).nodeId;
  console.log("retId", retId);

  // Target Collider -> Is Valid InputObject
  await connect(FN, entry.id, ["Target Collider", "TargetCollider"], validId, ["InputObject", "Object"]);

  // Entry then -> Is Valid execute
  await connect(FN, entry.id, ["then"], validId, ["exec", "Execute"]);

  // Is Valid True -> Set Box Extent execute
  await connect(FN, validId, ["Is Valid", "True", "IsValid"], setExtent.id, ["execute"]);

  // Is Valid False -> Return
  await connect(FN, validId, ["Is Not Valid", "False", "IsNotValid"], retId, ["execute"]);

  await bp({ action: "compile_blueprint" });
  console.log("DONE: compile ok");
  mcp.kill();
})().catch((e) => {
  console.error("FATAL", e.message);
  mcp.kill();
  process.exit(1);
});
