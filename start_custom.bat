@echo off
title TransGuard AI Native Launcher
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "%~dp0start_custom.ps1"
pause
