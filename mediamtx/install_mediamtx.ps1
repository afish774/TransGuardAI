# ==========================================
# TRANS GUARD AI — MediaMTX Installer (Windows)
# ==========================================
# Downloads and extracts the latest MediaMTX release.
# Run: powershell -ExecutionPolicy Bypass -File install_mediamtx.ps1

$ErrorActionPreference = "Stop"
$VERSION = "v1.12.2"
$ARCH = "windows_amd64"
$URL = "https://github.com/bluenviron/mediamtx/releases/download/$VERSION/mediamtx_${VERSION}_${ARCH}.zip"
$DEST = $PSScriptRoot

Write-Host "[MediaMTX] Downloading MediaMTX $VERSION for $ARCH..." -ForegroundColor Cyan
$zipPath = Join-Path $DEST "mediamtx.zip"
Invoke-WebRequest -Uri $URL -OutFile $zipPath -UseBasicParsing

Write-Host "[MediaMTX] Extracting..." -ForegroundColor Cyan
Expand-Archive -Path $zipPath -DestinationPath $DEST -Force
Remove-Item $zipPath

$exePath = Join-Path $DEST "mediamtx.exe"
if (Test-Path $exePath) {
    Write-Host "[MediaMTX] Installation complete!" -ForegroundColor Green
    Write-Host "[MediaMTX] Binary: $exePath" -ForegroundColor Green
    Write-Host "[MediaMTX] To start: cd mediamtx && .\mediamtx.exe mediamtx.yml" -ForegroundColor Yellow
} else {
    Write-Host "[MediaMTX] ERROR: mediamtx.exe not found after extraction." -ForegroundColor Red
    exit 1
}
