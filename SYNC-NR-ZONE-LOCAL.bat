@echo off
setlocal
cd /d "%~dp0"
set "NR_NODE=node"
where node >nul 2>nul
if errorlevel 1 set "NR_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
"%NR_NODE%" tools\sync_nr_all.cjs
if errorlevel 1 (
 echo NR sync failed. Both source-year builds must validate.
 pause
 exit /b 1
)
echo NR Zone and AU current/previous-year data refreshed locally. Reload the portal.
pause
