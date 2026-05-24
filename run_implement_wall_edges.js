const { spawn } = require("child_process");
const path = require("path");

const script = path.join(__dirname, "implement_wall_window_edges_mcp.js");
const mcp = spawn("node", [script], { shell: true, stdio: "inherit" });
mcp.on("exit", (code) => process.exit(code ?? 1));
