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
        const t = setTimeout(() => reject(new Error("timeout")), 90000);
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
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "lv", version: "1" } });
  const r = await rpc("tools/call", {
    name: "blueprint",
    arguments: { action: "list_variables", path: BP, assetPath: BP },
  });
  console.log(r?.result?.content?.[0]?.text);
  kill();
  process.exit(0);
})();
