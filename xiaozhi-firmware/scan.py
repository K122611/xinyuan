#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os
import sys

output_file = r"C:\Users\LENOVO\Desktop\心元\xiaozhi-firmware\scan_result.txt"

lines = []

# 1. Check merged-binary.bin
bin_path = r"C:\Users\LENOVO\Desktop\心元\xiaozhi-firmware\c6-amoled\merged-binary.bin"
if os.path.exists(bin_path):
    size = os.path.getsize(bin_path)
    lines.append(f"merged-binary.bin: {size} bytes ({size/1024/1024:.2f} MB)")
else:
    lines.append("merged-binary.bin: NOT FOUND")

# 2. List directory
lines.append("")
lines.append("=== c6-amoled directory ===")
for f in os.listdir(r"C:\Users\LENOVO\Desktop\心元\xiaozhi-firmware\c6-amoled"):
    fp = os.path.join(r"C:\Users\LENOVO\Desktop\心元\xiaozhi-firmware\c6-amoled", f)
    sz = os.path.getsize(fp) if os.path.isfile(fp) else 0
    lines.append(f"  {f} - {sz} bytes")

# 3. COM ports
lines.append("")
lines.append("=== COM Ports ===")
try:
    import serial.tools.list_ports
    ports = list(serial.tools.list_ports.comports())
    if ports:
        for p in ports:
            lines.append(f"  {p.device} - {p.description}")
    else:
        lines.append("  No COM ports detected")
except ImportError:
    lines.append("  pyserial not installed")
except Exception as e:
    lines.append(f"  Error: {e}")

# 4. esptool
lines.append("")
lines.append("=== esptool ===")
try:
    import subprocess
    result = subprocess.run(["where", "esptool.py"], capture_output=True, text=True, shell=True)
    if result.returncode == 0 and result.stdout.strip():
        lines.append(f"  Found: {result.stdout.strip()}")
    else:
        lines.append("  Not found via 'where'")
except Exception as e:
    lines.append(f"  Error: {e}")

lines.append("")
lines.append("=== DONE ===")

with open(output_file, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))

print("Output written to " + output_file)
