# EnsariPOS Local Garson - servisi ve guvenlik duvari kuralini kaldirir (dosyalara dokunmaz).
param([switch]$Silent)
$ErrorActionPreference = "SilentlyContinue"
$ServiceName = "EnsariPOSGarson"
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc) {
    & sc.exe stop $ServiceName | Out-Null
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 500
        $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
        if (-not $svc -or $svc.Status -eq 'Stopped') { break }
    }
    & sc.exe delete $ServiceName | Out-Null
    Write-Host "$ServiceName servisi kaldirildi." -ForegroundColor Yellow
}
Get-Process -Name EnsariGarsonSrv -ErrorAction SilentlyContinue | Stop-Process -Force
& netsh advfirewall firewall delete rule name="EnsariPOS Garson" | Out-Null
Write-Host "Guvenlik duvari kurali kaldirildi."
