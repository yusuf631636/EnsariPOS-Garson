# Gelistirme: EnsariGarsonSrv.cs'yi Windows'un kendi csc.exe'si ile derler (kurulumdaki ayni komut).
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (!(Test-Path $csc)) { $csc = "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe" }
& $csc /nologo /optimize+ /target:exe /out:EnsariGarsonSrv.exe /win32icon:..\assets\garson.ico `
    /reference:System.ServiceProcess.dll /reference:System.Web.Extensions.dll /reference:System.Data.dll `
    /reference:System.Core.dll EnsariGarsonSrv.cs
if ($LASTEXITCODE -ne 0) { throw "Derleme hatasi" }
Get-Item EnsariGarsonSrv.exe | Select-Object Name, Length, LastWriteTime
