#!/usr/bin/env python3
# Check if the correct ESP32-S3 AMOLED firmware exists in xiaozhi releases
import subprocess
import sys

output_file = r"C:\Users\LENOVO\Desktop\心元\xiaozhi-firmware\s3_amoled_check.txt"
lines = []

# Check what we already have in downloads
import os
downloads = os.path.expanduser("~/Downloads")
for f in os.listdir(downloads):
    if "waveshare" in f.lower() and "zip" in f.lower():
        fp = os.path.join(downloads, f)
        sz = os.path.getsize(fp)
        lines.append(f"{f} - {sz/1024/1024:.1f} MB")

if not any("waveshare" in f.lower() for f in os.listdir(downloads)):
    lines.append("No waveshare zip files in Downloads")
    
# List all zip files in Downloads matching s3 or amoled
for f in os.listdir(downloads):
    if f.lower().endswith('.zip') and ('s3' in f.lower() or 'amoled' in f.lower() or 'xiaozhi' in f.lower()):
        fp = os.path.join(downloads, f)
        sz = os.path.getsize(fp)
        lines.append(f"  {f} - {sz/1024/1024:.1f} MB")

lines.append("")
lines.append("=== DONE ===")

with open(output_file, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print("Done")
