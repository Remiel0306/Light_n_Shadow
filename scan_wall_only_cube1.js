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
        reject(new Error("timeout " + method));
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
      return { raw: t, _parseError: true };
    }
  }
  return { rpc, bp, kill: () => mcp.kill() };
}

function walkExec(conns, byId, startId, max = 40) {
  const steps = [];
  let cur = startId;
  const seen = new Set();
  while (cur && steps.length < max && !seen.has(cur)) {
    seen.add(cur);
    const n = byId[cur];
    if (!n) break;
    steps.push({ id: cur, title: n.title, class: n.class });
    const next =
      conns.find((c) => c.from === cur && c.fromPin === "then") ||
      conns.find((c) => c.from === cur && c.fromPin === "Loop Body") ||
      conns.find((c) => c.from === cur && c.fromPin === "Completed");
    cur = next?.to;
  }
  return steps;
}

(async () => {
  const { rpc, bp, kill } = mkMCP();
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "scan-cube1", version: "1" },
  });

  const val = await bp({ action: "validate", path: BP, assetPath: BP });
  const vars = await bp({ action: "list_variables", path: BP, assetPath: BP });
  const comps = await bp({ action: "read_component_properties", path: BP, assetPath: BP }).catch(() => null);
  const sum = await bp({
    action: "read_graph_summary",
    path: BP,
    assetPath: BP,
    graphName: "EventGraph",
  });

  const nodes = Array.isArray(sum) ? sum : sum.nodes || [];
  const conns = sum.connections || [];
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

  const keywords =
    /overlap|slot|cube|collision for all|beginplay|clear|add|make array|for each|for loop|check overlapping|update|shadow collision|get \(a copy\)|equal|branch|active ball|isinchecker/i;

  const relevant = nodes.filter((n) => keywords.test(n.title || ""));

  const overlapEvents = nodes.filter(
    (n) =>
      n.class === "K2Node_ComponentBoundEvent" &&
      /Overlap/i.test(n.title || "")
  );

  const beginPlay = nodes.find((n) => n.class === "K2Node_Event" && /BeginPlay/i.test(n.title || ""));

  const overlapChains = overlapEvents.map((ev) => ({
    title: ev.title,
    id: ev.id,
    exec: walkExec(conns, byId, ev.id),
  }));

  const beginPlayChain = beginPlay
    ? { id: beginPlay.id, exec: walkExec(conns, byId, beginPlay.id, 25) }
    : null;

  // Pin wiring for Add/Clear/Set Slot
  const slotWire = conns
    .filter((c) => {
      const from = byId[c.from];
      const to = byId[c.to];
      const t = `${from?.title || ""} ${to?.title || ""} ${c.fromPin} ${c.toPin}`;
      return /slot|add|clear|make array|set array|index|item|targetarray/i.test(t);
    })
    .slice(0, 80)
    .map((c) => ({
      from: byId[c.from]?.title,
      fromPin: c.fromPin,
      to: byId[c.to]?.title,
      toPin: c.toPin,
    }));

  // Find GET array index literals
  const getItems = nodes.filter((n) => /Get \(a copy\)/i.test(n.title || ""));
  const getItemIndices = getItems.map((n) => {
    const idxConn = conns.find((c) => c.to === n.id && c.toPin === "Dimension 1");
    const idxNode = idxConn ? byId[idxConn.from] : null;
    return {
      id: n.id,
      indexFrom: idxNode?.title,
      indexPin: idxConn?.fromPin,
      outTo: conns
        .filter((c) => c.from === n.id)
        .map((c) => ({ pin: c.fromPin, to: byId[c.to]?.title, toPin: c.toPin })),
    };
  });

  const out = {
    validate: val,
    variables: vars.variables || vars,
    componentSummary: comps,
    overlapChains,
    beginPlayChain,
    getItemIndices,
    slotWireSample: slotWire,
    relevantNodeTitles: [...new Set(relevant.map((n) => n.title))].sort(),
    nodeCount: nodes.length,
    connectionCount: conns.length,
  };

  fs.writeFileSync("D:/Unreal Engine/Light_n_Shadow/_wall_cube1_diagnosis.json", JSON.stringify(out, null, 2));

  const exportIds = [
    ...overlapEvents.map((n) => n.id),
    beginPlay?.id,
    ...nodes.filter((n) => /Check Overlapping|Slot Onwers|Get Overlapping|For Each|For Loop|Update|Shadow Collision Compute|Make Array/i.test(n.title || "")).map((n) => n.id),
  ].filter(Boolean);

  const ex = await bp({
    action: "export_nodes_t3d",
    path: BP,
    assetPath: BP,
    graphName: "EventGraph",
    nodeIds: [...new Set(exportIds)].slice(0, 50),
  });
  if (ex.t3d || ex.content) {
    fs.writeFileSync("D:/Unreal Engine/Light_n_Shadow/_wall_cube1_export.t3d", ex.t3d || ex.content);
  }

  console.log(JSON.stringify({
    errors: val?.errorCount,
    overlap: overlapChains.map((o) => ({ title: o.title, steps: o.exec.map((s) => s.title) })),
    beginPlay: beginPlayChain?.exec?.map((s) => s.title),
    getIndices: getItemIndices.slice(0, 15),
  }, null, 2));

  kill();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
