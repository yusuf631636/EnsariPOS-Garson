# EnsariPOS Garson APK derleme (Cordova). Cikti: ..\dist\EnsariPOSGarson.apk
# Debug anahtariyla imzalanir (C:\Users\Administrator\.android\debug.keystore) - yayindaki eski
# APK da bununla imzali, ayni anahtar olmazsa telefonda "guncelle" yerine hata verir.
# Surum: config.xml icindeki version (1.0.2 -> versionCode 10002); her yayinda artirin.
# Stop KULLANILMAZ: javac/gradle uyarilari stderr'e yazar, PowerShell 5.1 bunlari hata sanar
$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot
$env:JAVA_HOME = "C:\jdk17"
$env:ANDROID_HOME = "C:\Android\Sdk"; $env:ANDROID_SDK_ROOT = "C:\Android\Sdk"
$env:Path = "C:\jdk17\bin;C:\Android\gradle-extract\gradle-8.13\bin;" + $env:Path
if (!(Test-Path "platforms\android")) { cordova platform add android; if ($LASTEXITCODE -ne 0) { throw "platform add hatasi" } }
cordova build android --debug
if ($LASTEXITCODE -ne 0) { throw "Derleme hatasi" }
$apk = "platforms\android\app\build\outputs\apk\debug\app-debug.apk"
New-Item -ItemType Directory -Force ..\dist | Out-Null
Copy-Item $apk ..\dist\EnsariPOSGarson.apk -Force
Get-Item ..\dist\EnsariPOSGarson.apk | Select-Object FullName, Length, LastWriteTime
