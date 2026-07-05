#include "WallMovementComponent.h"

#include "GameFramework/Character.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "DrawDebugHelpers.h"
#include "Engine/World.h"

namespace WallMovement
{
	static const FName WallClimbableTag(TEXT("WallClimbable"));
}

UWallMovementComponent::UWallMovementComponent()
{
	PrimaryComponentTick.bCanEverTick = true;
}

void UWallMovementComponent::BeginPlay()
{
	Super::BeginPlay();

	OwnerCharacter = GetOwnerCharacter();
	MoveComp = GetMoveComp();

	if (bApplyDefaultMovementTuning)
	{
		if (UCharacterMovementComponent* CMC = GetMoveComp())
		{
			CMC->JumpZVelocity = DefaultJumpZVelocity;
			CMC->AirControl = DefaultAirControl;
			CMC->GravityScale = DefaultGravityScale;
			CMC->MaxWalkSpeed = DefaultMaxWalkSpeed;
			CMC->FallingLateralFriction = 0.1f;
		}
	}

	UpdateGroundAirState();
}

void UWallMovementComponent::TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);

	if (WallJumpLockRemaining > 0.0f)
	{
		WallJumpLockRemaining = FMath::Max(0.0f, WallJumpLockRemaining - DeltaTime);
	}

	UpdateJumpBuffer(DeltaTime);

	if (bBallCamActive)
	{
		if (IsOnWall())
		{
			DetachFromWall();
		}
		return;
	}

	switch (WallMoveState)
	{
	case EWallMoveState::Ground:
	case EWallMoveState::Air:
		UpdateGroundAirState();
		if (WallMoveState == EWallMoveState::Air && GetMoveComp() && GetMoveComp()->IsFalling())
		{
			TryAttachToWall();
		}
		break;
	case EWallMoveState::WallIdle:
		UpdateWallIdle(DeltaTime);
		break;
	case EWallMoveState::WallRun:
		UpdateWallRun(DeltaTime);
		break;
	case EWallMoveState::WallSlide:
		UpdateWallSlide(DeltaTime);
		break;
	default:
		break;
	}
}

void UWallMovementComponent::SetMoveInput(FVector2D Input)
{
	CachedMoveInput = Input;
}

void UWallMovementComponent::OnJumpPressed()
{
	if (IsOnWall())
	{
		DoWallJump();
		return;
	}

	TryNormalJump();
}

void UWallMovementComponent::SetBallCamActive(bool bActive)
{
	bBallCamActive = bActive;
	if (bBallCamActive && IsOnWall())
	{
		DetachFromWall();
	}
}

bool UWallMovementComponent::IsOnWall() const
{
	return WallMoveState == EWallMoveState::WallIdle
		|| WallMoveState == EWallMoveState::WallRun
		|| WallMoveState == EWallMoveState::WallSlide;
}

ACharacter* UWallMovementComponent::GetOwnerCharacter() const
{
	if (OwnerCharacter.IsValid())
	{
		return OwnerCharacter.Get();
	}
	return Cast<ACharacter>(GetOwner());
}

UCharacterMovementComponent* UWallMovementComponent::GetMoveComp() const
{
	if (MoveComp.IsValid())
	{
		return MoveComp.Get();
	}

	if (ACharacter* Character = GetOwnerCharacter())
	{
		return Character->GetCharacterMovement();
	}
	return nullptr;
}

bool UWallMovementComponent::IsClimbableHit(const FHitResult& Hit) const
{
	if (!Hit.bBlockingHit)
	{
		return false;
	}

	if (FMath::Abs(Hit.ImpactNormal.Z) >= MaxWallNormalZ)
	{
		return false;
	}

	if (const AActor* HitActor = Hit.GetActor())
	{
		if (HitActor->ActorHasTag(WallMovement::WallClimbableTag))
		{
			return true;
		}
	}

	return Hit.Component.IsValid();
}

bool UWallMovementComponent::DetectWall(FVector& OutNormal, EWallSide& OutSide) const
{
	const ACharacter* Character = GetOwnerCharacter();
	if (!Character)
	{
		return false;
	}

	const FVector TraceStart = Character->GetActorLocation() + FVector(0.0f, 0.0f, WallTraceHeightOffset);

	struct FWallTraceCandidate
	{
		FHitResult Hit;
		EWallSide Side = EWallSide::None;
	};

	TArray<FWallTraceCandidate, TInlineAllocator<3>> Candidates;

	const auto TryDirection = [&](const FVector& Direction, EWallSide Side)
	{
		FHitResult Hit;
		const FVector TraceEnd = TraceStart + Direction * WallTraceDistance;
		FCollisionQueryParams Params(SCENE_QUERY_STAT(WallDetect), false, Character);
		if (Character->GetWorld()->LineTraceSingleByChannel(Hit, TraceStart, TraceEnd, ECC_Visibility, Params))
		{
			if (IsClimbableHit(Hit))
			{
				FWallTraceCandidate Candidate;
				Candidate.Hit = Hit;
				Candidate.Side = Side;
				Candidates.Add(Candidate);
			}
		}

		if (bDebugWallMovement)
		{
			DrawDebugLine(Character->GetWorld(), TraceStart, TraceEnd, Candidates.Num() > 0 ? FColor::Green : FColor::Red, false, 0.0f, 0, 1.5f);
		}
	};

	TryDirection(Character->GetActorForwardVector(), EWallSide::Front);
	TryDirection(Character->GetActorRightVector(), EWallSide::Right);
	TryDirection(-Character->GetActorRightVector(), EWallSide::Left);

	if (Candidates.Num() == 0)
	{
		return false;
	}

	FWallTraceCandidate Best = Candidates[0];
	float BestDistSq = FVector::DistSquared(TraceStart, Best.Hit.ImpactPoint);
	for (int32 Index = 1; Index < Candidates.Num(); ++Index)
	{
		const float DistSq = FVector::DistSquared(TraceStart, Candidates[Index].Hit.ImpactPoint);
		if (DistSq < BestDistSq)
		{
			Best = Candidates[Index];
			BestDistSq = DistSq;
		}
	}

	OutNormal = Best.Hit.ImpactNormal.GetSafeNormal();
	OutSide = Best.Side;
	return true;
}

void UWallMovementComponent::TryAttachToWall()
{
	if (WallJumpLockRemaining > 0.0f || bBallCamActive)
	{
		return;
	}

	UCharacterMovementComponent* CMC = GetMoveComp();
	if (!CMC || !CMC->IsFalling() || WallMoveState != EWallMoveState::Air)
	{
		return;
	}

	FVector DetectedNormal = FVector::ZeroVector;
	EWallSide DetectedSide = EWallSide::None;
	if (!DetectWall(DetectedNormal, DetectedSide))
	{
		return;
	}

	WallNormal = DetectedNormal;
	WallSide = DetectedSide;

	const bool bShouldRun = GetHorizontalSpeed() >= WallRunSpeedThreshold || GetMoveInputLength() > MoveInputDeadzone;
	if (bShouldRun)
	{
		EnterWallRun();
	}
	else
	{
		EnterWallIdle();
	}
}

void UWallMovementComponent::EnterWallIdle()
{
	SetWallMoveState(EWallMoveState::WallIdle);
	WallIdleTimer = 0.0f;
	WallSlideTimer = 0.0f;
	WallRunBufferRemaining = 0.0f;

	if (UCharacterMovementComponent* CMC = GetMoveComp())
	{
		CMC->SetMovementMode(MOVE_Flying);
		CMC->GravityScale = 0.0f;
		CMC->Velocity = FVector::ZeroVector;
	}
}

void UWallMovementComponent::EnterWallRun()
{
	SetWallMoveState(EWallMoveState::WallRun);
	WallRunBufferRemaining = WallRunBufferDuration;
	WallIdleTimer = 0.0f;

	if (UCharacterMovementComponent* CMC = GetMoveComp())
	{
		CMC->SetMovementMode(MOVE_Flying);
		CMC->GravityScale = 0.0f;
	}
}

FVector UWallMovementComponent::GetWallForward() const
{
	return FVector::CrossProduct(FVector::UpVector, WallNormal).GetSafeNormal();
}

FVector UWallMovementComponent::GetMoveWorldDirection() const
{
	const ACharacter* Character = GetOwnerCharacter();
	if (!Character)
	{
		return FVector::ZeroVector;
	}

	const FRotator YawRotation(0.0f, Character->GetControlRotation().Yaw, 0.0f);
	const FVector Forward = FRotationMatrix(YawRotation).GetUnitAxis(EAxis::X);
	const FVector Right = FRotationMatrix(YawRotation).GetUnitAxis(EAxis::Y);
	return (Forward * CachedMoveInput.Y) + (Right * CachedMoveInput.X);
}

float UWallMovementComponent::GetHorizontalSpeed() const
{
	if (const UCharacterMovementComponent* CMC = GetMoveComp())
	{
		const FVector Velocity = CMC->Velocity;
		return FVector(Velocity.X, Velocity.Y, 0.0f).Size();
	}
	return 0.0f;
}

float UWallMovementComponent::GetMoveInputLength() const
{
	return CachedMoveInput.Size();
}

void UWallMovementComponent::ProjectVelocityOntoWall()
{
	if (UCharacterMovementComponent* CMC = GetMoveComp())
	{
		FVector Velocity = CMC->Velocity;
		Velocity = FVector::VectorPlaneProject(Velocity, WallNormal);
		CMC->Velocity = Velocity;
	}
}

void UWallMovementComponent::ApplyWallStickVelocity(const FVector& DesiredVelocity)
{
	if (UCharacterMovementComponent* CMC = GetMoveComp())
	{
		FVector Velocity = FVector::VectorPlaneProject(DesiredVelocity, WallNormal);
		CMC->Velocity = Velocity;
	}
}

void UWallMovementComponent::UpdateWallIdle(float DeltaTime)
{
	FVector DetectedNormal = FVector::ZeroVector;
	EWallSide DetectedSide = EWallSide::None;
	if (!DetectWall(DetectedNormal, DetectedSide))
	{
		DetachFromWall();
		return;
	}

	WallNormal = DetectedNormal;
	WallSide = DetectedSide;

	if (GetMoveInputLength() > MoveInputDeadzone)
	{
		EnterWallRun();
		return;
	}

	WallIdleTimer += DeltaTime;
	ApplyWallStickVelocity(FVector::ZeroVector);

	if (WallIdleTimer >= WallIdleBeforeSlide)
	{
		SetWallMoveState(EWallMoveState::WallSlide);
		WallSlideTimer = 0.0f;
		if (UCharacterMovementComponent* CMC = GetMoveComp())
		{
			CMC->GravityScale = 0.3f;
		}
	}
}

void UWallMovementComponent::UpdateWallRun(float DeltaTime)
{
	FVector DetectedNormal = FVector::ZeroVector;
	EWallSide DetectedSide = EWallSide::None;
	if (!DetectWall(DetectedNormal, DetectedSide))
	{
		DetachFromWall();
		return;
	}

	WallNormal = DetectedNormal;
	WallSide = DetectedSide;
	WallRunBufferRemaining -= DeltaTime;

	const FVector WallForward = GetWallForward();
	FVector RunDirection = WallForward;

	if (GetMoveInputLength() > MoveInputDeadzone)
	{
		const FVector MoveWorldDir = GetMoveWorldDirection().GetSafeNormal2D();
		RunDirection = (FVector::DotProduct(MoveWorldDir, WallForward) >= 0.0f) ? WallForward : -WallForward;
	}
	else if (UCharacterMovementComponent* CMC = GetMoveComp())
	{
		const FVector PlanarVelocity = FVector::VectorPlaneProject(CMC->Velocity, WallNormal);
		if (!PlanarVelocity.IsNearlyZero())
		{
			RunDirection = PlanarVelocity.GetSafeNormal();
		}
	}

	ApplyWallStickVelocity(RunDirection * WallRunSpeed);

	if (WallRunBufferRemaining <= 0.0f)
	{
		if (UCharacterMovementComponent* CMC = GetMoveComp())
		{
			CMC->Velocity = FVector::ZeroVector;
		}
		EnterWallIdle();
	}
}

void UWallMovementComponent::UpdateWallSlide(float DeltaTime)
{
	FVector DetectedNormal = FVector::ZeroVector;
	EWallSide DetectedSide = EWallSide::None;
	if (!DetectWall(DetectedNormal, DetectedSide))
	{
		DetachFromWall();
		return;
	}

	WallNormal = DetectedNormal;
	WallSide = DetectedSide;
	WallSlideTimer += DeltaTime;

	if (GetMoveInputLength() > MoveInputDeadzone)
	{
		EnterWallRun();
		return;
	}

	if (UCharacterMovementComponent* CMC = GetMoveComp())
	{
		CMC->GravityScale = 0.3f;
		FVector Velocity = FVector::VectorPlaneProject(CMC->Velocity, WallNormal);
		Velocity.Z = -WallSlideSpeed;
		CMC->Velocity = Velocity;
	}

	if (WallSlideTimer >= MaxWallSlideTime)
	{
		DetachFromWall();
	}
}

void UWallMovementComponent::DetachFromWall()
{
	if (UCharacterMovementComponent* CMC = GetMoveComp())
	{
		CMC->SetMovementMode(MOVE_Falling);
		CMC->GravityScale = DefaultGravityScale;
	}

	SetWallMoveState(EWallMoveState::Air);
	WallIdleTimer = 0.0f;
	WallSlideTimer = 0.0f;
	WallRunBufferRemaining = 0.0f;
	WallSide = EWallSide::None;
}

void UWallMovementComponent::DoWallJump()
{
	ACharacter* Character = GetOwnerCharacter();
	if (!Character)
	{
		return;
	}

	const FVector LaunchVelocity = (WallNormal * WallJumpPush) + (FVector::UpVector * WallJumpUp);
	WallJumpLockRemaining = WallJumpLockTime;
	DetachFromWall();
	Character->LaunchCharacter(LaunchVelocity, true, true);
}

void UWallMovementComponent::TryNormalJump()
{
	ACharacter* Character = GetOwnerCharacter();
	if (!Character)
	{
		return;
	}

	if (Character->CanJump())
	{
		Character->Jump();
		JumpBufferRemaining = 0.0f;
	}
	else
	{
		JumpBufferRemaining = JumpBufferTime;
	}
}

void UWallMovementComponent::UpdateJumpBuffer(float DeltaTime)
{
	if (JumpBufferRemaining <= 0.0f)
	{
		return;
	}

	JumpBufferRemaining = FMath::Max(0.0f, JumpBufferRemaining - DeltaTime);

	ACharacter* Character = GetOwnerCharacter();
	if (!Character || IsOnWall())
	{
		return;
	}

	if (JumpBufferRemaining > 0.0f && Character->CanJump())
	{
		Character->Jump();
		JumpBufferRemaining = 0.0f;
	}
}

void UWallMovementComponent::UpdateGroundAirState()
{
	const UCharacterMovementComponent* CMC = GetMoveComp();
	if (!CMC)
	{
		return;
	}

	if (CMC->IsMovingOnGround())
	{
		SetWallMoveState(EWallMoveState::Ground);
	}
	else if (!IsOnWall())
	{
		SetWallMoveState(EWallMoveState::Air);
	}
}

void UWallMovementComponent::SetWallMoveState(EWallMoveState NewState)
{
	if (WallMoveState == NewState)
	{
		return;
	}

	WallMoveState = NewState;
	OnWallMoveStateChanged.Broadcast(NewState);

	if (bDebugWallMovement)
	{
		UE_LOG(LogTemp, Log, TEXT("WallMoveState -> %d"), static_cast<int32>(NewState));
	}
}
