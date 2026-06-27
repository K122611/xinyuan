import os, sys, json

# File size
bin_path = r"C:\Users\LENOVO\Desktop\心元\xiaozhi-firmware\c6-amoled\merged-binary.bin"
size = os.path.getsize(bin_path)
print(f"merged-binary.bin: {size} bytes ({size/1024/1024:.2f} MB)")

# COM ports
try:
    import serial.tools.list_ports
    ports = list(serial.tools.list_ports.comports())
    for p in ports:
        print(f"COM: {p.device} - {p.description} - {p.hwid}")
    if not ports:
        print("No COM ports found")
except Exception as e:
    print(f"serial error: {e}")

# Check esptool
try:
    result = os.popen("where esptool.py 2>&1").read().strip()
    print(f"esptool.py: {result}")
except Exception as e:
    print(f"esptool check error: {e}")

print("Done.")
