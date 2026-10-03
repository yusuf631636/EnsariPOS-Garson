@echo off
rem EnsariPOS Garson Direkt - SambaPOS bilgisayari hazirligi. Yonetici olarak yeniden baslar (guvenlik duvari icin).
net session >nul 2>&1 || (powershell -NoProfile -Command "Start-Process -Verb RunAs -FilePath '%~f0'" & exit /b)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0GarsonDirekt-Hazirlik.ps1"
