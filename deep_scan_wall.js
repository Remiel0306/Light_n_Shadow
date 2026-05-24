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
      }, 180000);
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
      return { raw: t?.slice(0, 500) };
    }
  }
  return { rpc, bp, kill: () => mcp.kill() };
}

(async () => {
  const { rpc, bp, kill } = mkMCP();
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "deep-scan", version: "1" },
  });

  const sum = await bp({
    action: "read_graph_summary",
    path: BP,
    assetPath: BP,
    graphName: "EventGraph",
  });

  const nodes = sum?.nodes || (Array.isArray(sum) ? sum : []);
  const conns = sum?.connections || [];
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

  const pick = (re) => nodes.filter((n) => re.test(n.title || ""));

  const loops = pick(/For Loop|For Each/i);
  const getItems = pick(/Get \(a copy\)/i);
  const branches = pick(/^Branch$/i);
  const equals = pick(/Equal \(Object\)/i);
  const overlaps = pick(/Begin Overlap|End Overlap|Check Overlapping/i);
  const computes = pick(/Shadow Collision Compute|Update Shadow|Update All/i);
  const slotGets = pick(/Slot Onwers|Slot Owners|Light Through Points/i);

  // For each Get (a copy), find index source
  const getItemDetail = getItems.map((n) => {
    const arrayConn = conns.find((c) => c.to === n.id && c.toPin === "Array");
    const idxConn = conns.find((c) => c.to === n.id && /^Dimension 1$|^Index$/.test(c.toPin));
    const outConns = conns.filter((c) => c.from === n.id);
    return {
      id: n.id,
      arrayFrom: byId[arrayConn?.from]?.title,
      indexFrom: byId[idxConn?.from]?.title,
      indexPin: idxConn?.fromPin,
      indexDefault: idxConn ? null : "literal/disconnected?",
      outputs: outConns.slice(0, 4).map((c) => ({
        pin: c.fromPin,
        to: byId[c.to]?.title,
        toPin: c.toPin,
      })),
    };
  });

  // For Loop nodes - find First/Last index connections
  const loopDetail = loops.map((n) => {
    const pins = ["First Index", "Last Index", "Index"];
    const wiring = {};
    for (const p of pins) {
      const c = conns.find((c) => c.to === n.id && c.toPin === p);
      wiring[p] = c
        ? { from: byId[c.from]?.title, fromPin: c.fromPin }
        : "default literal on node";
    }
    const bodyTo = conns.find((c) => c.from === n.id && c.fromPin === "Loop Body");
    const completedTo = conns.find((c) => c.from === n.id && c.fromPin === "Completed");
    return {
      title: n.title,
      id: n.id,
      wiring,
      loopBodyGoesTo: byId[bodyTo?.to]?.title,
      completedGoesTo: byId[completedTo?.to]?.title,
    };
  });

  // Trace from Begin Overlap
  const beginOverlap = nodes.find(
    (n) => n.class === "K2Node_ComponentBoundEvent" && /Begin Overlap/i.test(n.title || "")
  );
  function traceExec(startId, max = 25) {
    const steps = [];
    let cur = startId;
    const seen = new Set();
    while (cur && steps.length < max && !seen.has(cur)) {
      seen.add(cur);
      const n = byId[cur];
      if (!n) break;
      steps.push(n.title);
      const next =
        conns.find((c) => c.from === cur && c.fromPin === "then") ||
        conns.find((c) => c.from === cur && c.fromPin === "Loop Body");
      cur = next?.to;
    }
    return steps;
  }

  const overlapTrace = beginOverlap ? traceExec(beginOverlap.id) : [];

  const out = {
    nodeCount: nodes.length,
    connectionCount: conns.length,
    mcpOk: nodes.length > 0,
    overlapTrace,
    loopDetail,
    getItemDetail,
    overlapNodes: overlaps.map((n) => n.title),
    computeNodes: computes.map((n) => n.title),
    equalCount: equals.length,
    branchCount: branches.length,
    slotLightNodes: slotGets.map((n) => n.title),
  };

  fs.writeFileSync("D:/Unreal Engine/Light_n_Shadow/_wall_deep_scan.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  kill();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
