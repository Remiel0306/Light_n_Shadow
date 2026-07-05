#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "WallClimbTestWall.generated.h"

class UStaticMeshComponent;

UCLASS()
class LIGHT_AND_SHADOW_API AWallClimbTestWall : public AActor
{
	GENERATED_BODY()

public:
	AWallClimbTestWall();

protected:
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Wall")
	TObjectPtr<UStaticMeshComponent> WallMesh;
};
