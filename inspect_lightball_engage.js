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

const BP = "/Game/BluePrint/BP_LightBall";

(async () => {
  const { rpc, bp, kill } = mkMCP();
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "inspect-engage", version: "1" } });

  const lf = await bp({ action: "list_functions", path: BP, assetPath: BP });
  console.log("functions:", JSON.stringify(lf, null, 2));

  const graphs = await bp({ action: "list_graphs", path: BP, assetPath: BP });
  console.log("graphs:", JSON.stringify(graphs, null, 2));

  const sum = await bp({ action: "read_graph_summary", path: BP, assetPath: BP, graphName: "EventGraph" });
  const nodes = Array.isArray(sum) ? sum : sum.nodes || sum.summary || [];
  const hit = nodes.filter((n) => {
    const t = (n.title || "") + (n.class || "");
    return /Engage|engage|Destory|Destroy|Ball|ThirdPerson|GetActor|ActorOfClass/i.test(t);
  });
  console.log("\n=== matching nodes", hit.length, "===");
  hit.forEach((n) => console.log(n.id, "|", n.class, "|", n.title));

  const ids = hit.map((n) => n.id).filter(Boolean);
  if (ids.length) {
    const ex = await bp({ action: "export_nodes_t3d", path: BP, assetPath: BP, graphName: "EventGraph", nodeIds: ids });
    const t3d = ex.t3d || ex.content || "";
    fs.writeFileSync("D:/Unreal Engine/Light_n_Shadow/bp_lightball_engage_export.t3d", t3d);
    console.log("\nWrote bp_lightball_engage_export.t3d", t3d.length, "bytes", ex.error || "");
  }

  // Also try function graph if Engage is a function
  const fnNames = (lf.functions || []).map((f) => f.name);
  const engageFn = fnNames.find((n) => /engage/i.test(n));
  if (engageFn) {
    const s2 = await bp({ action: "read_graph_summary", path: BP, assetPath: BP, graphName: engageFn });
    const n2 = Array.isArray(s2) ? s2 : s2.nodes || s2.summary || [];
    console.log("\n=== function", engageFn, "nodes", n2.length);
    const ex2 = await bp({
      action: "export_nodes_t3d",
      path: BP,
      assetPath: BP,
      graphName: engageFn,
      nodeIds: n2.map((x) => x.id),
    });
    const t2 = ex2.t3d || ex2.content || "";
    fs.writeFileSync("D:/Unreal Engine/Light_n_Shadow/bp_lightball_engage_fn.t3d", t2);
    console.log("Wrote bp_lightball_engage_fn.t3d", t2.length, ex2.error || "");
  }

  kill();
})().catch(console.error);
