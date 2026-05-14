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
  const r = await bp({
    action: "read_blueprint_graph",
    path: "/Game/BluePrint/BP_EnemyShadowLogic",
    assetPath: "/Game/BluePrint/BP_EnemyShadowLogic",
    graphName: "EventGraph",
  });
  fs.writeFileSync("D:/Unreal Engine/Light_n_Shadow/_read_graph_shadow.json", JSON.stringify(r, null, 2));
  console.log("wrote nodes", (r.nodes || []).length);
  const tr = (r.nodes || []).find((n) => (n.title || "").includes("Line Trace"));
  if (tr) console.log("trace pins", JSON.stringify(tr.pins, null, 2).slice(0, 4000));
  m.kill();
})().catch((e) => console.error(e));
