/**
 * Implement plan: Shadow Collision Compute — Distance = Hit-Start if blocking else End-Start;
 * half extent = Distance*0.5 on long axis; optional midpoint + look-at (if nodes added).
 */
const { spawn } = require("child_process");
const fs = require("fs");

const PROJECT = "D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject";
const BP = "/Game/BluePrint/BP_Enemy1";
const GRAPH = "EventGraph";

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
        reject(new Error("timeout " + method));
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
      return { raw: t, _err: true };
    }
  }
  return { rpc, bp, kill: () => mcp.kill() };
}

(async () => {
  const { rpc, bp, kill } = mkMCP();
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "shadow-compute", version: "1" } });

  const sum = await bp({ action: "read_graph_summary", path: BP, assetPath: BP, graphName: GRAPH });
  const nodes = Array.isArray(sum) ? sum : sum.nodes || [];
  const find = (re) => nodes.filter((n) => re.test(n.title || ""));

  const computeEvt = nodes.find((n) => n.class === "K2Node_CustomEvent" && (n.title || "").includes("Shadow Collision Compute"));
  const traces = find(/Line Trace By Channel/i);
  const breaks = find(/Break Hit Result/i);
  const setExtents = find(/Set Box Extent/i);

  console.log("Shadow Collision Compute:", computeEvt ? `${computeEvt.id} ${computeEvt.title}` : "NOT FOUND");
  console.log("Line traces:", traces.map((n) => n.id).join(", "));
  console.log("Break hits:", breaks.map((n) => n.id).join(", "));
  console.log("Set Box Extent:", setExtents.length);

  // Try execution flow from custom event
  let flow = await bp({
    action: "get_execution_flow",
    path: BP,
    assetPath: BP,
    graphName: GRAPH,
    eventName: "Shadow Collision Compute",
  });
  if (flow._err || flow.error) {
    console.log("get_execution_flow by name failed, try nodeId", computeEvt?.id);
    if (computeEvt) {
      flow = await bp({ action: "get_execution_flow", path: BP, assetPath: BP, graphName: GRAPH, nodeId: computeEvt.id });
    }
  }
  fs.writeFileSync("D:/Unreal Engine/Light_n_Shadow/_shadow_compute_flow.json", JSON.stringify(flow, null, 2));
  console.log("Wrote _shadow_compute_flow.json");

  // Export nodes near compute: custom event + first trace in file by position if multiple
  const exportIds = new Set();
  if (computeEvt) exportIds.add(computeEvt.id);
  traces.slice(0, 3).forEach((n) => exportIds.add(n.id));
  breaks.slice(0, 3).forEach((n) => exportIds.add(n.id));
  setExtents.slice(0, 6).forEach((n) => exportIds.add(n.id));

  const ids = [...exportIds];
  if (ids.length) {
    const ex = await bp({ action: "export_nodes_t3d", path: BP, assetPath: BP, graphName: GRAPH, nodeIds: ids });
    const t3d = ex.t3d || ex.content || "";
    fs.writeFileSync("D:/Unreal Engine/Light_n_Shadow/_shadow_compute_export.t3d", t3d);
    console.log("Wrote _shadow_compute_export.t3d", t3d.length, ex.error || "");
  }

  kill();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
