@echo off
setlocal
cd /d "%~dp0"

echo.
echo  BloodLink HOST for Windows
echo  =======================
echo  This starts a SERVER on this computer.
echo  Friends should use BloodLink-Connect.zip or the Invite People link instead.
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 22.5 or newer is required.
  echo Opening https://nodejs.org/  - install the LTS build, then run this file again.
  start https://nodejs.org/
  pause
  exit /b 1
)

for /f "tokens=1 delims=v" %%v in ('node -v') do set NODEVER=%%v
echo Using Node %NODEVER%

if not exist "node_modules\" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

if not exist "client\dist\index.html" (
  echo Building the client...
  call npm run build
  if errorlevel 1 (
    echo Build failed.
    pause
    exit /b 1
  )
)

set HEARTH_PORT=3928
set HEARTH_HOST=0.0.0.0
echo.
echo Starting BloodLink on http://127.0.0.1:3928
echo Leave this window open. Friends on the same Wi-Fi can join at:
echo   http://YOUR-PC-IP:3928
echo.
start "" http://127.0.0.1:3928
node server\src\index.js
echo.
echo BloodLink stopped.
pause
