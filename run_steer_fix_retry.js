/**
 * Wait for MCP bridge then apply steer forward-preservation fix.
 */
const { spawn } = require("child_process");
const net = require("net");

const PROJECT = "D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject";
const PORT = 9877;
const MAX_WAIT_MS = 420000;
const INTERVAL_MS = 5000;

function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.createConnection({ port, host: "127.0.0.1" }, () => {
      s.end();
      resolve(true);
    });
    s.on("error", () => resolve(false));
    s.setTimeout(2000, () => {
      s.destroy();
      resolve(false);
    });
  });
}

async function waitBridge() {
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT_MS) {
    if (await portOpen(PORT)) {
      console.log("Bridge ready on port", PORT);
      await new Promise((r) => setTimeout(r, 8000));
      return;
    }
    console.log("Waiting for UE MCP bridge...");
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  throw new Error("Bridge not ready after " + MAX_WAIT_MS / 1000 + "s — open project in Unreal Editor");
}

(async () => {
  await waitBridge();
  const child = spawn("node", ["fix_steer_preserve_forward.js"], {
    cwd: "D:/Unreal Engine/Light_n_Shadow",
    stdio: "inherit",
    shell: true,
  });
  child.on("exit", (code) => process.exit(code ?? 1));
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
