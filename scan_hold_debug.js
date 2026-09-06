const { spawn } = require("child_process");
const fs = require("fs");
const PROJECT = "D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject";
const OUT = "D:/Unreal Engine/Light_n_Shadow/scan_hold_debug.json";
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
      return { raw: t.slice(0, 150000) };
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
      clientInfo: { name: "hold-debug", version: "1" },
    });
    report.set = await call("project", {
      action: "set_project",
      projectPath: PROJECT,
    });
    const player = "/Game/BluePrint/Player/BP_ThirdPersonCharacter";
    const button = "/Game/BluePrint/Object/BP_Level2HoldButton";

    report.flowUpdate = await call("blueprint", {
      action: "get_execution_flow",
      assetPath: player,
      graphName: "EventGraph",
      entryPoint: "Update Hold",
    });

    // read hold-related graph nodes with pins
    report.holdNodes = await call("blueprint", {
      action: "read_graph",
      assetPath: player,
      graphName: "EventGraph",
      titleFilter: "Hold",
    });
    report.iaNodes = await call("blueprint", {
      action: "read_graph",
      assetPath: player,
      graphName: "EventGraph",
      titleFilter: "Level2",
    });
    report.timerNodes = await call("blueprint", {
      action: "read_graph",
      assetPath: player,
      graphName: "EventGraph",
      titleFilter: "Timer",
    });

    // component collision on button
    report.button = await call("blueprint", {
      action: "read",
      assetPath: button,
      includeComponentProperties: true,
    });
    report.buttonCube = await call("blueprint", {
      action: "get_component_properties",
      assetPath: button,
      componentName: "Cube",
    });
    report.buttonBox = await call("blueprint", {
      action: "get_component_properties",
      assetPath: button,
      componentName: "Box",
    });

    // IMC mapping?
    report.imc = await call("blueprint", {
      action: "read",
      assetPath: "/Game/Input/IMC_Player",
    });
    report.ia = await call("asset", {
      action: "get_details",
      path: "/Game/Input/Controller/IA_Level2BUtton",
    });
    report.ia2 = await call("asset", {
      action: "get_details",
      path: "/Game/Input/IA_Level2BUtton",
    });

    // find actors in level
    report.levelButtons = await call("level", {
      action: "get_actors_by_class",
      className: "BP_Level2HoldButton",
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
