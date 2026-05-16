#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "ShadowLinkLibrary.generated.h"

class UPrimitiveComponent;

/** Blueprint-callable shadow network search + stomp (plan: FindEnemiesConnectedToShadow + hook). */
UCLASS()
class UShadowLinkLibrary : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	/**
	 * BFS from StompedShadowPrimitive along overlapping primitives whose owners implement IShadowLinkAgent
	 * and register that primitive via GetShadowLinkPrimitives. Returns unique GetShadowLinkOwner for enemies.
	 */
	UFUNCTION(BlueprintCallable, Category = "Shadow|Link", meta = (WorldContext = "WorldContextObject"))
	static void FindEnemiesConnectedToShadow(
		const UObject* WorldContextObject,
		UPrimitiveComponent* StompedShadowPrimitive,
		TArray<AActor*>& OutEnemyOwners);

	/** Calls ApplyShadowStomp on each found enemy that AllowsShadowStomp. */
	UFUNCTION(BlueprintCallable, Category = "Shadow|Link", meta = (WorldContext = "WorldContextObject"))
	static void TryShadowNetworkStomp(
		const UObject* WorldContextObject,
		UPrimitiveComponent* StompedShadowPrimitive,
		APawn* InstigatingPawn);

	/** Logs enemy display names for ~5s (PIE checklist: two isolated networks). */
	UFUNCTION(BlueprintCallable, Category = "Shadow|Link", meta = (WorldContext = "WorldContextObject"))
	static void DebugPrintConnectedEnemies(
		const UObject* WorldContextObject,
		UPrimitiveComponent* StompedShadowPrimitive,
		float DurationSeconds = 5.f);
};
