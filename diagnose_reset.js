const { spawn } = require("child_process");
const fs = require("fs");

function mkMCP() {
  const mcp = spawn("npx.cmd", ["ue-mcp", "D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject"], { shell: true });
  let id = 1;
  const wait = new Map();
  let buf = "";

  function rpc(method, params) {
    return new Promise((resolve, reject) => {
      const reqId = id++;
      const t = setTimeout(() => {
        wait.delete(reqId);
        reject(new Error(`timeout ${method}`));
      }, 90000);
      wait.set(reqId, (msg) => {
        clearTimeout(t);
        resolve(msg);
      });
      mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: reqId, method, params }) + "\n");
    });
  }

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
  mcp.stderr.on("data", () => {});

  async function bp(args) {
    const r = await rpc("tools/call", { name: "blueprint", arguments: args });
    const t = r?.result?.content?.[0]?.text || "";
    try {
      return JSON.parse(t);
    } catch {
      return { success: false, raw: t.slice(0, 1200) };
    }
  }

  return { rpc, bp, kill: () => mcp.kill() };
}

async function main() {
  const BP = "/Game/BluePrint/BP_Enemy1";
  const { rpc, bp, kill } = mkMCP();
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "diagnose-reset", version: "1" } });

  const summary = await bp({ action: "read_graph_summary", path: BP, assetPath: BP, graphName: "EventGraph" });
  if (summary.success === false) {
    console.log("SUMMARY_FAIL", summary.error || summary.raw || "unknown");
    kill();
    return;
  }
  const nodes = Array.isArray(summary) ? summary : summary.nodes || summary.summary || [];
  const endOverlap = nodes.find((n) => n.class === "K2Node_ComponentBoundEvent" && (n.title || "").includes("End Overlap"));
  const resetCalls = nodes.filter((n) => (n.title || "").includes("ResetOneShadowCollider"));
  const setArray = nodes.filter((n) => n.class === "K2Node_CallArrayFunction" && (n.title || "").includes("Set Array Elem"));
  const setCollision = nodes.filter((n) => n.class === "K2Node_CallFunction" && (n.title || "").includes("Set Collision Enabled"));

  console.log("END_OVERLAP", endOverlap ? endOverlap.id : "NONE");
  console.log("RESET_CALLS", resetCalls.length);
  console.log("SET_ARRAY_ELEM", setArray.length);
  console.log("SET_COLLISION_ENABLED", setCollision.length);

  // Try function graph summary for ResetOneShadowCollider
  const resetGraph = await bp({ action: "read_graph_summary", path: BP, assetPath: BP, graphName: "ResetOneShadowCollider" });
  if (resetGraph.success === false) {
    console.log("RESET_GRAPH_FAIL", resetGraph.error || resetGraph.raw || "unknown");
  } else {
    const rn = Array.isArray(resetGraph) ? resetGraph : resetGraph.nodes || resetGraph.summary || [];
    console.log("RESET_GRAPH_NODES", rn.length);
    for (const n of rn) {
      const t = n.title || "";
      if (
        t.includes("Set World Location") ||
        t.includes("Set World Rotation") ||
        t.includes("Set Box Extent") ||
        t.includes("Set Collision Enabled") ||
        t.includes("Select")
      ) {
        console.log("RESET_NODE", n.class, t, n.id);
      }
    }
  }

  const exportIds = [];
  if (endOverlap) exportIds.push(endOverlap.id);
  for (const n of resetCalls) exportIds.push(n.id);
  for (const n of setArray) exportIds.push(n.id);
  for (const n of setCollision) exportIds.push(n.id);

  if (exportIds.length > 0) {
    const ex = await bp({
      action: "export_nodes_t3d",
      path: BP,
      assetPath: BP,
      graphName: "EventGraph",
      nodeIds: [...new Set(exportIds)],
    });
    if (ex.success === false) {
      console.log("EXPORT_FAIL", ex.error || ex.raw || "unknown");
    } else {
      const t3d = ex.t3d || ex.content || "";
      fs.writeFileSync("D:/Unreal Engine/Light_n_Shadow/diagnose_reset_eventgraph.t3d", t3d);
      console.log("EXPORTED_EVENTGRAPH_T3D", t3d.length);
    }
  }

  // Export reset function nodes if possible
  const resetSummary2 = await bp({ action: "read_graph_summary", path: BP, assetPath: BP, graphName: "ResetOneShadowCollider" });
  if (resetSummary2.success !== false) {
    const rn = Array.isArray(resetSummary2) ? resetSummary2 : resetSummary2.nodes || resetSummary2.summary || [];
    if (rn.length > 0) {
      const rex = await bp({
        action: "export_nodes_t3d",
        path: BP,
        assetPath: BP,
        graphName: "ResetOneShadowCollider",
        nodeIds: rn.map((n) => n.id),
      });
      if (rex.success === false) {
        console.log("EXPORT_RESET_FAIL", rex.error || rex.raw || "unknown");
      } else {
        const t3d = rex.t3d || rex.content || "";
        fs.writeFileSync("D:/Unreal Engine/Light_n_Shadow/diagnose_reset_function.t3d", t3d);
        console.log("EXPORTED_RESET_T3D", t3d.length);
      }
    }
  }

  kill();
}

main().catch((e) => {
  console.error("FATAL", e.message);
  process.exit(1);
});

