const { spawn } = require("child_process");
const fs = require("fs");

const PROJECT = "D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject";
const BP = "/Game/BluePrint/BP_WallShadowLogic";

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
      return { raw: t, _parseError: true };
    }
  }
  return { rpc, bp, kill: () => mcp.kill() };
}

(async () => {
  const { rpc, bp, kill } = mkMCP();
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "scan-wallshadow", version: "1" },
  });

  const val = await bp({ action: "validate", path: BP, assetPath: BP });
  const vars = await bp({ action: "list_variables", path: BP, assetPath: BP });
  const funcs = await bp({ action: "list_functions", path: BP, assetPath: BP });
  const graphs = await bp({ action: "list_graphs", path: BP, assetPath: BP });
  const sum = await bp({ action: "read_graph_summary", path: BP, assetPath: BP, graphName: "EventGraph" });
  const nodes = Array.isArray(sum) ? sum : sum.nodes || [];
  const conns = sum.connections || [];

  const customEvents = nodes.filter((n) => n.class === "K2Node_CustomEvent");
  const variables = vars.variables || vars;
  const functions = funcs.functions || funcs;

  const keywords = /shadow|overlap|light|cube|slot|collider|compute|ball|trace|engage|wall|point|loop|for/i;
  const relevant = nodes.filter((n) => keywords.test(n.title || ""));

  const flows = {};
  for (const ev of customEvents.slice(0, 12)) {
    const name = (ev.title || "").replace(/\n.*/, "");
    try {
      flows[name] = await bp({
        action: "get_execution_flow",
        path: BP,
        assetPath: BP,
        graphName: "EventGraph",
        nodeId: ev.id,
      });
    } catch {
      flows[name] = { error: "flow failed" };
    }
  }

  const out = {
    validate: val,
    graphs,
    variables,
    functions: functions.map((f) => (typeof f === "string" ? f : f.name || f)),
    customEvents: customEvents.map((n) => ({ id: n.id, title: n.title })),
    relevantNodes: relevant.map((n) => ({ id: n.id, class: n.class, title: n.title })),
    allNodeTitles: [...new Set(nodes.map((n) => n.title).filter(Boolean))].sort(),
    nodeCount: nodes.length,
    connectionCount: conns.length,
    flows,
  };

  fs.writeFileSync("D:/Unreal Engine/Light_n_Shadow/_bp_wallshadow_scan.json", JSON.stringify(out, null, 2));

  const ex = await bp({
    action: "export_nodes_t3d",
    path: BP,
    assetPath: BP,
    graphName: "EventGraph",
    nodeIds: relevant.slice(0, 40).map((n) => n.id),
  });
  if (ex.t3d || ex.content) {
    fs.writeFileSync("D:/Unreal Engine/Light_n_Shadow/_bp_wallshadow_export.t3d", ex.t3d || ex.content);
  }

  console.log(
    JSON.stringify(
      {
        nodeCount: nodes.length,
        customEvents: out.customEvents,
        variableNames: (Array.isArray(variables) ? variables : []).map((v) => v.name || v),
        relevantCount: relevant.length,
      },
      null,
      2
    )
  );

  kill();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
