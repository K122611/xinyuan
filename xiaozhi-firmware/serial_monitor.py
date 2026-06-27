#!/usr/bin/env python3
import serial
import time

output_file = r"C:\Users\LENOVO\Desktop\心元\xiaozhi-firmware\serial_boot.txt"
lines = []

try:
    ser = serial.Serial("COM5", 115200, timeout=1)
    lines.append("Connected to COM5 at 115200 baud")
    lines.append("Waiting for boot messages (10 seconds)...")
    lines.append("")
    
    start = time.time()
    while time.time() - start < 15:
        line = ser.readline()
        if line:
            try:
                text = line.decode('utf-8', errors='replace').rstrip()
            except:
                text = str(line)
            lines.append(text)
    
    ser.close()
    lines.append("")
    lines.append("--- Done ---")
except Exception as e:
    lines.append(f"Error: {e}")
    # Try with different baud rate
    try:
        ser = serial.Serial("COM5", 921600, timeout=1)
        lines.append("Trying 921600 baud...")
        start = time.time()
        while time.time() - start < 10:
            line = ser.readline()
            if line:
                try:
                    text = line.decode('utf-8', errors='replace').rstrip()
                except:
                    text = str(line)
                lines.append(text)
        ser.close()
    except Exception as e2:
        lines.append(f"921600 error: {e2}")

with open(output_file, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print("Done")
