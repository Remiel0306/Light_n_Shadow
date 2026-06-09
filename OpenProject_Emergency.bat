@echo off
setlocal
title Light_and_Shadow EMERGENCY OPEN
color 0E

set "PROJECT_DIR=%~dp0"
set "PROJECT=%PROJECT_DIR%Light_and_Shadow.uproject"
if not defined UE_ROOT set "UE_ROOT=D:\UE_5.7"
set "UE=%UE_ROOT%\Engine\Binaries\Win64\UnrealEditor.exe"

if not exist "%UE%" (
    echo.
    echo [ERROR] Cannot find Unreal Editor:
    echo   %UE%
    echo.
    echo Fix: set UE_ROOT=your UE 5.7 folder, then run this bat again.
    pause
    exit /b 1
)

echo.
echo === Emergency open (low VRAM) ===
echo 1. Clears Saved / DDC / Intermediate
echo 2. Opens with DX11 + safe flags
echo 3. Startup map = Engine Entry (NOT your heavy level)
echo.
echo Close all UnrealEditor.exe in Task Manager first!
pause

taskkill /IM UnrealEditor.exe /F >nul 2>&1

if exist "%PROJECT_DIR%Saved" rmdir /s /q "%PROJECT_DIR%Saved"
if exist "%PROJECT_DIR%DerivedDataCache" rmdir /s /q "%PROJECT_DIR%DerivedDataCache"
if exist "%PROJECT_DIR%Intermediate" rmdir /s /q "%PROJECT_DIR%Intermediate"

echo Starting editor...
start "" "%UE%" "%PROJECT%" -dx11 -nosplash -notracing -windowed -ResX=1280 -ResY=720

echo.
echo If it opens: File - Open Level - pick Lvl_ThirdPerson only when ready.
echo To restore normal startup: edit Config\DefaultEngine.ini EditorStartupMap back to Lvl_ThirdPerson
pause
