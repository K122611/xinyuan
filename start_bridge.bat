@echo off
chcp 65001 >nul
cd /d %~dp0
title 心元 XiaoZhi 全栈启动

echo.
echo ╔══════════════════════════════════════════╗
echo ║     心元 EMO-Mate + 小智 ESP32 Bridge       ║
echo ╚══════════════════════════════════════════╝
echo.

REM 1. 确保证书存在
if not exist "certs\xiaozhi-cert.pem" (
    echo [STEP 1] 生成 SSL 证书...
    python gen_cert.py
    if errorlevel 1 (
        echo [FAIL] 证书生成失败！
        pause
        exit /b 1
    )
) else (
    echo [STEP 1] SSL 证书已存在 ✓
)

REM 2. 启动桥接器 (后台)
echo [STEP 2] 启动桥接器 (WSS:443, WS:8888, MQTT:1883)...
start "XiaoZhiBridge" /MIN cmd /c "cd /d %~dp0 && node electron\xiaozhi-bridge.js"
echo [STEP 2] 桥接器已后台启动

REM 3. 等待桥接器就绪
echo [STEP 3] 等待桥接器就绪 (3秒)...
timeout /t 3 /nobreak >nul

REM 4. 启动 DNS 欺骗
echo [STEP 4] 启动 DNS 欺骗 (需要管理员权限)...
python dns_spoof.py
pause
