import unreal

BP_PATH = "/Game/BluePrint/BP_EnemyShadowLogic"


def add_call(graph, func_name, x, y):
    return unreal.BlueprintEditorLibrary.add_function_node(
        graph, unreal.K2Node_CallFunction, func_name, unreal.Vector2D(x, y)
    )


def try_connect(a, a_pin, b, b_pin):
    try:
        unreal.BlueprintEditorLibrary.connect_pins(a, a_pin, b, b_pin)
        return True
    except Exception:
        return False


def connect_any(a, src_pins, b, dst_pins):
    for sp in src_pins:
        for dp in dst_pins:
            if try_connect(a, sp, b, dp):
                return True
    return False


def find_node_by_name_contains(graph, needle):
    for n in graph.nodes:
        if needle in n.get_name():
            return n
    return None


bp = unreal.load_asset(BP_PATH)
if not bp:
    raise RuntimeError("BP not found")

graph = unreal.BlueprintEditorLibrary.get_all_graphs(bp)[0]

line_trace = find_node_by_name_contains(graph, "LineTraceByChannel")
break_hit = find_node_by_name_contains(graph, "BreakHitResult")
if not line_trace or not break_hit:
    raise RuntimeError("line trace chain not found")

base_x = int(line_trace.node_pos_x) + 500
base_y = int(line_trace.node_pos_y) + 100

# 1) Save hit point into Shadow farthest location (Vector)
set_farthest = unreal.BlueprintEditorLibrary.add_variable_set_node(
    graph, "Shadow farthest location", unreal.Vector2D(base_x, base_y)
)
try_connect(line_trace, "then", set_farthest, "execute")
connect_any(break_hit, ["Location", "ImpactPoint"], set_farthest, ["Shadow farthest location"])

# 2) Compute distance = |HitLocation - ShaodwColliderRootWorldLocation|
get_root = unreal.BlueprintEditorLibrary.add_variable_get_node(
    graph, "ShaodwColliderRoot", unreal.Vector2D(base_x + 260, base_y + 220)
)
root_world = add_call(graph, "GetWorldLocation", base_x + 460, base_y + 220)
connect_any(get_root, ["ShaodwColliderRoot"], root_world, ["self"])

sub_vec = add_call(graph, "Subtract_VectorVector", base_x + 700, base_y + 140)
connect_any(break_hit, ["Location", "ImpactPoint"], sub_vec, ["A"])
connect_any(root_world, ["ReturnValue"], sub_vec, ["B"])

vec_len = add_call(graph, "VectorLength", base_x + 920, base_y + 140)
connect_any(sub_vec, ["ReturnValue"], vec_len, ["V"])

set_dist = unreal.BlueprintEditorLibrary.add_variable_set_node(
    graph, "Shadow colision distance", unreal.Vector2D(base_x + 1120, base_y)
)
try_connect(set_farthest, "then", set_dist, "execute")
connect_any(vec_len, ["ReturnValue"], set_dist, ["Shadow colision distance"])

# 3) SetBoxExtent based on distance
half = add_call(graph, "Divide_DoubleDouble", base_x + 1320, base_y + 140)
connect_any(vec_len, ["ReturnValue"], half, ["A"])
unreal.BlueprintEditorLibrary.set_node_pin_default_value(half, "B", "2.0")

make_vec = add_call(graph, "MakeVector", base_x + 1520, base_y + 110)
connect_any(half, ["ReturnValue"], make_vec, ["X"])
unreal.BlueprintEditorLibrary.set_node_pin_default_value(make_vec, "Y", "20.0")
unreal.BlueprintEditorLibrary.set_node_pin_default_value(make_vec, "Z", "120.0")

get_collider = unreal.BlueprintEditorLibrary.add_variable_get_node(
    graph, "ShadowCollider", unreal.Vector2D(base_x + 1510, base_y + 280)
)
set_extent = add_call(graph, "SetBoxExtent", base_x + 1750, base_y + 110)
connect_any(get_collider, ["ShadowCollider"], set_extent, ["Target"])
connect_any(make_vec, ["ReturnValue"], set_extent, ["InBoxExtent"])
try_connect(set_dist, "then", set_extent, "execute")
unreal.BlueprintEditorLibrary.set_node_pin_default_value(set_extent, "bUpdateOverlaps", "true")

unreal.BlueprintEditorLibrary.compile_blueprint(bp)
unreal.EditorAssetLibrary.save_asset(BP_PATH)
print("SHADOW_DYNAMIC_DONE")
