#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "WallMovementTypes.h"
#include "WallMovementComponent.generated.h"

class ACharacter;
class UCharacterMovementComponent;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnWallMoveStateChanged, EWallMoveState, NewState);

UCLASS(ClassGroup = (Custom), meta = (BlueprintSpawnableComponent))
class LIGHT_AND_SHADOW_API UWallMovementComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UWallMovementComponent();

	virtual void BeginPlay() override;
	virtual void TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction) override;

	UFUNCTION(BlueprintCallable, Category = "Wall Movement")
	void SetMoveInput(FVector2D Input);

	UFUNCTION(BlueprintCallable, Category = "Wall Movement")
	void OnJumpPressed();

	UFUNCTION(BlueprintCallable, Category = "Wall Movement")
	void SetBallCamActive(bool bActive);

	UFUNCTION(BlueprintPure, Category = "Wall Movement")
	EWallMoveState GetWallMoveState() const { return WallMoveState; }

	UFUNCTION(BlueprintPure, Category = "Wall Movement")
	bool IsOnWall() const;

	UPROPERTY(BlueprintAssignable, Category = "Wall Movement")
	FOnWallMoveStateChanged OnWallMoveStateChanged;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wall Movement|Timing")
	float WallIdleBeforeSlide = 0.25f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wall Movement|Timing")
	float WallRunBufferDuration = 0.55f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wall Movement|Timing")
	float MaxWallSlideTime = 2.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wall Movement|Timing")
	float WallJumpLockTime = 0.15f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wall Movement|Timing")
	float JumpBufferTime = 0.15f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wall Movement|Speed")
	float WallRunSpeedThreshold = 300.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wall Movement|Speed")
	float WallRunSpeed = 420.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wall Movement|Speed")
	float WallSlideSpeed = 200.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wall Movement|Speed")
	float WallJumpPush = 600.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wall Movement|Speed")
	float WallJumpUp = 520.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wall Movement|Detection")
	float WallTraceDistance = 70.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wall Movement|Detection")
	float WallTraceHeightOffset = 50.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wall Movement|Detection")
	float MaxWallNormalZ = 0.3f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wall Movement|Input")
	float MoveInputDeadzone = 0.15f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wall Movement|Character Movement")
	bool bApplyDefaultMovementTuning = true;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wall Movement|Character Movement")
	float DefaultJumpZVelocity = 700.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wall Movement|Character Movement")
	float DefaultAirControl = 0.4f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wall Movement|Character Movement")
	float DefaultGravityScale = 1.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wall Movement|Character Movement")
	float DefaultMaxWalkSpeed = 550.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wall Movement|Debug")
	bool bDebugWallMovement = false;

protected:
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Wall Movement")
	EWallMoveState WallMoveState = EWallMoveState::Air;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Wall Movement")
	FVector WallNormal = FVector::ZeroVector;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Wall Movement")
	EWallSide WallSide = EWallSide::None;

	FVector2D CachedMoveInput = FVector2D::ZeroVector;
	float WallIdleTimer = 0.0f;
	float WallSlideTimer = 0.0f;
	float WallRunBufferRemaining = 0.0f;
	float WallJumpLockRemaining = 0.0f;
	float JumpBufferRemaining = 0.0f;
	bool bBallCamActive = false;

	TWeakObjectPtr<ACharacter> OwnerCharacter;
	TWeakObjectPtr<UCharacterMovementComponent> MoveComp;

	bool DetectWall(FVector& OutNormal, EWallSide& OutSide) const;
	bool IsClimbableHit(const FHitResult& Hit) const;
	void TryAttachToWall();
	void EnterWallIdle();
	void EnterWallRun();
	void UpdateWallIdle(float DeltaTime);
	void UpdateWallRun(float DeltaTime);
	void UpdateWallSlide(float DeltaTime);
	void DetachFromWall();
	void DoWallJump();
	void TryNormalJump();
	void UpdateJumpBuffer(float DeltaTime);
	void UpdateGroundAirState();
	void SetWallMoveState(EWallMoveState NewState);
	FVector GetWallForward() const;
	FVector GetMoveWorldDirection() const;
	float GetHorizontalSpeed() const;
	float GetMoveInputLength() const;
	void ProjectVelocityOntoWall();
	void ApplyWallStickVelocity(const FVector& DesiredVelocity);
	ACharacter* GetOwnerCharacter() const;
	UCharacterMovementComponent* GetMoveComp() const;
};
