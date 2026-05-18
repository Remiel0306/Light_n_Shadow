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
const BP = "/Game/BluePrint/BP_ThirdPersonCharacter";
const EG = "EventGraph";
const CALL_SC = "19904FAD430E0A429DBDD5883DE15D8F";
const PRINT_DONE = null;
const FOREACH = "5DADBDD64F91551B74DB03B565C14DD7";

(async () => {
  const { rpc, kill } = mkMCP();
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "simp", version: "1" } });
  async function bp(a) {
    const r = await rpc("tools/call", { name: "blueprint", arguments: a });
    try {
      return JSON.parse(r?.result?.content?.[0]?.text || "{}");
    } catch {
      return {};
    }
  }

  const sum = await bp({ action: "read_graph_summary", path: BP, assetPath: BP, graphName: EG });
  const toDel = (sum.nodes || []).filter((n) =>
    /array length|conv int to string|append|sc enemy count/i.test(n.title || "")
  );
  for (const n of toDel) {
    console.log("delete", n.title, n.id);
    await bp({ action: "delete_node", path: BP, assetPath: BP, graphName: EG, nodeName: n.id });
  }

  const printDone = (sum.nodes || []).find(
    (n) => n.title === "Print String" && n.id !== "OYrUB0pLjAEVEdqiV9r17g" && n.id !== "s5g9ck7Fbbpadf2cCYWy-g"
  );
  if (printDone) {
    await bp({
      action: "connect_pins",
      path: BP,
      assetPath: BP,
      graphName: EG,
      sourceNode: CALL_SC,
      sourcePin: "then",
      targetNode: printDone.id,
      targetPin: "execute",
    });
    if (FOREACH) {
      await bp({
        action: "connect_pins",
        path: BP,
        assetPath: BP,
        graphName: EG,
        sourceNode: printDone.id,
        sourcePin: "then",
        targetNode: FOREACH,
        targetPin: "Exec",
      });
      await bp({
        action: "connect_pins",
        path: BP,
        assetPath: BP,
        graphName: EG,
        sourceNode: CALL_SC,
        sourcePin: "Connected Enemies",
        targetNode: FOREACH,
        targetPin: "Array",
      });
    }
  }

  const val = await bp({ action: "validate", path: BP, assetPath: BP });
  console.log(JSON.stringify(val, null, 2));
  kill();
})();
