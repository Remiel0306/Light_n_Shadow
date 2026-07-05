#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "WallMovementBlueprintLibrary.generated.h"

class UWallMovementComponent;

UCLASS()
class LIGHT_AND_SHADOW_API UWallMovementBlueprintLibrary : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	UFUNCTION(BlueprintCallable, Category = "Wall Movement", meta = (DefaultToSelf = "Actor"))
	static UWallMovementComponent* GetWallMovementComponent(AActor* Actor);

	UFUNCTION(BlueprintCallable, Category = "Wall Movement", meta = (DefaultToSelf = "Actor"))
	static void WallMovement_SetMoveInput(AActor* Actor, FVector2D MoveInput);

	UFUNCTION(BlueprintCallable, Category = "Wall Movement", meta = (DefaultToSelf = "Actor"))
	static void WallMovement_OnJumpPressed(AActor* Actor);

	UFUNCTION(BlueprintCallable, Category = "Wall Movement", meta = (DefaultToSelf = "Actor"))
	static void WallMovement_SetBallCamActive(AActor* Actor, bool bActive);
};
