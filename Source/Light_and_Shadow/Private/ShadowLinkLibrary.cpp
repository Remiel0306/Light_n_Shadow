#include "ShadowLinkLibrary.h"
#include "DrawDebugHelpers.h"
#include "Engine/World.h"
#include "GameFramework/Actor.h"
#include "GameFramework/Pawn.h"
#include "ShadowLinkAgent.h"
#include "Components/PrimitiveComponent.h"

static bool ActorImplementsShadowLink(AActor* Actor)
{
	return Actor && Actor->GetClass()->ImplementsInterface(UShadowLinkAgent::StaticClass());
}

static bool PrimitiveIsRegisteredShadowLink(UPrimitiveComponent* Prim)
{
	if (!Prim)
	{
		return false;
	}
	AActor* Owner = Prim->GetOwner();
	if (!ActorImplementsShadowLink(Owner))
	{
		return false;
	}
	if (!IShadowLinkAgent::Execute_IsShadowLinkActive(Owner))
	{
		return false;
	}
	const TArray<UPrimitiveComponent*> Prims = IShadowLinkAgent::Execute_GetShadowLinkPrimitives(Owner);
	return Prims.Contains(Prim);
}

void UShadowLinkLibrary::FindEnemiesConnectedToShadow(
	const UObject* WorldContextObject,
	UPrimitiveComponent* StompedShadowPrimitive,
	TArray<AActor*>& OutEnemyOwners)
{
	OutEnemyOwners.Reset();
	if (!WorldContextObject || !StompedShadowPrimitive)
	{
		return;
	}
	UWorld* World = WorldContextObject->GetWorld();
	if (!World)
	{
		return;
	}

	if (!PrimitiveIsRegisteredShadowLink(StompedShadowPrimitive))
	{
		return;
	}

	TArray<UPrimitiveComponent*> Queue;
	TArray<UPrimitiveComponent*> Visited;
	Queue.Add(StompedShadowPrimitive);

	while (Queue.Num() > 0)
	{
		UPrimitiveComponent* Current = Queue[0];
		Queue.RemoveAt(0);
		if (!Current || Visited.Contains(Current))
		{
			continue;
		}
		Visited.Add(Current);

		AActor* Owner = Current->GetOwner();
		if (ActorImplementsShadowLink(Owner) && IShadowLinkAgent::Execute_IsShadowLinkActive(Owner))
		{
			const EShadowRole Role = IShadowLinkAgent::Execute_GetShadowRole(Owner);
			if (Role == EShadowRole::Enemy)
			{
				AActor* StompTarget = IShadowLinkAgent::Execute_GetShadowLinkOwner(Owner);
				if (!StompTarget)
				{
					StompTarget = Owner;
				}
				OutEnemyOwners.AddUnique(StompTarget);
			}
		}

		TArray<UPrimitiveComponent*> Overlapping;
		Current->GetOverlappingComponents(Overlapping);

		for (UPrimitiveComponent* Other : Overlapping)
		{
			if (!Other || Visited.Contains(Other))
			{
				continue;
			}
			if (!PrimitiveIsRegisteredShadowLink(Other))
			{
				continue;
			}
			Queue.Add(Other);
		}
	}
}

void UShadowLinkLibrary::TryShadowNetworkStomp(
	const UObject* WorldContextObject,
	UPrimitiveComponent* StompedShadowPrimitive,
	APawn* InstigatingPawn)
{
	TArray<AActor*> Enemies;
	FindEnemiesConnectedToShadow(WorldContextObject, StompedShadowPrimitive, Enemies);

	for (AActor* Enemy : Enemies)
	{
		if (!Enemy || !ActorImplementsShadowLink(Enemy))
		{
			continue;
		}
		if (!IShadowLinkAgent::Execute_AllowsShadowStomp(Enemy))
		{
			continue;
		}
		IShadowLinkAgent::Execute_ApplyShadowStomp(Enemy, InstigatingPawn);
	}
}

void UShadowLinkLibrary::DebugPrintConnectedEnemies(
	const UObject* WorldContextObject,
	UPrimitiveComponent* StompedShadowPrimitive,
	float DurationSeconds)
{
	UWorld* World = WorldContextObject ? WorldContextObject->GetWorld() : nullptr;
	if (!World)
	{
		return;
	}

	TArray<AActor*> Enemies;
	FindEnemiesConnectedToShadow(WorldContextObject, StompedShadowPrimitive, Enemies);

	for (AActor* A : Enemies)
	{
		if (!A)
		{
			continue;
		}
		const FString Msg = FString::Printf(TEXT("[ShadowLink] %s"), *A->GetName());
		GEngine->AddOnScreenDebugMessage(
			(uint64)((PTRINT)A) ^ 0x53484144,
			DurationSeconds,
			FColor::Cyan,
			Msg);
		DrawDebugString(World, A->GetActorLocation() + FVector(0, 0, 100), Msg, nullptr, FColor::Cyan, DurationSeconds, true);
	}
}
