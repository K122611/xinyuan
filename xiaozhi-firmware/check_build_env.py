import os, subprocess, sys

base = r"C:\Users\LENOVO\Desktop\心元\xiaozhi-firmware"
idf_dir = os.path.join(base, "esp-idf-v5.4")
source_dir = os.path.join(base, "xiaozhi-esp32-0d1ffd3f383214bc9b59fc699b77817771fe6a26")
log_path = os.path.join(base, "build_env_check.txt")

with open(log_path, 'w', encoding='utf-8') as log:
    # Check if IDF environment is set up
    log.write("=== ESP-IDF v5.4 Environment Check ===\n\n")
    
    # Check Python virtual env
    python_env = os.path.join(os.path.expanduser("~"), ".espressif", "python_env", "idf5.4_py3.12_env")
    log.write(f"Python venv path: {python_env}\n")
    log.write(f"Exists: {os.path.exists(python_env)}\n")
    if os.path.exists(python_env):
        python_exe = os.path.join(python_env, "Scripts", "python.exe")
        log.write(f"  Python: {python_exe} exists={os.path.exists(python_exe)}\n")
    
    # Check toolchain
    tools_dir = os.path.join(os.path.expanduser("~"), ".espressif", "tools")
    log.write(f"\nTools dir: {tools_dir}\n")
    if os.path.isdir(tools_dir):
        for item in sorted(os.listdir(tools_dir)):
            item_path = os.path.join(tools_dir, item)
            if os.path.isdir(item_path):
                log.write(f"  {item}/\n")
                for sub in sorted(os.listdir(item_path)):
                    log.write(f"    {sub}\n")
    
    # Check if idf.py exists
    idf_py = os.path.join(idf_dir, "tools", "idf.py")
    log.write(f"\nidf.py: {idf_py} exists={os.path.exists(idf_py)}\n")
    
    # Check export script
    export_bat = os.path.join(idf_dir, "export.bat")
    log.write(f"export.bat: {export_bat} exists={os.path.exists(export_bat)}\n")
    
    # Check V2 source directory structure
    log.write(f"\n=== V2 Source Directory ===\n")
    log.write(f"Source: {source_dir}\n")
    log.write(f"Exists: {os.path.isdir(source_dir)}\n")
    if os.path.isdir(source_dir):
        # Check main dir
        main_dir = os.path.join(source_dir, "main")
        cmake = os.path.join(source_dir, "CMakeLists.txt")
        log.write(f"CMakeLists.txt: {os.path.exists(cmake)}\n")
        
        # Check if there's already an sdkconfig
        sdkconfig = os.path.join(source_dir, "sdkconfig")
        log.write(f"sdkconfig exists: {os.path.exists(sdkconfig)}\n")
        
        # List boards
        boards_dir = os.path.join(source_dir, "main", "boards")
        if os.path.isdir(boards_dir):
            log.write(f"\nBoard directories:\n")
            for d in sorted(os.listdir(boards_dir)):
                log.write(f"  {d}\n")
    
    # Check if CMake is available
    log.write(f"\n=== System Tools ===\n")
    try:
        result = subprocess.run(["cmake", "--version"], capture_output=True, text=True, timeout=10)
        log.write(f"CMake: {result.stdout.split(chr(10))[0]}\n")
    except:
        log.write("CMake: NOT FOUND in PATH\n")
    
    try:
        result = subprocess.run(["ninja", "--version"], capture_output=True, text=True, timeout=10)
        log.write(f"Ninja: {result.stdout.strip()}\n")
    except:
        log.write("Ninja: NOT FOUND in PATH\n")

print("Done. See build_env_check.txt")
