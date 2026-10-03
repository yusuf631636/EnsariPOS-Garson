@echo off
:: EnsariPOS Local Garson servisini yeniden baslatir (yonetici izni ister)
net session >nul 2>&1
if %errorLevel% neq 0 (
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)
echo EnsariPOS Local Garson yeniden baslatiliyor...
sc stop EnsariPOSGarson >nul 2>&1
ping -n 3 127.0.0.1 >nul
sc start EnsariPOSGarson
ping -n 3 127.0.0.1 >nul
start "" "http://localhost:6363"
