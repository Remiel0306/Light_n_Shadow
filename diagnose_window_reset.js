const { spawn } = require("child_process");
const fs = require("fs");

const BP = "/Game/BluePrint/BP_WindowShadowLogic";

function mkMCP() {
  const mcp = spawn("npx.cmd", ["ue-mcp", "D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject"], { shell: true });
  let id = 1;
  const wait = new Map();
  let buf = "";
  function rpc(method, params, ms = 120000) {
    return new Promise((resolve, reject) => {
      const reqId = id++;
      const t = setTimeout(() => {
        wait.delete(reqId);
        reject(new Error(`timeout ${method}`));
      }, ms);
      wait.set(reqId, (msg) => {
        clearTimeout(t);
        resolve(msg);
      });
      mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: reqId, method, params }) + "\n");
    });
  }
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
  mcp.stderr.on("data", () => {});
  async function bp(args) {
    const r = await rpc("tools/call", { name: "blueprint", arguments: args });
    const t = r?.result?.content?.[0]?.text || "";
    try {
      return JSON.parse(t);
    } catch {
      return { success: false, raw: t.slice(0, 2000) };
    }
  }
  return { rpc, bp, kill: () => mcp.kill() };
}

function nodesFrom(summary) {
  if (Array.isArray(summary)) return summary;
  if (Array.isArray(summary?.nodes)) return summary.nodes;
  if (Array.isArray(summary?.summary)) return summary.summary;
  return [];
}

async function main() {
  const { rpc, bp, kill } = mkMCP();
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "diag-win-reset" } });

  const read = await bp({ action: "read", path: BP, assetPath: BP });
  fs.writeFileSync("D:/Unreal Engine/Light_n_Shadow/_window_shadow_read.json", JSON.stringify(read, null, 2));
  console.log("components:", (read.components || []).map((c) => c.name).join(", "));

  const vars = await bp({ action: "list_variables", path: BP, assetPath: BP });
  fs.writeFileSync("D:/Unreal Engine/Light_n_Shadow/_window_shadow_vars.json", JSON.stringify(vars, null, 2));
  console.log("variables:", JSON.stringify(vars, null, 2).slice(0, 2500));

  for (const graphName of ["EventGraph", "ResetOneShadowCollider"]) {
    const sum = await bp({ action: "read_graph_summary", path: BP, assetPath: BP, graphName });
    const nodes = nodesFrom(sum);
    fs.writeFileSync(`D:/Unreal Engine/Light_n_Shadow/_window_${graphName}_summary.json`, JSON.stringify(sum, null, 2));
    console.log(`\n=== ${graphName} nodes: ${nodes.length} ===`);
    for (const n of nodes) {
      const t = n.title || "";
      if (/Reset|Select|Shadow Collider|Set Box|Set Collision|Array|Target/i.test(t) || /Select/.test(n.class || "")) {
        console.log(n.id, n.class, "|", t);
      }
    }
    const exportIds = nodes
      .filter((n) => {
        const t = n.title || "";
        const c = n.class || "";
        return (
          t.includes("ResetOneShadowCollider") ||
          t.includes("Reset One Shadow") ||
          c.includes("Select") ||
          (t.includes("Set Collision") && graphName === "EventGraph") ||
          (t.includes("Get") && /Shadow Collider/i.test(t))
        );
      })
      .map((n) => n.id);
    if (exportIds.length) {
      const ex = await bp({
        action: "export_nodes_t3d",
        path: BP,
        assetPath: BP,
        graphName,
        nodeIds: [...new Set(exportIds)],
      });
      const t3d = ex.t3d || ex.content || "";
      const out = `D:/Unreal Engine/Light_n_Shadow/_window_${graphName}_reset_export.t3d`;
      fs.writeFileSync(out, t3d);
      console.log(`exported ${out} len=${t3d.length}`);
    }
  }

  kill();
}

main().catch((e) => {
  console.error("FATAL", e.message);
  process.exit(1);
});
