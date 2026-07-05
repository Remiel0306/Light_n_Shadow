@echo off
setlocal
REM Rebuild after adding WallMovementComponent. Close Unreal Editor first (Live Coding blocks build).

set "PROJECT_DIR=%~dp0"
set "PROJECT=%PROJECT_DIR%Light_and_Shadow.uproject"
if not defined UE_ROOT set "UE_ROOT=D:\UE_5.7"
set "UBT=%UE_ROOT%\Engine\Build\BatchFiles\Build.bat"

echo === Wall Jump module build ===
echo Close Unreal Editor before continuing.
pause

call "%UBT%" Light_and_ShadowEditor Win64 Development -Project="%PROJECT%" -WaitMutex
if errorlevel 1 (
    echo [FAILED] See Output Log / Live Coding must be off.
    pause
    exit /b 1
)

echo.
echo [OK] Compiled. Next in UE Editor:
echo   1. Open BP_ThirdPersonCharacter
echo   2. Add Component: Wall Movement Component
echo   3. Run Python: Scripts/SetupWallJump_BP.py
echo   4. Place Wall Climb Test Wall actors in level for testing
echo.
pause
