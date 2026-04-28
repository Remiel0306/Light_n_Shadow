import unreal
path = "/Game/BluePrint/BP_Enemy1"
bp = unreal.load_asset(path)
graph = unreal.BlueprintEditorLibrary.get_all_graphs(bp)[0]

nodes_to_delete = []
for node in graph.nodes:
    if node.get_class().get_name() == "K2Node_CallFunction":
        name_str = str(node.get_name())
        # PrintString nodes
        if "PrintString" in name_str:
            nodes_to_delete.append(node)

for node in nodes_to_delete:
    unreal.BlueprintEditorLibrary.remove_node(graph, node)

if len(nodes_to_delete) > 0:
    unreal.BlueprintEditorLibrary.compile_blueprint(bp)
    unreal.EditorAssetLibrary.save_asset(path)
print(f"DELETED_{len(nodes_to_delete)}_NODES")
