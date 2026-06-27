@echo off
setlocal enabledelayedexpansion
set "DIST=C:\Users\LENOVO\.espressif\dist"
set "URL=https://github.com/espressif/crosstool-NG/releases/download/esp-14.2.0_20241119/xtensa-esp-elf-14.2.0_20241119-x86_64-w64-mingw32.zip"
set "FILE=%DIST%\xtensa-esp-elf-14.2.0_20241119-x86_64-w64-mingw32.zip"

:: Try mirror
echo Trying ghproxy mirror...
curl -L -o "%FILE%.tmp" "https://ghproxy.com/%URL%" 2>&1
if %ERRORLEVEL% equ 0 (
    move /y "%FILE%.tmp" "%FILE%"
    echo SUCCESS via ghproxy
) else (
    echo ghproxy failed, trying fastgit...
    curl -L -o "%FILE%.tmp" "https://download.fastgit.org/espressif/crosstool-NG/releases/download/esp-14.2.0_20241119/xtensa-esp-elf-14.2.0_20241119-x86_64-w64-mingw32.zip" 2>&1
    if !ERRORLEVEL! equ 0 (
        move /y "%FILE%.tmp" "%FILE%"
        echo SUCCESS via fastgit
    ) else (
        echo All mirrors failed, trying direct download with resume...
        curl -L -o "%FILE%" "%URL%" 2>&1
    )
)
