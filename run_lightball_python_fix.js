const { spawn } = require('child_process');
const path = require('path');
const ROOT = 'D:/Unreal Engine/Light_n_Shadow';
const PROJECT = `${ROOT}/Light_and_Shadow.uproject`;
const PY = `${ROOT}/fix_lightball_cleanup_and_material.py`;

const mcp = spawn('npx.cmd', ['ue-mcp', PROJECT], { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
let id = 1, pending = new Map(), buf = '';
function rpc(method, params, ms = 300000) {
  return new Promise((res, rej) => {
    const i = id++;
    const t = setTimeout(() => rej(new Error('timeout')), ms);
    pending.set(i, (m) => { clearTimeout(t); res(m); });
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n');
  });
}
mcp.stdout.on('data', (d) => {
  buf += d.toString();
  const lines = buf.split('\n'); buf = lines.pop();
  for (const line of lines) {
    try { const msg = JSON.parse(line); const cb = pending.get(msg.id); if (cb) { pending.delete(msg.id); cb(msg); } } catch (_) {}
  }
});

(async () => {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'pyfix' } });
  const res = await rpc('tools/call', {
    name: 'editor',
    arguments: { action: 'run_python_file', filePath: PY },
  });
  console.log(res?.result?.content?.[0]?.text || JSON.stringify(res));
  mcp.kill();
})().catch((e) => { console.error(e); mcp.kill(); process.exit(1); });
