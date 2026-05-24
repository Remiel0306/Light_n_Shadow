"""
在 Unreal Editor 內執行：Window -> Developer Tools -> Output Log 旁
Tools -> Execute Python Script -> 選此檔

會在 BP_WallShadowLogic 的 EventGraph 加入「依窗邊設定影子」節點鏈，
並嘗試新增變數 Edge Lengths。若找不到 Shadow Collision Compute，只會印警告。
"""
import unreal

BP_PATH = "/Game/BluePrint/BP_WallShadowLogic"


def find_graph(bp, name_hint):
    for g in unreal.BlueprintEditorLibrary.get_all_graphs(bp):
        gn = g.get_name()
        if name_hint.lower() in gn.lower():
            return g
    graphs = unreal.BlueprintEditorLibrary.get_all_graphs(bp)
    return graphs[0] if graphs else None


def find_node(graph, *needles):
    for n in graph.nodes:
        nm = n.get_name()
        if all(k in nm for k in needles):
            return n
    for n in graph.nodes:
        nm = n.get_name()
        if any(k in nm for k in needles):
            return n
    return None


def connect(a, ap, b, bp):
    try:
        unreal.BlueprintEditorLibrary.connect_pins(a, ap, b, bp)
        return True
    except Exception:
        return False


def connect_any(a, aps, b, bps):
    for ap in aps:
        for bp_pin in bps:
            if connect(a, ap, b, bp_pin):
                return True
    return False


def add_call(graph, func, x, y, target_class="/Script/Engine.KismetMathLibrary"):
    return unreal.BlueprintEditorLibrary.add_function_node(
        graph, unreal.K2Node_CallFunction, func, unreal.Vector2D(x, y)
    )


def ensure_member_variable(bp, var_name):
    """Best-effort: skip if variable already exists."""
    try:
        gen = bp.get_editor_property("new_variables")
        for v in gen:
            if str(v.get_editor_property("var_name")) == var_name:
                print("Variable exists:", var_name)
                return
    except Exception:
        pass
    try:
        unreal.KismetEditorUtilities.add_member_variable(
            bp,
            var_name,
            unreal.FloatProperty(),
            True,
        )
        print("Added array variable:", var_name)
    except Exception as e:
        print("Could not auto-add", var_name, "- add manually (Float Array, size 4):", e)


bp = unreal.load_asset(BP_PATH)
if not bp:
    raise RuntimeError("Open project and ensure " + BP_PATH + " exists")

ensure_member_variable(bp, "Edge Lengths")

graph = find_graph(bp, "EventGraph")
if not graph:
    raise RuntimeError("No EventGraph")

compute = find_node(graph, "ShadowCollisionCompute")
if not compute:
    compute = find_node(graph, "Shadow", "Collision", "Compute")
if not compute:
    print("WARN: Shadow Collision Compute not found. Create functions manually from bp_wall_shadow_edges_manual.md")
else:
    base_x = int(compute.node_pos_x) - 1200
    base_y = int(compute.node_pos_y)

    # --- SideIndex + NextIndex ---
    get_points = unreal.BlueprintEditorLibrary.add_variable_get_node(
        graph, "Light Through Points", unreal.Vector2D(base_x, base_y)
    )
    get_edges = unreal.BlueprintEditorLibrary.add_variable_get_node(
        graph, "Edge Lengths", unreal.Vector2D(base_x, base_y + 180)
    )

    # Expect custom event pin SideIndex on compute node; if missing, user adds int pin "SideIndex"
    add1 = add_call(graph, "Add_IntInt", base_x + 200, base_y - 120)
    mod4 = add_call(graph, "Percent_IntInt", base_x + 400, base_y - 120)
    unreal.BlueprintEditorLibrary.set_node_pin_default_value(mod4, "B", "4")

    get_a = add_call(graph, "Array_Get", base_x + 200, base_y, "/Script/Engine.KismetArrayLibrary")
    get_b = add_call(graph, "Array_Get", base_x + 200, base_y + 140, "/Script/Engine.KismetArrayLibrary")
    get_edge = add_call(graph, "Array_Get", base_x + 200, base_y + 300, "/Script/Engine.KismetArrayLibrary")

    loc_a = add_call(
        graph, "K2_GetComponentLocation", base_x + 440, base_y, "/Script/Engine.SceneComponent"
    )
    loc_b = add_call(
        graph, "K2_GetComponentLocation", base_x + 440, base_y + 140, "/Script/Engine.SceneComponent"
    )

    add_vec = add_call(graph, "Add_VectorVector", base_x + 680, base_y + 60)
    mid = add_call(graph, "Multiply_VectorFloat", base_x + 900, base_y + 60)
    unreal.BlueprintEditorLibrary.set_node_pin_default_value(mid, "B", "0.5")

    look = add_call(graph, "FindLookAtRotation", base_x + 680, base_y - 100)
    half = add_call(graph, "Divide_DoubleDouble", base_x + 680, base_y + 280)
    unreal.BlueprintEditorLibrary.set_node_pin_default_value(half, "B", "2.0")

    get_origin = unreal.BlueprintEditorLibrary.add_variable_get_node(
        graph, "Origin Collision Size", unreal.Vector2D(base_x + 440, base_y + 300)
    )
    brk = add_call(graph, "BreakVector", base_x + 640, base_y + 300)
    mk = add_call(graph, "MakeVector", base_x + 900, base_y + 280)

    set_loc = add_call(
        graph, "K2_SetWorldLocation", base_x + 1120, base_y - 40, "/Script/Engine.SceneComponent"
    )
    set_rot = add_call(
        graph, "K2_SetWorldRotation", base_x + 1360, base_y - 40, "/Script/Engine.SceneComponent"
    )
    set_ext = add_call(
        graph, "SetBoxExtent", base_x + 1120, base_y + 260, "/Script/Engine.BoxComponent"
    )
    unreal.BlueprintEditorLibrary.set_node_pin_default_value(set_ext, "bUpdateOverlaps", "true")

    connect_any(compute, ["SideIndex"], add1, ["A"])
    connect_any(add1, ["ReturnValue"], mod4, ["A"])
    connect_any(compute, ["SideIndex"], get_a, ["Index"])
    connect_any(get_points, ["Light Through Points"], get_a, ["TargetArray"])
    connect_any(mod4, ["ReturnValue"], get_b, ["Index"])
    connect_any(get_points, ["Light Through Points"], get_b, ["TargetArray"])
    connect_any(compute, ["SideIndex"], get_edge, ["Index"])
    connect_any(get_edges, ["Edge Lengths"], get_edge, ["TargetArray"])

    connect_any(get_a, ["Item"], loc_a, ["self"])
    connect_any(get_b, ["Item"], loc_b, ["self"])
    connect_any(loc_a, ["ReturnValue"], look, ["Start"])
    connect_any(loc_b, ["ReturnValue"], look, ["Target"])
    connect_any(loc_a, ["ReturnValue"], add_vec, ["A"])
    connect_any(loc_b, ["ReturnValue"], add_vec, ["B"])
    connect_any(add_vec, ["ReturnValue"], mid, ["A"])

    connect_any(compute, ["TargetRoot"], set_loc, ["self"])
    connect_any(mid, ["ReturnValue"], set_loc, ["NewLocation"])
    connect_any(compute, ["TargetRoot"], set_rot, ["self"])
    connect_any(look, ["ReturnValue"], set_rot, ["NewRotation"])

    connect_any(get_edge, ["Item"], half, ["A"])
    connect_any(get_origin, ["Origin Collision Size"], brk, ["InVec"])
    connect_any(brk, ["X"], mk, ["X"])
    connect_any(half, ["ReturnValue"], mk, ["Y"])
    connect_any(brk, ["Z"], mk, ["Z"])
    connect_any(compute, ["TargetCollider"], set_ext, ["self"])
    connect_any(mk, ["ReturnValue"], set_ext, ["InBoxExtent"])

    # Exec: Compute.then -> set_loc -> set_rot -> set_ext -> (old chain)
    connect_any(compute, ["then"], set_loc, ["execute"])
    connect_any(set_loc, ["then"], set_rot, ["execute"])
    connect_any(set_rot, ["then"], set_ext, ["execute"])

    print("Edge layout nodes added left of Shadow Collision Compute.")
    print("IMPORTANT: Disconnect Hit Location -> Set Box Extent if still connected.")
    print("Wire set_ext.then -> your old Line Trace chain (or Compute's next step).")
    print("Add int input pin 'SideIndex' on Shadow Collision Compute if missing.")

unreal.BlueprintEditorLibrary.compile_blueprint(bp)
unreal.EditorAssetLibrary.save_asset(BP_PATH)
print("Saved", BP_PATH)
