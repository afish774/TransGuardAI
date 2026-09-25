@echo off
title TransGuard AI — Mobile Camera Demo Launcher
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run_mobile_demo.ps1"
pause
