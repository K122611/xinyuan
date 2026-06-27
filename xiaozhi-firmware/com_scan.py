#!/usr/bin/env python3
import os

output_file = r"C:\Users\LENOVO\Desktop\心元\xiaozhi-firmware\com_scan.txt"
lines = []

lines.append("=== All COM Ports ===")
try:
    import serial.tools.list_ports
    ports = list(serial.tools.list_ports.comports())
    for p in ports:
        lines.append(f"  PORT: {p.device}")
        lines.append(f"    Description: {p.description}")
        lines.append(f"    HWID: {p.hwid}")
        lines.append(f"    VID: {p.vid}, PID: {p.pid}")
        lines.append(f"    Serial: {p.serial_number}")
        lines.append(f"    Manufacturer: {p.manufacturer}")
        lines.append(f"    Product: {p.product}")
        lines.append("")
    if not ports:
        lines.append("  No COM ports found!")
except Exception as e:
    lines.append(f"  Error: {e}")

lines.append("=== DONE ===")
with open(output_file, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print("Done")
