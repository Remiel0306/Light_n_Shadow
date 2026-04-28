const { spawn } = require('child_process');
const fs = require('fs');

const PROJECT = 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject';
const PY = fs.readFileSync('shadow_dynamic_logic.py', 'utf8');

const mcp = spawn('npx.cmd', ['ue-mcp', PROJECT], { shell: true });
let reqId = 1;
const send = (method, params) => {
  mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: reqId++, method, params }) + '\n');
};

mcp.stdout.on('data', (data) => {
  const lines = data.toString().split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const res = JSON.parse(line);
      if (res.id === 1) {
        send('tools/call', { name: 'editor', arguments: { action: 'execute_python', code: PY } });
      } else if (res.id === 2) {
        console.log(res.result?.content?.[0]?.text ?? JSON.stringify(res));
        process.exit(0);
      }
    } catch (_) {}
  }
});

send('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'shadow-dynamic-runner', version: '1.0' },
});
