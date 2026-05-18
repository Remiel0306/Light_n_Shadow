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
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "full-scan", version: "1" } });

  const fnSum = await bp({ action: "read_graph_summary", path: BP, assetPath: BP, graphName: FN });
  const egSum = await bp({ action: "read_graph_summary", path: BP, assetPath: BP, graphName: "EventGraph" });
  const vars = await bp({ action: "list_variables", path: BP, assetPath: BP });
  const locals = await bp({
    action: "list_local_variables",
    path: BP,
    assetPath: BP,
    functionName: FN,
  });
  const validate = await bp({ action: "validate", path: BP, assetPath: BP });

  const nodes = fnSum.nodes || [];
  const exec = fnSum.execEdges || [];
  const data = fnSum.dataEdges || [];
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

  const report = { issues: [], ok: [], warnings: [], nodes: nodes.length, execCount: exec.length };

  function trace(fromId, seen = new Set(), depth = 0, lines = []) {
    if (!fromId || seen.has(fromId) || depth > 50) return lines;
    seen.add(fromId);
    const outs = exec.filter((e) => e.from === fromId);
    for (const e of outs) {
      const t = byId[e.to];
      lines.push({ depth, pin: e.fromPin, to: t ? t.title : e.to, cls: t?.class });
      trace(e.to, seen, depth + 1, lines);
    }
    return lines;
  }

  const entry = nodes.find((n) => n.class === "K2Node_FunctionEntry");
  const execChain = trace(entry?.id);

  const titles = nodes.map((n) => n.title);
  const has = (s) => titles.some((t) => t && t.toLowerCase().includes(s.toLowerCase()));

  // Checks
  if (has("clear")) report.ok.push("6.2: Clear arrays present");
  if (has("while loop")) report.ok.push("6.3: While Loop present");
  if (has("remove index")) report.ok.push("6.3.4: Remove Index from Queue");
  if (has("contains")) report.ok.push("Visited Contains check");
  if (has("get overlapping")) report.ok.push("6.3.8: Get Overlapping Components");
  else report.issues.push("MISSING: Get Overlapping Components");
  if (has("for each")) report.ok.push("6.3.8: For Each Loop");
  else report.issues.push("MISSING: For Each Loop");

  const hasReturn = nodes.filter((n) => n.title === "Return Node");
  const completedToReturn = exec.some(
    (e) => byId[e.from]?.title === "While Loop" && e.fromPin?.toLowerCase().includes("completed") && byId[e.to]?.title === "Return Node"
  );
  if (completedToReturn) report.ok.push("While Completed -> Return Node");
  else report.issues.push("MISSING or WRONG: While Completed -> Return Node (function must return ConnectedEnemies)");

  const startToQueue = data.some((d) => d.fromPin && /start shadow/i.test(d.fromPin) && byId[d.to]?.title === "Add");
  if (startToQueue) report.ok.push("6.2: Start Shadow -> Queue Add");
  else report.issues.push("MISSING: Queue.Add(Start Shadow) before While");

  const isActiveToBranch = data.some((d) => /IsShadowLinkActive|Is Shadow Link Active/i.test(d.fromPin || "") && byId[d.to]?.class === "K2Node_IfThenElse");
  if (isActiveToBranch) report.ok.push("6.2: IsShadowLinkActive wired to Branch condition");
  else report.warnings.push("IsShadowLinkActive may only use exec chain (bool not checked)");

  // EG: stomp + shadows connect call
  const egNodes = egSum.nodes || [];
  const egHit = egNodes.filter((n) => {
    const t = `${n.title} ${n.class}`;
    return /stomp|shadow|connect|isonshadow/i.test(t);
  });
  const callsShadowsConnect = egNodes.some((n) => /shadows connect|shadow connect/i.test(n.title || ""));
  if (callsShadowsConnect) report.ok.push("EventGraph: calls Shadows Connect");
  else report.issues.push("MISSING: EventGraph does not call Shadows Connect (wire IA_StompC + StompedShadow)");

  const memberArrays = (vars.variables || []).filter((v) => ["Queue", "Visted", "Visited", "ConnectedEnemies", "Connected Enemies", "Curren", "Current"].includes(v.name));
  if (memberArrays.length >= 3) {
    report.warnings.push(`Variables on CHARACTER (should be Local in function): ${memberArrays.map((v) => v.name + ":" + v.type).join(", ")}`);
  }

  const out = {
    fn: FN,
    nodeCount: nodes.length,
    execChain,
    report,
    locals,
    validate: validate.errors || validate.warnings || validate,
    egShadowRelated: egHit.map((n) => ({ title: n.title, class: n.class })),
    allTitles: titles.sort(),
  };

  fs.writeFileSync("D:/Unreal Engine/Light_n_Shadow/_shadows_connect_full_scan.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  kill();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
