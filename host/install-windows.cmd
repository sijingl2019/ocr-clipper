@echo off
rem Double-click to register the OCR Clipper native host for the current user.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1" %*
pause
