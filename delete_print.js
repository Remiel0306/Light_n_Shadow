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
                send('tools/call', { name: 'blueprint', arguments: { action: 'read_graph', path: BP_PATH, graphName: 'EventGraph' } });
            } else if (res.id === 2) {
                const graph = JSON.parse(res.result.content[0].text);
                
                // Find Print String nodes
                const printNodes = graph.nodes.filter(n => n.class === 'K2Node_CallFunction' && n.title === 'Print String');
                
                if (printNodes.length === 0) {
                    console.log("No Print String nodes found.");
                    process.exit(0);
                }
                
                console.log(`Found ${printNodes.length} Print String node(s). Deleting...`);
                
                // Delete the first one we found (or all of them)
                // We'll just delete the one we found earlier or the first one if the ID changed.
                // Let's delete all Print String nodes to be sure, or just the one connected to Overlap.
                // The user said "overlap的print string", there are two. Let's delete both.
                
                // Since MCP might not support batch operations, we'll use execute_python to guarantee deletion and reconnection.
                
                const pyCode = `
import unreal
path = "${BP_PATH}"
bp = unreal.load_asset(path)
graph = unreal.BlueprintEditorLibrary.get_all_graphs(bp)[0]

nodes_to_delete = []
for node in graph.nodes:
    if node.get_class().get_name() == "K2Node_CallFunction":
        if "PrintString" in str(node.get_name()) or node.get_name() == "PrintString":
            nodes_to_delete.append(node)

for node in nodes_to_delete:
    unreal.BlueprintEditorLibrary.remove_node(graph, node)

unreal.BlueprintEditorLibrary.compile_blueprint(bp)
unreal.EditorAssetLibrary.save_asset(path)
print(f"DELETED {len(nodes_to_delete)} NODES")
`;
                send('tools/call', { name: 'editor', arguments: { action: 'execute_python', code: pyCode } });
            } else if (res.id === 3) {
                console.log("Python execution result:", res.result.content[0].text);
                process.exit(0);
            }
        } catch (e) {}
    }
});

send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'deleter', version: '1.0' } });
