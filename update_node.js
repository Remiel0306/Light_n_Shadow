const { spawn } = require('child_process');

const mcp = spawn('npx.cmd', ['ue-mcp', 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject'], { shell: true });

let step = 0;
let reqId = 1;

function send(method, params) {
    const req = JSON.stringify({ jsonrpc: '2.0', id: reqId++, method, params });
    mcp.stdin.write(req + '\n');
}

let buffer = '';

mcp.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop(); // Keep incomplete line

    for (const line of lines) {
        if (!line.trim()) continue;
        try {
            const res = JSON.parse(line);
            
            if (res.id === 1) {
                // Initialized, request graph
                console.log("Connected to MCP. Reading graph...");
                send('tools/call', {
                    name: 'blueprint',
                    arguments: {
                        action: 'read_graph',
                        blueprintPath: '/Game/BluePrint/BP_Enemy1',
                        assetPath: '/Game/BluePrint/BP_Enemy1',
                        path: '/Game/BluePrint/BP_Enemy1',
                        graphName: 'EventGraph'
                    }
                });
            } else if (res.id === 2) {
                // Graph read
                console.log("Graph read received.");
                const contentStr = res.result.content[0].text;
                const content = JSON.parse(contentStr);
                
                let printNodeId = null;
                if (!content.nodes) {
                    console.error("No nodes in content:", JSON.stringify(content, null, 2));
                    process.exit(1);
                }
                if (content.nodes && content.nodes.length > 0) {
                    console.log("First node structure:", JSON.stringify(content.nodes[0], null, 2));
                }
                for (const node of content.nodes) {
                    if (node.class === 'K2Node_CallFunction' && node.title === 'Print String') {
                        printNodeId = node.id;
                        break;
                    }
                }
                
                if (printNodeId) {
                    console.log("Found Print String Node: " + printNodeId);
                    console.log("Updating property to 'MCP is Work'...");
                    send('tools/call', {
                        name: 'blueprint',
                        arguments: {
                            action: 'set_node_property',
                            blueprintPath: '/Game/BluePrint/BP_Enemy1',
                            assetPath: '/Game/BluePrint/BP_Enemy1',
                            path: '/Game/BluePrint/BP_Enemy1',
                            nodeName: printNodeId,
                            propertyName: 'InString',
                            value: 'MCP is Work'
                        }
                    });
                } else {
                    console.log("Could not find Print String node. Available nodes:");
                    console.log(content.nodes.map(n => n.title + " (" + n.class + ")").join(', '));
                    process.exit(1);
                }
            } else if (res.id === 3) {
                // Update result
                console.log("Update successful. Compiling...");
                send('tools/call', {
                    name: 'blueprint',
                    arguments: {
                        action: 'compile',
                        path: '/Game/BluePrint/BP_Enemy1'
                    }
                });
            } else if (res.id === 4) {
                // Compile result
                console.log("Compile result:", JSON.stringify(res.result.content[0].text));
                process.exit(0);
            }
        } catch (e) {
            // console.error("Parse error:", e);
            if (e.message !== "Unexpected end of JSON input") {
                console.error("Error processing line:", e);
            }
        }
    }
});

send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test', version: '1.0' }
});
