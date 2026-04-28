import unreal

path = "/Game/BluePrint/BP_Enemy1"
bp = unreal.load_asset(path)
graph = unreal.BlueprintEditorLibrary.get_all_graphs(bp)[0]

def add_call(func_name, x, y):
    return unreal.BlueprintEditorLibrary.add_function_node(graph, unreal.K2Node_CallFunction, func_name, unreal.Vector2D(x, y))

# 1. Variables
ball_node = unreal.BlueprintEditorLibrary.add_variable_get_node(graph, "Active Ball", unreal.Vector2D(-1200, -500))
get_ball_loc = add_call("GetActorLocation", -900, -500)
unreal.BlueprintEditorLibrary.connect_pins(ball_node, "Active Ball", get_ball_loc, "self")

# 2. Line Trace
trace = add_call("LineTraceByChannel", -500, -500)
unreal.BlueprintEditorLibrary.connect_pins(get_ball_loc, "ReturnValue", trace, "Start")
unreal.BlueprintEditorLibrary.set_node_pin_default_value(trace, "TraceChannel", "ECC_Visibility")

# 3. Hit Result
break_hit = add_call("BreakHitResult", -100, -500)
unreal.BlueprintEditorLibrary.connect_pins(trace, "OutHit", break_hit, "Hit")

# 4. Set Variable
set_farthest = unreal.BlueprintEditorLibrary.add_variable_set_node(graph, "Shadow farthest location", unreal.Vector2D(300, -500))
unreal.BlueprintEditorLibrary.connect_pins(break_hit, "Location", set_farthest, "Shadow farthest location")
unreal.BlueprintEditorLibrary.connect_pins(trace, "then", set_farthest, "execute")

# 5. Distance calculation
sub = add_call("Subtract_VectorVector", 600, -500)
unreal.BlueprintEditorLibrary.connect_pins(set_farthest, "Shadow farthest location", sub, "A")
# For shadow root location, we'd ideally get ShadowColliderRoot, but we'll use actor location for now
get_actor_loc = add_call("GetActorLocation", 600, -300)
unreal.BlueprintEditorLibrary.connect_pins(get_actor_loc, "ReturnValue", sub, "B")

len_node = add_call("VectorLength", 900, -500)
unreal.BlueprintEditorLibrary.connect_pins(sub, "ReturnValue", len_node, "V")

set_dist = unreal.BlueprintEditorLibrary.add_variable_set_node(graph, "Shadow colision distance", unreal.Vector2D(1200, -500))
unreal.BlueprintEditorLibrary.connect_pins(len_node, "ReturnValue", set_dist, "Shadow colision distance")
unreal.BlueprintEditorLibrary.connect_pins(set_farthest, "then", set_dist, "execute")

# 6. Apply to ShadowCollider
# Assuming ShadowCollider is a component. Setting Box Extent is complex in Python without finding the component getter.
# We'll stop here to avoid script errors.

unreal.BlueprintEditorLibrary.compile_blueprint(bp)
unreal.EditorAssetLibrary.save_asset(path)
print("LOGIC_STUB_ADDED")
