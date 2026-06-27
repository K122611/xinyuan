import os

base = r"C:\Users\LENOVO\Desktop\心元\xiaozhi-firmware"

# Check if existing xiaozhi-esp32 has V2 files
v2_in_existing = os.path.join(base, "xiaozhi-esp32", "main", "boards", "waveshare", "esp32-s3-touch-amoled-1.8-v2")
log_path = os.path.join(base, "existing_check.txt")
with open(log_path, 'w', encoding='utf-8') as log:
    log.write(f"V2 in existing: {v2_in_existing}\n")
    log.write(f"Exists: {os.path.isdir(v2_in_existing)}\n")
    
    # Check existing build's target from CMakeCache
    cmake_cache = os.path.join(base, "xiaozhi-esp32", "build", "CMakeCache.txt")
    if os.path.exists(cmake_cache):
        log.write(f"\nCMakeCache.txt exists, checking target...\n")
        with open(cmake_cache, 'r') as f:
            for line in f:
                if 'IDF_TARGET' in line or 'BOARD' in line.upper() or 'SDKCONFIG' in line.upper():
                    log.write(f"  {line.rstrip()}\n")
    
    # Check what commit the existing repo is at
    git_head = os.path.join(base, "xiaozhi-esp32", ".git", "HEAD")
    if os.path.exists(git_head):
        log.write(f"\nGit HEAD:\n")
        with open(git_head, 'r') as f:
            log.write(f"  {f.read()}\n")
    
    # Also check if build output exists (merged binary)
    build_out = os.path.join(base, "xiaozhi-esp32", "build")
    for f in sorted(os.listdir(build_out)):
        if f.endswith('.bin') and 'merged' in f.lower():
            fp = os.path.join(build_out, f)
            log.write(f"\nMerged binary: {f} ({os.path.getsize(fp)} bytes)\n")
        elif f.endswith('.bin') and 'xiaozhi' in f.lower():
            fp = os.path.join(build_out, f)
            log.write(f"\nXiaozhi binary: {f} ({os.path.getsize(fp)} bytes)\n")

print("Done. See existing_check.txt")
