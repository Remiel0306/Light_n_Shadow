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

function pinOut(exec, fromId, pinRe) {
  return exec.filter((e) => e.from === fromId && pinRe.test(e.fromPin || ""));
}

function findNode(nodes, title) {
  return nodes.find((n) => n.title === title);
}

function analyze(fnSum, egSum, vars, validate) {
  const nodes = fnSum.nodes || [];
  const exec = fnSum.execEdges || [];
  const data = fnSum.dataEdges || [];
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

  const issues = [];
  const ok = [];
  const warnings = [];
  let canRunBFS = true;

  const has = (re) => nodes.some((n) => re.test(n.title || ""));

  // compile
  if (validate.valid === false || validate.errorCount > 0) {
    issues.push(`Blueprint 編譯錯誤: ${validate.errorCount || "?"}`);
    canRunBFS = false;
  } else ok.push("Blueprint Validate 通過");

  // core nodes
  for (const [name, re] of [
    ["Clear", /clear/i],
    ["While Loop", /while loop/i],
    ["Get Overlapping Components", /get overlapping components/i],
    ["For Each Loop", /for each/i],
    ["Get Owner", /get owner/i],
  ]) {
    if (has(re)) ok.push(`有 ${name}`);
    else {
      issues.push(`缺少 ${name}`);
      canRunBFS = false;
    }
  }

  const whileNode = findNode(nodes, "While Loop");
  const foreachNode = findNode(nodes, "For Each Loop");
  if (whileNode && pinOut(exec, whileNode.id, /completed/i).some((e) => byId[e.to]?.title === "Return Node")) {
    ok.push("While Completed → Return");
  } else {
    issues.push("While Completed 沒接到 Return");
    canRunBFS = false;
  }

  // Start Shadow -> Queue via reroute
  const startToQueue =
    data.some((d) => /start shadow/i.test(d.fromPin || "") && byId[d.to]?.title === "Add") ||
    data.some((d) => /start shadow/i.test(d.fromPin || "") && byId[d.from]?.class === "K2Node_Knot");
  if (startToQueue) ok.push("Start Shadow → Queue.Add");
  else {
    issues.push("Start Shadow 沒加入 Queue");
    canRunBFS = false;
  }

  // Current -> Overlapping -> ForEach Array
  if (
    data.some(
      (d) =>
        byId[d.from]?.title === "Get Overlapping Components" &&
        d.to === foreachNode?.id &&
        /array/i.test(d.toPin || "")
    )
  ) {
    ok.push("Current → Get Overlapping → ForEach Array");
  } else {
    issues.push("Overlapping 沒接到 ForEach Array");
    canRunBFS = false;
  }

  // Visited branch on Current (DVO4PE pattern): then should NOT go to ForEach
  const visitedBranches = nodes.filter((n) => n.class === "K2Node_IfThenElse");
  for (const b of visitedBranches) {
    const condFromContains = data.some(
      (e) =>
        e.to === b.id &&
        /condition/i.test(e.toPin || "") &&
        byId[e.from]?.title === "Contains Item" &&
        data.some((d2) => d2.from === e.from && byId[d2.from]?.title === "Contains Item")
    );
    const thenToForeach = pinOut(exec, b.id, /^then$/).some((e) => e.to === foreachNode?.id);
    const elseToForeach = pinOut(exec, b.id, /^else$/).some((e) => {
      let cur = e.to;
      for (let i = 0; i < 8; i++) {
        if (cur === foreachNode?.id) return true;
        const next = exec.find((x) => x.from === cur && /^then$/i.test(x.fromPin || ""));
        if (!next) break;
        cur = next.to;
      }
      return false;
    });
    // heuristic: branch right after Remove Index uses Visited Contains on Current
    const execIn = exec.filter((e) => e.to === b.id && /execute/i.test(e.toPin || ""));
    const fromRemove = execIn.some((e) => byId[e.from]?.title === "Remove Index");
    if (fromRemove && thenToForeach) {
      issues.push("Visited Contains：then 仍接到 ForEach（應留空或跳過）");
      canRunBFS = false;
    }
  }

  // ForEach neighbor visited: then must NOT restart While
  const whileExecIn = exec.filter((e) => e.to === whileNode?.id && /execute/i.test(e.toPin || ""));
  const foreachRestartsWhile = whileExecIn.some((e) => {
    // trace back from while execute input
    const from = e.from;
    return byId[from]?.class === "K2Node_Knot" || byId[from]?.title === "For Each Loop";
  });
  // more precise: any exec edge into While.execute from inside foreach body chain
  const badWhileRestart = exec.some(
    (e) =>
      e.to === whileNode?.id &&
      /execute/i.test(e.toPin || "") &&
      (() => {
        let n = byId[e.from];
        return n && (n.title === "For Each Loop" || n.class === "K2Node_Knot");
      })()
  );
  if (badWhileRestart) {
    issues.push("ForEach 內有線接回 While execute（會打亂 BFS）");
    canRunBFS = false;
  } else ok.push("ForEach 沒有接回 While");

  // duplicate enemy chain inside foreach (GetShadowRole after Queue.Add)
  const queueAdds = nodes.filter((n) => n.title === "Add" && n.class === "K2Node_CallArrayFunction");
  for (const add of queueAdds) {
    const targetsQueue = data.some((d) => d.from === add.id && byId[d.to]?.title === "Get Queue");
    if (!targetsQueue) continue;
    const thenEdge = pinOut(exec, add.id, /^then$/)[0];
    if (thenEdge && byId[thenEdge.to]?.title === "GetShadowRole") {
      issues.push("ForEach 內 Queue.Add 後又跑 GetShadowRole（多餘敵人邏輯）");
      warnings.push("建議刪除 ForEach 內第二套敵人收集");
    }
  }

  // expand hub M6 -> 4NC -> ForEach
  const expandHub = nodes.find((n) => n.id === "M6HILELDDF38TWaRmq1rdQ") || nodes.filter((n) => n.class === "K2Node_Knot");
  const foreachExecSources = exec.filter((e) => e.to === foreachNode?.id && /exec/i.test(e.toPin || ""));
  if (foreachExecSources.length >= 1) ok.push(`ForEach 有 ${foreachExecSources.length} 條 exec 入口`);
  else {
    issues.push("ForEach 沒有 exec 入口");
    canRunBFS = false;
  }

  // Enemy path merge to expand hub
  const expandReroute = "M6HILELDDF38TWaRmq1rdQ";
  const pathsToExpand = [
    ["0xuqnU6Y", "else"],
    ["Ojp9vULh", "else"],
    ["UY_v70dK", "then"],
    ["6jBHtUMbd", "then"],
  ];
  for (const [prefix, pin] of pathsToExpand) {
    const branch = nodes.find((n) => n.id.startsWith(prefix) && n.class === "K2Node_IfThenElse");
    if (!branch) continue;
    const hit = pinOut(exec, branch.id, new RegExp(`^${pin}$`)).some((e) => e.to === expandReroute);
    if (hit) ok.push(`敵人/擴展路徑 ${prefix} ${pin} → ForEach 匯流`);
    else warnings.push(`敵人路徑 ${prefix} ${pin} 可能沒接到 ForEach 匯流`);
  }

  // EventGraph
  const egNodes = egSum.nodes || [];
  const callsSC = egNodes.some((n) => /shadows connect/i.test(n.title || ""));
  const hasStomp = egNodes.some((n) => /IA_StompC/i.test(n.title || ""));
  const hasOnShadow = egNodes.some((n) => /isOnShadow/i.test(n.title || ""));

  let canRunInGame = canRunBFS && callsSC;
  if (callsSC) ok.push("EventGraph 有呼叫 Shadows Connect");
  else {
    issues.push("EventGraph 還沒呼叫 Shadows Connect（踩了也不會跑 BFS）");
    canRunInGame = false;
  }
  if (hasStomp) ok.push("有 IA_StompC");
  if (hasOnShadow) ok.push("有 isOnShadow? 變數");

  const memberBad = (vars.variables || []).filter((v) =>
    ["Queue", "Visted", "Visited", "ConnectedEnemies", "Curren", "Current"].includes(v.name)
  );
  if (memberBad.length >= 2) warnings.push(`變數仍在角色上: ${memberBad.map((v) => v.name).join(", ")}`);

  return {
    summary: {
      blueprintValid: validate.valid !== false,
      bfsLogicOk: canRunBFS,
      canRunInGame,
      verdict: canRunInGame
        ? "可以測連線效果（記得影子 Box 要 Overlap）"
        : canRunBFS
          ? "BFS 函式看起來可跑，但 EventGraph 還沒接上踩踏"
          : "BFS 函式仍有邏輯問題，需再修",
    },
    issues,
    ok,
    warnings,
    nodeCount: nodes.length,
    eventGraph: { callsShadowsConnect: callsSC, hasStomp, hasOnShadow },
    validate,
  };
}

(async () => {
  const { rpc, bp, kill } = mkMCP();
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "scan-full", version: "1" } });

  const fnSum = await bp({ action: "read_graph_summary", path: BP, assetPath: BP, graphName: FN });
  if (fnSum.raw && /not connected/i.test(fnSum.raw)) {
    console.log(JSON.stringify({ error: "EDITOR_NOT_CONNECTED", hint: fnSum.raw }, null, 2));
    kill();
    process.exit(2);
  }

  const egSum = await bp({ action: "read_graph_summary", path: BP, assetPath: BP, graphName: "EventGraph" });
  const vars = await bp({ action: "list_variables", path: BP, assetPath: BP });
  const validate = await bp({ action: "validate", path: BP, assetPath: BP });

  const report = analyze(fnSum, egSum, vars, validate);
  fs.writeFileSync("D:/Unreal Engine/Light_n_Shadow/_scan_report.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  kill();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
