@echo off
rem Starts JobPilot in the browser: http://127.0.0.1:47321
rem Double-click this file, or run scripts\install-shortcuts.ps1 once for a Desktop / Start Menu shortcut.
setlocal
cd /d "%~dp0"

if not exist "node_modules" (
  echo Installing dependencies. This happens once.
  call pnpm install || goto :error
)
if not exist "apps\web\dist\index.html" (
  echo Building the dashboard. This happens once.
  call pnpm --filter @jobpilot/web build || goto :error
)

node "apps\server\node_modules\tsx\dist\cli.mjs" "apps\server\src\main.ts" --open
goto :eof

:error
echo.
echo JobPilot could not start. Is pnpm installed?  npm install -g pnpm
pause
exit /b 1
