const { spawn } = require("child_process");
const fs = require("fs");
const PROJECT = "D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject";
const OUT = "D:/Unreal Engine/Light_n_Shadow/hold_impl_log.json";
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
      return { raw: t.slice(0, 50000) };
    }
  }
  return r.result || r;
}
(async () => {
  const log = {};
  try {
    await rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "hold-impl", version: "1" },
    });
    // Discover tools briefly
    const tools = await rpc("tools/list", {});
    const names = (tools.result.tools || []).map((t) => t.name);
    log.tools = names;

    // Check if assets exist
    log.doorExists = await call("assets", {
      action: "exists",
      path: "/Game/BluePrint/Object/BP_Level2DoorButton",
    }).catch((e) => ({ error: String(e) }));

    log.playerRead = await call("blueprint", {
      action: "read",
      assetPath: "/Game/BluePrint/Player/BP_ThirdPersonCharacter",
    }).catch((e) => ({ error: String(e) }));

    log.imcRead = await call("assets", {
      action: "read",
      path: "/Game/Input/IMC_Player",
    }).catch((e) => ({ error: String(e) }));

    // Try input/gameplay handlers
    log.searchIA = await call("assets", {
      action: "search",
      query: "IA_",
      path: "/Game/Input",
      limit: 30,
    }).catch((e) => ({ error: String(e) }));

    fs.writeFileSync(OUT, JSON.stringify(log, null, 2));
    console.log("WROTE probe");
  } catch (e) {
    fs.writeFileSync(OUT, JSON.stringify({ error: String(e), log }, null, 2));
    console.error(e);
  } finally {
    try {
      mcp.kill();
    } catch {}
    process.exit(0);
  }
})();
