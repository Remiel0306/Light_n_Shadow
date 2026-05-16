import unreal

BP_PATH = "/Game/BluePrint/BP_EnemyShadowLogic"
bp = unreal.load_asset(BP_PATH)
if not bp:
    print("ERR: BP not found")
    raise SystemExit(1)

graph = unreal.BlueprintEditorLibrary.get_all_graphs(bp)[0]

def by_name_contains(key):
    for n in graph.nodes:
        if key in n.get_name():
            return n
    return None

def connect(a, ap, b, bp):
    try:
        unreal.BlueprintEditorLibrary.connect_pins(a, ap, b, bp)
        return True
    except Exception:
        return False

line_trace = by_name_contains("LineTraceByChannel")
break_hit = by_name_contains("BreakHitResult")
if not line_trace or not break_hit:
    print("ERR: line trace chain missing")
    raise SystemExit(1)

base_x = int(line_trace.node_pos_x) + 4200
base_y = int(line_trace.node_pos_y)

# Make trace visible in game/editor for verification.
try:
    unreal.BlueprintEditorLibrary.set_node_pin_default_value(line_trace, "DrawDebugType", "ForDuration")
    unreal.BlueprintEditorLibrary.set_node_pin_default_value(line_trace, "DrawTime", "5.0")
except Exception:
    pass

set_far = unreal.BlueprintEditorLibrary.add_variable_set_node(graph, "Shadow farthest location", unreal.Vector2D(base_x, base_y + 20))
get_root = unreal.BlueprintEditorLibrary.add_variable_get_node(graph, "ShaodwColliderRoot", unreal.Vector2D(base_x + 260, base_y + 250))
get_root_loc = unreal.BlueprintEditorLibrary.add_function_node(graph, unreal.K2Node_CallFunction, "K2_GetComponentLocation", unreal.Vector2D(base_x + 480, base_y + 230))
sub_vec = unreal.BlueprintEditorLibrary.add_function_node(graph, unreal.K2Node_CallFunction, "Subtract_VectorVector", unreal.Vector2D(base_x + 760, base_y + 170))
vec_len = unreal.BlueprintEditorLibrary.add_function_node(graph, unreal.K2Node_CallFunction, "VSize", unreal.Vector2D(base_x + 990, base_y + 170))
set_dist = unreal.BlueprintEditorLibrary.add_variable_set_node(graph, "Shadow colision distance", unreal.Vector2D(base_x + 1220, base_y + 20))
make_vec = unreal.BlueprintEditorLibrary.add_function_node(graph, unreal.K2Node_CallFunction, "MakeVector", unreal.Vector2D(base_x + 1480, base_y + 150))
get_col = unreal.BlueprintEditorLibrary.add_variable_get_node(graph, "ShadowCollider", unreal.Vector2D(base_x + 1480, base_y + 320))
set_extent = unreal.BlueprintEditorLibrary.add_function_node(graph, unreal.K2Node_CallFunction, "SetBoxExtent", unreal.Vector2D(base_x + 1720, base_y + 150))

connect(line_trace, "then", set_far, "execute")
if not connect(break_hit, "Location", set_far, "Shadow farthest location"):
    connect(break_hit, "ImpactPoint", set_far, "Shadow farthest location")

connect(get_root, "ShaodwColliderRoot", get_root_loc, "self")
if not connect(break_hit, "Location", sub_vec, "A"):
    connect(break_hit, "ImpactPoint", sub_vec, "A")
connect(get_root_loc, "ReturnValue", sub_vec, "B")
connect(sub_vec, "ReturnValue", vec_len, "A")

connect(set_far, "then", set_dist, "execute")
connect(vec_len, "ReturnValue", set_dist, "Shadow colision distance")

connect(vec_len, "ReturnValue", make_vec, "X")
try:
    unreal.BlueprintEditorLibrary.set_node_pin_default_value(make_vec, "Y", "20.0")
    unreal.BlueprintEditorLibrary.set_node_pin_default_value(make_vec, "Z", "120.0")
except Exception:
    pass

connect(get_col, "ShadowCollider", set_extent, "self")
connect(make_vec, "ReturnValue", set_extent, "InBoxExtent")
connect(set_dist, "then", set_extent, "execute")
try:
    unreal.BlueprintEditorLibrary.set_node_pin_default_value(set_extent, "bUpdateOverlaps", "true")
except Exception:
    pass

unreal.BlueprintEditorLibrary.compile_blueprint(bp)
unreal.EditorAssetLibrary.save_asset(BP_PATH)
print("OK: shadow chain applied")

