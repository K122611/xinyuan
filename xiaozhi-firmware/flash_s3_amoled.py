#!/usr/bin/env python3
import os
import zipfile
import subprocess
import sys
import shutil

# Paths
zip_path = os.path.expanduser(r"~\Downloads\v2.2.6_waveshare-esp32-s3-touch-amoled-1.8.zip")
extract_dir = r"C:\Users\LENOVO\Desktop\心元\xiaozhi-firmware\s3-amoled"
esptool = r"C:\Users\LENOVO\Desktop\心元\xiaozhi-firmware\esp-idf-v5.4\components\esptool_py\esptool\esptool.py"
logfile = r"C:\Users\LENOVO\Desktop\心元\xiaozhi-firmware\flash_s3_result.txt"

lines = []

# Step 1: Extract
lines.append("=== Step 1: Extract ===")
if os.path.exists(extract_dir):
    shutil.rmtree(extract_dir)
os.makedirs(extract_dir)
try:
    with zipfile.ZipFile(zip_path, 'r') as zf:
        zf.extractall(extract_dir)
    lines.append("Extracted successfully")
    for f in os.listdir(extract_dir):
        fp = os.path.join(extract_dir, f)
        sz = os.path.getsize(fp) if os.path.isfile(fp) else 0
        lines.append(f"  {f} - {sz} bytes")
except Exception as e:
    lines.append(f"Extract error: {e}")

# Step 2: Flash
lines.append("")
lines.append("=== Step 2: Flash ESP32-S3 on COM5 ===")
bin_path = os.path.join(extract_dir, "merged-binary.bin")
if not os.path.exists(bin_path):
    lines.append("ERROR: merged-binary.bin not found!")
else:
    lines.append(f"Firmware: {bin_path} ({os.path.getsize(bin_path)} bytes)")
    cmd = [
        sys.executable, esptool,
        "--chip", "esp32s3",
        "--port", "COM5",
        "--baud", "921600",
        "--before", "default-reset",
        "--after", "hard-reset",
        "write-flash",
        "0x0", bin_path
    ]
    lines.append(f"Command: {' '.join(cmd)}")
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        lines.append("STDOUT:")
        lines.append(result.stdout)
        lines.append("STDERR:")
        lines.append(result.stderr)
        lines.append(f"Return code: {result.returncode}")
    except subprocess.TimeoutExpired:
        lines.append("TIMEOUT")
    except Exception as e:
        lines.append(f"Error: {e}")

with open(logfile, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print("Done")
