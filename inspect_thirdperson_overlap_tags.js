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
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "inspect-tp-overlap", version: "1" } });

  const sum = await bp({ action: "read_graph_summary", path: BP, assetPath: BP, graphName: "EventGraph" });
  const nodes = Array.isArray(sum) ? sum : sum.nodes || sum.summary || [];
  if (!nodes.length) {
    console.log("No nodes / MCP error:", JSON.stringify(sum).slice(0, 500));
    kill();
    return;
  }

  const hit = nodes.filter((n) => {
    const t = `${n.title || ""} ${n.class || ""}`;
    return /overlap|tag|has tag|branch|print|enemy|component/i.test(t);
  });
  console.log("=== ThirdPerson EventGraph: overlap/tag related ===");
  hit.forEach((n) => console.log(n.id, "|", n.class, "|", n.title));

  fs.writeFileSync(
    "D:/Unreal Engine/Light_n_Shadow/bp_thirdperson_overlap_tag_summary.json",
    JSON.stringify({ success: true, path: BP, graphName: "EventGraph", nodes: hit, allCount: nodes.length }, null, 2)
  );

  const ids = hit.map((n) => n.id).filter(Boolean);
  if (ids.length) {
    const ex = await bp({ action: "export_nodes_t3d", path: BP, assetPath: BP, graphName: "EventGraph", nodeIds: ids });
    const t3d = ex.t3d || ex.content || "";
    fs.writeFileSync("D:/Unreal Engine/Light_n_Shadow/bp_thirdperson_overlap_tag_export.t3d", t3d);
    console.log("\nWrote bp_thirdperson_overlap_tag_export.t3d", t3d.length, "bytes", ex.error || "");
  }

  kill();
})().catch(console.error);
