import unreal
path = "/Game/BluePrint/BP_EnemyShadowLogic"
bp = unreal.load_asset(path)
graph = unreal.BlueprintEditorLibrary.get_all_graphs(bp)[0]
node = unreal.BlueprintEditorLibrary.add_function_node(graph, unreal.K2Node_CallFunction, "PrintString", unreal.Vector2D(0, 0))
unreal.BlueprintEditorLibrary.set_node_pin_default_value(node, "InString", "MCP TEST SUCCESS")
unreal.BlueprintEditorLibrary.compile_blueprint(bp)
unreal.EditorAssetLibrary.save_asset(path)
print("NODE_ADDED")
