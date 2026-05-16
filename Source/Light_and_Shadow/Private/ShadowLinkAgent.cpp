#include "ShadowLinkAgent.h"
#include "Components/PrimitiveComponent.h"
#include "GameFramework/Actor.h"

TArray<UPrimitiveComponent*> IShadowLinkAgent::GetShadowLinkPrimitives_Implementation() const
{
	return {};
}

EShadowRole IShadowLinkAgent::GetShadowRole_Implementation() const
{
	return EShadowRole::Prop;
}

bool IShadowLinkAgent::IsShadowLinkActive_Implementation() const
{
	return false;
}

AActor* IShadowLinkAgent::GetShadowLinkOwner_Implementation() const
{
	return nullptr;
}

bool IShadowLinkAgent::AllowsShadowStomp_Implementation() const
{
	return true;
}

void IShadowLinkAgent::ApplyShadowStomp_Implementation(APawn* InstigatingPawn)
{
}
