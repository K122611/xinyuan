@echo off
set IDF_PATH=C:\Users\LENOVO\Desktop\心元\xiaozhi-firmware\esp-idf-v5.4
set LOG=C:\Users\LENOVO\Desktop\心元\xiaozhi-firmware\build3.txt
call "%IDF_PATH%\export.bat" > "%LOG%" 2>&1
cd /d C:\Users\LENOVO\Desktop\心元\xiaozhi-firmware\xiaozhi-esp32-0d1ffd3f383214bc9b59fc699b77817771fe6a26
echo === set-target esp32s3 === >> "%LOG%"
idf.py set-target esp32s3 >> "%LOG%" 2>&1
echo === add sdkconfig === >> "%LOG%"
echo CONFIG_BOARD_TYPE_WAVESHARE_ESP32_S3_TOUCH_AMOLED_1_8_V2=y>> sdkconfig
echo CONFIG_USE_WECHAT_MESSAGE_STYLE=y>> sdkconfig
echo === idf.py build === >> "%LOG%"
idf.py build >> "%LOG%" 2>&1
echo EXIT=%ERRORLEVEL% >> "%LOG%"
echo === bin files === >> "%LOG%"
dir /s /b build\*.bin >> "%LOG%" 2>&1
