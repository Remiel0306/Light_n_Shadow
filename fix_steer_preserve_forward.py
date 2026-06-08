"""
Preserve forward speed when IA_BallSteerC steers — run via MCP editor.run_python_file (interactive UE).
"""
import unreal

BP_PATH = "/Game/BluePrint/Player/BP_ThirdPersonCharacter"
DEADZONE = 0.15


def find_event_graph(bp):
    for graph in bp.blueprint_graphs:
        if graph.get_name() == "EventGraph":
            return graph
    return None


def title(n):
    return str(n.get_node_title(unreal.NodeTitleType.FULL_TITLE)).strip()


def find_one(graph, exact):
    for n in graph.nodes:
        if title(n) == exact:
            return n
    return None


def pin_node(node, pin_name):
    for p in node.pins:
        if str(p.pin_name) == pin_name:
            return p
    return None


def linked_from(pin):
    out = []
    if not pin:
        return out
    for lp in pin.linked_to:
        out.append((lp.owning_node, str(lp.pin_name)))
    return out


def disconnect_all_to(node, pin_name):
    pin = pin_node(node, pin_name)
    if not pin:
        return
    for src_node, src_pin in list(linked_from(pin)):
        try:
            unreal.BlueprintEditorLibrary.disconnect_pins(src_node, src_pin, node, pin_name)
        except Exception:
            try:
                pin.break_link_to(pin_node(src_node, src_pin))
            except Exception:
                pass


def disconnect_all_from(node, pin_name):
    pin = pin_node(node, pin_name)
    if not pin:
        return
    for dst_node, dst_pin in list(linked_from(pin)):
        try:
            unreal.BlueprintEditorLibrary.disconnect_pins(node, pin_name, dst_node, dst_pin)
        except Exception:
            try:
                pin.break_link_to(pin_node(dst_node, dst_pin))
            except Exception:
                pass


def connect_any(a, a_pins, b, b_pins):
    for ap in a_pins:
        for bp_pin in b_pins:
            try:
                unreal.BlueprintEditorLibrary.connect_pins(a, ap, b, bp_pin)
                print(f"  OK {title(a)}.{ap} -> {title(b)}.{bp_pin}")
                return True
            except Exception:
                pass
    print(f"  FAIL {title(a)} -> {title(b)}")
    return False


def add_call(graph, func, x, y):
    return unreal.BlueprintEditorLibrary.add_function_node(
        graph, unreal.K2Node_CallFunction, func, unreal.Vector2D(x, y)
    )


def add_branch(graph, x, y):
    return unreal.BlueprintEditorLibrary.add_node(
        graph, unreal.K2Node_IfThenElse, unreal.Vector2D(x, y)
    )


def exec_in(node):
    pin_obj = pin_node(node, "execute")
    if not pin_obj:
        return None, None
    links = linked_from(pin_obj)
    return links[0] if links else (None, None)


bp = unreal.load_asset(BP_PATH)
if not bp:
    raise RuntimeError("Load failed: " + BP_PATH)

graph = find_event_graph(bp)
if not graph:
    raise RuntimeError("EventGraph not found on blueprint_graphs")

set_vel = find_one(graph, "Set Physics Linear Velocity")
get_vel = find_one(graph, "Get Physics Linear Velocity")
make_vec = find_one(graph, "Make Vector")
break2d = find_one(graph, "Break Vector 2D") or find_one(graph, "Break Vector2D")
max_vert = None
for n in graph.nodes:
    if "Max Steer Vertical" in title(n):
        max_vert = n
        break

if not all([set_vel, get_vel, make_vec, break2d, max_vert]):
    raise RuntimeError("Missing steer nodes in EventGraph")

px = int(make_vec.node_pos_x) + 100
py = int(make_vec.node_pos_y) + 160

print("=== Fix Make Vector Z (preserve V.Z when not pushing Y) ===")
disconnect_all_to(make_vec, "Z")

y_mul = None
for n in graph.nodes:
    linked = {lp.owning_node for p in n.pins for lp in p.linked_to}
    if break2d in linked and max_vert in linked:
        t = title(n)
        if "Max Steer" not in t and ("*" in t or "PromotableOperator" in n.get_class().get_name()):
            y_mul = n
            break
if not y_mul:
    raise RuntimeError("Y * MaxSteerVertical multiply not found")

break_vel = add_call(graph, "BreakVector", px, py)
abs_y = add_call(graph, "Abs", px, py + 110)
gt_y = add_call(graph, "Greater_FloatFloat", px + 150, py + 110)
select_z = add_call(graph, "SelectFloat", px + 320, py + 50)
unreal.BlueprintEditorLibrary.set_node_pin_default_value(gt_y, "B", str(DEADZONE))

connect_any(get_vel, ["ReturnValue"], break_vel, ["InVec", "A", "V"])
connect_any(break_vel, ["Z"], select_z, ["A", "False", "Option 0"])
connect_any(y_mul, ["ReturnValue"], select_z, ["B", "True", "Option 1"])
connect_any(break2d, ["Y"], abs_y, ["A", "InDouble", "Value"])
connect_any(abs_y, ["ReturnValue"], gt_y, ["A"])
connect_any(gt_y, ["ReturnValue"], select_z, ["bPickA", "Pick A", "Index"])
connect_any(select_z, ["ReturnValue"], make_vec, ["Z"])

print("=== Fix forward (Normal*VSize instead of Dot) ===")
dot = find_one(graph, "Dot Product") or find_one(graph, "DotProduct")
if dot:
    fwd_mul = None
    for dst, dp in linked_from(pin_node(dot, "ReturnValue")):
        n = dst
        if "PromotableOperator" in n.get_class().get_name() or "*" in title(n):
            fwd_mul = n
            break
    if fwd_mul:
        npx = int(dot.node_pos_x) - 100
        npy = int(dot.node_pos_y) - 60
        vsize = add_call(graph, "VSize", npx, npy)
        normal = add_call(graph, "Normal", npx, npy + 90)
        disconnect_all_to(fwd_mul, "A")
        disconnect_all_to(fwd_mul, "B")
        connect_any(get_vel, ["ReturnValue"], vsize, ["A", "V", "InVec"])
        connect_any(get_vel, ["ReturnValue"], normal, ["A", "V", "InVec"])
        connect_any(vsize, ["ReturnValue"], fwd_mul, ["B", "A"])
        connect_any(normal, ["ReturnValue"], fwd_mul, ["A", "B"])

print("=== Exec dead zone before Set Velocity ===")
prev_exec, prev_pin = exec_in(set_vel)
if prev_exec and title(prev_exec) != "Branch":
    branch = add_branch(graph, int(set_vel.node_pos_x) - 220, int(set_vel.node_pos_y))
    abs_x = add_call(graph, "Abs", int(set_vel.node_pos_x) - 440, int(set_vel.node_pos_y) + 70)
    abs_y2 = add_call(graph, "Abs", int(set_vel.node_pos_x) - 440, int(set_vel.node_pos_y) + 150)
    fmax = add_call(graph, "FMax", int(set_vel.node_pos_x) - 300, int(set_vel.node_pos_y) + 110)
    gt_stick = add_call(graph, "Greater_FloatFloat", int(set_vel.node_pos_x) - 160, int(set_vel.node_pos_y) + 110)
    unreal.BlueprintEditorLibrary.set_node_pin_default_value(gt_stick, "B", str(DEADZONE))
    disconnect_all_to(set_vel, "execute")
    connect_any(prev_exec, [prev_pin, "then"], branch, ["execute"])
    connect_any(branch, ["then"], set_vel, ["execute"])
    connect_any(break2d, ["X"], abs_x, ["A"])
    connect_any(break2d, ["Y"], abs_y2, ["A"])
    connect_any(abs_x, ["ReturnValue"], fmax, ["A"])
    connect_any(abs_y2, ["ReturnValue"], fmax, ["B"])
    connect_any(fmax, ["ReturnValue"], gt_stick, ["A"])
    connect_any(gt_stick, ["ReturnValue"], branch, ["Condition"])

unreal.BlueprintEditorLibrary.compile_blueprint(bp)
unreal.EditorAssetLibrary.save_asset(BP_PATH)
print("DONE")
