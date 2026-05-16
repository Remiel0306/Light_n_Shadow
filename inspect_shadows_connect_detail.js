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
const FN = "Shadows Connect";

(async () => {
  const { rpc, bp, kill } = mkMCP();
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "sc-detail", version: "1" } });

  const sum = await bp({ action: "read_graph_summary", path: BP, assetPath: BP, graphName: FN });
  const flow = await bp({
    action: "get_blueprint_execution_flow",
    path: BP,
    assetPath: BP,
    graphName: FN,
    entryPoint: FN,
  });
  const locals = await bp({ action: "list_local_variables", path: BP, assetPath: BP, graphName: FN });
  const stompFlow = await bp({
    action: "get_blueprint_execution_flow",
    path: BP,
    assetPath: BP,
    graphName: "EventGraph",
    entryPoint: "EnhancedInputAction IA_StompC",
  });

  const out = { summary: sum, flow, locals, stompFlow };
  fs.writeFileSync("D:/Unreal Engine/Light_n_Shadow/_thirdperson_shadows_connect_detail.json", JSON.stringify(out, null, 2));
  console.log("nodes", (sum.nodes || []).length);
  console.log("locals", JSON.stringify(locals, null, 2));
  console.log("flow steps", flow.stepCount || flow.steps?.length);
  if (flow.steps) flow.steps.forEach((s, i) => console.log(i, s.title, s.branches?.map((b) => b.pin + "->" + b.toId).join(",")));
  kill();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
