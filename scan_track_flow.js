const { spawn } = require("child_process");
const fs = require("fs");
const PROJECT = "D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject";
const OUT = "D:/Unreal Engine/Light_n_Shadow/scan_after_track5.json";
const mcp = spawn("npx.cmd", ["ue-mcp", PROJECT], {
  shell: true,
  cwd: "D:/Unreal Engine/Light_n_Shadow",
});
let id = 1,
  buf = "",
  wait = new Map();
function rpc(method, params, timeoutMs = 60000) {
  return new Promise((res, rej) => {
    const i = id++;
    const t = setTimeout(() => {
      wait.delete(i);
      rej(new Error("timeout " + method));
    }, timeoutMs);
    wait.set(i, (m) => {
      clearTimeout(t);
      res(m);
    });
    mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n");
  });
}
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
(async () => {
  try {
    await rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "scan5", version: "1" },
    });
    const tools = await rpc("tools/list", {});
    const bp = (tools.result.tools || []).find((t) => t.name === "blueprint");
    const desc = bp ? bp.description : "";
    // extract get_execution_flow section
    const idx = desc.indexOf("get_execution_flow");
    const snippet = desc.slice(Math.max(0, idx - 50), idx + 800);

    async function call(name, args) {
      const r = await rpc("tools/call", { name, arguments: args });
      if (r.error) return { error: r.error };
      const c = r.result && r.result.content;
      if (Array.isArray(c)) {
        const t = c.map((x) => x.text || JSON.stringify(x)).join("\n");
        try {
          return JSON.parse(t);
        } catch {
          return { raw: t.slice(0, 100000) };
        }
      }
      return r.result || r;
    }

    const assetPath = "/Game/BluePrint/Enemy/BP_EnemySpotter-Ins";
    const nodeId = "D471B0B24DFCD64D87982AB1C0980D48";
    const tries = {
      nodeId: await call("blueprint", {
        action: "get_execution_flow",
        assetPath,
        graphName: "EventGraph",
        nodeId,
      }),
      startNodeId: await call("blueprint", {
        action: "get_execution_flow",
        assetPath,
        graphName: "EventGraph",
        startNodeId: nodeId,
      }),
      entryNodeId: await call("blueprint", {
        action: "get_execution_flow",
        assetPath,
        graphName: "EventGraph",
        entryNodeId: nodeId,
      }),
      fromNodeId: await call("blueprint", {
        action: "get_execution_flow",
        assetPath,
        graphName: "EventGraph",
        fromNodeId: nodeId,
      }),
      export: await call("blueprint", {
        action: "export_nodes_t3d",
        assetPath,
        graphName: "EventGraph",
        nodeIds: [nodeId],
      }),
    };

    // Also get summary around After Track
    const summary = await call("blueprint", {
      action: "read_graph_summary",
      assetPath,
      graphName: "EventGraph",
    });

    fs.writeFileSync(
      OUT,
      JSON.stringify({ snippet, tries, summaryKeys: summary && Object.keys(summary) }, null, 2)
    );
    console.log("WROTE");
  } catch (e) {
    fs.writeFileSync(OUT, JSON.stringify({ error: String(e) }, null, 2));
    console.error(e);
  } finally {
    try {
      mcp.kill();
    } catch {}
    process.exit(0);
  }
})();
