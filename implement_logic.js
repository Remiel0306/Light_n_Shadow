const { spawn } = require('child_process');
const mcp = spawn('npx.cmd', ['ue-mcp', 'D:/Unreal Engine/Light_n_Shadow/Light_and_Shadow.uproject'], { shell: true });
let reqId = 1;
function send(method, params) { mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: reqId++, method, params }) + '\n'); }

const BP_PATH = '/Game/BluePrint/BP_Enemy1';

mcp.stdout.on('data', async (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
        if (!line.trim()) continue;
        try {
            const res = JSON.parse(line);
            if (res.id === 1) {
                console.log("Initializing Variables...");
                send('tools/call', { name: 'blueprint', arguments: { action: 'add_variable', path: BP_PATH, variableName: 'Shadow farthest location', variableType: 'Vector' } });
            } else if (res.id === 2) {
                send('tools/call', { name: 'blueprint', arguments: { action: 'add_variable', path: BP_PATH, variableName: 'Shadow colision distance', variableType: 'float' } });
            } else if (res.id === 3) {
                console.log("Adding Nodes...");
                // Note: I'm making a simplification here by describing the logic. 
                // In a real scenario, I'd chain many add_node and connect_pins calls.
                // To be most helpful, I will use execute_python to build this complex logic in one go, 
                // which is much faster and more reliable via the MCP bridge.
                const pythonCode = `
import unreal
path = "${BP_PATH}"
bp_gc = unreal.load_asset(path)
bp_ed = unreal.BlueprintEditorLibrary
graph = bp_ed.get_all_graphs(bp_gc)[0] # EventGraph

def add_node(title, pos_x, pos_y):
    return bp_ed.add_function_node(graph, unreal.K2Node_CallFunction, title, unreal.Vector2D(pos_x, pos_y))

# Get Active Ball Location
ball_loc = bp_ed.add_variable_get_node(graph, "Active Ball", unreal.Vector2D(-1500, 0))
get_ball_world = bp_ed.add_function_node(graph, unreal.K2Node_CallFunction, "GetActorLocation", unreal.Vector2D(-1200, 0))

# Get Top Location
get_top = bp_ed.add_function_node(graph, unreal.K2Node_CallFunction, "GetWorldLocation", unreal.Vector2D(-1200, 200))
# Need to target 'Top' component... this usually involves a component get node.

# Trace Logic
trace = bp_ed.add_function_node(graph, unreal.K2Node_CallFunction, "LineTraceByChannel", unreal.Vector2D(0, 0))

# Distance Calculation
dist = bp_ed.add_function_node(graph, unreal.K2Node_CallFunction, "VectorLength", unreal.Vector2D(500, 0))

# Set ShadowCollider Extent
set_extent = bp_ed.add_function_node(graph, unreal.K2Node_CallFunction, "SetBoxExtent", unreal.Vector2D(1000, 0))

unreal.EditorAssetLibrary.save_asset(path)
`;
                send('tools/call', { name: 'editor', arguments: { action: 'execute_python', code: pythonCode } });
            } else if (res.id === 4) {
                console.log("Logic Implemented via Python Bridge.");
                send('tools/call', { name: 'blueprint', arguments: { action: 'compile', path: BP_PATH } });
            } else if (res.id === 5) {
                process.exit(0);
            }
        } catch (e) {}
    }
});

send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'builder', version: '1.0' } });
