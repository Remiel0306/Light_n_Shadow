const { spawn } = require("child_process");
const PROJECT = "D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject";
const BP = "/Game/BluePrint/BP_WallShadowLogic";

function mkMCP() {
  const mcp = spawn("npx.cmd", ["ue-mcp", PROJECT], { shell: true });
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
        const t = setTimeout(() => {
          wait.delete(i);
          reject(new Error("timeout " + method));
        }, 120000);
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
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "auto-layout", version: "1" },
  });
  async function bp(args) {
    const r = await rpc("tools/call", { name: "blueprint", arguments: args });
    const t = r?.result?.content?.[0]?.text || "";
    try {
      return JSON.parse(t);
    } catch {
      return { raw: t };
    }
  }

  const graphs = ["EventGraph"];
  const listed = await bp({ action: "list_graphs", path: BP, assetPath: BP });
  const names = (listed.graphs || listed).map?.((g) => g.name || g) || graphs;
  console.log("graphs:", names);

  for (const graphName of names.length ? names : graphs) {
    if (typeof graphName !== "string") continue;
    const r = await bp({ action: "auto_layout", path: BP, assetPath: BP, graphName });
    console.log("auto_layout", graphName, JSON.stringify(r, null, 2));
  }

  await bp({ action: "compile", path: BP, assetPath: BP }).catch(() => ({}));
  const save = await bp({ action: "save", path: BP, assetPath: BP }).catch((e) => ({ error: e.message }));
  console.log("save:", save);
  kill();
  console.log("DONE");
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
