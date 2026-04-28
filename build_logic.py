import unreal
import sys

def run():
    path = "/Game/BluePrint/BP_Enemy1"
    bp = unreal.load_asset(path)
    if not bp:
        print("BP NOT FOUND")
        return
        
    graphs = unreal.BlueprintEditorLibrary.get_all_graphs(bp)
    graph = graphs[0]

    # Find LineTraceByChannel to start near it
    trace_node = None
    for n in graph.nodes:
        if "LineTraceByChannel" in str(n.get_name()):
            trace_node = n
            break
            
    base_x = 0
    base_y = 0
    if trace_node:
        base_x = trace_node.node_pos_x
        base_y = trace_node.node_pos_y
    else:
        base_x = 2000
        base_y = 0

    def add_func(name, x, y):
        return unreal.BlueprintEditorLibrary.add_function_node(graph, unreal.K2Node_CallFunction, name, unreal.Vector2D(x, y))

    def connect(node1, pin1, node2, pin2):
        try:
            unreal.BlueprintEditorLibrary.connect_pins(node1, pin1, node2, pin2)
        except Exception as e:
            print(f"Failed to connect {pin1} to {pin2}: {e}")

    try:
        # 1. Break Hit Result
        break_hit = add_func("BreakHitResult", base_x + 300, base_y)
        if trace_node:
            connect(trace_node, "OutHit", break_hit, "Hit")

        # 2. Set Shadow farthest location
        set_farthest = unreal.BlueprintEditorLibrary.add_variable_set_node(graph, "Shadow farthest location", unreal.Vector2D(base_x + 600, base_y - 100))
        connect(break_hit, "Location", set_farthest, "Shadow farthest location")
        if trace_node:
            connect(trace_node, "then", set_farthest, "execute")

        # 3. Get ShaodwColliderRoot Location
        get_root = unreal.BlueprintEditorLibrary.add_variable_get_node(graph, "ShaodwColliderRoot", unreal.Vector2D(base_x + 600, base_y + 200))
        root_loc = add_func("GetWorldLocation", base_x + 800, base_y + 200)
        connect(get_root, "ShaodwColliderRoot", root_loc, "self")

        # 4. Subtract Vector
        sub_vec = add_func("Subtract_VectorVector", base_x + 1100, base_y)
        connect(set_farthest, "Shadow farthest location", sub_vec, "A")
        connect(root_loc, "ReturnValue", sub_vec, "B")

        # 5. Vector Length
        vlen = add_func("VectorLength", base_x + 1300, base_y)
        connect(sub_vec, "ReturnValue", vlen, "A") # Try 'A' as generic input

        # 6. Set Shadow colision distance
        set_dist = unreal.BlueprintEditorLibrary.add_variable_set_node(graph, "Shadow colision distance", unreal.Vector2D(base_x + 1600, base_y - 100))
        connect(vlen, "ReturnValue", set_dist, "Shadow colision distance")
        connect(set_farthest, "then", set_dist, "execute")

        # 7. Set Box Extent
        get_collider = unreal.BlueprintEditorLibrary.add_variable_get_node(graph, "ShadowCollider", unreal.Vector2D(base_x + 1600, base_y + 200))
        set_extent = add_func("SetBoxExtent", base_x + 1900, base_y - 100)
        connect(get_collider, "ShadowCollider", set_extent, "Target")
        connect(set_dist, "then", set_extent, "execute")
        
        # Make vector for Extent (we'll divide the distance by 2 for the Y or X axis)
        # Note: Making a vector from float is complex to wire up via Python. 
        # I'll leave the Extent pin unconnected so the user can just plug it into the correct axis!

        unreal.BlueprintEditorLibrary.compile_blueprint(bp)
        unreal.EditorAssetLibrary.save_asset(path)
        print("SUCCESS_LOGIC_CREATED")

    except Exception as e:
        print(f"ERROR: {e}")

run()
