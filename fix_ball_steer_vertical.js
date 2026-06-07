const { spawn } = require("child_process");
const fs = require("fs");

const PROJECT = "D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject";
const BP = "/Game/BluePrint/Player/BP_ThirdPersonCharacter";

function mkMCP() {
  const mcp = spawn("npx.cmd", ["ue-mcp", PROJECT], { shell: true });
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
      }, 180000);
      wait.set(i, (m) => {
        clearTimeout(t);
        resolve(m);
      });
      mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n");
    });
  }
  async function bp(args) {
    const r = await rpc("tools/call", { name: "blueprint", arguments: { path: BP, assetPath: BP, ...args } });
    const t = r?.result?.content?.[0]?.text || "";
    try {
      return JSON.parse(t);
    } catch {
      return { raw: t };
    }
  }
  return { rpc, bp, kill: () => mcp.kill() };
}

function findNode(nodes, pred) {
  return nodes.find(pred);
}

function pinNames(node) {
  return (node.pins || []).map((p) => `${p.direction}:${p.name}`).join(", ");
}

(async () => {
  const { rpc, bp, kill } = mkMCP();
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "fix-steer-z" } });

  let g = await bp({ action: "read_graph", graphName: "EventGraph" });
  if (!g.nodes?.length) {
    console.log("read_graph failed, trying summary...");
    g = await bp({ action: "read_graph_summary", graphName: "EventGraph" });
  }
  if (!g.nodes?.length) {
    console.error("No nodes:", g.raw || g.error);
    kill();
    process.exit(1);
  }

  fs.writeFileSync("_steer_graph.json", JSON.stringify(g, null, 2));
  const nodes = g.nodes;
  const exec = g.execEdges || [];
  const data = g.dataEdges || [];
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const steerEvt = nodes.find((n) => /IA_BallSteerC/.test(n.title || ""));
  const setVel = nodes.filter((n) => n.title === "Set Physics Linear Velocity");
  const makeUp = nodes.filter(
    (n) => n.class === "K2Node_CallFunction" && (n.title === "Make Vector" || n.title === "Construct Vector")
  );
  const breaks = nodes.filter((n) => n.title === "Break Vector");
  const adds = nodes.filter((n) => n.title === "Add" || /PromotableOperator.*\+/.test(n.title || "") || n.class === "K2Node_PromotableOperator");

  console.log("BallSteer event:", steerEvt?.id, steerEvt?.title);
  console.log("Set Physics Linear Velocity count:", setVel.length);
  console.log("Make Vector count:", makeUp.length);
  console.log("Break Vector count:", breaks.length);

  // Find Set Physics Linear Velocity fed by steer chain (has New Vel data in)
  const setNode = setVel.find((n) => data.some((e) => e.to === n.id && e.toPin?.includes("New"))) || setVel[0];
  if (!setNode) {
    console.error("No Set Physics Linear Velocity");
    kill();
    process.exit(1);
  }
  console.log("Target SetVel:", setNode.id);

  // Trace back from New Vel pin
  const newVelIn = data.filter((e) => e.to === setNode.id && /New|InVel|Velocity/i.test(e.toPin || ""));
  console.log("NewVel inputs:", newVelIn.map((e) => `${byId.get(e.from)?.title}.${e.fromPin}`));

  // Find final add before set
  let cur = newVelIn[0]?.from;
  const chain = [];
  for (let i = 0; i < 10 && cur; i++) {
    const n = byId.get(cur);
    chain.push(`${n?.title} (${n?.id})`);
    const prev = data.find((e) => e.to === cur && /Return|Result|Output|Vector/i.test(String(e.toPin)));
    cur = prev?.from;
  }
  console.log("Data chain back:", chain.join(" <- "));

  // Find vertical branch: Make Vector with Z=1 connected to multiply/add
  for (const mv of makeUp) {
    const zConst = data.find((e) => e.to === mv.id && e.toPin === "Z");
    const outUsers = data.filter((e) => e.from === mv.id);
    console.log("\nMakeVector", mv.id, "Z<=", zConst ? `${byId.get(zConst.from)?.title}.${zConst.fromPin}` : "none", "out->", outUsers.map((e) => `${byId.get(e.to)?.title}.${e.toPin}`));
  }

  // Find Max Steer Vertical usage
  const maxVert = nodes.filter((n) => /Max Steer Vertical|MaxSteerVertical/i.test(n.title || "") || (n.class === "K2Node_VariableGet" && (n.title || "").includes("Max Steer Vertical")));
  console.log("\nMax Steer Vertical nodes:", maxVert.map((n) => `${n.title} ${n.id}`));

  // --- FIX: insert Break before final Make/Set, replace Z with stick*max not additive ---
  // Strategy: find last add node feeding SetVel NewVel
  let finalAdd = newVelIn[0]?.from;
  const finalAddNode = byId.get(finalAdd);
  if (!finalAddNode || !/Add|\+/.test(finalAddNode.title || "") && finalAddNode.class !== "K2Node_PromotableOperator") {
    // maybe direct from break/make
    console.log("Final node before Set:", finalAddNode?.title, finalAddNode?.class);
  }

  // Find Make Vector (0,0,1) * vertical path - disconnect from final add, reroute Z via Break/Make
  const upMake = makeUp.find((mv) => {
    const zIn = data.find((e) => e.to === mv.id && e.toPin === "Z");
    return zIn && byId.get(zIn.from)?.title?.includes?.("PromotableOperator") === false && String(zIn.fromPin).includes("1") || 
      (() => {
        // check literal 1 on Z via node props
        const pins = mv.pins || [];
        const zPin = pins.find((p) => p.name === "Z");
        return zPin && (zPin.defaultValue === "1.0" || zPin.defaultValue === "1");
      })();
  });

  // simpler: find multiply vector where input is Make(0,0,1) or Up
  const vertMul = nodes.find((n) => {
    if (n.class !== "K2Node_PromotableOperator" && n.title !== "vector * vector" && n.title !== "Multiply") return false;
    const ins = data.filter((e) => e.to === n.id);
    return ins.some((e) => byId.get(e.from)?.title === "Make Vector");
  });

  console.log("\nVertical mul candidate:", vertMul?.id, vertMul?.title);

  // Find horizontal add (Fwd + Right) - the add whose inputs don't include Make Vector up
  const addNodes = nodes.filter((n) => n.class === "K2Node_PromotableOperator" && (n.title === "Add" || n.title?.includes("+")));
  for (const a of addNodes) {
    const ins = data.filter((e) => e.to === a.id);
    console.log("Add", a.id, "inputs:", ins.map((e) => `${byId.get(e.from)?.title}.${e.fromPin}`));
  }

  // Implementation: 
  // 1. Find finalAdd = node feeding SetVel New Vel (should be add of 3 or add of add+up)
  // 2. If structure is (add1: fwd+right) + upVec -> change to Break(add1)-> Make(bx,by, Y*MaxVert)
  // 3. Need Break Vector node, branch on Y, etc.

  // Minimal fix attempt via MCP:
  // - Disconnect up vector from final add
  // - Connect final add output to Break Vector
  // - Y stick * MaxSteerVertical to Make Vector Z
  // - Make Vector X,Y from Break, Z from stick
  // - Connect to SetVel

  const finalAddId = newVelIn[0]?.from;
  if (!finalAddId) {
    console.error("Cannot find NewVel source");
    kill();
    process.exit(1);
  }

  // Find Y * MaxSteerVertical float mul
  const yBreak = nodes.find((n) => n.title === "Break Vector 2D" || n.title === "Break Vector2D");
  const maxVertGet = nodes.find((n) => n.class === "K2Node_VariableGet" && (n.title || "").includes("Max Steer Vertical"));
  console.log("Break2D:", yBreak?.id, "MaxVert:", maxVertGet?.id);

  // Add nodes near final add
  const baseNode = byId.get(finalAddId);
  const posX = (baseNode?.posX || 1200) + 200;
  const posY = baseNode?.posY || 600;

  async function addNode(nodeClass, nodeParams, x, y) {
    const r = await bp({ action: "add_node", graphName: "EventGraph", nodeClass, nodeParams, posX: x, posY: y });
    if (!r.nodeId && !r.id) throw new Error("add_node failed: " + JSON.stringify(r));
    return r.nodeId || r.id;
  }

  async function connect(a, ap, b, bpPin) {
    const r = await bp({
      action: "connect_pins",
      graphName: "EventGraph",
      sourceNode: a,
      sourcePin: ap,
      targetNode: b,
      targetPin: bpPin,
    });
    console.log(`connect ${ap} -> ${bpPin}:`, r.success !== false ? "OK" : r.error || r);
    return r;
  }

  async function disconnect(a, ap, b, bpPin) {
    const r = await bp({
      action: "disconnect_pins",
      graphName: "EventGraph",
      sourceNode: a,
      sourcePin: ap,
      targetNode: b,
      targetPin: bpPin,
    });
    console.log(`disconnect ${ap} -> ${bpPin}:`, r.success !== false ? "OK" : r.error || r);
    return r;
  }

  // Identify up-vector add input on finalAdd
  const finalInputs = data.filter((e) => e.to === finalAddId);
  let upInputEdge = null;
  let baseInputEdge = null;
  for (const e of finalInputs) {
    const fromNode = byId.get(e.from);
    const fromTitle = fromNode?.title || "";
    if (/Make Vector|0.*0.*1|Vertical|Up/i.test(fromTitle) || fromTitle === "vector * vector") {
      // trace if from mul with make 0,0,1
      upInputEdge = e;
    } else {
      baseInputEdge = e;
    }
  }
  // if two inputs to add, one should be up path
  if (finalInputs.length === 2) {
    for (const e of finalInputs) {
      let n = byId.get(e.from);
      let depth = 0;
      let isUp = false;
      while (n && depth < 6) {
        if (n.title === "Make Vector") {
          const zPin = (n.pins || []).find((p) => p.name === "Z");
          if (zPin?.defaultValue === "1.0" || zPin?.defaultValue === "1") isUp = true;
        }
        if ((n.title || "").includes("Max Steer Vertical")) isUp = true;
        const prev = data.find((d) => d.to === n.id && d.toPin !== "execute");
        n = prev ? byId.get(prev.from) : null;
        depth++;
      }
      if (isUp) upInputEdge = e;
      else baseInputEdge = e;
    }
  }

  console.log("\nUp input edge:", upInputEdge ? `${byId.get(upInputEdge.from)?.title}.${upInputEdge.fromPin}` : "NOT FOUND");
  console.log("Base input edge:", baseInputEdge ? `${byId.get(baseInputEdge.from)?.title}.${baseInputEdge.fromPin}` : "NOT FOUND");

  if (upInputEdge) {
    await disconnect(upInputEdge.from, upInputEdge.fromPin, upInputEdge.to, upInputEdge.toPin);
  }

  // baseInputEdge might be the fwd+right add output - use finalAdd's output path differently
  // New flow: base = fwd+right add (baseInputEdge.from OR the other add node)
  const baseAddId = baseInputEdge?.from || finalAddId;

  const breakId = await addNode("K2Node_CallFunction", { functionName: "BreakVector", functionClass: "/Script/Engine.KismetMathLibrary" }, posX, posY);
  const makeId = await addNode("K2Node_CallFunction", { functionName: "MakeVector", functionClass: "/Script/Engine.KismetMathLibrary" }, posX + 220, posY);
  const yMulId = await addNode("K2Node_PromotableOperator", { operator: "*" }, posX + 220, posY + 120);

  // Re-read graph for fresh ids if needed
  await connect(baseAddId, "ReturnValue", breakId, "InVec");
  if (!yBreak || !maxVertGet) {
    console.error("Missing Break Vector2D or Max Steer Vertical");
  } else {
    await connect(yBreak.id, "Y", yMulId, "A");
    await connect(maxVertGet.id, "Max Steer Vertical", yMulId, "B");
  }
  await connect(breakId, "X", makeId, "X");
  await connect(breakId, "Y", makeId, "Y");
  await connect(yMulId, "ReturnValue", makeId, "Z");

  // disconnect old finalAdd -> setVel if exists
  for (const e of newVelIn) {
    await disconnect(e.from, e.fromPin, e.to, e.toPin);
  }
  await connect(makeId, "ReturnValue", setNode.id, newVelIn[0]?.toPin || "NewVel");

  const comp = await bp({ action: "compile" });
  console.log("\nCompile:", comp.success !== false ? "OK" : comp);
  const val = await bp({ action: "validate" });
  console.log("Validate:", val);

  kill();
  console.log("\nDone. Vertical Z is now absolute (Y * MaxSteerVertical), not accumulated.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
