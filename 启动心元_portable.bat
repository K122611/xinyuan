@echo off
chcp 65001 >nul
title 心元 EMO-Mate (Portable)

REM ============================================
REM  心元 EMO-Mate 便携启动器
REM  自动检测热点 IP，启动桥接服务和应用
REM ============================================

set ROOT=%~dp0
cd /d "%ROOT%"

echo.
echo  ╔══════════════════════════════════╗
echo  ║    心元 EMO-Mate  便携启动器     ║
echo  ╚══════════════════════════════════╝
echo.

REM --- 检查 Node.js ---
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [错误] 未找到 Node.js，请先安装：https://nodejs.org
    pause
    exit /b 1
)

REM --- 检查依赖 ---
if not exist "%ROOT%node_modules" (
    echo [提示] 首次启动，正在安装依赖...
    call npm install --production
    if %ERRORLEVEL% neq 0 (
        echo [错误] 依赖安装失败
        pause
        exit /b 1
    )
)

REM --- 检查 Python (证书生成需要) ---
where python >nul 2>&1
if %ERRORLEVEL% neq 0 (
    where python3 >nul 2>&1
    if %ERRORLEVEL% neq 0 (
        echo [警告] 未找到 Python，SSL 证书功能可能不可用
        echo        安装 Python 后重新运行: https://python.org
    )
)

REM --- 自动检测本机 IP ---
echo [检测] 正在检测本机 IP...
for /f "delims=" %%i in ('node "%ROOT%scripts\auto_detect_ip.cjs" 2^>nul') do set DETECT_JSON=%%i

if "%DETECT_JSON%"=="" (
    echo [错误] 无法检测到本机 IP 地址
    echo        请确保已开启 Windows 移动热点
    echo.
    echo 如何开启：设置 → 网络和 Internet → 移动热点 → 开启
    pause
    exit /b 1
)

REM --- 从 JSON 提取 IP ---
for /f "tokens=2 delims=:, " %%a in ('echo %DETECT_JSON%') do set IP=%%~a
set IP=%IP:"=%
set IP=%IP:}=%

echo [检测] 本机 IP: %IP%

REM --- 启动桥接服务 ---
echo.
echo [启动] 正在启动桥接服务...
start "心元-Bridge" cmd /c "node "%ROOT%start_bridge.js" --ip=%IP% 2>&1 | tee bridge.log"
echo [启动] 桥接服务已启动（后台运行）

REM --- 等待桥接就绪 ---
echo [等待] 等待桥接服务就绪（3秒）...
timeout /t 3 /nobreak >nul

REM --- 启动 OTA 服务 ---
echo [启动] 正在启动 OTA 服务...
start "心元-OTA" cmd /c "node "%ROOT%start_ota.cjs" 2>&1"
echo [启动] OTA 服务已启动

REM --- 启动 Electron 应用 ---
echo.
echo [启动] 正在启动心元应用...
start "心元-App" cmd /c "node "%ROOT%launcher.mjs" --ip=%IP%"

echo.
echo ╔══════════════════════════════════╗
echo ║   全部服务已启动！               ║
echo ║   ESP32 连接热点后自动对接       ║
echo ║   关闭此窗口不会停止服务         ║
echo ╚══════════════════════════════════╝
echo.
echo 停止服务: 关闭心元应用窗口，然后关闭桥接窗口
echo 查看日志: bridge.log
echo.

pause
