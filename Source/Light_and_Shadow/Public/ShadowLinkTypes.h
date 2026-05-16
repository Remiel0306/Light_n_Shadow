#pragma once

#include "CoreMinimal.h"
#include "ShadowLinkTypes.generated.h"

/** Who owns a shadow collider for network stomp logic (matches plan E_ShadowRole). */
UENUM(BlueprintType)
enum class EShadowRole : uint8
{
	Player UMETA(DisplayName = "Player"),
	Prop UMETA(DisplayName = "Prop"),
	Enemy UMETA(DisplayName = "Enemy"),
};
