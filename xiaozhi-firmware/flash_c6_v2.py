#!/usr/bin/env python3
import subprocess
import sys

esptool = r"C:\Users\LENOVO\Desktop\心元\xiaozhi-firmware\esp-idf-v5.4\components\esptool_py\esptool\esptool.py"
firmware = r"C:\Users\LENOVO\Desktop\心元\xiaozhi-firmware\c6-amoled\merged-binary.bin"
output_file = r"C:\Users\LENOVO\Desktop\心元\xiaozhi-firmware\flash_c6_result.txt"

cmd = [
    sys.executable, esptool,
    "--chip", "esp32c6",
    "--port", "COM5",
    "--baud", "921600",
    "--before", "default_reset",
    "--after", "hard_reset",
    "write-flash",
    "0x0", firmware
]

lines = []
lines.append(f"Flashing ESP32-C6 on COM5...")
lines.append(f"Firmware: {firmware}")
lines.append("")

try:
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    lines.append("=== STDOUT ===")
    lines.append(result.stdout)
    lines.append("=== STDERR ===")
    lines.append(result.stderr)
    lines.append(f"Return code: {result.returncode}")
except subprocess.TimeoutExpired:
    lines.append("TIMEOUT after 300s")
except Exception as e:
    lines.append(f"ERROR: {e}")

with open(output_file, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print("Done")
