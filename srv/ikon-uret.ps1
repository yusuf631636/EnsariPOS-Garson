# Uygulama simgeleri (30.09.2026: yeni garson logosu - papyonlu garson + servis tepsisi).
# Cizim: ..\logo\garson-logo.svg (kaynak). PNG'ler ..\logo\png, ICO ..\logo\garson.ico.
# Bu betik hazir dosyalari www ve assets'e kopyalar; APK ikonlari ..\apk\res\ altindadir.
$logo = Join-Path $PSScriptRoot "..\logo"
Copy-Item (Join-Path $logo "png\app-icon-192.png") (Join-Path $PSScriptRoot "..\www\images\app-icon-192.png") -Force
Copy-Item (Join-Path $logo "png\app-icon-512.png") (Join-Path $PSScriptRoot "..\www\images\app-icon-512.png") -Force
Copy-Item (Join-Path $logo "garson.ico") (Join-Path $PSScriptRoot "..\www\favicon.ico") -Force
Copy-Item (Join-Path $logo "garson.ico") (Join-Path $PSScriptRoot "..\assets\garson.ico") -Force
Get-ChildItem (Join-Path $PSScriptRoot "..\www\images\app-icon-*.png") | Select-Object Name, Length
