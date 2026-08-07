const { spawn } = require("child_process");
const fs = require("fs");
const PROJECT = "D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject";
const OUT = "D:/Unreal Engine/Light_n_Shadow/scan_after_track6.json";
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
      clientInfo: { name: "scan6", version: "1" },
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
    const assetPath = "/Game/BluePrint/Enemy/BP_EnemySpotter-Ins";
    const names = [
      "After Track Arrived",
      "Enter Phase 2 Track Loop",
      "Phase 2 Try to Track",
      "Start Follow",
      "Enter Phase 2",
    ];
    const flows = {};
    for (const entryPoint of names) {
      flows[entryPoint] = await call("blueprint", {
        action: "get_execution_flow",
        assetPath,
        graphName: "EventGraph",
        entryPoint,
      });
    }

    // Also read_node_property / graph with titleFilter if supported
    const filtered = await call("blueprint", {
      action: "read_graph",
      assetPath,
      graphName: "EventGraph",
      titleFilter: "After Track",
    });

    // Variables defaults
    const vars = await call("blueprint", { action: "list_variables", assetPath });
    const grabVars = (vars.variables || vars.vars || []).filter((v) =>
      /Grab|Track|Scan|Follow|Phase|MaxGrab/i.test(v.name || "")
    );

    fs.writeFileSync(OUT, JSON.stringify({ flows, filteredMeta: filtered && { success: filtered.success, nodeCount: filtered.nodeCount, keys: Object.keys(filtered) }, grabVars }, null, 2));
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
