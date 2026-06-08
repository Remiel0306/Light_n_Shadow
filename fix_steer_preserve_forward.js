/**
 * Fix IA_BallSteerC wiping forward momentum (ball drops when steering).
 * Requires Unreal Editor open + MCP bridge.
 *
 * Changes:
 * 1. Exec dead zone: only Set Physics Linear Velocity when |stick| > 0.15
 * 2. Forward: Normalize(V) * VectorLength(V) instead of FlyDir * Dot(V, FlyDir)
 * 3. Make Vector Z: SelectFloat — keep Break(V).Z when |stickY| <= deadzone, else Y*MaxSteerVertical
 */
const { spawn } = require("child_process");
const fs = require("fs");

const PROJECT = "D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject";
const BP = "/Game/BluePrint/Player/BP_ThirdPersonCharacter";
const EG = "EventGraph";
const DEADZONE = 0.15;

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
        reject(new Error("MCP timeout — open Unreal Editor with Light_and_Shadow loaded"));
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

function byTitle(nodes, re) {
  return nodes.filter((n) => re.test(n.title || ""));
}

function findEdge(data, toId, toPinRe) {
  return data.find((e) => e.to === toId && toPinRe.test(e.toPin || ""));
}

function upstream(data, fromId, depth = 0) {
  if (depth > 12) return [];
  const ins = data.filter((e) => e.to === fromId);
  return ins.concat(...ins.flatMap((e) => upstream(data, e.from, depth + 1)));
}

(async () => {
  const { rpc, bp, kill } = mkMCP();
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "steer-forward-fix" } });

  const g = await bp({ action: "read_graph", graphName: EG });
  if (!g.nodes?.length) throw new Error("Cannot read EventGraph: " + (g.raw || g.error || "no nodes"));

  fs.writeFileSync("_steer_graph_before.json", JSON.stringify(g, null, 2));
  const nodes = g.nodes;
  const data = g.dataEdges || [];
  const exec = g.execEdges || [];
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const setVel = nodes.find((n) => n.title === "Set Physics Linear Velocity");
  if (!setVel) throw new Error("Set Physics Linear Velocity not found");

  const newVelEdge = findEdge(data, setVel.id, /New|Vel/i);
  if (!newVelEdge) throw new Error("No NewVel wired to Set Physics Linear Velocity");

  const makeVec = byId.get(newVelEdge.from);
  if (!makeVec || makeVec.title !== "Make Vector") {
    throw new Error("Expected Make Vector before SetVel, got: " + (makeVec?.title || newVelEdge.from));
  }

  const getVel = nodes.find((n) => n.title === "Get Physics Linear Velocity");
  if (!getVel) throw new Error("Get Physics Linear Velocity not found");

  const break2d = nodes.find((n) => /Break Vector 2D|Break Vector2D/.test(n.title || ""));
  if (!break2d) throw new Error("Break Vector 2D not found (IA_BallSteerC Action Value)");

  const maxVert = nodes.find((n) => n.class === "K2Node_VariableGet" && (n.title || "").includes("Max Steer Vertical"));
  if (!maxVert) throw new Error("Max Steer Vertical variable get not found");

  const yMul = data.find(
    (e) => e.to === makeVec.id && e.toPin === "Z" && byId.get(e.from)?.class === "K2Node_PromotableOperator"
  );
  const yMulId = yMul?.from;
  if (!yMulId) throw new Error("Make Vector Z is not from Y*MaxVertical multiply — wire manually");

  // --- 1) Fix Make Vector Z: SelectFloat preserve V.Z when not pushing Y ---
  const zEdge = findEdge(data, makeVec.id, /^Z$/);
  if (zEdge) {
    await bp({
      action: "disconnect_pins",
      graphName: EG,
      sourceNode: zEdge.from,
      sourcePin: zEdge.fromPin,
      targetNode: zEdge.to,
      targetPin: zEdge.toPin,
    });
  }

  const px = (makeVec.posX || 1600) + 80;
  const py = (makeVec.posY || 700) + 140;

  const breakVelId = (
    await bp({
      action: "add_node",
      graphName: EG,
      nodeClass: "K2Node_CallFunction",
      nodeParams: { functionName: "BreakVector", functionClass: "/Script/Engine.KismetMathLibrary" },
      posX: px,
      posY: py,
    })
  ).nodeId;

  const absYId = (
    await bp({
      action: "add_node",
      graphName: EG,
      nodeClass: "K2Node_CallFunction",
      nodeParams: { functionName: "Abs", functionClass: "/Script/Engine.KismetMathLibrary" },
      posX: px,
      posY: py + 120,
    })
  ).nodeId;

  const gtYId = (
    await bp({
      action: "add_node",
      graphName: EG,
      nodeClass: "K2Node_PromotableOperator",
      nodeParams: { operator: ">" },
      posX: px + 160,
      posY: py + 120,
    })
  ).nodeId;

  const selectZId = (
    await bp({
      action: "add_node",
      graphName: EG,
      nodeClass: "K2Node_CallFunction",
      nodeParams: { functionName: "SelectFloat", functionClass: "/Script/Engine.KismetMathLibrary" },
      posX: px + 320,
      posY: py + 60,
    })
  ).nodeId;

  const conn = (a, ap, b, bpPin) =>
    bp({
      action: "connect_pins",
      graphName: EG,
      sourceNode: a,
      sourcePin: ap,
      targetNode: b,
      targetPin: bpPin,
    });

  await conn(getVel.id, "ReturnValue", breakVelId, "InVec");
  await conn(breakVelId, "Z", selectZId, "A");
  await conn(yMulId, "ReturnValue", selectZId, "B");
  await conn(break2d.id, "Y", absYId, "A");
  await conn(absYId, "ReturnValue", gtYId, "A");
  await bp({
    action: "set_node_property",
    graphName: EG,
    nodeId: gtYId,
    pinName: "B",
    defaultValue: String(DEADZONE),
  });
  await conn(gtYId, "ReturnValue", selectZId, "bPickA");
  await conn(selectZId, "ReturnValue", makeVec.id, "Z");
  console.log("OK: Make Vector Z uses SelectFloat (keep V.Z when |Y| <= deadzone)");

  // --- 2) Fix forward: replace Dot*Forward with Normalize(V)*VSize(V) ---
  const dot = nodes.find((n) => n.title === "Dot Product" || n.title === "DotProduct");
  if (dot) {
    const dotOutUsers = data.filter((e) => e.from === dot.id);
    const fwdMul = dotOutUsers.find((e) => {
      const n = byId.get(e.to);
      return n && (n.title === "vector * float" || n.class === "K2Node_PromotableOperator");
    });

    if (fwdMul) {
      const fwdMulNode = byId.get(fwdMul.to);
      const fwdVecEdge = data.find((e) => e.to === fwdMul.to && /A|Left|Vector/i.test(e.toPin || ""));
      const speedEdge = data.find((e) => e.to === fwdMul.to && /B|Right|Float/i.test(e.toPin || ""));

      if (speedEdge?.from === dot.id) {
        await bp({
          action: "disconnect_pins",
          graphName: EG,
          sourceNode: speedEdge.from,
          sourcePin: speedEdge.fromPin,
          targetNode: speedEdge.to,
          targetPin: speedEdge.toPin,
        });
      }

      const npx = (dot.posX || 1200) - 120;
      const npy = (dot.posY || 600) - 80;

      const vSizeId = (
        await bp({
          action: "add_node",
          graphName: EG,
          nodeClass: "K2Node_CallFunction",
          nodeParams: { functionName: "VSize", functionClass: "/Script/Engine.KismetMathLibrary" },
          posX: npx,
          posY: npy,
        })
      ).nodeId;

      const normalId = (
        await bp({
          action: "add_node",
          graphName: EG,
          nodeClass: "K2Node_CallFunction",
          nodeParams: { functionName: "Normal", functionClass: "/Script/Engine.KismetMathLibrary" },
          posX: npx,
          posY: npy + 100,
        })
      ).nodeId;

      await conn(getVel.id, "ReturnValue", vSizeId, "A");
      await conn(getVel.id, "ReturnValue", normalId, "A");
      await conn(vSizeId, "ReturnValue", fwdMul.to, speedEdge?.toPin || "B");

      if (fwdVecEdge) {
        await bp({
          action: "disconnect_pins",
          graphName: EG,
          sourceNode: fwdVecEdge.from,
          sourcePin: fwdVecEdge.fromPin,
          targetNode: fwdVecEdge.to,
          targetPin: fwdVecEdge.toPin,
        });
        await conn(normalId, "ReturnValue", fwdMul.to, fwdVecEdge.toPin || "A");
      } else {
        await conn(normalId, "ReturnValue", fwdMul.to, "A");
      }
      console.log("OK: forward uses Normal(V)*VSize(V) instead of Dot+FlyDir");
    }
  } else {
    console.log("WARN: Dot Product not found — skipped forward vector fix");
  }

  // --- 3) Exec dead zone before Set Physics Linear Velocity ---
  const setExecIn = exec.find((e) => e.to === setVel.id);
  if (setExecIn) {
    const existingBranch = byId.get(setExecIn.from);
    const alreadyDeadzone =
      existingBranch?.title === "Branch" &&
      upstream(data, existingBranch.id).some((e) => byId.get(e.from)?.title === "Abs");

    if (!alreadyDeadzone) {
      const branchId = (
        await bp({
          action: "add_node",
          graphName: EG,
          nodeClass: "K2Node_IfThenElse",
          nodeParams: {},
          posX: (setVel.posX || 1800) - 200,
          posY: setVel.posY || 700,
        })
      ).nodeId;

      const absXId = (
        await bp({
          action: "add_node",
          graphName: EG,
          nodeClass: "K2Node_CallFunction",
          nodeParams: { functionName: "Abs", functionClass: "/Script/Engine.KismetMathLibrary" },
          posX: (setVel.posX || 1800) - 420,
          posY: (setVel.posY || 700) + 80,
        })
      ).nodeId;

      const absY2Id = (
        await bp({
          action: "add_node",
          graphName: EG,
          nodeClass: "K2Node_CallFunction",
          nodeParams: { functionName: "Abs", functionClass: "/Script/Engine.KismetMathLibrary" },
          posX: (setVel.posX || 1800) - 420,
          posY: (setVel.posY || 700) + 180,
        })
      ).nodeId;

      const maxStickId = (
        await bp({
          action: "add_node",
          graphName: EG,
          nodeClass: "K2Node_CallFunction",
          nodeParams: { functionName: "FMax", functionClass: "/Script/Engine.KismetMathLibrary" },
          posX: (setVel.posX || 1800) - 280,
          posY: (setVel.posY || 700) + 130,
        })
      ).nodeId;

      const gtStickId = (
        await bp({
          action: "add_node",
          graphName: EG,
          nodeClass: "K2Node_PromotableOperator",
          nodeParams: { operator: ">" },
          posX: (setVel.posX || 1800) - 140,
          posY: (setVel.posY || 700) + 130,
        })
      ).nodeId;

      await bp({
        action: "disconnect_pins",
        graphName: EG,
        sourceNode: setExecIn.from,
        sourcePin: setExecIn.fromPin,
        targetNode: setExecIn.to,
        targetPin: setExecIn.toPin,
      });

      await conn(setExecIn.from, setExecIn.fromPin, branchId, "execute");
      await conn(branchId, "then", setVel.id, "execute");
      await conn(break2d.id, "X", absXId, "A");
      await conn(break2d.id, "Y", absY2Id, "A");
      await conn(absXId, "ReturnValue", maxStickId, "A");
      await conn(absY2Id, "ReturnValue", maxStickId, "B");
      await conn(maxStickId, "ReturnValue", gtStickId, "A");
      await bp({
        action: "set_node_property",
        graphName: EG,
        nodeId: gtStickId,
        pinName: "B",
        defaultValue: String(DEADZONE),
      });
      await conn(gtStickId, "ReturnValue", branchId, "Condition");
      console.log("OK: exec dead zone Branch before Set Physics Linear Velocity");
    } else {
      console.log("SKIP: dead zone Branch already present");
    }
  }

  const comp = await bp({ action: "compile" });
  console.log("Compile:", comp.success !== false ? "OK" : JSON.stringify(comp));
  const val = await bp({ action: "validate" });
  console.log("Validate:", val.success !== false ? "OK" : JSON.stringify(val));

  kill();
  console.log("\nDone. Steer should preserve forward speed; Z kept when not pushing Y; no Set when stick centered.");
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
