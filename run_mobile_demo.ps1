# =========================================================
# TransGuard AI — 1-Click Mobile RTSP/HTTP Camera Demo Launcher
# Public Transportation Real-Time AI Surveillance
# =========================================================

Write-Host ""
Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host " 🛡️ TransGuard AI — Public Transportation Mobile Demo" -ForegroundColor Cyan
Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host "Real-time edge AI inference running on live mobile phone video" -ForegroundColor Yellow
Write-Host ""

$RootPath = Split-Path -Parent $MyInvocation.MyCommand.Definition

# 1. Check MongoDB
Write-Host "[1/5] Verifying MongoDB..." -ForegroundColor Green
try {
    $tcp = New-Object Net.Sockets.TcpClient
    $tcp.Connect("127.0.0.1", 27017)
    $tcp.Close()
    Write-Host "  -> MongoDB is running on port 27017." -ForegroundColor DarkGreen
} catch {
    Write-Host "  -> WARNING: MongoDB port 27017 not reachable! Starting background service or ensure MongoDB is active." -ForegroundColor Yellow
}

# 2. Start Backend
Write-Host "[2/5] Starting Node.js Backend (Port 5000)..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$RootPath'; Write-Host '--- TransGuard Backend (Port 5000) ---' -ForegroundColor Cyan; node server.js"
Start-Sleep -Seconds 3

# 3. Start MediaMTX (WebRTC server)
Write-Host "[3/5] Starting MediaMTX WebRTC Streaming Server..." -ForegroundColor Green
$mediamtxExe = Join-Path $RootPath "mediamtx\mediamtx.exe"
if (Test-Path $mediamtxExe) {
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$RootPath\mediamtx'; Write-Host '--- MediaMTX WebRTC Server ---' -ForegroundColor Cyan; .\mediamtx.exe"
} else {
    Write-Host "  -> MediaMTX executable not found in mediamtx\ directory. WebRTC live player may be disabled." -ForegroundColor Yellow
}
Start-Sleep -Seconds 2

# 4. Start Frontend
Write-Host "[4/5] Starting Vite Operator Dashboard (Port 5173)..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$RootPath\frontend'; Write-Host '--- TransGuard Operator UI (Port 5173) ---' -ForegroundColor Cyan; npm run dev"
Start-Sleep -Seconds 3

# 5. Prompt for Mobile Camera Feed
Write-Host ""
Write-Host "[5/5] Configure Mobile Camera Feed:" -ForegroundColor Cyan
Write-Host "Open your mobile camera streaming app (e.g. IP Webcam on Android or Live-Reporter on iOS)."
Write-Host "Make sure your phone is connected to the same Wi-Fi network as this PC."
Write-Host ""
$defaultUrl = "http://192.168.1.50:8080/video"
Write-Host "Common formats:" -ForegroundColor Gray
Write-Host "  - Android (IP Webcam): http://<PHONE_IP>:8080/video" -ForegroundColor Gray
Write-Host "  - Android/iOS (RTSP):  rtsp://<PHONE_IP>:8554/live" -ForegroundColor Gray
Write-Host "  - Local Test Webcam:   0" -ForegroundColor Gray
Write-Host ""
$userUrl = Read-Host "Enter mobile stream URL (Press ENTER for default [$defaultUrl])"
if ([string]::IsNullOrWhiteSpace($userUrl)) {
    $userUrl = $defaultUrl
}

Write-Host ""
Write-Host "Launching 6-Pillar AI Edge Inference Engine..." -ForegroundColor Cyan
Write-Host "Connected stream: $userUrl" -ForegroundColor Yellow
Write-Host "Vehicle context: Public Transit Bus (BUS_001)" -ForegroundColor DarkGray
Write-Host ""

# Open browser to dashboard
Start-Process "http://localhost:5173"

# Start Python Engine in current window
Set-Location $RootPath
$pythonCmd = if (Test-Path "$RootPath\transguard-env\Scripts\python.exe") { "$RootPath\transguard-env\Scripts\python.exe" } else { "python" }
& $pythonCmd trans_guard_engine.py --camera CAM_01 --url $userUrl --backend-url http://localhost:5000 --vehicle-id BUS_001
