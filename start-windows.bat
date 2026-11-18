@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js 20+ is required. Download from https://nodejs.org/
  pause
  exit /b 1
)

echo Checking mihomo.exe...
node setup-mihomo.mjs

echo Starting Airport Bench on http://127.0.0.1:8788 ...
start "" http://127.0.0.1:8788
node server.mjs
pause
