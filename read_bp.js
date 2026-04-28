const { spawn } = require('child_process');
const mcp = spawn('npx.cmd', ['ue-mcp', 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject'], { shell: true });
let reqId = 1;
function send(method, params) { mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: reqId++, method, params }) + '\n'); }
mcp.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
        if (!line.trim()) continue;
        try {
            const res = JSON.parse(line);
            if (res.id === 1) send('tools/call', { name: 'blueprint', arguments: { action: 'read', path: '/Game/BluePrint/BP_Enemy1', assetPath: '/Game/BluePrint/BP_Enemy1', blueprintPath: '/Game/BluePrint/BP_Enemy1' } });
            else if (res.id === 2) { console.log(res.result.content[0].text); process.exit(0); }
        } catch (e) {}
    }
});
send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'explorer', version: '1.0' } });
