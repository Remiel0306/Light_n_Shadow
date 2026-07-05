#pragma once

#include "CoreMinimal.h"
#include "WallMovementTypes.generated.h"

UENUM(BlueprintType)
enum class EWallMoveState : uint8
{
	Ground UMETA(DisplayName = "Ground"),
	Air UMETA(DisplayName = "Air"),
	WallIdle UMETA(DisplayName = "Wall Idle"),
	WallRun UMETA(DisplayName = "Wall Run"),
	WallSlide UMETA(DisplayName = "Wall Slide")
};

UENUM(BlueprintType)
enum class EWallSide : uint8
{
	None UMETA(DisplayName = "None"),
	Front UMETA(DisplayName = "Front"),
	Left UMETA(DisplayName = "Left"),
	Right UMETA(DisplayName = "Right")
};
