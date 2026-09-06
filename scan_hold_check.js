const { spawn } = require("child_process");
const fs = require("fs");
const PROJECT = "D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject";
const OUT = "D:/Unreal Engine/Light_n_Shadow/scan_hold_check.json";
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
      return { raw: t.slice(0, 100000) };
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
      clientInfo: { name: "hold-scan", version: "1" },
    });
    report.setp = await call("project", {
      action: "set_project",
      projectPath: PROJECT,
    });
    report.status = await call("project", { action: "get_status" });
    if (!report.status?.editorConnected && !report.setp?.editorConnected) {
      fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
      console.log("NOT_CONNECTED");
      process.exit(0);
    }
    const player = "/Game/BluePrint/Player/BP_ThirdPersonCharacter";
    report.vars = await call("blueprint", {
      action: "list_variables",
      assetPath: player,
    });
    report.flowUpdateHold = await call("blueprint", {
      action: "get_execution_flow",
      assetPath: player,
      graphName: "EventGraph",
      entryPoint: "Update Hold",
    });
    report.flowUpdateHold2 = await call("blueprint", {
      action: "get_execution_flow",
      assetPath: player,
      graphName: "EventGraph",
      entryPoint: "UpdateHold",
    });
    // try IA related
    for (const name of [
      "IA_Level2Button",
      "IA_Level2DoorHold",
      "EnhancedInputAction IA_Level2Button",
    ]) {
      report["flow_" + name] = await call("blueprint", {
        action: "get_execution_flow",
        assetPath: player,
        graphName: "EventGraph",
        entryPoint: name,
      });
    }
    report.graphs = await call("blueprint", {
      action: "list_graphs",
      assetPath: player,
    });
    // door bp
    report.door = await call("blueprint", {
      action: "read",
      assetPath: "/Game/BluePrint/Object/BP_Level2HoldButton",
    });
    report.door2 = await call("blueprint", {
      action: "read",
      assetPath: "/Game/BluePrint/Object/BP_Level2DoorButton",
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
