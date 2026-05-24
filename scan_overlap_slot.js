const { spawn } = require("child_process");
const fs = require("fs");

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

(async () => {
  const { rpc, bp, kill } = mkMCP();
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "scan-overlap", version: "1" },
  });

  const sum = await bp({
    action: "read_graph_summary",
    path: BP,
    assetPath: BP,
    graphName: "EventGraph",
  });
  const nodes = Array.isArray(sum) ? sum : sum.nodes || [];
  const conns = sum.connections || [];
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

  const overlap = nodes.find(
    (n) =>
      n.class === "K2Node_ComponentBoundEvent" &&
      /Begin Overlap.*Collision For All/i.test(n.title || "")
  );
  const slotNodes = nodes.filter((n) => /Slot Onwers|Slot Owners/i.test(n.title || ""));

  let steps = [];
  if (overlap) {
    let cur = overlap.id;
    const seen = new Set();
    for (let i = 0; i < 30 && cur && !seen.has(cur); i++) {
      seen.add(cur);
      const n = byId[cur];
      if (!n) break;
      steps.push({ id: cur, title: n.title, class: n.class });
      const next = conns.find((c) => c.from === cur && c.fromPin === "then");
      cur = next?.to;
    }
  }

  const addNodes = nodes.filter(
    (n) => n.title === "Add" && n.class === "K2Node_CallArrayFunction"
  );

  fs.writeFileSync(
    "D:/Unreal Engine/Light_n_Shadow/_overlap_slot_scan.json",
    JSON.stringify(
      {
        overlapEvent: overlap ? { id: overlap.id, title: overlap.title } : null,
        execChain: steps,
        slotNodeCount: slotNodes.length,
        slotTitles: [...new Set(slotNodes.map((n) => n.title))],
        addNodeCount: addNodes.length,
        relevantTitles: nodes
          .filter((n) =>
            /Overlap|Slot|BeginPlay|For Loop|Make Array|Set Array|Add|Clear/i.test(n.title || "")
          )
          .map((n) => n.title),
      },
      null,
      2
    )
  );
  console.log(JSON.stringify(JSON.parse(fs.readFileSync("D:/Unreal Engine/Light_n_Shadow/_overlap_slot_scan.json", "utf8")), null, 2));
  kill();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
