const { spawn } = require("child_process");
const fs = require("fs");

function mkMCP() {
  const mcp = spawn("npx.cmd", ["ue-mcp", "D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject"], { shell: true });
  let id = 1;
  const wait = new Map();
  let buf = "";
  mcp.stdout.on("data", (d) => {
    buf += d.toString();
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        const cb = wait.get(msg.id);
        if (cb) {
          wait.delete(msg.id);
          cb(msg);
        }
      } catch {}
    }
  });
  function rpc(method, params) {
    return new Promise((resolve, reject) => {
      const i = id++;
      const t = setTimeout(() => {
        wait.delete(i);
        reject(new Error("timeout"));
      }, 120000);
      wait.set(i, (m) => {
        clearTimeout(t);
        resolve(m);
      });
      mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n");
    });
  }
  async function bp(args) {
    const r = await rpc("tools/call", { name: "blueprint", arguments: args });
    const t = r?.result?.content?.[0]?.text || "";
    try {
      return JSON.parse(t);
    } catch {
      return {};
    }
  }
  return { rpc, bp, kill: () => mcp.kill() };
}

const BP = "/Game/BluePrint/BP_ThirdPersonCharacter";

(async () => {
  const { rpc, bp, kill } = mkMCP();
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "ex", version: "1" } });

  const s = await bp({ action: "read_graph_summary", path: BP, assetPath: BP, graphName: "EventGraph" });
  const nodes = Array.isArray(s) ? s : s.nodes || s.summary || [];
  const pick = nodes.filter((n) => (n.title || "").match(/Destory|Destroy|Ball Array|Target Ball/i));
  const ids = pick.map((n) => n.id);
  console.log("export ids", ids);

  const ex = await bp({ action: "export_nodes_t3d", path: BP, assetPath: BP, graphName: "EventGraph", nodeIds: ids });
  const t3d = ex.t3d || ex.content || "";
  fs.writeFileSync("D:/Unreal Engine/Light_n_Shadow/destory_ball_export.t3d", t3d);
  console.log("bytes", t3d.length, ex.error || "ok");

  kill();
})().catch(console.error);
