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
      return { raw: t };
    }
  }
  return { rpc, bp, kill: () => mcp.kill() };
}

const BP = "/Game/BluePrint/BP_ThirdPersonCharacter";

(async () => {
  const { rpc, bp, kill } = mkMCP();
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "inspect-destroy-ball", version: "1" } });

  const lf = await bp({ action: "list_functions", path: BP, assetPath: BP });
  console.log("list_functions:", JSON.stringify(lf, null, 2).slice(0, 8000));

  const names = (lf.functions || []).map((f) => f.name || f);
  const hit = names.filter((n) => /destroy|destory|ball/i.test(String(n)));
  console.log("\nmatching function names:", hit);

  for (const g of hit.length ? hit : names) {
    const sum = await bp({ action: "read_graph_summary", path: BP, assetPath: BP, graphName: g });
    if (sum.error || sum.raw) {
      console.log("read_graph_summary fail", g, sum.error || sum.raw?.slice(0, 200));
      continue;
    }
    const nodes = Array.isArray(sum) ? sum : sum.nodes || sum.summary || [];
    console.log("\n===", g, "nodes", nodes.length, "===");
    nodes.forEach((n) => console.log(n.class, "|", n.title, "|", n.id));
  }

  // Export T3D for destroy-related graph
  const targetGraph = hit[0] || names.find((n) => /destroy/i.test(n));
  if (targetGraph) {
    const sum2 = await bp({ action: "read_graph_summary", path: BP, assetPath: BP, graphName: targetGraph });
    const nodes2 = Array.isArray(sum2) ? sum2 : sum2.nodes || sum2.summary || [];
    const ids = nodes2.map((n) => n.id).filter(Boolean);
    if (ids.length) {
      const ex = await bp({
        action: "export_nodes_t3d",
        path: BP,
        assetPath: BP,
        graphName: targetGraph,
        nodeIds: ids,
      });
      const t3d = ex.t3d || ex.content || "";
      fs.writeFileSync("D:/Unreal Engine/Light_n_Shadow/destroy_ball_function.t3d", t3d);
      console.log("\nWrote destroy_ball_function.t3d bytes=", t3d.length, ex.error || "");
    }
  }

  kill();
})().catch((e) => console.error(e));
