const { spawn } = require("child_process");
const fs = require("fs");
const m = spawn("npx.cmd", ["ue-mcp", "D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject"], { shell: true });
let id = 1;
const wait = new Map();
let buf = "";
m.stdout.on("data", (d) => {
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
    wait.set(i, (x) => {
      clearTimeout(t);
      resolve(x);
    });
    m.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n");
  });
}
async function bp(a) {
  const r = await rpc("tools/call", { name: "blueprint", arguments: a });
  const t = r?.result?.content?.[0]?.text || "";
  try {
    return JSON.parse(t);
  } catch {
    return {};
  }
}
(async () => {
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "p", version: "1" } });
  const BP = "/Game/BluePrint/BP_EnemyShadowLogic";
  const ex = await bp({
    action: "export_nodes_t3d",
    path: BP,
    assetPath: BP,
    graphName: "EventGraph",
    nodeIds: ["sfFoNk8icJGtHU2-pIUNTg"],
  });
  fs.writeFileSync("D:/Unreal Engine/Light_n_Shadow/_trace_only.t3d", ex.t3d || ex.content || "");
  console.log("len", (ex.t3d || "").length, ex.error);
  m.kill();
})();
