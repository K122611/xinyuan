import os

base = r"C:\Users\LENOVO\Desktop\心元\xiaozhi-firmware"

# Check V2 board files in the fresh extraction
extract_dir = os.path.join(base, "xiaozhi-esp32-0d1ffd3f383214bc9b59fc699b77817771fe6a26")
v2_dir = os.path.join(extract_dir, "main", "boards", "waveshare", "esp32-s3-touch-amoled-1.8-v2")

log_path = os.path.join(base, "v2_check.txt")
with open(log_path, 'w', encoding='utf-8') as log:
    log.write(f"V2 directory: {v2_dir}\n")
    if os.path.isdir(v2_dir):
        log.write("V2 board directory EXISTS!\n")
        for f in sorted(os.listdir(v2_dir)):
            fpath = os.path.join(v2_dir, f)
            log.write(f"  {f} ({os.path.getsize(fpath)} bytes)\n" if os.path.isfile(fpath) else f"  {f}/\n")
            if f.endswith('.json'):
                with open(fpath, 'r') as ff:
                    log.write(f"    Content: {ff.read()}\n")
    else:
        log.write("V2 board directory NOT found.\n")
        # List waveshare boards
        ws_dir = os.path.join(extract_dir, "main", "boards", "waveshare")
        if os.path.isdir(ws_dir):
            log.write(f"\nWaveshare boards:\n")
            for d in sorted(os.listdir(ws_dir)):
                log.write(f"  {d}\n")
    
    # Check if there's a build in the existing repo
    build_dir = os.path.join(base, "xiaozhi-esp32", "build")
    log.write(f"\nBuild directory: {build_dir}\n")
    if os.path.isdir(build_dir):
        for f in sorted(os.listdir(build_dir)):
            log.write(f"  {f}\n")
    
    # Check ESP-IDF
    idf_dir = os.path.join(base, "esp-idf-v5.4")
    log.write(f"\nESP-IDF dir: {idf_dir}\n")
    if os.path.isdir(idf_dir):
        idf_export = os.path.join(idf_dir, "export.bat")
        log.write(f"  export.bat exists: {os.path.exists(idf_export)}\n")
        idf_py = os.path.join(idf_dir, "tools", "idf.py")
        log.write(f"  tools/idf.py exists: {os.path.exists(idf_py)}\n")

print("Done. See v2_check.txt")
