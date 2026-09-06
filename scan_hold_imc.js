const { spawn } = require("child_process");
const fs = require("fs");
const PROJECT = "D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject";
const OUT = "D:/Unreal Engine/Light_n_Shadow/scan_hold_imc.json";
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
      clientInfo: { name: "hold-imc", version: "1" },
    });
    await call("project", { action: "set_project", projectPath: PROJECT });

    report.searchImc = await call("asset", {
      action: "search",
      query: "IMC",
      classNames: ["InputMappingContext"],
    });
    report.searchIa = await call("asset", {
      action: "search",
      query: "Level2",
    });
    report.describeAsset = await call("project", {
      action: "describe_action",
      category: "asset",
      actionName: "read",
    });
    report.searchTools = await call("project", {
      action: "search_tools",
      query: "input mapping context mappings",
    });
    // try common IMC paths
    for (const p of [
      "/Game/Input/IMC_Player",
      "/Game/ThirdPerson/Input/IMC_Default",
      "/Game/Input/Controller/IMC_Player",
      "/Game/BluePrint/Player/IMC_Player",
    ]) {
      report["read_" + p.replace(/\//g, "_")] = await call("asset", {
        action: "read",
        assetPath: p,
      });
    }
    // cube visibility specifically
    report.cubeVis = await call("blueprint", {
      action: "get_component_collision",
      assetPath: "/Game/BluePrint/Object/BP_Level2HoldButton",
      componentName: "Cube",
    });
    // multiply * near hold - try float * vector titles
    const player = "/Game/BluePrint/Player/BP_ThirdPersonCharacter";
    report.mul1 = await call("blueprint", {
      action: "read_graph",
      assetPath: player,
      graphName: "EventGraph",
      titleFilter: "*",
      includePins: true,
      offset: 0,
      limit: 50,
    });
    // get execution flow from Update Hold with more detail - already have
    // check parent of Cube - is Cube root?
    report.buttonRead = await call("blueprint", {
      action: "read",
      assetPath: "/Game/BluePrint/Object/BP_Level2HoldButton",
      includeComponents: true,
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
