const { spawn } = require('child_process');
const mcp = spawn('npx.cmd', ['ue-mcp', 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject'], { shell: true });
let reqId = 1;
function send(method, params) { mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: reqId++, method, params }) + '\n'); }
let buffer = '';
mcp.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
        if (!line.trim()) continue;
        try {
            const res = JSON.parse(line);
            if (res.id === 1) send('tools/call', { name: 'blueprint', arguments: { action: 'read_graph', path: '/Game/BluePrint/BP_Enemy1', graphName: 'EventGraph' } });
            else if (res.id === 2) {
                const content = JSON.parse(res.result.content[0].text);
                const linetrace = content.nodes.find(n => n.title.includes('LineTrace'));
                if (linetrace) {
                    console.log(`FOUND_TRACE: ${linetrace.id} at ${linetrace.posX}, ${linetrace.posY}`);
                } else {
                    console.log("TRACE_NOT_FOUND");
                }
                process.exit(0);
            }
        } catch (e) {}
    }
});
send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'explorer', version: '1.0' } });
