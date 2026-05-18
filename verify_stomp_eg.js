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
        const t = setTimeout(() => reject(new Error("timeout")), 90000);
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
const STOMP = "hbcr8kwqJYG8rU2jYP5zkA";
(async () => {
  const { rpc, kill } = mkMCP();
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "v", version: "1" } });
  async function bp(a) {
    const r = await rpc("tools/call", { name: "blueprint", arguments: a });
    const t = r?.result?.content?.[0]?.text || "";
    try {
      return JSON.parse(t);
    } catch {
      return { raw: t };
    }
  }
  const g = await bp({ action: "read_blueprint_graph", path: BP, assetPath: BP, graphName: "EventGraph" });
  const nodes = g.nodes || [];
  const sc = nodes.filter((n) => /shadows connect/i.test(n.title || ""));
  const stomp = nodes.find((n) => n.id === STOMP);
  const setCurrent = nodes.filter((n) => n.title === "Set Current");
  const getCurrent = nodes.filter((n) => n.title === "Get Current");
  const exec = [];
  for (const n of nodes) {
    for (const p of n.pins || []) {
      if (p.direction === "Output" && p.type === "exec" && p.connected) {
        exec.push({ from: n.id, fromPin: p.name, title: n.title });
      }
    }
  }
  const stompStarted = exec.some((e) => e.from === STOMP && e.fromPin === "Started");
  const val = await bp({ action: "validate_blueprint", path: BP, assetPath: BP });
  const report = {
    scNodes: sc.map((n) => ({ id: n.id, title: n.title })),
    setCurrentCount: setCurrent.length,
    getCurrentCount: getCurrent.length,
    stompStarted,
    validate: { errors: val.errorCount, warnings: val.warningCount, messages: val.errors || val.messages },
    prints: nodes.filter((n) => n.title === "Print String" && (n.pins || []).some((p) => p.name === "InString")).length,
  };
  console.log(JSON.stringify(report, null, 2));
  fs.writeFileSync("D:/Unreal Engine/Light_n_Shadow/_stomp_verify.json", JSON.stringify(report, null, 2));
  kill();
})();
