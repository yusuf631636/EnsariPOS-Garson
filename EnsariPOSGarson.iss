; EnsariPOS Local Garson v2 - LISANSSIZ / UCRETSIZ / TAMAMEN YEREL garson terminali.
; garsonsys (AlfaSrv) kurulum tarzinda (29.09.2026, kullanici istegi: "kurulumu tarzini,
; C# olan kismi da bunun gibi yapabiliriz"): kurulumda Windows'un KENDI csc.exe'si ile
; C# servisi derlenir ve "EnsariPOSGarson" Windows servisi olarak kurulur. Node.js/NSSM/
; sqlcmd/internet GEREKMEZ. Bu kurulum icindeki kur\ klasoru, EXE olmadan da kur.bat ile
; ayni kurulumu yapabilir. Eski v1 (Node) kurulum betigi: EnsariPOSGarson-v1-node.iss
#define AppName "EnsariPOS Local Garson"
#define AppVersion "2.2.2"
#define AppPublisher "EnsariPOS"
#define AppPort "6363"

[Setup]
AppId={{9F2C4E1A-7B3D-4A6E-8C2F-ENSARIGARSON1}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL=https://ornek-alanadi.com
AppSupportPhone=0537 618 63 16
DefaultDirName=C:\EnsariPOS\Garson
UsePreviousAppDir=no
DisableDirPage=yes
DefaultGroupName=EnsariPOS Garson
DisableProgramGroupPage=yes
OutputDir=dist
OutputBaseFilename=EnsariPOSGarsonSetup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
SetupIconFile=assets\garson.ico
UninstallDisplayIcon={app}\EnsariGarsonSrv.exe
UninstallDisplayName={#AppName}
VersionInfoVersion={#AppVersion}.0
VersionInfoDescription={#AppName} Kurulum

[Languages]
Name: "tr"; MessagesFile: "compiler:Languages\Turkish.isl"

[Messages]
tr.WelcomeLabel2=Bu program, SambaPOS / AlfaPOS için ÜCRETSİZ garson terminalini bu bilgisayara kurar.%n%n• Tamamen yerel çalışır; internet, lisans veya bulut sunucu gerekmez.%n• Arka planda Windows servisi olarak çalışır, bilgisayar açılınca kendiliğinden başlar.%n• Garsonlar telefon/tabletten (Android, iPhone) kendi SambaPOS PIN'leriyle girer.%n• Veritabanı ve SambaPOS ayarları otomatik bulunur.%n%nEnsariPOS · 0537 618 63 16
tr.FinishedLabel=Kurulum tamamlandı. Garson servisi arka planda çalışıyor.%n%nGarson telefonlarında (aynı Wi-Fi) bu bilgisayarın IP adresini ve :{#AppPort} portunu açın, ör. http://192.168.1.10:{#AppPort}%nTam adres, uygulamadaki Ayarlar ekranında yazar (Ayarlar: SambaPOS yönetici PIN'i).

[Files]
Source: "www\*"; DestDir: "{app}\www"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "downloads\*"
Source: "srv\EnsariGarsonSrv.cs"; DestDir: "{app}\kur"; Flags: ignoreversion
Source: "srv\EnsariGarsonSrv.exe"; DestDir: "{app}\kur"; DestName: "EnsariGarsonSrv.prebuilt.exe"; Flags: ignoreversion
Source: "kur\EnsariGarson_Kurulum.ps1"; DestDir: "{app}\kur"; Flags: ignoreversion
Source: "kur\kaldir.ps1"; DestDir: "{app}\kur"; Flags: ignoreversion
Source: "kur\kur.bat"; DestDir: "{app}\kur"; Flags: ignoreversion
Source: "kur\kaldir.bat"; DestDir: "{app}\kur"; Flags: ignoreversion
Source: "kur\yeniden-baslat.bat"; DestDir: "{app}\kur"; Flags: ignoreversion
; 30.09.2026: yeni garson logosu (logo\garson.ico) - kurulum betigi kur\alfapos.ico adini bekler
Source: "assets\garson.ico"; DestDir: "{app}\kur"; DestName: "alfapos.ico"; Flags: ignoreversion

[Tasks]
Name: "desktopicon"; Description: "Masaüstüne ""Garson"" kısayolu oluştur"; GroupDescription: "Ek kısayollar:"

[Icons]
Name: "{group}\Garson Uygulamasını Aç"; Filename: "http://localhost:{#AppPort}"
Name: "{group}\Garson Servisini Yeniden Başlat"; Filename: "{app}\kur\yeniden-baslat.bat"; WorkingDir: "{app}\kur"
Name: "{group}\Garson Kaldır"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Garson"; Filename: "http://localhost:{#AppPort}"; Tasks: desktopicon
; 29.09.2026: telefonu QR ile baglama + mutfak ekrani
Name: "{group}\Telefon Bağla (QR)"; Filename: "http://localhost:{#AppPort}/baglan.html"
Name: "{group}\Mutfak Ekranı"; Filename: "http://localhost:{#AppPort}/mutfak.html"
Name: "{autodesktop}\Garson - Telefon Bağla"; Filename: "http://localhost:{#AppPort}/baglan.html"; Tasks: desktopicon

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\kur\EnsariGarson_Kurulum.ps1"" -InstallDir ""{app}"" -Silent"; StatusMsg: "Garson servisi derleniyor ve kuruluyor..."; Flags: waituntilterminated runhidden
Filename: "http://localhost:{#AppPort}/baglan.html"; Description: "Telefonları bağlamak için QR sayfasını aç"; Flags: postinstall shellexec skipifsilent nowait

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\kur\kaldir.ps1"" -Silent"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveGarsonService"

[UninstallDelete]
Type: files; Name: "{app}\EnsariGarsonSrv.exe"
Type: filesandordirs; Name: "{app}\logs"

[Code]
{ Guncelleme/yeniden kurulum: calisan servis EXE'yi kilitler - dosyalar kopyalanmadan once
  durdurulur (eski v1 Node/NSSM servisi de ayni adla kurulu olabilir). Asil kaldirma/yeniden
  kurma EnsariGarson_Kurulum.ps1 icinde yapilir. }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  rc: Integer;
begin
  Exec(ExpandConstant('{sys}\sc.exe'), 'stop EnsariPOSGarson', '', SW_HIDE, ewWaitUntilTerminated, rc);
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM EnsariGarsonSrv.exe', '', SW_HIDE, ewWaitUntilTerminated, rc);
  Sleep(2000);
  Result := '';
end;
