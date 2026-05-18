const { spawn } = require("child_process");
function mkMCP() {
  const mcp = spawn("npx.cmd", ["ue-mcp", "D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject"], { shell: true });
  let id = 1;
  const wait = new Map();
  let buf = "";
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
  return {
    rpc(method, params) {
      return new Promise((resolve, reject) => {
        const i = id++;
        const t = setTimeout(() => reject(new Error("timeout")), 60000);
        wait.set(i, (m) => {
          clearTimeout(t);
          resolve(m);
        });
        mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n");
      });
    },
    kill: () => mcp.kill(),
  };
}
const BP = "/Game/BluePrint/BP_ThirdPersonCharacter";
(async () => {
  const { rpc, kill } = mkMCP();
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } });
  async function bp(a) {
    const r = await rpc("tools/call", { name: "blueprint", arguments: a });
    return JSON.parse(r?.result?.content?.[0]?.text || "{}");
  }
  for (const t of [
    "/Script/Engine.PrimitiveComponent",
    "PrimitiveComponent*",
    "PrimitiveComponent",
    "object",
    "Object",
  ]) {
    await bp({ action: "delete_variable", path: BP, assetPath: BP, name: "StompedShadowTest" });
    const r = await bp({
      action: "add_variable",
      path: BP,
      assetPath: BP,
      name: "StompedShadowTest",
      type: t,
      variableType: t,
    });
    console.log("type attempt", t, JSON.stringify(r));
    const lv = await bp({ action: "list_variables", path: BP, assetPath: BP });
    const v = (lv.variables || []).find((x) => x.name === "StompedShadowTest");
    console.log("  listed:", v);
    await bp({ action: "delete_variable", path: BP, assetPath: BP, name: "StompedShadowTest" });
  }
  kill();
})();
