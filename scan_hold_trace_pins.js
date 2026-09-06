const { spawn } = require("child_process");
const fs = require("fs");
const PROJECT = "D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject";
const OUT = "D:/Unreal Engine/Light_n_Shadow/scan_hold_trace_pins.json";
const mcp = spawn("npx.cmd", ["ue-mcp", PROJECT], {
  shell: true,
  cwd: "D:/Unreal Engine/Light_n_Shadow",
});
let id = 1,
  buf = "",
  wait = new Map();
function rpc(method, params, timeoutMs = 120000) {
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
  const report = {};
  try {
    await rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "hold-trace", version: "1" },
    });
    report.set = await call("project", {
      action: "set_project",
      projectPath: PROJECT,
    });
    const player = "/Game/BluePrint/Player/BP_ThirdPersonCharacter";

    // Read graph nodes around Update Hold with pin links
    report.updateHold = await call("blueprint", {
      action: "read_graph",
      assetPath: player,
      graphName: "EventGraph",
      titleFilter: "Update Hold",
      includePins: true,
    });
    report.sphere = await call("blueprint", {
      action: "read_graph",
      assetPath: player,
      graphName: "EventGraph",
      titleFilter: "Sphere Trace",
      includePins: true,
    });
    report.forward = await call("blueprint", {
      action: "read_graph",
      assetPath: player,
      graphName: "EventGraph",
      titleFilter: "Forward",
      includePins: true,
    });
    report.camera = await call("blueprint", {
      action: "read_graph",
      assetPath: player,
      graphName: "EventGraph",
      titleFilter: "Camera",
      includePins: true,
    });
    report.holding = await call("blueprint", {
      action: "read_graph",
      assetPath: player,
      graphName: "EventGraph",
      titleFilter: "Holding",
      includePins: true,
    });
    report.print = await call("blueprint", {
      action: "read_graph",
      assetPath: player,
      graphName: "EventGraph",
      titleFilter: "Print",
      includePins: true,
    });
    report.iaFlow = await call("blueprint", {
      action: "get_execution_flow",
      assetPath: player,
      graphName: "EventGraph",
      entryPoint: "EnhancedInputAction IA_Level2BUtton",
    });
    // try alternate entry names
    report.iaFlow2 = await call("blueprint", {
      action: "get_execution_flow",
      assetPath: player,
      graphName: "EventGraph",
      entryPoint: "IA_Level2BUtton",
    });
    report.vars = await call("blueprint", {
      action: "list_variables",
      assetPath: player,
    });
    // components collision summary
    for (const comp of ["Cube", "Box", "StaticMesh", "Mesh"]) {
      report["comp_" + comp] = await call("blueprint", {
        action: "get_component_properties",
        assetPath: "/Game/BluePrint/Object/BP_Level2HoldButton",
        componentName: comp,
      });
    }
    report.levelButtons = await call("level", {
      action: "get_actors_by_class",
      className: "/Script/Engine.Actor",
      nameFilter: "Level2",
    });
    report.levelButtons2 = await call("level", {
      action: "get_actors_by_class",
      className: "BP_Level2HoldButton_C",
    });
    report.imcMappings = await call("asset", {
      action: "get_details",
      path: "/Game/Input/IMC_Player",
    });

    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log("WROTE");
  } catch (e) {
    fs.writeFileSync(OUT, JSON.stringify({ error: String(e), report }, null, 2));
    console.error(e);
  } finally {
    try {
      mcp.kill();
    } catch {}
    process.exit(0);
  }
})();
