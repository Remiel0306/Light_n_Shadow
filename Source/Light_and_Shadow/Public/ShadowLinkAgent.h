#pragma once

/**
 * Shadow network (overlap graph) — C++ counterpart to plan BPI_ShadowLink + BFS.
 *
 * After compiling the project, in each actor that casts a shadow collider (player / prop / enemy):
 * 1) Class Settings → Add Interface → ShadowLinkAgent (UShadowLinkAgent).
 * 2) Implement GetShadowLinkPrimitives → return an array containing each Box (or primitive) that should chain.
 * 3) Implement GetShadowRole → Player / Prop / Enemy.
 * 4) Implement IsShadowLinkActive → true when that shadow should participate (e.g. lit / visible).
 * 5) Implement GetShadowLinkOwner → usually Self (who receives stomp / attribution).
 * 6) On enemies: override AllowsShadowStomp if needed; implement ApplyShadowStomp (damage, death, VFX).
 * 7) On stomp input: call UShadowLinkLibrary::TryShadowNetworkStomp with the overlapped shadow primitive and Instigator pawn.
 * 8) PIE test: place two disconnected chains; DebugPrintConnectedEnemies should only list enemies in the stomped chain.
 */

#include "CoreMinimal.h"
#include "UObject/Interface.h"
#include "ShadowLinkTypes.h"
#include "ShadowLinkAgent.generated.h"

class UPrimitiveComponent;

/** Actor implements this to participate in shadow-overlap BFS (plan: BPI_ShadowLink). */
UINTERFACE(BlueprintType, Blueprintable)
class UShadowLinkAgent : public UInterface
{
	GENERATED_BODY()
};

class LIGHT_AND_SHADOW_API IShadowLinkAgent
{
	GENERATED_BODY()

public:
	/** Primitives that form edges when overlapping other shadow-link primitives (usually your shadow boxes). */
	UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "Shadow|Link")
	TArray<UPrimitiveComponent*> GetShadowLinkPrimitives() const;

	UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "Shadow|Link")
	EShadowRole GetShadowRole() const;

	UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "Shadow|Link")
	bool IsShadowLinkActive() const;

	/** Who receives stomp / gameplay (often Self for pawns). */
	UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "Shadow|Link")
	AActor* GetShadowLinkOwner() const;

	/** Gameplay gate unrelated to connectivity (plan: bAllowShadowStomp). */
	UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "Shadow|Link")
	bool AllowsShadowStomp() const;

	UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "Shadow|Link")
	void ApplyShadowStomp(APawn* InstigatingPawn);
};
