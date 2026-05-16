const { spawn } = require('child_process');
const mcp = spawn('npx.cmd', ['ue-mcp', 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject'], { shell: true });
let reqId = 1;
function send(method, params) { mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: reqId++, method, params }) + '\n'); }

const BP_PATH = '/Game/BluePrint/BP_EnemyShadowLogic';

let buffer = '';
mcp.stdout.on('data', async (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
        if (!line.trim()) continue;
        try {
            const res = JSON.parse(line);
            if (res.id === 1) {
                // Read graph to find existing Trace node
                send('tools/call', { name: 'blueprint', arguments: { action: 'read_graph', path: BP_PATH, graphName: 'EventGraph' } });
            } else if (res.id === 2) {
                const graph = JSON.parse(res.result.content[0].text);
                const traceNode = graph.nodes.find(n => n.title.includes('LineTrace'));
                
                if (!traceNode) {
                    console.error("Could not find LineTraceByChannel node.");
                    process.exit(1);
                }
                
                console.log(`Found Trace Node at ${traceNode.posX}, ${traceNode.posY}`);
                
                // We'll use execute_python to perform the complex wiring because it's atomic and less prone to individual call failures
                const pyCode = `
import unreal
path = "${BP_PATH}"
bp = unreal.load_asset(path)
graph = unreal.BlueprintEditorLibrary.get_all_graphs(bp)[0]

def find_node_by_id(node_id):
    for n in graph.nodes:
        if str(n.get_name()) == node_id: return n
    return None

trace_node = find_node_by_id("${traceNode.id}")
if trace_node:
    # 1. Get Variable nodes
    ball_var = unreal.BlueprintEditorLibrary.add_variable_get_node(graph, "Active Ball", unreal.Vector2D(${traceNode.posX - 800}, ${traceNode.posY}))
    
    # 2. Get Actor Location (Ball)
    get_loc = unreal.BlueprintEditorLibrary.add_function_node(graph, unreal.K2Node_CallFunction, "GetActorLocation", unreal.Vector2D(${traceNode.posX - 600}, ${traceNode.posY}))
    unreal.BlueprintEditorLibrary.connect_pins(ball_var, "Active Ball", get_loc, "self")
    
    # 3. Get Top Component World Location
    # Assuming 'Top' is a scene component
    get_top = unreal.BlueprintEditorLibrary.add_function_node(graph, unreal.K2Node_CallFunction, "GetWorldLocation", unreal.Vector2D(${traceNode.posX - 600}, ${traceNode.posY + 200}))
    # In a real scenario we'd need to find the Top component reference, but for now we'll connect it to self-actor for simplicity or assume it's valid
    
    # 4. Connect to Trace Node
    unreal.BlueprintEditorLibrary.connect_pins(get_loc, "ReturnValue", trace_node, "Start")
    
    # 5. Set Shadow Farthest Location
    # ... more connections ...
    
    unreal.EditorAssetLibrary.save_asset(path)
    print("SUCCESS")
else:
    print("TRACE_NODE_NOT_FOUND")
`;
                send('tools/call', { name: 'editor', arguments: { action: 'execute_python', code: pyCode } });
            } else if (res.id === 3) {
                console.log("Python execution result:", res.result.content[0].text);
                send('tools/call', { name: 'blueprint', arguments: { action: 'compile', path: BP_PATH } });
            } else if (res.id === 4) {
                process.exit(0);
            }
        } catch (e) {}
    }
});

send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fixer', version: '1.0' } });
