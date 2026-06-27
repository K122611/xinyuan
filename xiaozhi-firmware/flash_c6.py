#!/usr/bin/env python3
import subprocess
import os
import sys

# Paths
esptool = r"C:\Users\LENOVO\Desktop\心元\xiaozhi-firmware\esp-idf-v5.4\components\esptool_py\esptool\esptool.py"
firmware = r"C:\Users\LENOVO\Desktop\心元\xiaozhi-firmware\c6-amoled\merged-binary.bin"
output_file = r"C:\Users\LENOVO\Desktop\心元\xiaozhi-firmware\flash_result.txt"

os.chdir(r"C:\Users\LENOVO\Desktop\心元\xiaozhi-firmware")

cmd = [
    sys.executable, esptool,
    "--chip", "esp32c6",
    "--port", "COM5",
    "--baud", "921600",
    "write_flash",
    "0x0", firmware
]

lines = []
lines.append(f"Running: {' '.join(cmd)}")
lines.append("")

try:
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    lines.append("STDOUT:")
    lines.append(result.stdout)
    if result.stderr:
        lines.append("STDERR:")
        lines.append(result.stderr)
    lines.append(f"Return code: {result.returncode}")
except subprocess.TimeoutExpired:
    lines.append("TIMEOUT - Flashing took too long")
except Exception as e:
    lines.append(f"ERROR: {e}")

with open(output_file, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))

print("Done, see flash_result.txt")
