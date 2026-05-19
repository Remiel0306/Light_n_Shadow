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
const FN = "Shadows Connect";
(async () => {
  const { rpc, kill } = mkMCP();
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "d", version: "1" } });
  async function bp(a) {
    const r = await rpc("tools/call", { name: "blueprint", arguments: a });
    return JSON.parse(r?.result?.content?.[0]?.text || "{}");
  }
  const g = await bp({ action: "read_graph_summary", path: BP, assetPath: BP, graphName: FN });
  const nodes = g.nodes || [];
  const exec = g.execEdges || [];
  const data = g.dataEdges || [];
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

  const report = { titles: nodes.map((n) => n.title).sort(), checks: {} };

  // Start Shadow -> anything -> Queue Add
  const queueAdds = nodes.filter((n) => n.title === "Add");
  const startShadowSources = data.filter((d) => /start shadow/i.test(d.fromPin || ""));
  report.startShadowWires = startShadowSources.map((d) => ({
    from: byId[d.from]?.title,
    to: byId[d.to]?.title,
    pins: `${d.fromPin} -> ${d.toPin}`,
  }));

  // Connected Enemies Add chain
  const ceAdds = [];
  for (const n of nodes) {
    if (n.title !== "Add") continue;
    const toCE = data.some((d) => d.from === n.id && /connected/i.test(byId[d.to]?.title || ""));
    const fromCE = data.some((d) => d.to === n.id && /connected/i.test(byId[d.from]?.title || ""));
    if (toCE || fromCE) ceAdds.push(n.id);
  }
  report.connectedEnemiesAddNodes = ceAdds.length;

  // GetShadowRole nodes
  report.getShadowRole = nodes.filter((n) => /getshadowrole/i.test(n.title || "")).length;
  report.equalEnemy = nodes.filter((n) => /equal.*enum/i.test(n.title || "")).length;

  // Trace: GetShadowRole -> Add ConnectedEnemies?
  const roleNodes = nodes.filter((n) => /getshadowrole/i.test(n.title || ""));
  report.roleToAdd = roleNodes.map((rn) => {
    const outExec = exec.filter((e) => e.from === rn.id);
    const outData = data.filter((e) => e.from === rn.id);
    return {
      id: rn.id.slice(0, 8),
      execTo: outExec.map((e) => byId[e.to]?.title),
      dataTo: outData.map((e) => `${byId[e.to]?.title}.${e.toPin}`),
    };
  });

  // Function entry flow
  const entry = nodes.find((n) => n.class === "K2Node_FunctionEntry");
  if (entry) {
    report.entryExec = exec
      .filter((e) => e.from === entry.id)
      .map((e) => ({ pin: e.fromPin, to: byId[e.to]?.title }));
  }

  // Is Valid Start Shadow branch
  const validNodes = nodes.filter((n) => /is valid/i.test(n.title || ""));
  report.isValid = validNodes.map((n) => ({
    title: n.title,
    execOut: exec.filter((e) => e.from === n.id).map((e) => ({ pin: e.fromPin, to: byId[e.to]?.title })),
  }));

  console.log(JSON.stringify(report, null, 2));
  fs.writeFileSync("D:/Unreal Engine/Light_n_Shadow/_sc_detail_scan.json", JSON.stringify(report, null, 2));
  kill();
})();
