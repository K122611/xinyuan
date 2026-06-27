import os
import sys

base = r"C:\Users\LENOVO\Desktop\心元\xiaozhi-firmware"
zip_path = os.path.join(base, "xiaozhi-esp32-source.zip")
log_path = os.path.join(base, "check_status.txt")

with open(log_path, 'w', encoding='utf-8') as log:
    log.write(f"Checking: {zip_path}\n")
    if os.path.exists(zip_path):
        size = os.path.getsize(zip_path)
        log.write(f"File exists. Size: {size} bytes ({size/1024/1024:.2f} MB)\n")
    else:
        log.write("File NOT found\n")
    
    # Check for extracted directory
    for item in os.listdir(base):
        if 'xiaozhi-esp32' in item.lower():
            full = os.path.join(base, item)
            if os.path.isdir(full):
                log.write(f"\nFound directory: {item}\n")
                # List main dirs
                for sub in os.listdir(full):
                    log.write(f"  {sub}/\n" if os.path.isdir(os.path.join(full, sub)) else f"  {sub}\n")
    
    log.write("\nDone.")
    
print("Status written to check_status.txt")
