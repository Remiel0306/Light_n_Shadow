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
const OUT = "D:/Unreal Engine/Light_n_Shadow/_thirdperson_shadows_connect.json";

(async () => {
  const { rpc, bp, kill } = mkMCP();
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "sc-tp", version: "1" } });

  const sum = await bp({ action: "read_graph_summary", path: BP, assetPath: BP, graphName: "EventGraph" });
  const nodes = sum.nodes || [];
  console.log("EventGraph nodes:", nodes.length);

  const hit = nodes.filter((n) => {
    const t = `${n.title || ""} ${n.class || ""}`.toLowerCase();
    return /shadow|connect|stomp|queue|visited|overlap|bpi_shadow|interface|while|primitive|enemy/.test(t);
  });
  console.log("--- shadow/connect related in EventGraph ---");
  hit.forEach((n) => console.log(n.id, "|", n.class, "|", n.title));

  const graphs = ["Shadows Connect", "Shadow Connect", "FindEnemiesConnectedToShadow", "Find Shadow"];
  for (const g of graphs) {
    const fg = await bp({
      action: "read_graph_summary",
      path: BP,
      assetPath: BP,
      graphName: g,
    });
    const fn = fg.nodes || [];
    if (fn.length) {
      console.log(`\n=== Function graph: ${g} (${fn.length} nodes) ===`);
      fn.forEach((n) => console.log(n.id, "|", n.class, "|", n.title));
    }
  }

  const listFn = await bp({ action: "list_graphs", path: BP, assetPath: BP });
  const graphsList = listFn.graphs || listFn.functions || listFn;
  console.log("\n--- list_graphs ---");
  console.log(JSON.stringify(graphsList, null, 2).slice(0, 4000));

  fs.writeFileSync(
    OUT,
    JSON.stringify({ path: BP, eventGraphHits: hit, listGraphs: graphsList, allEventCount: nodes.length }, null, 2)
  );
  console.log("wrote", OUT);
  kill();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
