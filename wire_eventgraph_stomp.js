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
        reject(new Error(`timeout ${method}`));
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
      return { raw: t };
    }
  }
  return { rpc, bp, kill: () => mcp.kill() };
}

const BP = "/Game/BluePrint/BP_ThirdPersonCharacter";

(async () => {
  const { rpc, bp, kill } = mkMCP();
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "eg-scan", version: "1" } });

  const eg = await bp({ action: "read_graph_summary", path: BP, assetPath: BP, graphName: "EventGraph" });
  const vars = await bp({ action: "list_variables", path: BP, assetPath: BP });
  const funcs = await bp({ action: "list_functions", path: BP, assetPath: BP });

  const out = { vars, funcs: funcs.functions, nodes: eg.nodes, exec: eg.execEdges, data: eg.dataEdges };
  fs.writeFileSync("D:/Unreal Engine/Light_n_Shadow/_eventgraph_scan.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  kill();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
