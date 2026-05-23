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
    clientInfo: { name: "trace-shadow", version: "1" },
  });

  const sum = await bp({
    action: "read_graph_summary",
    path: BP,
    assetPath: BP,
    graphName: "EventGraph",
  });
  const nodes = Array.isArray(sum) ? sum : sum.nodes || [];
  const conns = sum.connections || [];

  const shadowNodes = nodes.filter((n) => /Shadow Collision/i.test(n.title || ""));
  const calls = nodes.filter(
    (n) =>
      n.class === "K2Node_CallFunction" &&
      /Shadow Collision/i.test(n.title || "")
  );

  const events = nodes.filter(
    (n) => n.class === "K2Node_CustomEvent" && /Shadow Collision/i.test(n.title || "")
  );

  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

  // Who calls whom via exec (then pin)
  const execOut = conns.filter((c) => c.fromPin === "then" || c.fromPin === "Loop Body");
  const callersTo = {};
  for (const c of execOut) {
    const from = byId[c.from];
    const to = byId[c.to];
    if (!from || !to) continue;
    const key = `${from.title} -> ${to.title}`;
    if (!callersTo[key]) callersTo[key] = [];
    callersTo[key].push(c.fromPin);
  }

  // Find nodes that call Shadow Collision * functions
  const callTargets = calls.map((n) => ({
    id: n.id,
    title: n.title,
    incomingExec: conns
      .filter((c) => c.to === n.id && (c.toPin === "execute" || c.toPin === "self"))
      .map((c) => ({ from: byId[c.from]?.title, fromPin: c.fromPin })),
  }));

  const eventIncoming = events.map((ev) => ({
    title: ev.title,
    id: ev.id,
    incomingExec: conns
      .filter((c) => c.to === ev.id && c.toPin === "execute")
      .map((c) => ({ from: byId[c.from]?.title, fromPin: c.fromPin, fromId: c.from })),
  }));

  // Search for For Loop, Branch, Sequence near shadow
  const loops = nodes.filter((n) => /For Loop|For Each|Sequence/i.test(n.title || ""));

  const out = {
    shadowNodeTitles: shadowNodes.map((n) => n.title),
    events: eventIncoming,
    callNodes: callTargets,
    loopNodes: loops.map((n) => n.title),
    sampleExecChains: Object.entries(callersTo)
      .filter(([k]) => /Shadow/i.test(k))
      .slice(0, 40),
  };

  fs.writeFileSync("D:/Unreal Engine/Light_n_Shadow/_shadow_call_trace.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  kill();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
