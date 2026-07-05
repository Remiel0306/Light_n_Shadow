"""
Run inside Unreal Editor: Tools -> Execute Python Script
Wires BP_ThirdPersonCharacter to WallMovementComponent (Jump, Move, Ball Cam).
"""
import unreal

BP_PATH = "/Game/BluePrint/Player/BP_ThirdPersonCharacter"
COMPONENT_CLASS = "/Script/Light_and_Shadow.WallMovementComponent"


def log(msg):
    unreal.log("[SetupWallJump] " + str(msg))


def load_bp():
    bp = unreal.load_asset(BP_PATH)
    if not bp:
        raise RuntimeError("Blueprint not found: " + BP_PATH)
    return bp


def ensure_component(bp):
    if not hasattr(unreal, "WallMovementComponent"):
        log("Compile C++ and restart editor so WallMovementComponent is registered.")
        return False

    subobjects = bp.get_editor_property("simple_construction_script").get_all_nodes()
    for node in subobjects:
        comp = node.get_editor_property("component_template")
        if comp and comp.get_class().get_name() == "WallMovementComponent":
            log("WallMovementComponent already present.")
            return True

    factory = unreal.BlueprintFactory()
    factory.set_editor_property("parent_class", unreal.WallMovementComponent.static_class())
    log("Add WallMovementComponent manually: Components -> Add -> Wall Movement Component")
    log("Then re-run this script for graph wiring.")
    return False


def main():
    bp = load_bp()
    log("Loaded " + BP_PATH)

    if not ensure_component(bp):
        return

    log("Manual Blueprint wiring (EventGraph):")
    log("  IA_Move Triggered/Ongoing -> Wall Movement Set Move Input (Action Value X,Y)")
    log("  IA_Jump Started -> Wall Movement On Jump Pressed")
    log("  Enter Ball Cam -> Wall Movement Set Ball Cam Active (True)")
    log("  Exit Ball Cam  -> Wall Movement Set Ball Cam Active (False)")
    log("Optional: CharacterMovement Jump from IA_Jump should be REMOVED; component handles jump.")

    unreal.EditorAssetLibrary.save_asset(BP_PATH)
    log("Done. Place WallClimbTestWall in level (tag WallClimbable).")


if __name__ == "__main__":
    main()
