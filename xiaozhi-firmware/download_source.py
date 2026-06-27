import urllib.request
import zipfile
import os
import sys

# Download the source code at the specific commit for V2 hardware support
commit_sha = "0d1ffd3f383214bc9b59fc699b77817771fe6a26"
url = f"https://github.com/78/xiaozhi-esp32/archive/{commit_sha}.zip"
output_dir = r"C:\Users\LENOVO\Desktop\心元\xiaozhi-firmware"
zip_path = os.path.join(output_dir, "xiaozhi-esp32-source.zip")
extract_dir = os.path.join(output_dir, f"xiaozhi-esp32-{commit_sha}")

print(f"Downloading source from: {url}")
print(f"Saving to: {zip_path}")

try:
    # Download with progress
    def report_progress(block_num, block_size, total_size):
        downloaded = block_num * block_size
        if total_size > 0:
            percent = min(100, downloaded * 100 // total_size)
            sys.stdout.write(f"\rDownloading... {percent}% ({downloaded}/{total_size} bytes)")
            sys.stdout.flush()
    
    urllib.request.urlretrieve(url, zip_path, report_progress)
    print(f"\nDownload complete! Size: {os.path.getsize(zip_path)} bytes")
    
    # Extract
    print(f"Extracting to: {extract_dir}")
    with zipfile.ZipFile(zip_path, 'r') as zf:
        zf.extractall(output_dir)
    
    print("Extraction complete!")
    
    # Verify the key V2 files exist
    v2_dir = os.path.join(extract_dir, "main", "boards", "waveshare", "esp32-s3-touch-amoled-1.8-v2")
    if os.path.isdir(v2_dir):
        print(f"V2 board directory found: {v2_dir}")
        for f in os.listdir(v2_dir):
            print(f"  - {f}")
    else:
        print("WARNING: V2 board directory not found!")
        # List waveshare boards
        ws_dir = os.path.join(extract_dir, "main", "boards", "waveshare")
        if os.path.isdir(ws_dir):
            print(f"Available boards: {os.listdir(ws_dir)}")
    
except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
