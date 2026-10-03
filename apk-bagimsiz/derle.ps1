# EnsariPOS Garson Direkt APK derleme. Cikti: dist\EnsariGarsonDirekt.apk
# 1) ..\www (mevcut Garson ekranlari) -> app\www kopyalanir (www'ya DOKUNULMAZ)
# 2) Her sayfaya en basa ek\bagimsiz.js, sona ek\yama.js eklenir; kurulum.html eklenir
# 3) Cordova derler (debug anahtari - mevcut Garson APK'si gibi; uygulama kimligi farkli oldugu icin ikisi yan yana kurulur)
# Surum: app\config.xml version + ek\bagimsiz.js APP_VERSION; her yayinda ikisini de artirin.
$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot
$src = Resolve-Path "..\www"
$www = Join-Path $PSScriptRoot "app\www"
if (Test-Path $www) { Remove-Item $www -Recurse -Force }
New-Item -ItemType Directory -Force $www | Out-Null
# mutfak/telefon-bagla/eski x sayfasi bu uygulamada yok
$skip = @('mutfak.html', 'baglan.html', 'x.html', 'manifest.json')
Get-ChildItem $src | Where-Object { $skip -notcontains $_.Name } | ForEach-Object { Copy-Item $_.FullName -Destination $www -Recurse -Force }
Copy-Item ek\bagimsiz.js, ek\yama.js, ek\kurulum.html -Destination $www -Force

$utf8 = New-Object System.Text.UTF8Encoding($false)
foreach ($f in Get-ChildItem $www -Filter *.html) {
    if ($f.Name -eq 'kurulum.html') { continue }
    $t = [IO.File]::ReadAllText($f.FullName, [Text.Encoding]::UTF8)
    # <head> acilir acilmaz (eg-settings.js / jQuery'den ONCE) baglanti katmani
    $t = ([regex]'(<head(\s[^>]*)?>)').Replace($t, '$1' + "`r`n    <script src=`"bagimsiz.js`"></script>", 1)
    # Config: gercek cordova.js (Sunucu Bul icin Wi-Fi adresi eklentisi)
    if ($f.Name -eq 'Config.html') { $t = $t.Replace('<script src="bagimsiz.js"></script>', '<script src="cordova.js"></script>' + "`r`n    " + '<script src="bagimsiz.js"></script>') }
    $t = $t.Replace('</body>', '<script src="yama.js"></script>' + "`r`n</body>")
    $t = $t.Replace('<title>EnsariPOS Local Garson</title>', '<title>Garson Direkt</title>')
    [IO.File]::WriteAllText($f.FullName, $t, $utf8)
}
if ($args -contains '-sadeceWww') { Write-Host "app\www hazir (derleme yapilmadi)"; return }

Set-Location app
if (!(Test-Path res)) { Copy-Item ..\..\apk\res -Destination res -Recurse }
$env:JAVA_HOME = "C:\jdk17"
$env:ANDROID_HOME = "C:\Android\Sdk"; $env:ANDROID_SDK_ROOT = "C:\Android\Sdk"
$env:Path = "C:\jdk17\bin;C:\Android\gradle-extract\gradle-8.13\bin;" + $env:Path
if (!(Test-Path node_modules)) { Copy-Item ..\..\apk\node_modules -Destination node_modules -Recurse }
if (!(Test-Path "platforms\android")) { cordova platform add android; if ($LASTEXITCODE -ne 0) { throw "platform add hatasi" } }
cordova build android --debug
if ($LASTEXITCODE -ne 0) { throw "Derleme hatasi" }
New-Item -ItemType Directory -Force ..\dist | Out-Null
Copy-Item "platforms\android\app\build\outputs\apk\debug\app-debug.apk" ..\dist\EnsariGarsonDirekt.apk -Force
Get-Item ..\dist\EnsariGarsonDirekt.apk | Select-Object FullName, Length, LastWriteTime
