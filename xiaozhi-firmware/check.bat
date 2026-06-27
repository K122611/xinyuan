@echo off
chcp 65001 >nul
echo === merged-binary.bin ===
for %%F in ("C:\Users\LENOVO\Desktop\心元\xiaozhi-firmware\c6-amoled\merged-binary.bin") do echo Size: %%~zF bytes
echo.
echo === COM Ports ===
mode
echo.
echo === Python COM check ===
python -c "import serial.tools.list_ports; [print(f'{p.device} - {p.description}') for p in serial.tools.list_ports.comports()]"
echo.
echo === esptool ===
where esptool.py 2>&1
echo DONE
