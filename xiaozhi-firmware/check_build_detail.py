import os, json

base = r"C:\Users\LENOVO\Desktop\心元\xiaozhi-firmware"
build_dir = os.path.join(base, "xiaozhi-esp32", "build")

log_path = os.path.join(base, "build_detail.txt")
with open(log_path, 'w', encoding='utf-8') as log:
    # Check flasher_args.json for info about what was built
    flasher_args = os.path.join(build_dir, "flasher_args.json")
    if os.path.exists(flasher_args):
        with open(flasher_args, 'r') as f:
            log.write(f"=== flasher_args.json ===\n{f.read()}\n\n")
    
    # Check project_description.json
    proj_desc = os.path.join(build_dir, "project_description.json")
    if os.path.exists(proj_desc):
        with open(proj_desc, 'r') as f:
            log.write(f"=== project_description.json ===\n{f.read()}\n\n")
    
    # Check sdkconfig for board
    sdkconfig = os.path.join(base, "xiaozhi-esp32", "sdkconfig")
    if os.path.exists(sdkconfig):
        log.write("=== sdkconfig board-related lines ===\n")
        with open(sdkconfig, 'r') as f:
            for line in f:
                if any(kw in line.upper() for kw in ['BOARD', 'TARGET', 'LCD', 'AMOLED', 'TCA', 'WAVESHARE']):
                    log.write(f"  {line.rstrip()}\n")
    
    # List .bin files in build
    log.write("\n=== .bin files in build ===\n")
    for f in sorted(os.listdir(build_dir)):
        if f.endswith('.bin'):
            fp = os.path.join(build_dir, f)
            log.write(f"  {f}: {os.path.getsize(fp)} bytes\n")
    
    # Check ESP-IDF installation details
    idf_dir = os.path.join(base, "esp-idf-v5.4")
    idf_ver = os.path.join(idf_dir, "version.txt")
    if os.path.exists(idf_ver):
        log.write(f"\n=== ESP-IDF version ===\n")
        with open(idf_ver) as f:
            log.write(f.read())
    
    # Check for python virtual env
    venv_py = os.path.join(idf_dir, "tools", "idf_tools.py")
    log.write(f"\nidf_tools.py exists: {os.path.exists(venv_py)}\n")
    
    # Check if ESP-IDF tools are installed
    tools_dir = os.path.join(os.path.expanduser("~"), ".espressif")
    if os.path.isdir(tools_dir):
        log.write(f"\n.espressif dir exists\n")
        for item in os.listdir(tools_dir):
            log.write(f"  {item}\n")

print("Done. See build_detail.txt")
