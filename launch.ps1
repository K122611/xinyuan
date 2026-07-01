<# XinYuan EMO-Mate Launcher #>
$ErrorActionPreference = "Continue"

$projectDir = $PSScriptRoot
$nodeDir = Join-Path $projectDir "nodejs\node-v22.12.0-win-x64"
$env:Path = "$nodeDir;$env:Path"

Set-Location $projectDir

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  XinYuan EMO-Mate v1.0.11" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$nodeExe = Join-Path $nodeDir "node.exe"
$npmCmd = Join-Path $nodeDir "npm.cmd"

if (-not (Test-Path $nodeExe)) {
    Write-Host "ERROR: node.exe not found" -ForegroundColor Red
    pause; exit 1
}

Write-Host "Starting Vite + Electron (electron:dev)..." -ForegroundColor Yellow
Write-Host ""

& $npmCmd run electron:dev

Write-Host ""
Write-Host "App closed."
pause
