# =====================================================================
# TransGuard AI — Native / Custom Windows Launcher (No Docker Required)
# =====================================================================

$ErrorActionPreference = "Continue"
$RootPath = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $RootPath

Write-Host ""
Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host "   TRANS GUARD AI — Native Launcher (Custom Windows Environment)" -ForegroundColor Cyan
Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------------------
# 1. Stop Docker containers if running to avoid port 5000 / 8554 conflicts
# ---------------------------------------------------------------------
Write-Host "[1/5] Checking for running Docker containers..." -ForegroundColor Yellow
try {
    $dockerRunning = docker ps -q --filter "name=transguard" 2>$null
    if ($dockerRunning) {
        Write-Host "  -> Stopping Docker containers to free up ports 5000, 8554, 8889..." -ForegroundColor Gray
        docker compose down 2>$null
        Write-Host "  -> Docker containers stopped successfully." -ForegroundColor Green
    } else {
        Write-Host "  -> No conflicting Docker containers found." -ForegroundColor DarkGreen
    }
} catch {
    Write-Host "  -> Docker check skipped." -ForegroundColor Gray
}

# ---------------------------------------------------------------------
# 2. Check MongoDB service
# ---------------------------------------------------------------------
Write-Host "`n[2/5] Checking native MongoDB service..." -ForegroundColor Yellow
$mongoRunning = $false
try {
    $tcp = New-Object Net.Sockets.TcpClient
    $tcp.Connect("127.0.0.1", 27017)
    $tcp.Close()
    $mongoRunning = $true
    Write-Host "  -> MongoDB is running on port 27017." -ForegroundColor Green
} catch {
    Write-Host "  -> MongoDB not listening on port 27017. Attempting to start Windows service..." -ForegroundColor Yellow
    try {
        Start-Service -Name MongoDB -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        $tcp = New-Object Net.Sockets.TcpClient
        $tcp.Connect("127.0.0.1", 27017)
        $tcp.Close()
        $mongoRunning = $true
        Write-Host "  -> MongoDB service started successfully!" -ForegroundColor Green
    } catch {
        Write-Host "  -> WARNING: Could not connect to MongoDB on 127.0.0.1:27017." -ForegroundColor Red
        Write-Host "     Please ensure MongoDB is started: net start MongoDB" -ForegroundColor Red
    }
}

# ---------------------------------------------------------------------
# 3. Start MediaMTX Streaming Server (WebRTC / RTSP Gateway)
# ---------------------------------------------------------------------
Write-Host "`n[3/5] Starting MediaMTX WebRTC & RTSP Gateway..." -ForegroundColor Yellow
$mediamtxExe = Join-Path $RootPath "mediamtx\mediamtx.exe"
if (Test-Path $mediamtxExe) {
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$RootPath\mediamtx'; `$host.UI.RawUI.WindowTitle = 'MediaMTX Streaming Server (Port 8554/8888/8889)'; Write-Host '--- MediaMTX Streaming Gateway (WebRTC / RTSP) ---' -ForegroundColor Cyan; .\mediamtx.exe"
    Write-Host "  -> MediaMTX launched in separate window." -ForegroundColor Green
} else {
    Write-Host "  -> NOTICE: mediamtx\mediamtx.exe not found. Live WebRTC camera feeds will be offline." -ForegroundColor DarkYellow
}
Start-Sleep -Seconds 1

# ---------------------------------------------------------------------
# 4. Start Node.js Backend & Dashboard Server (Port 5000)
# ---------------------------------------------------------------------
Write-Host "`n[4/5] Starting Node.js Backend & Web Dashboard (Port 5000)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$RootPath'; `$host.UI.RawUI.WindowTitle = 'TransGuard Backend & Dashboard (Port 5000)'; Write-Host '--- TransGuard AI Backend (Port 5000) ---' -ForegroundColor Cyan; node server.js"
Write-Host "  -> Backend server launched in separate window." -ForegroundColor Green

Start-Sleep -Seconds 3

# Open browser
Start-Process "http://localhost:5000"

# ---------------------------------------------------------------------
# 5. Launch Python AI Edge Engine
# ---------------------------------------------------------------------
Write-Host "`n[5/5] Configure AI Edge Vision Engine:" -ForegroundColor Cyan
Write-Host "Select camera source to process with YOLOv8 & Facial Recognition:"
Write-Host "  [1] RTSP IP Camera (e.g. rtsp://192.168.18.189:554/stream)" -ForegroundColor White
Write-Host "  [2] Mobile Camera (IP Webcam app: http://<PHONE_IP>:8080/video)" -ForegroundColor White
Write-Host "  [3] Built-in Laptop / USB Webcam (Device 0)" -ForegroundColor White
Write-Host "  [4] Skip engine (Dashboard & API only)" -ForegroundColor Gray
Write-Host ""

$choice = Read-Host "Choose option [1-4] (Default is 3 - USB Webcam)"
if ([string]::IsNullOrWhiteSpace($choice)) { $choice = "3" }

$camUrl = ""
$camId = "cam0"

switch ($choice) {
    "1" {
        $camUrl = Read-Host "Enter RTSP Stream URL (e.g. rtsp://192.168.18.189:554/stream)"
        if ($camUrl.ToLower().StartsWith("rstp://")) {
            $camUrl = "rtsp://" + $camUrl.Substring(7)
        }
    }
    "2" {
        $camUrl = Read-Host "Enter Phone Camera URL (e.g. http://192.168.1.50:8080/video)"
    }
    "3" {
        $camUrl = "0"
        Write-Host "Using local webcam device 0." -ForegroundColor Green
    }
    "4" {
        Write-Host "Skipping Python engine. Dashboard is running at http://localhost:5000" -ForegroundColor Green
    }
    Default {
        $camUrl = "0"
    }
}

if (![string]::IsNullOrWhiteSpace($camUrl)) {
    $pythonCmd = if (Test-Path "$RootPath\transguard-env\Scripts\python.exe") { "$RootPath\transguard-env\Scripts\python.exe" } else { "python" }
    Write-Host "`nLaunching AI Edge Engine for Camera '$camId' with input '$camUrl'..." -ForegroundColor Green
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$RootPath'; `$host.UI.RawUI.WindowTitle = 'TransGuard AI Vision Engine ($camId)'; Write-Host '--- TransGuard AI Vision Engine ($camId) ---' -ForegroundColor Cyan; & '$pythonCmd' trans_guard_engine.py --camera $camId --url '$camUrl' --backend http://localhost:5000"
    Write-Host "  -> Python engine launched in separate window." -ForegroundColor Green
}

Write-Host "`n=====================================================================" -ForegroundColor Green
Write-Host "   TransGuard AI is now running natively without Docker!" -ForegroundColor Green
Write-Host "   Operator Dashboard : http://localhost:5000" -ForegroundColor Cyan
Write-Host "   Default Login      : admin / TransGuard@2026!" -ForegroundColor White
Write-Host "=====================================================================" -ForegroundColor Green
