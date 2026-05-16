import unreal

BP_PATH = "/Game/BluePrint/BP_EnemyShadowLogic"
bp = unreal.load_asset(BP_PATH)
if not bp:
    print("ERR: BP not found")
    raise SystemExit(1)

graph = unreal.BlueprintEditorLibrary.get_all_graphs(bp)[0]

def pin_names(node):
    return [p.pin_name for p in node.pins]

def has_pin(node, name):
    for p in node.pins:
        if str(p.pin_name) == name:
            return True
    return False

def try_connect(a, ap, b, bp_name):
    try:
        unreal.BlueprintEditorLibrary.connect_pins(a, ap, b, bp_name)
        return True
    except Exception:
        return False

def connect_any(a, srcs, b, dsts):
    for s in srcs:
        for d in dsts:
            if try_connect(a, s, b, d):
                return True
    return False

def add_call(name, x, y):
    return unreal.BlueprintEditorLibrary.add_function_node(graph, unreal.K2Node_CallFunction, name, unreal.Vector2D(x, y))

# find one set-distance node in active chain
set_dist = None
line_trace = None
for n in graph.nodes:
    cls = n.get_class().get_name()
    if "LineTraceByChannel" in n.get_name():
        line_trace = n
    if cls == "K2Node_VariableSet" and has_pin(n, "Shadow colision distance"):
        set_dist = n
        break

if not set_dist:
    print("ERR: Set Shadow colision distance node not found")
    raise SystemExit(1)

base_x = int(set_dist.node_pos_x) + 260
base_y = int(set_dist.node_pos_y) + 180

# trace debug visible
if line_trace:
    try:
        unreal.BlueprintEditorLibrary.set_node_pin_default_value(line_trace, "DrawDebugType", "ForDuration")
        unreal.BlueprintEditorLibrary.set_node_pin_default_value(line_trace, "DrawTime", "5.0")
    except Exception:
        pass

get_root = unreal.BlueprintEditorLibrary.add_variable_get_node(graph, "ShaodwColliderRoot", unreal.Vector2D(base_x, base_y))
get_root_loc = add_call("K2_GetComponentLocation", base_x + 200, base_y)
get_far = unreal.BlueprintEditorLibrary.add_variable_get_node(graph, "Shadow farthest location", unreal.Vector2D(base_x, base_y - 180))
look_at = add_call("FindLookAtRotation", base_x + 420, base_y - 90)
set_root_rot = add_call("K2_SetWorldRotation", base_x + 660, base_y - 90)

half = add_call("Divide_DoubleDouble", base_x + 420, base_y + 120)
make_loc = add_call("MakeVector", base_x + 660, base_y + 120)
get_col = unreal.BlueprintEditorLibrary.add_variable_get_node(graph, "ShadowCollider", unreal.Vector2D(base_x + 660, base_y + 300))
set_rel = add_call("K2_SetRelativeLocation", base_x + 900, base_y + 120)
make_extent = add_call("MakeVector", base_x + 900, base_y + 300)
set_extent = add_call("SetBoxExtent", base_x + 1140, base_y + 300)

connect_any(get_root, ["ShaodwColliderRoot"], get_root_loc, ["self", "Target"])
connect_any(get_root_loc, ["ReturnValue"], look_at, ["Start"])
connect_any(get_far, ["Shadow farthest location"], look_at, ["Target"])
connect_any(get_root, ["ShaodwColliderRoot"], set_root_rot, ["self", "Target"])
connect_any(look_at, ["ReturnValue"], set_root_rot, ["NewRotation", "DesiredRotation"])

connect_any(set_dist, ["then"], set_root_rot, ["execute"])
connect_any(set_root_rot, ["then"], set_rel, ["execute"])
connect_any(set_rel, ["then"], set_extent, ["execute"])

connect_any(set_dist, ["Shadow colision distance", "Output_Get"], half, ["A", "Dividend"])
try:
    unreal.BlueprintEditorLibrary.set_node_pin_default_value(half, "B", "2.0")
except Exception:
    pass

connect_any(half, ["ReturnValue"], make_loc, ["X"])
try:
    unreal.BlueprintEditorLibrary.set_node_pin_default_value(make_loc, "Y", "0.0")
    unreal.BlueprintEditorLibrary.set_node_pin_default_value(make_loc, "Z", "0.0")
except Exception:
    pass
connect_any(get_col, ["ShadowCollider"], set_rel, ["self", "Target"])
connect_any(make_loc, ["ReturnValue"], set_rel, ["NewLocation", "Location"])

connect_any(half, ["ReturnValue"], make_extent, ["X"])
try:
    unreal.BlueprintEditorLibrary.set_node_pin_default_value(make_extent, "Y", "20.0")
    unreal.BlueprintEditorLibrary.set_node_pin_default_value(make_extent, "Z", "120.0")
except Exception:
    pass
connect_any(get_col, ["ShadowCollider"], set_extent, ["self", "Target"])
connect_any(make_extent, ["ReturnValue"], set_extent, ["InBoxExtent", "NewExtent"])
try:
    unreal.BlueprintEditorLibrary.set_node_pin_default_value(set_extent, "bUpdateOverlaps", "true")
except Exception:
    pass

unreal.BlueprintEditorLibrary.compile_blueprint(bp)
unreal.EditorAssetLibrary.save_asset(BP_PATH)
print("OK: collider motion patched")

