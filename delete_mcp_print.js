const { spawn } = require('child_process');
const mcp = spawn('npx.cmd', ['ue-mcp', 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject'], { shell: true });
let reqId = 1;
function send(method, params) { mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: reqId++, method, params }) + '\n'); }

const BP_PATH = '/Game/BluePrint/BP_EnemyShadowLogic';

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
                const targetNodeId = "F34BFDDB46A5E5FD299E29BA505DFEC7";
                console.log(`Deleting Node ID: ${targetNodeId}`);
                send('tools/call', { 
                    name: 'blueprint', 
                    arguments: { 
                        action: 'delete_node', 
                        path: BP_PATH,
                        assetPath: BP_PATH,
                        blueprintPath: BP_PATH,
                        nodeId: targetNodeId,
                        nodeName: targetNodeId
                    } 
                });
            } else if (res.id === 2) {
                console.log("Delete result:", res.result.content[0].text);
                send('tools/call', { name: 'blueprint', arguments: { action: 'compile', path: BP_PATH, assetPath: BP_PATH, blueprintPath: BP_PATH } });
            } else if (res.id === 3) {
                console.log("Compile result:", res.result.content[0].text);
                process.exit(0);
            }
        } catch (e) {}
    }
});

send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'deleter2', version: '1.0' } });
