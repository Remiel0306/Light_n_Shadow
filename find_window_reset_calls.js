const { spawn } = require("child_process");
const fs = require("fs");

const PATHS = [
  "/Game/BluePrint/BP_WindowShadowLogic",
  "/Game/BluePrint/Object/BP_WindowShadowLogic",
];

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
  return {
    rpc(method, params, ms = 180000) {
      return new Promise((resolve, reject) => {
        const i = id++;
        const t = setTimeout(() => reject(new Error("timeout")), ms);
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

async function bp(rpc, assetPath, args) {
  const r = await rpc("tools/call", { name: "blueprint", arguments: { path: assetPath, assetPath, ...args } });
  const t = r?.result?.content?.[0]?.text || "";
  try {
    return JSON.parse(t);
  } catch {
    return { success: false, raw: t.slice(0, 500) };
  }
}

function pinInfo(node) {
  return (node.pins || []).map((p) => ({
    name: p.name,
    dir: p.direction,
    type: p.type,
    connected: !!p.connected,
    default: p.defaultValue,
  }));
}

(async () => {
  const { rpc, kill } = mkMCP();
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "find-reset" } });

  for (const BP of PATHS) {
    console.log("\n########", BP, "########");
    const g = await bp(rpc, BP, { action: "read_graph", graphName: "EventGraph" });
    if (!g.nodes) {
      console.log("graph fail", g.error || g.raw);
      continue;
    }
    const nodes = g.nodes;
    console.log("node count", nodes.length);

    const resets = nodes.filter((n) => /ResetOneShadowCollider|Reset One Shadow/i.test(n.title || ""));
    console.log("reset calls", resets.length);
    for (const n of resets) {
      console.log("\n---", n.id, n.title, "---");
      for (const p of n.pins || []) {
        if (/Target|Collider|Root/i.test(p.name)) {
          console.log(" pin", p.name, p.direction, "connected=", p.connected, "links=", JSON.stringify(p.linkedTo || p.connections));
        }
      }
    }

    const selects = nodes.filter((n) => (n.class || "").includes("Select") || (n.title || "") === "Select");
    console.log("\nselect nodes", selects.length);
    for (const n of selects.slice(0, 8)) {
      const dataPins = (n.pins || []).filter((p) => p.type !== "exec");
      const unconnected = dataPins.filter((p) => !p.connected && p.direction === "Input");
      if (unconnected.length) {
        console.log(" SELECT", n.id, "unconnected inputs:", unconnected.map((p) => p.name).join(", "));
      }
    }

    const getColliders = nodes.filter((n) => /Shadow Collider/i.test(n.title || ""));
    console.log("\nshadow collider gets", getColliders.length);
    for (const n of getColliders.slice(0, 5)) {
      console.log(n.id, n.title, pinInfo(n).filter((p) => p.name === "Shadow Colliders" || p.name === "Index"));
    }

    fs.writeFileSync(
      `D:/Unreal Engine/Light_n_Shadow/_window_eg_${BP.replace(/\//g, "_")}.json`,
      JSON.stringify(
        {
          resetIds: resets.map((n) => ({ id: n.id, title: n.title, pins: pinInfo(n) })),
          selectUnconnected: selects
            .map((n) => ({
              id: n.id,
              unconnected: (n.pins || [])
                .filter((p) => !p.connected && p.direction === "Input" && p.type !== "exec")
                .map((p) => p.name),
            }))
            .filter((x) => x.unconnected.length),
        },
        null,
        2
      )
    );
  }

  kill();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
