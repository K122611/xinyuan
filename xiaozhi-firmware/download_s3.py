#!/usr/bin/env python3
import subprocess
import sys
import os

url = "https://github.com/78/xiaozhi-esp32/releases/download/v2.2.6/v2.2.6_waveshare-esp32-s3-touch-amoled-1.8.zip"
output = os.path.expanduser(r"~\Downloads\v2.2.6_waveshare-esp32-s3-touch-amoled-1.8.zip")
logfile = r"C:\Users\LENOVO\Desktop\心元\xiaozhi-firmware\download_s3_result.txt"

lines = []
lines.append(f"Downloading: {url}")
lines.append(f"To: {output}")
lines.append("")

try:
    import urllib.request
    urllib.request.urlretrieve(url, output)
    size = os.path.getsize(output)
    lines.append(f"SUCCESS: {size} bytes downloaded")
except Exception as e:
    lines.append(f"Python urllib error: {e}")
    # Try powershell fallback
    try:
        ps_cmd = f'Invoke-WebRequest -Uri "{url}" -OutFile "{output}"'
        result = subprocess.run(["powershell", "-Command", ps_cmd], capture_output=True, text=True, timeout=60)
        lines.append(f"PowerShell result: {result.returncode}")
        lines.append(f"STDOUT: {result.stdout[:500]}")
        lines.append(f"STDERR: {result.stderr[:500]}")
        if os.path.exists(output):
            size = os.path.getsize(output)
            lines.append(f"SUCCESS via PowerShell: {size} bytes")
    except Exception as e2:
        lines.append(f"PowerShell error: {e2}")

with open(logfile, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print("Done")
