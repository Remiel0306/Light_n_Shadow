@echo off
REM Safer launch: DX11, no ray tracing. Use if double-click .uproject crashes.
set "PROJECT_DIR=%~dp0"
set "PROJECT=%PROJECT_DIR%Light_and_Shadow.uproject"

if not defined UE_ROOT set "UE_ROOT=D:\UE_5.7"
set "UE_EDITOR=%UE_ROOT%\Engine\Binaries\Win64\UnrealEditor.exe"

if not exist "%UE_EDITOR%" (
    echo [ERROR] Editor not found: %UE_EDITOR%
    echo Set UE_ROOT to your UE 5.7 folder, then run again.
    pause
    exit /b 1
)

start "" "%UE_EDITOR%" "%PROJECT%" -dx11 -notracing -nosplash
