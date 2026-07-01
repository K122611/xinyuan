@echo off
set "NODE_PATH=%~dp0nodejs\node-v22.12.0-win-x64"
set "PATH=%NODE_PATH%;%PATH%"
cd /d "%~dp0"
echo.
echo ========================================
echo   心元 EMO-Mate 启动中...
echo   Node.js: %NODE_PATH%
echo ========================================
echo.
call npm run electron:dev
pause
