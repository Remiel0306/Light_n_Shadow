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
  const s = await bp({ action: "read_graph_summary", path: BP, assetPath: BP, graphName: "EventGraph" });
  fs.writeFileSync("D:/Unreal Engine/Light_n_Shadow/_summary_shadowlogic.json", JSON.stringify(s, null, 2));
  const nodes = s.nodes || [];
  console.log("nodes", nodes.length);
  nodes
    .filter((n) => (n.title || "").includes("Knot") || (n.title || "").includes("Reroute") || (n.class || "").includes("Knot"))
    .slice(0, 20)
    .forEach((n) => console.log(n.id, n.class, n.title));
  m.kill();
})();
