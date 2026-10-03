@echo off
setlocal
cd /d "%~dp0"
title EnsariPOS Local Garson - Kurulum

:: Yonetici izni kontrolu (garsonsys kur.bat ile ayni yontem)
net session >nul 2>&1
if %errorLevel% == 0 (
    goto :run
) else (
    echo Yonetici izinleri aliniyor...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

:run
powershell -NoProfile -ExecutionPolicy Bypass -File "EnsariGarson_Kurulum.ps1" -InstallDir "C:\EnsariPOS\Garson"
echo.
pause
