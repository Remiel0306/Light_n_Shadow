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

function analyze(summary, vars, locals) {
  const nodes = summary.nodes || [];
  const exec = summary.execEdges || [];
  const data = summary.dataEdges || [];
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

  const issues = [];
  const ok = [];
  const branchAudit = [];

  const hasTitle = (re) => nodes.some((n) => re.test(n.title || ""));
  const getBranches = () => nodes.filter((n) => n.class === "K2Node_IfThenElse");

  for (const b of getBranches()) {
    const trueOut = exec.filter((e) => e.from === b.id && /^true$/i.test(e.fromPin || ""));
    const falseOut = exec.filter((e) => e.from === b.id && /^false$/i.test(e.fromPin || ""));
    const condData = data.filter((e) => e.to === b.id && /condition/i.test(e.toPin || ""));
    branchAudit.push({
      id: b.id,
      title: "Branch",
      trueWired: trueOut.length > 0,
      falseWired: falseOut.length > 0,
      trueTo: trueOut.map((e) => byId[e.to]?.title || e.to),
      falseTo: falseOut.map((e) => byId[e.to]?.title || e.to),
      hasCondition: condData.length > 0,
    });
    if (!trueOut.length) issues.push(`Branch ${b.id.slice(0, 8)}: True 沒有白線`);
    if (!falseOut.length) issues.push(`Branch ${b.id.slice(0, 8)}: False 沒有白線`);
    if (!condData.length) issues.push(`Branch ${b.id.slice(0, 8)}: Condition 沒接`);
  }

  if (hasTitle(/clear/i)) ok.push("Clear 陣列");
  if (hasTitle(/while loop/i)) ok.push("While Loop");
  if (hasTitle(/remove index/i)) ok.push("Remove Index");
  if (hasTitle(/get overlapping components/i)) ok.push("Get Overlapping Components");
  else issues.push("缺少 Get Overlapping Components");
  if (hasTitle(/for each/i)) ok.push("For Each Loop");
  else issues.push("缺少 For Each Loop");

  const whileNode = nodes.find((n) => n.title === "While Loop");
  const completed = exec.filter(
    (e) => e.from === whileNode?.id && /completed/i.test(e.fromPin || "") && byId[e.to]?.class === "K2Node_FunctionResult"
  );
  if (completed.length) ok.push("While Completed → Return");
  else issues.push("While Completed 沒接到 Return Node");

  const startToQueue = data.some(
    (d) => /start shadow/i.test(d.fromPin || "") && byId[d.to]?.title === "Add"
  );
  if (startToQueue) ok.push("Start Shadow → Queue.Add");
  else issues.push("Start Shadow 可能沒加入 Queue（檢查 reroute）");

  const getOwnerFromCurrent = data.some(
    (d) =>
      byId[d.from]?.title === "Get Owner" &&
      data.some((x) => byId[x.from]?.title === "Get Curren" || byId[x.from]?.title === "Get Current") &&
      byId[d.to]?.title?.includes("GetShadow")
  );
  const wrongOwnerTarget = data.some(
    (d) =>
      (byId[d.from]?.title === "Get Curren" || byId[d.from]?.title === "Get Current") &&
      byId[d.to]?.class === "K2Node_Message" &&
      /getshadow/i.test(byId[d.to]?.title || "")
  );
  if (wrongOwnerTarget) issues.push("GetShadowOwner/Role 的 Target 仍接到 Curren/Current（應接 Get Owner）");
  else if (getOwnerFromCurrent || hasTitle(/get owner/i)) ok.push("有 Get Owner");

  const overlapToForeach = data.some(
    (d) =>
      /overlapping/i.test(d.fromPin || "") &&
      nodes.some((n) => n.id === d.to && /for each/i.test(n.title || ""))
  );
  if (overlapToForeach) ok.push("Overlapping → For Each Array");
  else issues.push("Get Overlapping 輸出可能沒接到 For Each Array");

  const foreachRestart = exec.some(
    (e) =>
      nodes.some((n) => /for each/i.test(n.title || "") && n.id === e.to && /execute/i.test(e.toPin || "")) &&
      nodes.some((n) => n.id === e.from && (n.title === "Add" || n.class === "K2Node_CallArrayFunction"))
  );
  // Add -> ForEach execute is OK once; Queue.Add -> ForEach is bad
  const queueAddRestart = exec.some((e) => {
    const from = byId[e.from];
    const to = byId[e.to];
    return (
      from?.title === "Add" &&
      from?.class === "K2Node_CallArrayFunction" &&
      /for each/i.test(to?.title || "") &&
      data.some((d) => d.from === e.from && byId[d.to]?.title === "Get Queue")
    );
  });
  if (queueAddRestart) issues.push("Queue.Add 的 then 接回 For Each execute（應拆掉）");

  const memberBad = (vars.variables || []).filter((v) =>
    ["Queue", "Visted", "Visited", "ConnectedEnemies", "Curren", "Current"].includes(v.name)
  );
  let warnings = [];
  if (memberBad.length >= 2)
    warnings.push(`成員變數應改 Local: ${memberBad.map((v) => v.name).join(", ")}`);
  const isActiveBranch = data.some((d) => /IsShadowLinkActive|IsShadowsConnectActive/i.test(d.fromPin || ""));
  if (isActiveBranch) ok.push("IsShadowLinkActive → Branch Condition");

  return {
    nodeCount: nodes.length,
    execCount: exec.length,
    branchAudit,
    issues,
    ok,
    warnings,
    allTitles: nodes.map((n) => n.title).sort(),
    exec,
    data,
    nodes,
  };
}

(async () => {
  const { rpc, bp, kill } = mkMCP();
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "audit", version: "1" } });

  const fnSum = await bp({ action: "read_graph_summary", path: BP, assetPath: BP, graphName: FN });
  const egSum = await bp({ action: "read_graph_summary", path: BP, assetPath: BP, graphName: "EventGraph" });
  const vars = await bp({ action: "list_variables", path: BP, assetPath: BP });
  const locals = await bp({ action: "list_local_variables", path: BP, assetPath: BP, functionName: FN });
  const validate = await bp({ action: "validate", path: BP, assetPath: BP });

  if (fnSum.raw && /not connected/i.test(fnSum.raw)) {
    console.log(JSON.stringify({ error: "EDITOR_NOT_CONNECTED", hint: fnSum.raw }, null, 2));
    kill();
    process.exit(2);
  }

  const audit = analyze(fnSum, vars, locals);

  const egNodes = egSum.nodes || [];
  const callsSC = egNodes.some((n) => /shadows connect/i.test(n.title || ""));
  const stomp = egNodes.filter((n) => /stomp|isonshadow|stompedshadow/i.test(`${n.title} ${n.class}`));

  const out = { audit, locals, validate, eventGraph: { callsShadowsConnect: callsSC, stompRelated: stomp.map((n) => n.title) } };
  fs.writeFileSync("D:/Unreal Engine/Light_n_Shadow/_shadows_connect_audit.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  kill();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
