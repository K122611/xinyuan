@echo off
echo Starting OTA server...
start "OTA" "C:\Program Files\nodejs\node.exe" "C:\Users\LENOVO\Desktop\心元\start_ota.cjs"
timeout /t 2 /nobreak >nul
echo Starting AI Voice Bridge...
start "Bridge" "C:\Program Files\nodejs\node.exe" "C:\Users\LENOVO\Desktop\心元\xinyuan-emo-mate\bridge_ai.mjs"
echo Both servers started.
pause
