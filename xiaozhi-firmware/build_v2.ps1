$ErrorActionPreference = "Continue"
$logFile = "C:\Users\LENOVO\Desktop\心元\xiaozhi-firmware\build_log.txt"
$idfPath = "C:\Users\LENOVO\Desktop\心元\xiaozhi-firmware\esp-idf-v5.4"
$projPath = "C:\Users\LENOVO\Desktop\心元\xiaozhi-firmware\xiaozhi-esp32-0d1ffd3f383214bc9b59fc699b77817771fe6a26"

function Write-Log {
    param([string]$msg)
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Add-Content -Path $logFile -Value $line
    Write-Host $line
}

Write-Log "========== BUILD_V2 START =========="
Write-Log "IDF_PATH=$idfPath"
Write-Log "Project=$projPath"

# Step 1: Set environment
$env:IDF_PATH = $idfPath
Write-Log "Step 1: Set IDF_PATH done"

# Step 2: Source export.bat (convert to env vars)
Write-Log "Step 2: Running export.bat..."
$exportOutput = cmd /c "call `"$idfPath\export.bat`" 2>&1 && set" 2>&1
foreach ($line in $exportOutput) {
    if ($line -match '^([^=]+)=(.*)$') {
        $name = $Matches[1].Trim()
        $value = $Matches[2].Trim()
        if ($name -notmatch '^(PROMPT|_|USER|COMPUTER|HOME|PATH_EXT|SYSTEM|PROCESSOR|COMMON|PATHEXT|ALLUSER|APPDATA|COMSPEC|HOMEDRIVE|HOMEPATH|LOCALAPPDATA|LOGONSERVER|NUMBER|OS|PSModulePath|PUBLIC|SESSIONNAME|SystemDrive|SystemRoot|TEMP|TMP|USERDOMAIN|USERNAME|USERPROFILE|windir|WINDOWS)') {
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
}
Write-Log "Step 2: export.bat done, env vars loaded"

# Step 3: Go to project dir and set target
Set-Location $projPath
Write-Log "Step 3: cd to project dir"

Write-Log "Step 4: idf.py set-target esp32s3"
$result = cmd /c "idf.py set-target esp32s3" 2>&1
$result | ForEach-Object { Write-Log "[set-target] $_" }
Write-Log "set-target exit code: $LASTEXITCODE"

# Step 4: Append sdkconfig
Write-Log "Step 5: Appending board config to sdkconfig..."
$sdkconfig = Join-Path $projPath "sdkconfig"
if (Test-Path $sdkconfig) {
    $content = Get-Content $sdkconfig -Raw
    if ($content -notmatch "CONFIG_BOARD_TYPE_WAVESHARE_ESP32_S3_TOUCH_AMOLED_1_8_V2=y") {
        Add-Content -Path $sdkconfig -Value "`nCONFIG_BOARD_TYPE_WAVESHARE_ESP32_S3_TOUCH_AMOLED_1_8_V2=y"
        Write-Log "Added BOARD_TYPE_V2 config"
    } else {
        Write-Log "BOARD_TYPE_V2 already in sdkconfig"
    }
    if ($content -notmatch "CONFIG_USE_WECHAT_MESSAGE_STYLE=y") {
        Add-Content -Path $sdkconfig -Value "CONFIG_USE_WECHAT_MESSAGE_STYLE=y"
        Write-Log "Added WECHAT_MESSAGE_STYLE config"
    } else {
        Write-Log "WECHAT_MESSAGE_STYLE already in sdkconfig"
    }
} else {
    Write-Log "WARNING: sdkconfig not found, creating..."
    "CONFIG_BOARD_TYPE_WAVESHARE_ESP32_S3_TOUCH_AMOLED_1_8_V2=y" | Out-File -FilePath $sdkconfig -Encoding ascii
    "CONFIG_USE_WECHAT_MESSAGE_STYLE=y" | Add-Content -Path $sdkconfig
}

# Step 5: Build
Write-Log "Step 6: idf.py build (this may take 10-20 minutes)..."
$buildResult = cmd /c "idf.py build 2>&1"
$buildResult | ForEach-Object { Write-Log "[build] $_" }
Write-Log "build exit code: $LASTEXITCODE"

# Check for output files
$buildDir = Join-Path $projPath "build"
if (Test-Path $buildDir) {
    Write-Log "Build directory contents:"
    Get-ChildItem $buildDir -Recurse -Name | ForEach-Object { Write-Log "  $_" }
}

Write-Log "========== BUILD_V2 END =========="
