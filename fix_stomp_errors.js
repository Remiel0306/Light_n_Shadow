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
const LEN_ARR = null; // discover

(async () => {
  const { rpc, kill } = mkMCP();
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "fix", version: "1" } });
  async function bp(a) {
    const r = await rpc("tools/call", { name: "blueprint", arguments: a });
    const raw = r?.result?.content?.[0]?.text || "{}";
    try {
      return JSON.parse(raw);
    } catch {
      return { raw };
    }
  }

  // Remove broken ApplyShadowStomp / None nodes
  const bad = ["297D61C243349348B5819D8E6F8F9E6F"];
  for (const nid of bad) {
    await bp({ action: "delete_node", path: BP, assetPath: BP, graphName: EG, nodeName: nid });
  }

  // Find Array_Length node near stomp chain
  const sum = await bp({ action: "read_graph_summary", path: BP, assetPath: BP, graphName: EG });
  const lenNode = (sum.nodes || []).find((n) => /array.?length/i.test(n.title || ""));
  if (lenNode) {
    await bp({
      action: "connect_pins",
      path: BP,
      assetPath: BP,
      graphName: EG,
      sourceNode: CALL_SC,
      sourcePin: "Connected Enemies",
      targetNode: lenNode.id,
      targetPin: "TargetArray",
    });
    console.log("Rewired Connected Enemies ->", lenNode.id);
  }

  const val = await bp({ action: "validate", path: BP, assetPath: BP });
  console.log(JSON.stringify(val, null, 2));
  await bp({ action: "compile_blueprint", path: BP, assetPath: BP });
  kill();
})();
