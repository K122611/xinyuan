@echo off
set IDF_PATH=C:\Users\LENOVO\Desktop\心元\xiaozhi-firmware\esp-idf-v5.4
echo hello > C:\Users\LENOVO\Desktop\心元\xiaozhi-firmware\test_build.txt
call "%IDF_PATH%\export.bat" >> C:\Users\LENOVO\Desktop\心元\xiaozhi-firmware\test_build.txt 2>&1
echo export_done >> C:\Users\LENOVO\Desktop\心元\xiaozhi-firmware\test_build.txt
idf.py --version >> C:\Users\LENOVO\Desktop\心元\xiaozhi-firmware\test_build.txt 2>&1
echo all_done >> C:\Users\LENOVO\Desktop\心元\xiaozhi-firmware\test_build.txt
