@echo off
setlocal EnableDelayedExpansion

REM First-time setup after git clone. Requires UE 5.7 + Visual Studio 2022 (C++ workload).
REM Usage: double-click, or run from cmd. Set UE_ROOT if engine is not at D:\UE_5.7

set "PROJECT_DIR=%~dp0"
set "PROJECT=%PROJECT_DIR%Light_and_Shadow.uproject"

if not defined UE_ROOT set "UE_ROOT=D:\UE_5.7"
set "UBT=%UE_ROOT%\Engine\Build\BatchFiles\Build.bat"

if not exist "%UBT%" (
    echo [ERROR] Unreal Build Tool not found at:
    echo   %UBT%
    echo Install UE 5.7 or set UE_ROOT to your engine folder, e.g.:
    echo   set UE_ROOT=C:\Program Files\Epic Games\UE_5.7
    pause
    exit /b 1
)

if not exist "%PROJECT%" (
    echo [ERROR] Project file not found: %PROJECT%
    pause
    exit /b 1
)

echo.
echo === Light_and_Shadow first-time build ===
echo Project: %PROJECT%
echo Engine:  %UE_ROOT%
echo.
echo UE_MCP_Bridge is OFF by default (optional dev tool). Game module only.
echo This may take several minutes on first compile...
echo.

REM Stale Intermediate from a failed MCP / wrong-engine build often blocks reopening.
if exist "%PROJECT_DIR%Intermediate" (
    echo Removing stale Intermediate...
    rmdir /s /q "%PROJECT_DIR%Intermediate"
)
if exist "%PROJECT_DIR%Binaries" (
    echo Removing stale Binaries...
    rmdir /s /q "%PROJECT_DIR%Binaries"
)
if exist "%PROJECT_DIR%Plugins\UE_MCP_Bridge\Intermediate" (
    rmdir /s /q "%PROJECT_DIR%Plugins\UE_MCP_Bridge\Intermediate"
)
if exist "%PROJECT_DIR%Plugins\UE_MCP_Bridge\Binaries" (
    rmdir /s /q "%PROJECT_DIR%Plugins\UE_MCP_Bridge\Binaries"
)

call "%UBT%" Light_and_ShadowEditor Win64 Development -Project="%PROJECT%" -WaitMutex
set "RC=%ERRORLEVEL%"

if not "%RC%"=="0" (
    echo.
    echo [FAILED] Build exit code %RC%
    echo - Confirm Visual Studio 2022 with "Desktop development with C++" is installed
    echo - Confirm engine version is 5.7 (see EngineAssociation in .uproject)
    echo - Open Light_and_Shadow.sln in VS and build "Development Editor" for more detail
    pause
    exit /b %RC%
)

echo.
echo [OK] Build finished. You can now open Light_and_Shadow.uproject in Unreal Editor.
echo.
pause
exit /b 0
