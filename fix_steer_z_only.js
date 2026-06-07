/**
 * Fix IA_BallSteerC vertical accumulation on BP_ThirdPersonCharacter.
 * Requires Unreal Editor open with Light_and_Shadow project + MCP bridge.
 *
 * Change: Z = Y * MaxSteerVertical (absolute), not (0,0,1)*Y added to sum.
 * Keeps existing forward+right add; only replaces vertical branch.
 */
const { spawn } = require("child_process");
const fs = require("fs");

const PROJECT = "D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject";
const BP = "/Game/BluePrint/Player/BP_ThirdPersonCharacter";
const EG = "EventGraph";

function mkMCP() {
  const mcp = spawn("npx.cmd", ["ue-mcp", PROJECT], { shell: true });
  let id = 1;
  const wait = new Map();
  let buf = "";
  mcp.stdout.on("data", (d) => {
    buf += d.toString();
    for (const line of buf.split("\n")) {
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
    buf = buf.split("\n").pop();
  });
  const rpc = (method, params) =>
    new Promise((resolve, reject) => {
      const i = id++;
      const t = setTimeout(() => {
        wait.delete(i);
        reject(new Error("MCP timeout — open Unreal Editor with this project first"));
      }, 180000);
      wait.set(i, (m) => {
        clearTimeout(t);
        resolve(m);
      });
      mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n");
    });
  const bp = async (args) => {
    const r = await rpc("tools/call", { name: "blueprint", arguments: { path: BP, assetPath: BP, ...args } });
    const t = r?.result?.content?.[0]?.text || "";
    try {
      return JSON.parse(t);
    } catch {
      return { raw: t };
    }
  };
  return { rpc, bp, kill: () => mcp.kill() };
}

function edges(data) {
  return data || [];
}

function traceUpMul(data, byId, fromId, depth = 0) {
  if (depth > 8) return false;
  const n = byId.get(fromId);
  if (!n) return false;
  if (n.title === "Make Vector") {
    const zPin = (n.pins || []).find((p) => p.name === "Z");
    if (zPin?.defaultValue === "1.0" || zPin?.defaultValue === "1") return true;
  }
  if ((n.title || "").includes("Max Steer Vertical")) return true;
  for (const e of edges(data).filter((x) => x.to === fromId)) {
    if (traceUpMul(data, byId, e.from, depth + 1)) return true;
  }
  return false;
}

(async () => {
  const { rpc, bp, kill } = mkMCP();
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "fix-steer-z" } });

  const g = await bp({ action: "read_graph", graphName: EG });
  if (!g.nodes?.length) throw new Error("Cannot read EventGraph: " + (g.raw || g.error || "no nodes"));

  fs.writeFileSync("_steer_graph.json", JSON.stringify(g, null, 2));
  const nodes = g.nodes;
  const data = g.dataEdges || [];
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const setVel = nodes.find((n) => n.title === "Set Physics Linear Velocity");
  if (!setVel) throw new Error("Set Physics Linear Velocity not found");

  const newVelEdge = data.find((e) => e.to === setVel.id && /New|Vel/i.test(e.toPin || ""));
  if (!newVelEdge) throw new Error("Set Physics Linear Velocity has no NewVel input");

  const finalAddId = newVelEdge.from;
  const finalAdd = byId.get(finalAddId);
  console.log("Final add before Set:", finalAdd?.title, finalAddId);

  const addInputs = data.filter((e) => e.to === finalAddId);
  if (addInputs.length < 2) throw new Error("Expected 2 inputs to final add, got " + addInputs.length);

  let upEdge = null;
  let baseEdge = null;
  for (const e of addInputs) {
    if (traceUpMul(data, byId, e.from)) upEdge = e;
    else baseEdge = e;
  }
  if (!upEdge || !baseEdge) throw new Error("Could not split up/base add inputs");

  console.log("Up branch from:", byId.get(upEdge.from)?.title);
  console.log("Base branch from:", byId.get(baseEdge.from)?.title);

  const yBreak = nodes.find((n) => /Break Vector 2D|Break Vector2D/.test(n.title || ""));
  const maxVert = nodes.find((n) => n.class === "K2Node_VariableGet" && (n.title || "").includes("Max Steer Vertical"));
  if (!yBreak || !maxVert) throw new Error("Need Break Vector 2D + Max Steer Vertical");

  const baseAddId = baseEdge.from;
  const px = (finalAdd?.posX || 1400) + 250;
  const py = finalAdd?.posY || 700;

  const addNode = async (nodeClass, nodeParams, x, y) => {
    const r = await bp({ action: "add_node", graphName: EG, nodeClass, nodeParams, posX: x, posY: y });
    const nid = r.nodeId || r.id;
    if (!nid) throw new Error("add_node failed: " + JSON.stringify(r));
    return nid;
  };

  const connect = (a, ap, b, bpPin) =>
    bp({ action: "connect_pins", graphName: EG, sourceNode: a, sourcePin: ap, targetNode: b, targetPin: bpPin });

  const disconnect = (a, ap, b, bpPin) =>
    bp({ action: "disconnect_pins", graphName: EG, sourceNode: a, sourcePin: ap, targetNode: b, targetPin: bpPin });

  // Remove vertical vector from sum
  await disconnect(upEdge.from, upEdge.fromPin, upEdge.to, upEdge.toPin);
  await disconnect(newVelEdge.from, newVelEdge.fromPin, newVelEdge.to, newVelEdge.toPin);

  const breakId = await addNode("K2Node_CallFunction", {
    functionName: "BreakVector",
    functionClass: "/Script/Engine.KismetMathLibrary",
  }, px, py);

  const yMulId = await addNode("K2Node_PromotableOperator", { operator: "*" }, px + 180, py + 100);
  const makeId = await addNode("K2Node_CallFunction", {
    functionName: "MakeVector",
    functionClass: "/Script/Engine.KismetMathLibrary",
  }, px + 360, py);

  await connect(baseAddId, "ReturnValue", breakId, "InVec");
  await connect(breakId, "X", makeId, "X");
  await connect(breakId, "Y", makeId, "Y");
  await connect(yBreak.id, "Y", yMulId, "A");
  await connect(maxVert.id, "Max Steer Vertical", yMulId, "B");
  await connect(yMulId, "ReturnValue", makeId, "Z");
  await connect(makeId, "ReturnValue", setVel.id, newVelEdge.toPin);

  const comp = await bp({ action: "compile" });
  console.log("Compile:", comp.success !== false ? "OK" : comp);
  console.log("Fixed: Z = Y * MaxSteerVertical (not additive Up vector)");

  kill();
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
