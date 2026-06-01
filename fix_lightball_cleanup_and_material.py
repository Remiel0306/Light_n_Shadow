"""Run inside Unreal Editor via ue-mcp editor.run_python_file"""
import unreal

MAT_PATH = "/Game/Material/XRayVision/M_LightBall_XRayOverlay"
BP_PATH = "/Game/BluePrint/Player/BP_LightBall"
MPC_PATH = "/Game/Material/MPC_XRayVision"
MEL = unreal.MaterialEditingLibrary

mat = unreal.load_asset(MAT_PATH)
if mat:
    mat.set_editor_property("blend_mode", unreal.BlendMode.BLEND_TRANSLUCENT)
    mat.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    mat.set_editor_property("two_sided", True)
    mat.set_editor_property("disable_depth_test", True)
    print("disable_depth_test =", mat.get_editor_property("disable_depth_test"))

    # Remove existing expressions via editor library
    try:
        exprs = MEL.get_material_expressions(mat)
    except Exception:
        exprs = []
    for expr in list(exprs):
        MEL.delete_material_expression(mat, expr)

    cp = MEL.create_material_expression(mat, unreal.MaterialExpressionVectorParameter, -600, 0)
    cp.set_editor_property("parameter_name", "GlowColor")
    cp.set_editor_property("default_value", unreal.LinearColor(1.0, 0.82, 0.15, 1.0))

    coll = MEL.create_material_expression(mat, unreal.MaterialExpressionCollectionParameter, -600, 200)
    coll.set_editor_property("collection", unreal.load_asset(MPC_PATH))
    coll.set_editor_property("parameter_name", "XRayOn")

    mul_e = MEL.create_material_expression(mat, unreal.MaterialExpressionMultiply, -300, 80)
    MEL.connect_material_expressions(cp, "", mul_e, "A")
    MEL.connect_material_expressions(coll, "", mul_e, "B")
    MEL.connect_material_property(mul_e, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    MEL.connect_material_property(coll, "", unreal.MaterialProperty.MP_OPACITY)

    MEL.recompile_material(mat)
    unreal.EditorAssetLibrary.save_loaded_asset(mat)
    print("Material graph OK (MPC XRayOn drives emissive + opacity)")
else:
    print("Material not found:", MAT_PATH)

bp = unreal.load_asset(BP_PATH)
if bp:
    removed = 0
    for graph in bp.blueprint_graphs:
        if graph.get_name() != "EventGraph":
            continue
        to_remove = []
        for node in graph.nodes:
            if node.get_class().get_name() == "K2Node_CallFunction":
                title = str(node.get_node_title(unreal.NodeTitleType.FULL_TITLE)).strip()
                if title in ("None",) or title.startswith("Event None"):
                    to_remove.append(node)
        for node in to_remove:
            graph.remove_node(node)
            removed += 1
    unreal.KismetEditorUtilities.compile_blueprint(bp)
    print("Removed", removed, "broken BP nodes")
