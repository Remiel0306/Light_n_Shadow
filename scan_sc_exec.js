const fs = require("fs");
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
    for (const l of lines) {
      if (!l.trim()) continue;
      try {
        const m = JSON.parse(l);
        const cb = wait.get(m.id);
        if (cb) {
          wait.delete(m.id);
          cb(m);
        }
      } catch {}
    }
  });
  return {
    rpc(method, params) {
      return new Promise((resolve, reject) => {
        const i = id++;
        const t = setTimeout(() => reject(new Error("timeout")), 120000);
        wait.set(i, (m) => {
          clearTimeout(t);
          resolve(m);
        });
        mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n");
      });
    },
    kill: () => mcp.kill(),
  };
}
(async () => {
  const { rpc, kill } = mkMCP();
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "e", version: "1" } });
  const r = await rpc("tools/call", {
    name: "blueprint",
    arguments: {
      action: "read_blueprint_graph",
      path: "/Game/BluePrint/BP_ThirdPersonCharacter",
      assetPath: "/Game/BluePrint/BP_ThirdPersonCharacter",
      graphName: "Shadows Connect",
    },
  });
  const g = JSON.parse(r?.result?.content?.[0]?.text || "{}");
  const nodes = g.nodes || [];
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

  const adds = nodes.filter((n) => n.title === "Add");
  const report = adds.map((n) => {
    const pins = (n.pins || []).map((p) => ({
      name: p.name,
      dir: p.direction,
      connected: p.connected,
      def: p.defaultValue,
    }));
    return { id: n.id, pins };
  });

  // data edges to/from each Add
  const edges = [];
  for (const n of nodes) {
    for (const p of n.pins || []) {
      if (p.connected) edges.push({ node: n.title, pin: p.name, dir: p.direction });
    }
  }

  console.log(JSON.stringify({ addNodes: report, connectedPins: edges.filter((e) => e.node === "Add") }, null, 2));
  kill();
})();
