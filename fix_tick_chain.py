import unreal

BP_PATH = "/Game/BluePrint/BP_EnemyShadowLogic"
bp = unreal.load_asset(BP_PATH)
if not bp:
    print("ERR: BP not found")
    raise SystemExit(1)

graph = unreal.BlueprintEditorLibrary.get_all_graphs(bp)[0]
nodes = graph.nodes

# ── Index all nodes by partial ID ──────────────────────────────────────────
def find_node(partial_id):
    for n in nodes:
        if partial_id in n.get_name():
            return n
    return None

def has_pin(node, name):
    return any(str(p.pin_name) == name for p in node.pins)

def pin_names(node):
    return [str(p.pin_name) for p in node.pins]

def try_connect(a, ap, b, bp_name):
    try:
        unreal.BlueprintEditorLibrary.connect_pins(a, ap, b, bp_name)
        print(f"  OK: {a.get_name()[:8]}.{ap} -> {b.get_name()[:8]}.{bp_name}")
        return True
    except Exception as e:
        print(f"  FAIL: {a.get_name()[:8]}.{ap} -> {b.get_name()[:8]}.{bp_name}: {e}")
        return False

def connect_any(a, srcs, b, dsts):
    for s in srcs:
        for d in dsts:
            if try_connect(a, s, b, d):
                return True
    return False

# ── Known nodes from graph dump ─────────────────────────────────────────────
event_tick       = find_node("tDW6Xkxd")   # Event Tick
get_overlapping  = find_node("qmO2kUBuQ")  # Get Overlapping Actors
get_capsule      = find_node("gzqMJ0fdg")  # Get CapsuleComponent
for_each         = find_node("jJbwdk7yg")  # For Each Loop
cast_ball        = find_node("7LCVLUh1")   # Cast To BP_LightBall (in loop)
set_active_ball  = find_node("fAYia0-Xo")  # Set Active Ball

print("=== Node check ===")
for label, node in [
    ("Event Tick",         event_tick),
    ("Get Overlapping",    get_overlapping),
    ("Get Capsule",        get_capsule),
    ("For Each Loop",      for_each),
    ("Cast Ball (loop)",   cast_ball),
    ("Set Active Ball",    set_active_ball),
]:
    status = "FOUND" if node else "MISSING"
    print(f"  {label}: {status}")

print("\n=== Fixing exec chain ===")

# 1. Event Tick → Get Overlapping Actors
if event_tick and get_overlapping:
    connect_any(event_tick, ["then","execute"], get_overlapping, ["execute","then"])

# 2. Get Overlapping Actors → For Each Loop (exec)
if get_overlapping and for_each:
    connect_any(get_overlapping, ["then"], for_each, ["execute","Exec"])

# 3. Get CapsuleComponent data → Get Overlapping Actors target
if get_capsule and get_overlapping:
    connect_any(get_capsule, ["CapsuleComponent","ReturnValue"],
                get_overlapping, ["self","Target"])

# 4. Cast To BP_LightBall → Set Active Ball (exec)
if cast_ball and set_active_ball:
    connect_any(cast_ball, ["then"], set_active_ball, ["execute"])

# 5. Cast To BP_LightBall output → Set Active Ball value
if cast_ball and set_active_ball:
    connect_any(cast_ball, ["As BP Light Ball","AsObject","ReturnValue"],
                set_active_ball, ["Active Ball"])

print("\n=== Compiling ===")
unreal.BlueprintEditorLibrary.compile_blueprint(bp)
unreal.EditorAssetLibrary.save_asset(BP_PATH)
print("DONE")
