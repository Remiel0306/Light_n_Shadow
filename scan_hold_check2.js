const { spawn } = require("child_process");
const fs = require("fs");
const PROJECT = "D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject";
const OUT = "D:/Unreal Engine/Light_n_Shadow/scan_hold_input.json";
const mcp = spawn("npx.cmd", ["ue-mcp", PROJECT], {
  shell: true,
  cwd: "D:/Unreal Engine/Light_n_Shadow",
});
let id = 1,
  buf = "",
  wait = new Map();
function rpc(method, params, timeoutMs = 90000) {
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
async function call(name, args) {
  const r = await rpc("tools/call", { name, arguments: args });
  if (r.error) return { error: r.error };
  const c = r.result && r.result.content;
  if (Array.isArray(c)) {
    const t = c.map((x) => x.text || JSON.stringify(x)).join("\n");
    try {
      return JSON.parse(t);
    } catch {
      return { raw: t.slice(0, 200000) };
    }
  }
  return r.result || r;
}
(async () => {
  try {
    await rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "hold-scan2", version: "1" },
    });
    await call("project", { action: "set_project", projectPath: PROJECT });
    const player = "/Game/BluePrint/Player/BP_ThirdPersonCharacter";
    // read graph filtered
    const graph = await call("blueprint", {
      action: "read_graph",
      assetPath: player,
      graphName: "EventGraph",
      titleFilter: "Hold",
    });
    const graph2 = await call("blueprint", {
      action: "read_graph",
      assetPath: player,
      graphName: "EventGraph",
      titleFilter: "Level2",
    });
    const graph3 = await call("blueprint", {
      action: "read_graph",
      assetPath: player,
      graphName: "EventGraph",
      titleFilter: "IA_Level2",
    });
    // full flow with more detail - get flow again and also search nodes
    const flow = await call("blueprint", {
      action: "get_execution_flow",
      assetPath: player,
      graphName: "EventGraph",
      entryPoint: "Update Hold",
    });
    // find enhanced input by reading summary
    const summary = await call("blueprint", {
      action: "read_graph_summary",
      assetPath: player,
      graphName: "EventGraph",
    });
    fs.writeFileSync(
      OUT,
      JSON.stringify({ graph, graph2, graph3, flow, summaryKeys: summary && Object.keys(summary) }, null, 2)
    );
    console.log("WROTE");
  } catch (e) {
    fs.writeFileSync(OUT, JSON.stringify({ error: String(e) }, null, 2));
  } finally {
    try {
      mcp.kill();
    } catch {}
    process.exit(0);
  }
})();
