const { spawn } = require('child_process');

const mcp = spawn('npx.cmd', ['ue-mcp', 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject'], { shell: true });

let id = 1;
function sendRequest(method, params) {
    const req = JSON.stringify({
        jsonrpc: '2.0',
        id: id++,
        method: method,
        params: params
    });
    mcp.stdin.write(req + '\n');
}

mcp.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
        if (!line.trim()) continue;
        try {
            const res = JSON.parse(line);
            console.log(JSON.stringify(res, null, 2));
            
            // If initialized, call the tool
            if (res.id === 1) {
                sendRequest('tools/call', {
                    name: 'blueprint',
                    arguments: {
                        action: 'read_graph',
                        path: '/Game/BluePrint/BP_EnemyShadowLogic',
                        graphName: 'EventGraph'
                    }
                });
            } else if (res.id === 2) {
                process.exit(0);
            }
        } catch (e) {
            // Ignore non-json logs
        }
    }
});

sendRequest('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test', version: '1.0' }
});
