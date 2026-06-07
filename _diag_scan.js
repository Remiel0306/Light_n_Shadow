const { spawn } = require("child_process");
const fs = require("fs");

const BP = "/Game/BluePrint/Player/BP_ThirdPersonCharacter";

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
        reject(new Error(`timeout ${method}`));
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

function traceFrom(edges, startIds, ids, max = 20) {
  const out = [];
  let cur = new Set(startIds);
  for (let step = 0; step < max && cur.size; step++) {
    const next = new Set();
    for (const e of edges) {
      if (cur.has(e.from)) {
        const n = ids.get(e.to);
        out.push(`${step}: ${ids.get(e.from)?.title || e.from} --${e.fromPin}--> ${n?.title || e.to}`);
        next.add(e.to);
      }
    }
    cur = next;
  }
  return out;
}

(async () => {
  const { rpc, bp, kill } = mkMCP();
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "diag" } });

  const graphs = ["EventGraph", "Enter Ball Cam", "Exit Ball Cam", "CheckWatchBall"];
  const out = {};
  for (const g of graphs) {
    out[g] = await bp({ action: "read_graph_summary", path: BP, assetPath: BP, graphName: g });
  }
  fs.writeFileSync("_diag_ballcam.json", JSON.stringify(out, null, 2));

  const eg = out.EventGraph?.nodes || [];
  const exec = out.EventGraph?.execEdges || [];
  const data = out.EventGraph?.dataEdges || [];
  const ids = new Map(eg.map((n) => [n.id, n]));

  const pick = (n) =>
    /HoldBallCam|LookAtBallCam|BallSteer|CtrlBall|Throw|Freeze|Enter Ball|Exit Ball|CheckWatch|Current Ball|Target Ball|Active Thrown|isInBallCam|Ignore Look|Mapping|CameraYaw|CameraPitch|SpringArm|World Rotation|Valid|Branch|Set Current/i.test(
      n.title || ""
    );

  console.log("=== EventGraph related nodes ===");
  eg.filter(pick).forEach((n) => console.log(n.id, "|", n.title));

  const events = eg.filter((n) => /EnhancedInputAction IA_/.test(n.title || ""));
  console.log("\n=== Input events ===");
  events.forEach((n) => console.log(n.title));

  for (const ev of events) {
    if (!/HoldBallCam|LookAtBallCam|CtrlBall|Throw/.test(ev.title || "")) continue;
    console.log(`\n--- Exec trace from ${ev.title} ---`);
    traceFrom(exec, [ev.id], ids, 15).forEach((l) => console.log(l));
  }

  // LookAtBallCam data wiring
  const look = eg.find((n) => /IA_LookAtBallCamC/.test(n.title || ""));
  if (look) {
    console.log("\n=== IA_LookAtBallCamC data edges ===");
    data
      .filter((e) => e.from === look.id || eg.some((n) => e.from === n.id && exec.concat(data).some((x) => x.from === look.id)))
      .slice(0, 30);
    const related = new Set([look.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const e of data) {
        if (related.has(e.from) && !related.has(e.to)) {
          related.add(e.to);
          changed = true;
        }
        if (related.has(e.to) && !related.has(e.from)) {
          related.add(e.from);
          changed = true;
        }
      }
    }
    for (const e of data) {
      if (related.has(e.from) || related.has(e.to)) {
        console.log(`${ids.get(e.from)?.title}.${e.fromPin} -> ${ids.get(e.to)?.title}.${e.toPin}`);
      }
    }
  }

  // CtrlBall freeze path
  const ctrl = eg.find((n) => /IA_CtrlBallC/.test(n.title || ""));
  if (ctrl) {
    console.log("\n=== IA_CtrlBallC Started trace ===");
    const startedEdges = exec.filter((e) => e.from === ctrl.id && e.fromPin === "Started");
    traceFrom(exec, startedEdges.map((e) => e.to), ids, 20).forEach((l) => console.log(l));
    console.log("\n=== Freeze Ball data targets ===");
    for (const n of eg.filter((n) => n.title === "Freeze Ball")) {
      const ins = data.filter((e) => e.to === n.id);
      ins.forEach((e) => console.log(`Freeze Ball.${e.toPin} <= ${ids.get(e.from)?.title}.${e.fromPin}`));
      const insExec = exec.filter((e) => e.to === n.id);
      insExec.forEach((e) => console.log(`exec from ${ids.get(e.from)?.title}.${e.fromPin}`));
    }
  }

  kill();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
