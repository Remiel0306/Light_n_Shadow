/**
 * Plan implementation on BP_EnemyShadowLogic (EventGraph): segment length for box / shadow distance.
 * Node IDs from live _summary_shadowlogic.json (May 2026).
 */
const { spawn } = require("child_process");

const PROJECT = "D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject";
const BP = "/Game/BluePrint/BP_EnemyShadowLogic";
const GRAPH = "EventGraph";

const IDS = {
  knotStart: "51XraES3z5-GkpOubQXjWQ",
  trace: "sfFoNk8icJGtHU2-pIUNTg",
  breakHit: "LuDvzUdFYf3j_2uQTvAILg",
  endVec: "FC97YEOfVoT20meNoOpNmg",
  setDist: "w6OeCkVSWJP2TLuIdKSyyg",
  floatDiv: "ddIBTUrp1cVr6xi_Lw5N_w",
  oldSub: "NNJ1DUojvHPFc_uQ2JgEUw",
  oldLen: "juG_A0eG54QHTjmk91aGGw",
};

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
        reject(new Error("timeout"));
      }, 180000);
      wait.set(i, (x) => {
        clearTimeout(t);
        resolve(x);
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
      return { raw: t, _err: true };
    }
  }
  return { rpc, bp, kill: () => mcp.kill() };
}

async function addNode(bp, nodeClass, nodeParams, posX, posY) {
  const p = await bp({
    action: "add_node",
    path: BP,
    assetPath: BP,
    graphName: GRAPH,
    nodeClass,
    nodeParams: nodeParams || {},
    posX,
    posY,
  });
  if (!p.success) throw new Error(p.error || JSON.stringify(p));
  return p.nodeId;
}

async function connect(bp, sourceNode, sourcePin, targetNode, targetPin) {
  const p = await bp({
    action: "connect_pins",
    path: BP,
    assetPath: BP,
    graphName: GRAPH,
    sourceNode,
    sourcePin,
    targetNode,
    targetPin,
  });
  if (!p.success && !p.existed) throw new Error(`connect ${sourceNode}.${sourcePin} -> ${targetNode}.${targetPin}: ${p.error || JSON.stringify(p)}`);
  return p;
}

(async () => {
  const { rpc, bp, kill } = mkMCP();
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "seg", version: "1" } });

  const gx = 2600;
  const gy = 2280;

  const subHit = await addNode(bp, "CallFunction", {
    functionName: "Subtract_VectorVector",
    targetClass: "/Script/Engine.KismetMathLibrary",
  }, gx, gy);
  const subFull = await addNode(bp, "CallFunction", {
    functionName: "Subtract_VectorVector",
    targetClass: "/Script/Engine.KismetMathLibrary",
  }, gx, gy + 160);
  const vHit = await addNode(bp, "CallFunction", { functionName: "VSize", targetClass: "/Script/Engine.KismetMathLibrary" }, gx + 240, gy);
  const vFull = await addNode(bp, "CallFunction", { functionName: "VSize", targetClass: "/Script/Engine.KismetMathLibrary" }, gx + 240, gy + 160);
  const sel = await addNode(bp, "CallFunction", {
    functionName: "SelectFloat",
    targetClass: "/Script/Engine.KismetMathLibrary",
  }, gx + 480, gy + 80);

  await connect(bp, IDS.breakHit, "Location", subHit, "A");
  await connect(bp, IDS.knotStart, "OutputPin", subHit, "B");
  await connect(bp, subHit, "ReturnValue", vHit, "A");

  await connect(bp, IDS.endVec, "ReturnValue", subFull, "A");
  await connect(bp, IDS.knotStart, "OutputPin", subFull, "B");
  await connect(bp, subFull, "ReturnValue", vFull, "A");

  await connect(bp, vHit, "ReturnValue", sel, "A");
  await connect(bp, vFull, "ReturnValue", sel, "B");
  await connect(bp, IDS.trace, "ReturnValue", sel, "bPickA");

  await connect(bp, sel, "ReturnValue", IDS.setDist, "Shadow colision distance");
  await connect(bp, sel, "ReturnValue", IDS.floatDiv, "A");

  await bp({ action: "delete_node", path: BP, assetPath: BP, graphName: GRAPH, nodeId: IDS.oldLen });
  await bp({ action: "delete_node", path: BP, assetPath: BP, graphName: GRAPH, nodeId: IDS.oldSub });

  await bp({ action: "compile_blueprint", path: BP, assetPath: BP });
  console.log("OK: segment SelectFloat -> Set Shadow colision distance + float/float; removed old vector length chain.");
  kill();
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
