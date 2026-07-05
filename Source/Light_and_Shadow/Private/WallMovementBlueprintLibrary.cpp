#include "WallMovementBlueprintLibrary.h"

#include "WallMovementComponent.h"

UWallMovementComponent* UWallMovementBlueprintLibrary::GetWallMovementComponent(AActor* Actor)
{
	return Actor ? Actor->FindComponentByClass<UWallMovementComponent>() : nullptr;
}

void UWallMovementBlueprintLibrary::WallMovement_SetMoveInput(AActor* Actor, FVector2D MoveInput)
{
	if (UWallMovementComponent* Component = GetWallMovementComponent(Actor))
	{
		Component->SetMoveInput(MoveInput);
	}
}

void UWallMovementBlueprintLibrary::WallMovement_OnJumpPressed(AActor* Actor)
{
	if (UWallMovementComponent* Component = GetWallMovementComponent(Actor))
	{
		Component->OnJumpPressed();
	}
}

void UWallMovementBlueprintLibrary::WallMovement_SetBallCamActive(AActor* Actor, bool bActive)
{
	if (UWallMovementComponent* Component = GetWallMovementComponent(Actor))
	{
		Component->SetBallCamActive(bActive);
	}
}
