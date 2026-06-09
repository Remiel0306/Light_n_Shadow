@echo off
REM Clear GPU-heavy caches. Close Unreal Editor first.
echo Close Unreal Editor, then press any key...
pause >nul

set "DIR=%~dp0"
if exist "%DIR%Saved" rmdir /s /q "%DIR%Saved"
if exist "%DIR%DerivedDataCache" rmdir /s /q "%DIR%DerivedDataCache"
if exist "%DIR%Intermediate\ShaderCache" rmdir /s /q "%DIR%Intermediate\ShaderCache"

echo.
echo Done. Reopen Light_and_Shadow.uproject
echo Project now uses lighter rendering (no Lumen) in DefaultEngine.ini
pause
