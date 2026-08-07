const { spawn } = require("child_process");
const fs = require("fs");
const PROJECT = "D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject";
const OUT = "D:/Unreal Engine/Light_n_Shadow/scan_after_track3.json";
const mcp = spawn("npx.cmd", ["ue-mcp", PROJECT], {
  shell: true,
  cwd: "D:/Unreal Engine/Light_n_Shadow",
});
let id = 1,
  buf = "",
  wait = new Map();
function rpc(method, params, timeoutMs = 90000) {
  return new Promise((res, rej) => {
    const i = id++;
    const t = setTimeout(() => {
      wait.delete(i);
      rej(new Error("timeout " + method));
    }, timeoutMs);
    wait.set(i, (m) => {
      clearTimeout(t);
      res(m);
    });
    mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n");
  });
}
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
(async () => {
  try {
    await rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "scan-track3", version: "1" },
    });
    async function call(name, args) {
      const r = await rpc("tools/call", { name, arguments: args });
      if (r.error) return { error: r.error };
      const c = r.result && r.result.content;
      if (Array.isArray(c)) {
        const t = c.map((x) => x.text || JSON.stringify(x)).join("\n");
        try {
          return JSON.parse(t);
        } catch {
          return { raw: t };
        }
      }
      return r.result || r;
    }
    const assetPath = "/Game/BluePrint/Enemy/BP_EnemySpotter-Ins";
    const graph = await call("blueprint", {
      action: "read_graph",
      assetPath,
      graphName: "EventGraph",
    });
    const s = JSON.stringify(graph);
    fs.writeFileSync(
      "D:/Unreal Engine/Light_n_Shadow/scan_after_track3_full.json",
      s
    );

    const titles = [];
    const re2 = /"title":\s*"([^"]+)"/g;
    let m2;
    while ((m2 = re2.exec(s))) titles.push(m2[1]);
    const interesting = [...new Set(titles)].filter((t) =>
      /After|Grab|Track|Follow|Random|Phase|Request|Scan|Kill/i.test(t)
    );

    // Try execution flows for candidate events
    const candidates = interesting.filter((t) =>
      /After Track|Track Arrived|Grab|Phase 2 Track|Enter Phase|Start Follow/i.test(t)
    );
    const flows = {};
    for (const name of candidates.slice(0, 8)) {
      flows[name] = await call("blueprint", {
        action: "get_execution_flow",
        assetPath,
        graphName: "EventGraph",
        startNodeTitle: name,
      });
      if (flows[name] && flows[name].error) {
        flows[name + "_alt"] = await call("blueprint", {
          action: "get_execution_flow",
          assetPath,
          graphName: "EventGraph",
          entryTitle: name,
        });
      }
    }

    // Also try known exact names
    for (const name of [
      "After Track Arrived",
      "Enter Phase 2 Track Loop",
      "Start Phase 2 Track Loop",
      "Start Follow",
      "Enter Phase 2",
    ]) {
      if (!flows[name]) {
        flows[name] = await call("blueprint", {
          action: "get_execution_flow",
          assetPath,
          graphName: "EventGraph",
          startEvent: name,
        });
      }
    }

    fs.writeFileSync(
      OUT,
      JSON.stringify(
        {
          interesting,
          candidates,
          flows,
          keys: Object.keys(graph),
        },
        null,
        2
      )
    );
    console.log("WROTE", OUT);
  } catch (e) {
    console.error("FAIL", e);
    fs.writeFileSync(OUT, JSON.stringify({ error: String(e) }, null, 2));
  } finally {
    try {
      mcp.kill();
    } catch {}
    process.exit(0);
  }
})();
