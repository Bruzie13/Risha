@echo off
rem Double-click this file to start FETCH on this computer and open it in the browser.
rem Close this window (or press Ctrl+C in it) to stop the system.

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)

rem Already running? Then just open it.
curl -s -o nul http://localhost:8000/login.html
if not errorlevel 1 (
  echo FETCH is already running. Opening it in the browser.
  start "" "http://localhost:8000"
  exit /b 0
)

rem First run on this computer: install the backend packages.
if not exist "backend\node_modules\express" (
  echo Installing packages, this takes a minute...
  call npm install --prefix backend --no-fund --no-audit
)

echo Starting FETCH at http://localhost:8000 ...
echo Leave this window open while you use the system. Close it to stop.
echo.

rem Open the browser as soon as the server answers.
start "" /min powershell -NoProfile -WindowStyle Hidden -Command "for ($i = 0; $i -lt 60; $i++) { try { Invoke-WebRequest 'http://localhost:8000/login.html' -UseBasicParsing | Out-Null; Start-Process 'http://localhost:8000'; break } catch { Start-Sleep 1 } }"

node backend\server.js
pause
