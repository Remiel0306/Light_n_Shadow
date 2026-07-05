"""
Spawns three WallClimbTestWall actors for wall jump testing in the current editor level.
Run: Tools -> Execute Python Script
"""
import unreal

WALL_CLASS = unreal.WallClimbTestWall


def spawn_wall(location, rotation, label):
    actor = unreal.EditorLevelLibrary.spawn_actor_from_class(
        WALL_CLASS, location, rotation
    )
    actor.set_actor_label(label)
    return actor


def main():
    spawn_wall(unreal.Vector(400, 0, 200), unreal.Rotator(0, 0, 0), "WallJump_Test_Front")
    spawn_wall(unreal.Vector(0, 400, 200), unreal.Rotator(0, 90, 0), "WallJump_Test_Right")
    spawn_wall(unreal.Vector(0, -400, 200), unreal.Rotator(0, -90, 0), "WallJump_Test_Left")
    unreal.log("[SetupWallJump] Placed 3 test walls with tag WallClimbable.")


if __name__ == "__main__":
    main()
