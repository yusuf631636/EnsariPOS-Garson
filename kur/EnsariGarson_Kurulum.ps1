# EnsariPOS Local Garson - Windows servis kurulumu (garsonsys / AlfaSrv kurulum tarzi)
# ==================================================================================
# - Windows'un KENDI C# derleyicisi (csc.exe, .NET Framework 4) ile EnsariGarsonSrv.cs derlenir.
# - "EnsariPOSGarson" Windows servisi kurulur (otomatik baslar, cokerse kendini yeniden baslatir).
# - Guvenlik duvarinda garson portuna (varsayilan 6363) izin verilir.
# Node.js / NSSM / sqlcmd / internet GEREKMEZ. Lisanssiz, ucretsiz, tamamen yerel.
# Windows 7 (PowerShell 2) uyumlu yazilmistir.
param(
    [string]$InstallDir = "C:\EnsariPOS\Garson",
    [switch]$Silent
)
$ErrorActionPreference = "Stop"
$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$SourceRoot  = Split-Path -Parent $ScriptDir
$ServiceName = "EnsariPOSGarson"
$DisplayName = "EnsariPOS Local Garson"
$FwRule      = "EnsariPOS Garson"

function Say([string]$msg, [string]$color) {
    if ($color) { Write-Host $msg -ForegroundColor $color } else { Write-Host $msg }
}

# 1) Yonetici kontrolu
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Say "Lutfen bu kurulumu YONETICI OLARAK calistirin (kur.bat bunu otomatik yapar)." Red
    exit 1
}

Say "--- $DisplayName kurulumu basliyor ---" Cyan
Say "Kurulum klasoru: $InstallDir"

# 2) Dosyalar (klasorden kur.bat ile kuruluyorsa) - EXE kurulumda dosyalar zaten yerinde
if (-not (Test-Path $InstallDir)) { New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null }
$srcFull = (Resolve-Path $SourceRoot).Path.TrimEnd('\')
$dstFull = (Resolve-Path $InstallDir).Path.TrimEnd('\')
$sameDir = ($srcFull -ieq $dstFull)

# 3) Eski servisi durdur/kaldir (eski Node/NSSM surumu dahil)
Say "[1/6] Eski servis kontrol ediliyor..." Yellow
$old = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($old) {
    if ($old.Status -ne 'Stopped') {
        & sc.exe stop $ServiceName | Out-Null
        for ($i = 0; $i -lt 20; $i++) {
            Start-Sleep -Milliseconds 500
            $old = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
            if (-not $old -or $old.Status -eq 'Stopped') { break }
        }
    }
    & sc.exe delete $ServiceName | Out-Null
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 500
        if (-not (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)) { break }
    }
    Say "      Eski servis kaldirildi."
}
Get-Process -Name EnsariGarsonSrv -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

if (-not $sameDir) {
    Say "      Dosyalar kopyalaniyor..."
    foreach ($d in @('www', 'kur')) {
        $s = Join-Path $SourceRoot $d
        if (Test-Path $s) {
            $t = Join-Path $InstallDir $d
            if (-not (Test-Path $t)) { New-Item -ItemType Directory -Force -Path $t | Out-Null }
            Copy-Item (Join-Path $s '*') $t -Recurse -Force
        }
    }
}

# 4) Derleme (garsonsys gibi: Windows'un kendi csc.exe'si)
Say "[2/6] C# servisi derleniyor..." Yellow
$exe = Join-Path $InstallDir "EnsariGarsonSrv.exe"
$cs  = Join-Path $InstallDir "kur\EnsariGarsonSrv.cs"
$ico = Join-Path $InstallDir "kur\alfapos.ico"
$csc = $null
foreach ($c in @("$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe", "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe")) {
    if (Test-Path $c) { $csc = $c; break }
}
$compiled = $false
if ($csc -and (Test-Path $cs)) {
    if (Test-Path $exe) { Remove-Item $exe -Force -ErrorAction SilentlyContinue }
    $cscArgs = @('/nologo', '/optimize+', '/target:exe', "/out:$exe",
                 '/reference:System.ServiceProcess.dll', '/reference:System.Web.Extensions.dll',
                 '/reference:System.Data.dll', '/reference:System.Core.dll')
    if (Test-Path $ico) { $cscArgs += "/win32icon:$ico" }
    $cscArgs += $cs
    $out = & $csc $cscArgs 2>&1
    if ($LASTEXITCODE -eq 0 -and (Test-Path $exe)) { $compiled = $true; Say "      Derlendi: $exe" }
    else { Say "      Derleme basarisiz, hazir surum kullanilacak:" Yellow; $out | ForEach-Object { Say "      $_" } }
} else {
    Say "      .NET Framework 4 derleyicisi bulunamadi, hazir surum kullanilacak." Yellow
}
if (-not $compiled) {
    $pre = Join-Path $InstallDir "kur\EnsariGarsonSrv.prebuilt.exe"
    if (-not (Test-Path $pre)) { Say "HATA: Ne derleme yapilabildi ne de hazir surum var ($pre)." Red; exit 1 }
    Copy-Item $pre $exe -Force
}

# 5) Port (config.json yoksa servis ilk calismada varsayilanla olusturur)
$port = 6363
$cfgPath = Join-Path $InstallDir "config.json"
if (Test-Path $cfgPath) {
    $m = [regex]::Match([IO.File]::ReadAllText($cfgPath), '"port"\s*:\s*(\d+)')
    if ($m.Success) { $port = [int]$m.Groups[1].Value }
}
$busy = netstat -ano | Select-String -Pattern ("TCP\s+\S+:" + $port + "\s+\S+\s+LISTENING\s+(\d+)")
foreach ($b in $busy) {
    $procId = [int]$b.Matches[0].Groups[1].Value
    if ($procId -ne 4 -and $procId -ne 0) {
        $pname = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
        Say "      UYARI: $port portunu baska bir program kullaniyor: $pname (PID $procId). Garson servisi baslayamayabilir." Yellow
    }
}

# 6) Servis
Say "[3/6] Windows servisi kuruluyor (services.msc: $DisplayName)..." Yellow
New-Service -Name $ServiceName -BinaryPathName ('"' + $exe + '"') -DisplayName $DisplayName `
    -Description "$DisplayName - SambaPOS/AlfaPOS icin ucretsiz yerel garson terminali (port $port). EnsariPOS 0537 618 63 16" `
    -StartupType Automatic | Out-Null
& sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/10000/restart/30000 | Out-Null

# 7) Guvenlik duvari (telefonlar bu bilgisayara baglanabilsin)
Say "[4/6] Guvenlik duvari izni veriliyor (TCP $port)..." Yellow
& netsh advfirewall firewall delete rule name="$FwRule" | Out-Null
& netsh advfirewall firewall add rule name="$FwRule" dir=in action=allow protocol=TCP localport=$port profile=any | Out-Null

# 8) SQL erisimi: SambaPOS "Windows kimlik dogrulamasi" kullaniyorsa servis hesabina okuma izni ver
Say "[5/6] SambaPOS veritabani kontrol ediliyor..." Yellow
try {
    $settingsFiles = @("$env:ProgramData\SambaPOS\SambaPOS5\SambaSettings.txt", "$env:ProgramData\AlfaPOS\AlfaPOS5\AlfaSettings.txt")
    $connStr = $null
    foreach ($f in $settingsFiles) {
        if (Test-Path $f) {
            $mm = [regex]::Match([IO.File]::ReadAllText($f), '<ConnectionString>([^<]*)</ConnectionString>')
            if ($mm.Success -and $mm.Groups[1].Value.Trim()) {
                # XML kacislari (PowerShell 2 / .NET 2'de WebUtility yok)
                $connStr = $mm.Groups[1].Value.Trim().Replace('&lt;', '<').Replace('&gt;', '>').Replace('&quot;', '"').Replace('&apos;', "'").Replace('&amp;', '&')
                Say "      Bulundu: $f"
                break
            }
        }
    }
    if (-not $connStr) {
        Say "      SambaSettings.txt / AlfaSettings.txt bulunamadi - config.json'a SQL bilgisi yazilmali." Yellow
    } elseif ($connStr -match '(?i)integrated\s+security\s*=\s*(true|sspi|yes)|trusted_connection\s*=\s*(true|yes)') {
        Say "      Windows kimlik dogrulamasi kullaniliyor - servise okuma izni veriliyor..."
        $b = New-Object System.Data.SqlClient.SqlConnectionStringBuilder($connStr)
        $db = $b.InitialCatalog
        $con = New-Object System.Data.SqlClient.SqlConnection($connStr)
        $con.Open()
        $sql = "IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'NT AUTHORITY\SYSTEM') CREATE LOGIN [NT AUTHORITY\SYSTEM] FROM WINDOWS; " +
               "USE [" + $db.Replace(']', ']]') + "]; IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'NT AUTHORITY\SYSTEM') CREATE USER [NT AUTHORITY\SYSTEM] FOR LOGIN [NT AUTHORITY\SYSTEM]; " +
               "EXEC sp_addrolemember N'db_datareader', N'NT AUTHORITY\SYSTEM';"
        $cmd = $con.CreateCommand(); $cmd.CommandText = $sql; $cmd.ExecuteNonQuery() | Out-Null
        $con.Close()
        Say "      Okuma izni verildi ($db)."
    } else {
        Say "      SQL kullanici adi/sifresi ile baglaniliyor (ek izin gerekmez)."
    }
} catch {
    Say ("      UYARI: SQL izni ayarlanamadi: " + $_.Exception.Message) Yellow
}

# 9) Baslat + saglik kontrolu
Say "[6/6] Servis baslatiliyor..." Yellow
Start-Service -Name $ServiceName
$ok = $false
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        $wc = New-Object System.Net.WebClient
        $wc.Encoding = [System.Text.Encoding]::UTF8
        $health = $wc.DownloadString("http://localhost:$port/api/health")
        $ok = $true
        break
    } catch { }
}

$ips = @()
try {
    Get-WmiObject Win32_NetworkAdapterConfiguration -Filter "IPEnabled = TRUE" | ForEach-Object {
        foreach ($a in $_.IPAddress) { if ($a -match '^\d+\.\d+\.\d+\.\d+$' -and $a -ne '127.0.0.1') { $ips += $a } }
    }
} catch { }
$ips = @($ips | Sort-Object { if ($_ -match '^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)') { 0 } else { 1 } })

Write-Host ""
if ($ok) {
    Say "--- KURULUM BASARIYLA TAMAMLANDI ---" Green
    if ($health -match '"sql":false') { Say "UYARI: SambaPOS veritabanina baglanilamadi. SambaPOS/SQL acik mi? (logs\garson.log)" Yellow }
    if ($health -match '"samba":false') { Say "UYARI: SambaPOS mesaj sunucusuna (9000) ulasilamadi. SambaPOS'ta Mesaj Sunucusu acik mi?" Yellow }
} else {
    Say "Servis kuruldu ama yanit vermedi. $InstallDir\logs\garson.log dosyasina bakin." Yellow
}
Say "Bu bilgisayarda:          http://localhost:$port"
foreach ($ip in $ips) { Say "Garson telefonlarinda:    http://$($ip):$port" Cyan }
Say "Servis: $ServiceName  (bilgisayar acilinca otomatik calisir)"
if ($ok) { exit 0 } else { exit 2 }
