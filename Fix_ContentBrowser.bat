@echo off
REM Rebuild UE asset registry cache when Content Browser shows empty folders.
REM Close Unreal Editor before running this.

set "PROJECT_DIR=%~dp0"

echo === Fix Content Browser (asset registry) ===
echo Close Unreal Editor first, then press any key...
pause >nul

if exist "%PROJECT_DIR%Saved" (
    echo Removing Saved\ ...
    rmdir /s /q "%PROJECT_DIR%Saved"
)
if exist "%PROJECT_DIR%DerivedDataCache" (
    echo Removing DerivedDataCache\ ...
    rmdir /s /q "%PROJECT_DIR%DerivedDataCache"
)
if exist "%PROJECT_DIR%Intermediate\AssetRegistryCache" (
    echo Removing Intermediate\AssetRegistryCache\ ...
    rmdir /s /q "%PROJECT_DIR%Intermediate\AssetRegistryCache"
)

echo.
echo Done. Now:
echo   1. Open Light_and_Shadow.uproject
echo   2. Wait for shader compile to finish
echo   3. Content Browser - search: BP_ThirdPersonCharacter
echo.
pause
