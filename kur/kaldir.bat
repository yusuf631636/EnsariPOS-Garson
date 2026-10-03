@echo off
setlocal
cd /d "%~dp0"
title EnsariPOS Local Garson - Kaldirma

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Yonetici izinleri aliniyor...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

echo ==========================================
echo   EnsariPOS Local Garson - Kaldirma
echo ==========================================
echo  Servis durdurulup silinecek ve guvenlik duvari
echo  kurali kaldirilacak. Ayarlar (data) korunur.
echo.
choice /C EH /N /M "Devam etmek istiyor musunuz? (E)vet / (H)ayir: "
if errorlevel 2 (
    echo Iptal edildi.
    pause
    exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "kaldir.ps1"
echo.
pause
