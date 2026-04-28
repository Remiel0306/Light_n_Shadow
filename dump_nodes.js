const { spawn } = require('child_process');

const mcp = spawn('npx.cmd', ['ue-mcp', 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject'], { shell: true });

let reqId = 1;
function send(method, params) {
    const req = JSON.stringify({ jsonrpc: '2.0', id: reqId++, method, params });
    mcp.stdin.write(req + '\n');
}

let buffer = '';
mcp.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
        if (!line.trim()) continue;
        try {
            const res = JSON.parse(line);
            if (res.id === 1) {
                // Initialized
                send('tools/call', {
                    name: 'blueprint',
                    arguments: {
                        action: 'read_graph',
                        path: '/Game/BluePrint/BP_Enemy1',
                        graphName: 'EventGraph'
                    }
                });
            } else if (res.id === 2) {
                // Received graph
                const content = JSON.parse(res.result.content[0].text);
                console.log(JSON.stringify(content.nodes, null, 2));
                process.exit(0);
            }
        } catch (e) {}
    }
});

send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'explorer', version: '1.0' }
});
