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
  const rpc = (method, params) =>
    new Promise((resolve, reject) => {
      const i = id++;
      const t = setTimeout(() => reject(new Error("timeout")), 180000);
      wait.set(i, (m) => {
        clearTimeout(t);
        resolve(m);
      });
      mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n");
    });
  const bp = async (args) => {
    const r = await rpc("tools/call", { name: "blueprint", arguments: { path: BP, assetPath: BP, ...args } });
    const t = r?.result?.content?.[0]?.text || "";
    try {
      return JSON.parse(t);
    } catch {
      return { raw: t };
    }
  };
  return { rpc, bp, kill: () => mcp.kill() };
}

(async () => {
  const { rpc, bp, kill } = mkMCP();
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "xray-flydir" } });

  const eg = await bp({ action: "read_graph_summary", graphName: "EventGraph" });
  if (!eg.nodes?.length) {
    console.log("EventGraph failed:", eg.raw || eg.error);
    kill();
    process.exit(1);
  }

  fs.writeFileSync("_xray_scan.json", JSON.stringify(eg, null, 2));
  const nodes = eg.nodes;
  const ids = new Map(nodes.map((n) => [n.id, n]));
  const exec = eg.execEdges || [];
  const data = eg.dataEdges || [];

  const pick = (n) => /XRay|Fly Dir|Visibility|Switch XRay|isXRay|Flip Flop|Camera Gose|Timeline|Current Ball|Target Ball|Active Thrown/i.test(n.title || "");
  console.log("=== XRay / FlyDir related nodes ===");
  nodes.filter(pick).forEach((n) => console.log(n.title));

  const xray = nodes.find((n) => /IA_XRayVisionC/.test(n.title || ""));
  if (xray) {
    console.log("\n=== IA_XRayVisionC exec trace ===");
    let cur = [xray.id];
    const seen = new Set();
    for (let s = 0; s < 30 && cur.length; s++) {
      const nxt = [];
      for (const nid of cur) {
        if (seen.has(nid)) continue;
        seen.add(nid);
        for (const e of exec.filter((x) => x.from === nid)) {
          console.log(`${s}: ${ids.get(e.from)?.title} --${e.fromPin}--> ${ids.get(e.to)?.title}`);
          nxt.push(e.to);
        }
      }
      cur = nxt;
    }
  } else {
    console.log("\nNo IA_XRayVisionC event node found");
  }

  console.log("\n=== Fly Dir / Visibility data edges ===");
  for (const e of data) {
    const ft = ids.get(e.from)?.title || e.from;
    const tt = ids.get(e.to)?.title || e.to;
    if (/Fly Dir|Visibility|XRay|Current Ball|Target Ball|Active Thrown|Cast To BP/i.test(ft + tt)) {
      console.log(`${ft}.${e.fromPin} -> ${tt}.${e.toPin}`);
    }
  }

  // Find all Set Visibility nodes and their exec sources
  const visNodes = nodes.filter((n) => n.title === "Set Visibility");
  console.log("\n=== Set Visibility exec sources ===");
  for (const v of visNodes) {
    const ins = exec.filter((e) => e.to === v.id);
    ins.forEach((e) => console.log(`exec from ${ids.get(e.from)?.title}.${e.fromPin} -> Set Visibility`));
    const dataIns = data.filter((e) => e.to === v.id);
    dataIns.forEach((e) => console.log(`  ${ids.get(e.from)?.title}.${e.fromPin} -> Set Visibility.${e.toPin}`));
  }

  kill();
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
