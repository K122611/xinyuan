@echo off
chcp 65001 >nul
pushd "C:\Users\LENOVO\Desktop\心元\xinyuan-emo-mate"
set "PATH=C:\Program Files\nodejs;%PATH%"
start "" "%CD%\node_modules\electron\dist\electron.exe" .
popd
