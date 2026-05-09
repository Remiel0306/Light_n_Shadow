const { spawn } = require("child_process");

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
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "inspect-throw", version: "1" } });

  const fnList = await bp({ action: "list_functions", path: BP, assetPath: BP });
  console.log("functions:", JSON.stringify(fnList).slice(0, 3000));

  const graphs = await bp({ action: "list_graphs", path: BP, assetPath: BP });
  console.log("graphs:", JSON.stringify(graphs).slice(0, 2500));

  const rawList = graphs.graphs || graphs.list || graphs.data || graphs;
  const names = (Array.isArray(rawList) ? rawList : [])
    .map((g) => (typeof g === "string" ? g : g.name || g.graphName || g.Name))
    .filter(Boolean);
  const want = names.filter((n) => /throw|Throw|AI/i.test(String(n)));
  console.log("candidate graphs:", want);

  for (const g of ["throw ball", "Throw Ball", "throw_ball", "AI throwC", "AI ThrowC"]) {
    const sum = await bp({ action: "read_graph_summary", path: BP, assetPath: BP, graphName: g });
    if (sum.success === false && sum.error) {
      console.log("skip", g, sum.error?.slice(0, 80));
      continue;
    }
    const nodes = Array.isArray(sum) ? sum : sum.nodes || sum.summary || [];
    console.log("\n===", g, "node count", nodes.length, "===");
    const interesting = nodes.filter(
      (n) =>
        (n.title || "").match(/Spawn|Add|Array|Length|Branch|If|Function|Return/i) ||
        (n.class || "").match(/Spawn|Array|Branch|IfThen|Macro|Return/i)
    );
    interesting.slice(0, 40).forEach((n) => console.log(n.class, "|", n.title, "|", n.id));
  }

  kill();
})().catch((e) => console.error(e));
