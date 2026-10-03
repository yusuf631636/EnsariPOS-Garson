# EnsariPOS Garson Direkt - SambaPOS bilgisayari hazirligi (restoran bilgisayarinda BIR KEZ, yonetici olarak).
# 1) SambaPOS veritabanina "EnsariGarson" uygulama kaydi ekler (yoksa) - sadece GraphqlClients tablosu
# 2) Windows guvenlik duvarinda SambaPOS mesaj sunucusu portunu (9000) yerel aga acar
# 3) Mesaj sunucusunun calistigini kontrol eder ve telefonda yazilacak adresleri gosterir
# Sifre/PIN SORMAZ ve hicbir yere yazmaz. Baglanti kullanicisi SambaPOS'ta elle olusturulur (asagidaki not).
$ErrorActionPreference = 'Stop'
function Ok($s) { Write-Host ("  [TAMAM] " + $s) -ForegroundColor Green }
function Bad($s) { Write-Host ("  [HATA]  " + $s) -ForegroundColor Red }
Write-Host ""
Write-Host "EnsariPOS Garson Direkt - SambaPOS hazirligi" -ForegroundColor Cyan
Write-Host ""

# --- 1) uygulama kaydi
try {
    $f = 'C:\ProgramData\SambaPOS\SambaPOS5\SambaSettings.txt'
    if (-not (Test-Path $f)) { $f = 'C:\ProgramData\AlfaPOS\AlfaPOS5\AlfaSettings.txt' }
    if (-not (Test-Path $f)) { throw "SambaPOS ayar dosyasi bulunamadi (SambaPOS bu bilgisayarda kurulu mu?)" }
    $x = Get-Content $f -Raw
    $cs = [System.Net.WebUtility]::HtmlDecode([regex]::Match($x, '<ConnectionString>([^<]+)</ConnectionString>').Groups[1].Value)
    if (-not $cs) { throw "Veritabani baglanti bilgisi okunamadi." }
    $c = New-Object System.Data.SqlClient.SqlConnection $cs
    $c.Open()
    $cmd = $c.CreateCommand()
    $cmd.CommandText = "IF NOT EXISTS (SELECT 1 FROM GraphqlClients WHERE Identifier='EnsariGarson') INSERT INTO GraphqlClients (Identifier,Name,Secret,ApplicationType,Active,RefreshTokenLifeTime,AuthorizationType,AllowedOrigin) VALUES ('EnsariGarson','Ensari Garson','',0,1,43200,0,'*')"
    $n = $cmd.ExecuteNonQuery()
    $c.Close()
    Ok ("Uygulama kaydi: " + $(if ($n -gt 0) { 'eklendi' } else { 'zaten vardi' }))
} catch { Bad ("Uygulama kaydi: " + $_.Exception.Message) }

# --- 2) guvenlik duvari
$port = 9000
try {
    if (-not (Get-NetFirewallRule -DisplayName 'Ensari Garson (SambaPOS 9000)' -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName 'Ensari Garson (SambaPOS 9000)' -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow -Profile Private,Domain | Out-Null
        Ok "Guvenlik duvari: $port portu acildi (ozel/is aglari)"
    } else { Ok "Guvenlik duvari: kural zaten vardi" }
    $prof = Get-NetConnectionProfile -ErrorAction SilentlyContinue | Where-Object { $_.NetworkCategory -eq 'Public' }
    if ($prof) { Write-Host ("  [UYARI] '" + ($prof.Name -join ', ') + "' agi 'Ortak (Public)' olarak ayarli - telefonlar baglanamayabilir. Ag ayarlarindan 'Ozel' yapin.") -ForegroundColor Yellow }
} catch { Bad ("Guvenlik duvari (yonetici olarak calistirin): " + $_.Exception.Message) }

# --- 3) mesaj sunucusu kontrolu + adresler
try {
    $r = Invoke-WebRequest "http://localhost:$port/signalr/negotiate?clientProtocol=1.5&connectionData=%5B%5D" -UseBasicParsing -TimeoutSec 5
    if ($r.Content -match 'ConnectionToken') { Ok "SambaPOS mesaj sunucusu calisiyor (port $port)" } else { throw "beklenmeyen cevap" }
} catch { Bad "SambaPOS mesaj sunucusuna ulasilamadi. SambaPOS'ta Mesaj Sunucusu (Message Server) acik ve $port portunda mi?" }
$ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -match '^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)' } | Select-Object -ExpandProperty IPAddress
Write-Host ""
Write-Host "Telefonda 'Sunucu Bul' bu bilgisayari otomatik bulur. Bulamazsa elle yazilacak adres:" -ForegroundColor Cyan
foreach ($ip in $ips) { Write-Host ("    " + $ip + "   port " + $port) -ForegroundColor White }
Write-Host ""
Write-Host "SON ADIM (bir kez): SambaPOS > Yonetim > Kullanicilar'da telefonlarin baglanacagi bir kullanici" -ForegroundColor Cyan
Write-Host "olusturun (or. 'Ensari Garson') ve 'Sifre' alanini doldurun. Uygulamanin ilk kurulumunda bu kullanici"
Write-Host "adi + sifresi bir kez yazilir; garsonlar sonra kendi PIN'leriyle girer."
Write-Host ""
Read-Host "Kapatmak icin Enter"
