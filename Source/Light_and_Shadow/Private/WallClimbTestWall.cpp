#include "WallClimbTestWall.h"

#include "Components/StaticMeshComponent.h"
#include "UObject/ConstructorHelpers.h"

AWallClimbTestWall::AWallClimbTestWall()
{
	PrimaryActorTick.bCanEverTick = false;

	WallMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("WallMesh"));
	SetRootComponent(WallMesh);

	static ConstructorHelpers::FObjectFinder<UStaticMesh> CubeMesh(TEXT("/Engine/BasicShapes/Cube.Cube"));
	if (CubeMesh.Succeeded())
	{
		WallMesh->SetStaticMesh(CubeMesh.Object);
	}

	WallMesh->SetWorldScale3D(FVector(0.2f, 4.0f, 4.0f));
	WallMesh->SetCollisionProfileName(TEXT("BlockAll"));
	Tags.Add(TEXT("WallClimbable"));
}
