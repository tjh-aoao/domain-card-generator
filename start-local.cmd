@echo off
setlocal

cd /d "%~dp0"
set "APP_URL=http://localhost:3000/"

title Domain Card Generator Launcher

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Please install Node.js first.
  pause
  exit /b 1
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo npm.cmd was not found. Please reinstall Node.js or add npm to PATH.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -Uri '%APP_URL%' -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if not errorlevel 1 (
  echo Local server is already running.
  start "" "%APP_URL%"
  exit /b 0
)

if not exist "node_modules" (
  echo Installing dependencies...
  if exist "package-lock.json" (
    call npm.cmd ci --include=dev
  ) else (
    call npm.cmd install
  )
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

echo Starting local server...
start "Domain Card Generator Server" cmd /k "cd /d ""%~dp0"" && npm.cmd run dev"

echo Waiting for %APP_URL% ...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$deadline = (Get-Date).AddSeconds(45); do { try { Invoke-WebRequest -Uri '%APP_URL%' -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { Start-Sleep -Milliseconds 500 } } while ((Get-Date) -lt $deadline); exit 1"
if errorlevel 1 (
  echo Server did not respond yet. Check the server window for details.
  pause
  exit /b 1
)

start "" "%APP_URL%"
exit /b 0
