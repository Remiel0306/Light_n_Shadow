const { spawn } = require("child_process");
const fs = require("fs");
const PROJECT = "D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject";
const OUT = "D:/Unreal Engine/Light_n_Shadow/scan_hold_rootcause.json";
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
      clientInfo: { name: "hold-root", version: "1" },
    });
    await call("project", { action: "set_project", projectPath: PROJECT });
    const player = "/Game/BluePrint/Player/BP_ThirdPersonCharacter";
    const button = "/Game/BluePrint/Object/BP_Level2HoldButton";

    // pin links for hold sphere
    report.sphereLinks = await call("blueprint", {
      action: "get_node_pins",
      assetPath: player,
      graphName: "EventGraph",
      nodeId: "CF622F5642FC06CF47FE649459A3DFCD",
    });
    // try alternate
    report.sphereLinks2 = await call("blueprint", {
      action: "read_node",
      assetPath: player,
      graphName: "EventGraph",
      nodeId: "CF622F5642FC06CF47FE649459A3DFCD",
    });
    report.forwardLinks = await call("blueprint", {
      action: "read_node",
      assetPath: player,
      graphName: "EventGraph",
      nodeId: "z2IvVkL8Bs9H_mSUWaPfzQ",
    });

    // find nodes near hold by reading graph with offset and filter
    report.multiply = await call("blueprint", {
      action: "read_graph",
      assetPath: player,
      graphName: "EventGraph",
      titleFilter: "vector * float",
      includePins: true,
    });
    report.add = await call("blueprint", {
      action: "read_graph",
      assetPath: player,
      graphName: "EventGraph",
      titleFilter: "vector + vector",
      includePins: true,
    });
    report.actorFwd = await call("blueprint", {
      action: "read_graph",
      assetPath: player,
      graphName: "EventGraph",
      titleFilter: "Get Actor Forward",
      includePins: true,
    });
    report.camLoc = await call("blueprint", {
      action: "read_graph",
      assetPath: player,
      graphName: "EventGraph",
      titleFilter: "Get Camera Location",
      includePins: true,
    });
    report.breakHit = await call("blueprint", {
      action: "read_graph",
      assetPath: player,
      graphName: "EventGraph",
      titleFilter: "Break Hit Result",
      includePins: true,
    });
    report.setHoldProg = await call("blueprint", {
      action: "read_graph",
      assetPath: player,
      graphName: "EventGraph",
      titleFilter: "Set HoldProgress",
      includePins: true,
    });
    report.floatOps = await call("blueprint", {
      action: "read_graph",
      assetPath: player,
      graphName: "EventGraph",
      titleFilter: "float + float",
      includePins: true,
    });
    report.div = await call("blueprint", {
      action: "read_graph",
      assetPath: player,
      graphName: "EventGraph",
      titleFilter: "float / float",
      includePins: true,
    });

    // collision
    report.cubeCol = await call("blueprint", {
      action: "get_component_collision",
      assetPath: button,
      componentName: "Cube",
    });
    report.boxCol = await call("blueprint", {
      action: "get_component_collision",
      assetPath: button,
      componentName: "Box",
    });
    report.cubeProps = await call("blueprint", {
      action: "read_component_properties",
      assetPath: button,
      componentName: "Cube",
    });
    report.boxProps = await call("blueprint", {
      action: "read_component_properties",
      assetPath: button,
      componentName: "Box",
    });

    // IMC
    report.imcDescribe = await call("project", {
      action: "search_tools",
      query: "input mapping context",
    });
    report.imcRead = await call("blueprint", {
      action: "read",
      assetPath: "/Game/Input/IMC_Player",
    });
    report.imcAsset = await call("asset", {
      action: "read",
      path: "/Game/Input/IMC_Player",
    });
    report.iaAsset = await call("asset", {
      action: "read",
      path: "/Game/Input/Controller/IA_Level2BUtton",
    });

    // timer flow into Update Hold
    report.timerNearHold = await call("blueprint", {
      action: "read_graph",
      assetPath: player,
      graphName: "EventGraph",
      titleFilter: "Set Timer by Event",
      includePins: true,
    });
    report.clearTimer = await call("blueprint", {
      action: "read_graph",
      assetPath: player,
      graphName: "EventGraph",
      titleFilter: "Clear and Invalidate",
      includePins: true,
    });

    // describe pin link action
    report.describePins = await call("project", {
      action: "describe_action",
      category: "blueprint",
      actionName: "get_pin_connections",
    });
    report.describeLinks = await call("project", {
      action: "search_tools",
      query: "pin connection link node",
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
