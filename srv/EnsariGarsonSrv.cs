// EnsariPOS Garson Sunucusu - Windows servisi (C# 5 / .NET Framework 4.x, SIFIR bagimlilik).
//
// garsonsys (AlfaSrv) kurulum tarzinda (29.09.2026, kullanici istegi: "kurulumu tarzini,
// C# olan kismi da bunun gibi yapabiliriz"): kurulumda Windows'un KENDI csc.exe'si ile
// derlenir, services.msc'ye "EnsariPOSGarson" olarak eklenir. Node.js / NSSM / sqlcmd
// GEREKMEZ - SambaPOS/AlfaPOS kurulu her bilgisayarda .NET Framework 4 zaten vardir.
//
// garsonsys'ten FARKI (onun eksikleri):
//  - Garson KENDI SambaPOS/AlfaPOS PIN'iyle girer; oturum SUNUCUDA tutulur.
//  - SambaPOS token'i SUNUCUDA, garsonun kendi kullanici adi+PIN'iyle alinir - tarayiciya
//    hicbir API sifresi/istemci bilgisi gonderilmez (garsonsys "pda/2520634"u JS'e gomuyor).
//  - Odeme yetkisi SUNUCUDA zorlanir (payTerminalTicket + odeme otomasyon komutlari).
//  - Ayarlar sifresi SABIT degil: SambaPOS'taki yonetici (Admin) rolundeki kullanicilarin
//    kendi PIN'i (garsonsys'te herkes icin ayni sabit sifre 8503087310).
//  - Paylasilan ayarlari (/api/settings) sadece yonetici degistirebilir.
//  - SQL baglantisi SambaSettings.txt / AlfaSettings.txt'ten otomatik bulunur, SambaPOS
//    API istemcisi (GraphqlClients tablosu) otomatik secilir.
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.ServiceProcess;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

[assembly: System.Reflection.AssemblyTitle("EnsariPOS Garson Sunucusu")]
[assembly: System.Reflection.AssemblyProduct("EnsariPOS Local Garson")]
[assembly: System.Reflection.AssemblyVersion("2.2.0.0")]

namespace EnsariGarson
{
    public static class Program
    {
        public const string ServiceName = "EnsariPOSGarson";
        public const string Version = "2.2.0";

        public static void Main(string[] args)
        {
            var opts = ParseArgs(args);
            bool console = opts.ContainsKey("console") || Environment.UserInteractive;
            if (!console)
            {
                ServiceBase.Run(new GarsonService(opts));
                return;
            }
            var server = new GarsonServer(opts);
            try
            {
                server.Start();
            }
            catch (Exception ex)
            {
                Console.WriteLine("BASLATILAMADI: " + ex.Message);
                Environment.ExitCode = 1;
                return;
            }
            Console.WriteLine("EnsariPOS Garson " + Version + " calisiyor (konsol modu). Durdurmak icin Ctrl+C.");
            foreach (var u in server.PublicUrls()) Console.WriteLine("  " + u);
            // stdin bos/yonlendirilmis olabilir (arka planda baslatma) - ReadLine yerine bekle
            Thread.Sleep(Timeout.Infinite);
        }

        static Dictionary<string, string> ParseArgs(string[] args)
        {
            var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var a in args)
            {
                string s = a.TrimStart('/', '-');
                int i = s.IndexOf(':');
                if (i > 0) d[s.Substring(0, i)] = s.Substring(i + 1);
                else d[s] = "";
            }
            return d;
        }
    }

    public class GarsonService : ServiceBase
    {
        readonly Dictionary<string, string> _opts;
        GarsonServer _server;

        public GarsonService(Dictionary<string, string> opts)
        {
            _opts = opts;
            ServiceName = Program.ServiceName;
            CanStop = true;
            CanShutdown = true;
        }

        protected override void OnStart(string[] args)
        {
            _server = new GarsonServer(_opts);
            _server.Start();
        }

        protected override void OnStop()
        {
            if (_server != null) _server.Stop();
        }

        protected override void OnShutdown()
        {
            OnStop();
        }
    }

    // ------------------------------------------------------------------ Log
    public static class Log
    {
        static readonly object _lock = new object();
        static string _path;

        public static void Init(string dir)
        {
            try
            {
                Directory.CreateDirectory(dir);
                _path = Path.Combine(dir, "garson.log");
            }
            catch { _path = null; }
        }

        public static void Write(string msg)
        {
            string line = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + msg;
            if (Environment.UserInteractive) Console.WriteLine(line);
            if (_path == null) return;
            lock (_lock)
            {
                try
                {
                    var fi = new FileInfo(_path);
                    if (fi.Exists && fi.Length > 2 * 1024 * 1024)
                    {
                        string old = _path + ".1";
                        if (File.Exists(old)) File.Delete(old);
                        File.Move(_path, old);
                    }
                    File.AppendAllText(_path, line + Environment.NewLine, Encoding.UTF8);
                }
                catch { }
            }
        }
    }

    // ------------------------------------------------------------------ JSON
    public static class Json
    {
        public static object Parse(string text)
        {
            var js = new JavaScriptSerializer { MaxJsonLength = int.MaxValue, RecursionLimit = 64 };
            return js.DeserializeObject(text);
        }

        public static string Stringify(object value)
        {
            var js = new JavaScriptSerializer { MaxJsonLength = int.MaxValue, RecursionLimit = 64 };
            return js.Serialize(value);
        }

        // config.json / settings.json elle de okunabilsin diye girintili yazim
        public static string Pretty(object value)
        {
            var sb = new StringBuilder();
            WritePretty(sb, value, 0);
            return sb.ToString();
        }

        static void WritePretty(StringBuilder sb, object v, int depth)
        {
            string pad = new string(' ', depth * 2);
            string pad2 = new string(' ', (depth + 1) * 2);
            var dict = v as IDictionary<string, object>;
            if (dict != null)
            {
                if (dict.Count == 0) { sb.Append("{}"); return; }
                sb.Append("{\n");
                int i = 0;
                foreach (var kv in dict)
                {
                    sb.Append(pad2).Append(Stringify(kv.Key)).Append(": ");
                    WritePretty(sb, kv.Value, depth + 1);
                    if (++i < dict.Count) sb.Append(',');
                    sb.Append('\n');
                }
                sb.Append(pad).Append('}');
                return;
            }
            if (v is System.Collections.IEnumerable && !(v is string))
            {
                var items = ((System.Collections.IEnumerable)v).Cast<object>().ToList();
                if (items.Count == 0) { sb.Append("[]"); return; }
                sb.Append("[\n");
                for (int i = 0; i < items.Count; i++)
                {
                    sb.Append(pad2);
                    WritePretty(sb, items[i], depth + 1);
                    if (i < items.Count - 1) sb.Append(',');
                    sb.Append('\n');
                }
                sb.Append(pad).Append(']');
                return;
            }
            sb.Append(Stringify(v));
        }

        public static Dictionary<string, object> AsDict(object o)
        {
            var d = o as Dictionary<string, object>;
            return d ?? new Dictionary<string, object>();
        }

        public static string Str(Dictionary<string, object> d, string key)
        {
            object v;
            if (d == null || !d.TryGetValue(key, out v) || v == null) return null;
            return Convert.ToString(v, CultureInfo.InvariantCulture);
        }

        public static void WriteFileAtomic(string path, string content)
        {
            string tmp = path + ".tmp";
            File.WriteAllText(tmp, content, new UTF8Encoding(false));
            if (File.Exists(path))
            {
                try { File.Replace(tmp, path, null); return; }
                catch { File.Copy(tmp, path, true); File.Delete(tmp); return; }
            }
            File.Move(tmp, path);
        }
    }

    // ------------------------------------------------------------------ Config
    public class AppConfig
    {
        readonly string _path;
        readonly object _lock = new object();
        Dictionary<string, object> _raw;

        public AppConfig(string path)
        {
            _path = path;
            Reload();
        }

        public void Reload()
        {
            lock (_lock)
            {
                _raw = new Dictionary<string, object>();
                if (File.Exists(_path))
                {
                    try { _raw = Json.AsDict(Json.Parse(File.ReadAllText(_path, Encoding.UTF8))); }
                    catch (Exception ex) { Log.Write("config.json okunamadi (varsayilanlar kullaniliyor): " + ex.Message); }
                }
                else
                {
                    _raw["port"] = 6363;
                    _raw["sambaposHost"] = "127.0.0.1";
                    _raw["sambaposPort"] = 9000;
                    SaveLocked();
                }
            }
        }

        void SaveLocked()
        {
            try { Json.WriteFileAtomic(_path, Json.Pretty(_raw)); }
            catch (Exception ex) { Log.Write("config.json yazilamadi: " + ex.Message); }
        }

        public string Str(string key)
        {
            lock (_lock) return Json.Str(_raw, key);
        }

        public int Int(string key, int def)
        {
            string s = Str(key);
            int v;
            return int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out v) ? v : def;
        }

        public bool Bool(string key, bool def)
        {
            string s = Str(key);
            if (s == null) return def;
            return s.Equals("true", StringComparison.OrdinalIgnoreCase) || s == "1";
        }

        public object Raw(string key)
        {
            lock (_lock)
            {
                object v;
                return _raw.TryGetValue(key, out v) ? v : null;
            }
        }

        public List<string> StrList(string key)
        {
            var v = Raw(key);
            var list = new List<string>();
            var arr = v as System.Collections.IEnumerable;
            if (v is string) list.AddRange(((string)v).Split(',').Select(x => x.Trim()).Where(x => x.Length > 0));
            else if (arr != null) foreach (var x in arr) if (x != null) list.Add(Convert.ToString(x, CultureInfo.InvariantCulture));
            return list;
        }

        public void Set(string key, object value)
        {
            lock (_lock)
            {
                _raw[key] = value;
                SaveLocked();
            }
        }
    }

    // ------------------------------------------------------------------ Metin yardimcilari
    public static class Txt
    {
        static readonly CultureInfo Tr = new CultureInfo("tr-TR");

        // Turkce buyuk/kucuk harf ve aksan farklarini yok sayarak karsilastirma icin
        // ("KREDİ KARTI", "Kredi Karti", "kredı kartı" -> "kredi karti")
        public static string Fold(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            string t = s.ToLower(Tr).Normalize(NormalizationForm.FormD);
            var sb = new StringBuilder(t.Length);
            foreach (char c in t)
            {
                if (CharUnicodeInfo.GetUnicodeCategory(c) == UnicodeCategory.NonSpacingMark) continue;
                switch (c)
                {
                    case 'ı': sb.Append('i'); break;
                    default: sb.Append(c); break;
                }
            }
            return Regex.Replace(sb.ToString(), @"\s+", " ").Trim();
        }

        public static string GqlString(string s)
        {
            // GraphQL/JSON string literal
            var sb = new StringBuilder("\"");
            foreach (char c in s ?? "")
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            return sb.Append('"').ToString();
        }

        public static string RandomToken()
        {
            var b = new byte[24];
            using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(b);
            return BitConverter.ToString(b).Replace("-", "").ToLowerInvariant();
        }
    }

    // ------------------------------------------------------------------ SQL
    public class UserInfo
    {
        public int Id;
        public string Name;
        public int RoleId;
        public string RoleName;
        public bool IsAdmin;
    }

    public class Db
    {
        readonly AppConfig _cfg;
        string _cs;
        public string Source { get; private set; }

        public Db(AppConfig cfg) { _cfg = cfg; }

        public string ConnectionString
        {
            get
            {
                if (_cs == null) _cs = Build();
                return _cs;
            }
        }

        public void Reset() { _cs = null; }

        string Build()
        {
            SqlConnectionStringBuilder b;
            string server = _cfg.Str("server");
            if (!string.IsNullOrWhiteSpace(server))
            {
                b = new SqlConnectionStringBuilder();
                b.DataSource = server;
                b.InitialCatalog = _cfg.Str("database") ?? "SAMBAPOS5";
                string user = _cfg.Str("user");
                if (!string.IsNullOrEmpty(user)) { b.UserID = user; b.Password = _cfg.Str("password") ?? ""; }
                else b.IntegratedSecurity = true;
                Source = "config.json";
            }
            else
            {
                string found;
                string cs = DetectFromSambaSettings(out found);
                if (cs == null) throw new Exception("SambaPOS/AlfaPOS veritabani ayari bulunamadi (SambaSettings.txt / AlfaSettings.txt yok). config.json'a server/database/user/password yazin.");
                b = ParseLoose(cs);
                Source = found;
            }
            b.ConnectTimeout = 5;
            b.ApplicationName = "EnsariPOS Garson";
            b.Pooling = true;
            var opts = _cfg.Raw("options") as Dictionary<string, object>;
            if (opts != null)
            {
                string enc = Json.Str(opts, "encrypt");
                if (enc != null) b.Encrypt = enc.Equals("true", StringComparison.OrdinalIgnoreCase);
                string tsc = Json.Str(opts, "trustServerCertificate");
                if (tsc != null) b.TrustServerCertificate = tsc.Equals("true", StringComparison.OrdinalIgnoreCase);
            }
            Log.Write("SQL baglantisi: " + b.DataSource + " / " + b.InitialCatalog + " (kaynak: " + Source + ")");
            return b.ConnectionString;
        }

        public static string DetectFromSambaSettings(out string foundIn)
        {
            string pd = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
            var candidates = new[]
            {
                Path.Combine(pd, @"SambaPOS\SambaPOS5\SambaSettings.txt"),
                Path.Combine(pd, @"AlfaPOS\AlfaPOS5\AlfaSettings.txt"),
                @"C:\ProgramData\SambaPOS\SambaPOS5\SambaSettings.txt",
                @"C:\ProgramData\AlfaPOS\AlfaPOS5\AlfaSettings.txt"
            };
            foreach (var f in candidates.Distinct(StringComparer.OrdinalIgnoreCase))
            {
                try
                {
                    if (!File.Exists(f)) continue;
                    string xml = File.ReadAllText(f);
                    var m = Regex.Match(xml, @"<ConnectionString>([^<]*)</ConnectionString>", RegexOptions.IgnoreCase);
                    if (!m.Success || m.Groups[1].Value.Trim().Length == 0) continue;
                    foundIn = f;
                    return WebUtility.HtmlDecode(m.Groups[1].Value.Trim());
                }
                catch { }
            }
            foundIn = null;
            return null;
        }

        static SqlConnectionStringBuilder ParseLoose(string cs)
        {
            try { return new SqlConnectionStringBuilder(cs); }
            catch { }
            var b = new SqlConnectionStringBuilder();
            foreach (var piece in cs.Split(';'))
            {
                int eq = piece.IndexOf('=');
                if (eq < 0) continue;
                string k = piece.Substring(0, eq).Trim().ToLowerInvariant();
                string v = piece.Substring(eq + 1).Trim();
                if (k == "data source" || k == "server" || k == "address") b.DataSource = v;
                else if (k == "database" || k == "initial catalog") b.InitialCatalog = v;
                else if (k == "user id" || k == "uid" || k == "user") b.UserID = v;
                else if (k == "password" || k == "pwd") b.Password = v;
                else if (k == "integrated security" || k == "trusted_connection") b.IntegratedSecurity = v.Equals("true", StringComparison.OrdinalIgnoreCase) || v.Equals("sspi", StringComparison.OrdinalIgnoreCase) || v.Equals("yes", StringComparison.OrdinalIgnoreCase);
            }
            return b;
        }

        public List<object[]> Query(string sql, params SqlParameter[] ps)
        {
            var rows = new List<object[]>();
            using (var con = new SqlConnection(ConnectionString))
            using (var cmd = new SqlCommand(sql, con))
            {
                cmd.CommandTimeout = 10;
                if (ps != null) cmd.Parameters.AddRange(ps);
                con.Open();
                using (var r = cmd.ExecuteReader())
                {
                    while (r.Read())
                    {
                        var row = new object[r.FieldCount];
                        r.GetValues(row);
                        for (int i = 0; i < row.Length; i++) if (row[i] is DBNull) row[i] = null;
                        rows.Add(row);
                    }
                }
            }
            return rows;
        }

        public List<string> Names(string sql)
        {
            return Query(sql).Select(r => Convert.ToString(r[0], CultureInfo.InvariantCulture)).Where(s => !string.IsNullOrEmpty(s)).ToList();
        }

        public bool Ping(out string error)
        {
            try
            {
                Query("SELECT 1");
                error = null;
                return true;
            }
            catch (Exception ex)
            {
                error = ex.Message;
                return false;
            }
        }

        public UserInfo UserByPin(string pin)
        {
            List<object[]> rows;
            try
            {
                rows = Query("SELECT TOP 1 u.Id, u.Name, ur.Name, ur.IsAdmin, ur.Id FROM Users u JOIN UserRoles ur ON ur.Id = u.UserRole_Id WHERE u.PinCode = @pin",
                    new SqlParameter("@pin", pin));
            }
            catch (SqlException ex)
            {
                // Eski surumlerde UserRoles.IsAdmin olmayabilir
                if (ex.Message.IndexOf("IsAdmin", StringComparison.OrdinalIgnoreCase) < 0) throw;
                rows = Query("SELECT TOP 1 u.Id, u.Name, ur.Name, NULL, ur.Id FROM Users u JOIN UserRoles ur ON ur.Id = u.UserRole_Id WHERE u.PinCode = @pin",
                    new SqlParameter("@pin", pin));
            }
            if (rows.Count == 0) return null;
            var r = rows[0];
            var u = new UserInfo
            {
                Id = Convert.ToInt32(r[0], CultureInfo.InvariantCulture),
                Name = Convert.ToString(r[1], CultureInfo.InvariantCulture),
                RoleName = Convert.ToString(r[2], CultureInfo.InvariantCulture) ?? "",
                RoleId = r[4] != null ? Convert.ToInt32(r[4], CultureInfo.InvariantCulture) : 0
            };
            if (r[3] != null) u.IsAdmin = Convert.ToBoolean(r[3], CultureInfo.InvariantCulture);
            else u.IsAdmin = Txt.Fold(u.RoleName).Contains("admin") || Txt.Fold(u.RoleName).Contains("yonetici");
            return u;
        }
    }

    // ------------------------------------------------------------------ Oturumlar
    public class Session
    {
        public string Token;
        public int UserId;
        public string UserName;
        public int RoleId;
        public string RoleName;
        public bool IsAdmin;
        public bool CanTakePayment;
        public DateTime ExpiresUtc;
        public string Pin;              // sadece bellekte (SambaPOS token'i yenilemek icin), diske YAZILMAZ
        public string SambaAccess;
        public string SambaRefresh;
        public DateTime SambaExpiresUtc;
        public readonly object Lock = new object();
    }

    public class LoginLimiter
    {
        class Entry { public int Count; public DateTime LockUntil; }
        readonly ConcurrentDictionary<string, Entry> _map = new ConcurrentDictionary<string, Entry>();
        readonly int _threshold;
        readonly TimeSpan _lock;

        public LoginLimiter(int threshold, TimeSpan lockFor) { _threshold = threshold; _lock = lockFor; }

        public int LockedSeconds(string key)
        {
            Entry e;
            if (!_map.TryGetValue(key, out e)) return 0;
            var left = e.LockUntil - DateTime.UtcNow;
            return left > TimeSpan.Zero ? (int)Math.Ceiling(left.TotalSeconds) : 0;
        }

        public void Fail(string key)
        {
            var e = _map.GetOrAdd(key, k => new Entry());
            lock (e)
            {
                e.Count++;
                if (e.Count >= _threshold) { e.LockUntil = DateTime.UtcNow + _lock; e.Count = 0; }
            }
        }

        public void Success(string key)
        {
            Entry e;
            _map.TryRemove(key, out e);
        }
    }

    // ------------------------------------------------------------------ SambaPOS Mesaj Sunucusu istemcisi
    public class SambaTokenResult
    {
        public string Access;
        public string Refresh;
        public int ExpiresIn;
        public string Error;
        public bool Unreachable;
    }

    // ------------------------------------------------------------------ Odeme yetkisi / GraphQL denetimi
    public class GqlPolicy
    {
        static readonly Regex PayFunctions = new Regex(@"\b(payTerminalTicket|addCalculationToTerminalTicket|settleTerminalTicket|payTicket)\b", RegexOptions.IgnoreCase);
        static readonly Regex AutoCmdCall = new Regex(@"\bexecuteAutomationCommand(?:ForTerminalTicket)?\s*\(", RegexOptions.IgnoreCase);
        static readonly Regex UserCalls = new Regex(@"\b(registerTerminal|mergeTickets)\s*\(", RegexOptions.IgnoreCase);

        // GraphQL yorumlarini (# ... satir sonu) string'lerin DISINDA temizler
        public static string StripComments(string q)
        {
            if (q == null) return "";
            var sb = new StringBuilder(q.Length);
            bool inStr = false;
            for (int i = 0; i < q.Length; i++)
            {
                char c = q[i];
                if (inStr)
                {
                    sb.Append(c);
                    if (c == '\\' && i + 1 < q.Length) { sb.Append(q[++i]); continue; }
                    if (c == '"') inStr = false;
                    continue;
                }
                if (c == '"') { inStr = true; sb.Append(c); continue; }
                if (c == '#') { while (i < q.Length && q[i] != '\n') i++; sb.Append('\n'); continue; }
                sb.Append(c);
            }
            return sb.ToString();
        }

        // "(" isaretinden baslayip eslesen ")" isaretine kadar (string'lere dikkat ederek) arguman metni
        static string ArgList(string q, int openParen, out int closeIndex)
        {
            int depth = 0;
            bool inStr = false;
            for (int i = openParen; i < q.Length; i++)
            {
                char c = q[i];
                if (inStr)
                {
                    if (c == '\\') { i++; continue; }
                    if (c == '"') inStr = false;
                    continue;
                }
                if (c == '"') { inStr = true; continue; }
                if (c == '(') depth++;
                else if (c == ')')
                {
                    depth--;
                    if (depth == 0) { closeIndex = i; return q.Substring(openParen + 1, i - openParen - 1); }
                }
            }
            closeIndex = q.Length - 1;
            return q.Substring(openParen + 1);
        }

        // name: "..." / """...""" / $degisken -> degerler (cozulemezse null eleman)
        static List<string> ArgValues(string args, string argName, Dictionary<string, object> vars)
        {
            var result = new List<string>();
            var re = new Regex(@"(?<![A-Za-z0-9_])" + argName + @"\s*:\s*", RegexOptions.IgnoreCase);
            foreach (Match m in re.Matches(args))
            {
                int i = m.Index + m.Length;
                if (i >= args.Length) { result.Add(null); continue; }
                if (args.Substring(i).StartsWith("\"\"\"")) { result.Add(null); continue; }  // blok string: guvenli tarafta kal
                if (args[i] == '"')
                {
                    var sb = new StringBuilder();
                    bool ok = false;
                    for (int j = i + 1; j < args.Length; j++)
                    {
                        char c = args[j];
                        if (c == '\\' && j + 1 < args.Length)
                        {
                            char n = args[++j];
                            if (n == 'u' && j + 4 < args.Length)
                            {
                                int code;
                                if (int.TryParse(args.Substring(j + 1, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out code)) { sb.Append((char)code); j += 4; continue; }
                            }
                            switch (n) { case 'n': sb.Append('\n'); break; case 't': sb.Append('\t'); break; default: sb.Append(n); break; }
                            continue;
                        }
                        if (c == '"') { ok = true; break; }
                        sb.Append(c);
                    }
                    result.Add(ok ? sb.ToString() : null);
                    continue;
                }
                if (args[i] == '$')
                {
                    var vm = Regex.Match(args.Substring(i + 1), @"^[A-Za-z_][A-Za-z0-9_]*");
                    object val = null;
                    if (vm.Success && vars != null) vars.TryGetValue(vm.Value, out val);
                    result.Add(val as string);
                    continue;
                }
                result.Add(null);
            }
            return result;
        }

        // Kisitli (odeme alamayan) kullanici icin engelleme sebebi; izinliyse null
        public static string Check(string query, Dictionary<string, object> vars, Session s, Func<string, bool> isPaymentCommand)
        {
            if (s.CanTakePayment) return null;
            string q = StripComments(query);
            var pm = PayFunctions.Match(q);
            if (pm.Success) return "\"" + s.UserName + "\" (" + s.RoleName + ") ödeme alma yetkisine sahip değil.";
            foreach (Match m in AutoCmdCall.Matches(q))
            {
                int close;
                string args = ArgList(q, m.Index + m.Length - 1, out close);
                var names = ArgValues(args, "name", vars);
                if (names.Count == 0) return "Otomasyon komutu adı okunamadı.";
                foreach (var n in names)
                {
                    if (string.IsNullOrEmpty(n)) return "Otomasyon komutu adı okunamadı.";
                    if (isPaymentCommand(n)) return "\"" + s.UserName + "\" (" + s.RoleName + ") \"" + n + "\" (ödeme/tahsilat) işlemini yapamaz.";
                }
            }
            return null;
        }

        // registerTerminal/mergeTickets'taki user:"..." degerini OTURUMUN kullanicisiyla degistirir.
        // Degisken ile gonderilmisse (cozumlenemez) engeller -> blockReason.
        public static string EnforceUser(string query, Session s, out string blockReason)
        {
            blockReason = null;
            if (query == null || !UserCalls.IsMatch(query)) return query;
            string block = null;
            var sb = new StringBuilder();
            int pos = 0;
            foreach (Match m in UserCalls.Matches(query))
            {
                if (m.Index < pos) continue;
                int open = m.Index + m.Length - 1;
                int close;
                string args = ArgList(query, open, out close);
                string fixedArgs = Regex.Replace(args, @"(?<![A-Za-z0-9_])(user\s*:\s*)(""(?:[^""\\]|\\.)*""|\$[A-Za-z_][A-Za-z0-9_]*)", delegate(Match um)
                {
                    if (um.Groups[2].Value.StartsWith("$")) { block = "Kullanıcı değişkenle gönderilemez."; return um.Value; }
                    return um.Groups[1].Value + Txt.GqlString(s.UserName);
                });
                sb.Append(query, pos, open + 1 - pos).Append(fixedArgs);
                pos = close;
            }
            sb.Append(query.Substring(pos));
            blockReason = block;
            return sb.ToString();
        }
    }

    // ------------------------------------------------------------------ Sunucu
    public class GarsonServer
    {
        readonly Dictionary<string, string> _opts;
        readonly string _baseDir;
        readonly string _wwwRoot;
        readonly string _dataDir;
        readonly string _settingsPath;
        readonly object _settingsLock = new object();
        public readonly AppConfig Config;
        public readonly Db Db;
        HttpListener _listener;
        volatile bool _running;
        int _port;

        string _sambaHost;
        int _sambaPort;

        readonly ConcurrentDictionary<string, Session> _sessions = new ConcurrentDictionary<string, Session>();
        readonly ConcurrentDictionary<string, DateTime> _adminTokens = new ConcurrentDictionary<string, DateTime>();
        readonly LoginLimiter _limiter = new LoginLimiter(6, TimeSpan.FromMinutes(5));
        static readonly TimeSpan SessionTtl = TimeSpan.FromHours(12);
        static readonly TimeSpan AdminTtl = TimeSpan.FromMinutes(30);

        // SQL'den gelen kucuk listeler icin kisa onbellek
        readonly object _cacheLock = new object();
        string _clientId; DateTime _clientIdAt;
        HashSet<string> _paymentNames; DateTime _paymentNamesAt;
        bool _healthSql; string _healthSqlError; DateTime _healthAt;

        readonly ConcurrentDictionary<string, Tuple<DateTime, byte[]>> _gzCache = new ConcurrentDictionary<string, Tuple<DateTime, byte[]>>();

        public GarsonServer(Dictionary<string, string> opts)
        {
            _opts = opts;
            _baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string cfgPath = Opt("config") ?? Path.Combine(_baseDir, "config.json");
            _dataDir = Opt("data") ?? Path.Combine(_baseDir, "data");
            Log.Init(Opt("logs") ?? Path.Combine(_baseDir, "logs"));
            Directory.CreateDirectory(_dataDir);
            _settingsPath = Path.Combine(_dataDir, "settings.json");
            Config = new AppConfig(cfgPath);
            string www = Opt("www") ?? Config.Str("wwwRoot") ?? Path.Combine(_baseDir, "www");
            _wwwRoot = Path.GetFullPath(www).TrimEnd('\\');
            Db = new Db(Config);
            _sambaHost = Config.Str("sambaposHost") ?? "127.0.0.1";
            _sambaPort = Config.Int("sambaposPort", 9000);
            int p;
            _port = int.TryParse(Opt("port"), out p) ? p : Config.Int("port", 6363);
        }

        string Opt(string key)
        {
            string v;
            return _opts.TryGetValue(key, out v) && !string.IsNullOrEmpty(v) ? v : null;
        }

        string SambaBase { get { return "http://" + _sambaHost + ":" + _sambaPort; } }

        public void Start()
        {
            ServicePointManager.DefaultConnectionLimit = 256;
            ServicePointManager.Expect100Continue = false;
            ServicePointManager.UseNagleAlgorithm = false;
            int w, io;
            ThreadPool.GetMinThreads(out w, out io);
            ThreadPool.SetMinThreads(Math.Max(w, 64), Math.Max(io, 64));

            _listener = new HttpListener();
            _listener.Prefixes.Add("http://+:" + _port + "/");
            try
            {
                _listener.Start();
            }
            catch (HttpListenerException ex)
            {
                // Yonetici olmayan konsol calistirmasi: sadece bu makineden erisim
                Log.Write("http://+:" + _port + "/ acilamadi (" + ex.Message + "), sadece localhost dinlenecek.");
                _listener = new HttpListener();
                _listener.Prefixes.Add("http://localhost:" + _port + "/");
                _listener.Start();
            }
            _running = true;
            _listener.BeginGetContext(OnContext, null);
            Log.Write("EnsariPOS Garson " + Program.Version + " basladi. Port: " + _port + ", web: " + _wwwRoot + ", SambaPOS: " + SambaBase);
            ThreadPool.QueueUserWorkItem(delegate
            {
                string err;
                try { if (!Db.Ping(out err)) Log.Write("UYARI - SQL'e baglanilamadi: " + err); }
                catch (Exception ex) { Log.Write("UYARI - SQL ayari: " + ex.Message); }
            });
        }

        public void Stop()
        {
            _running = false;
            try { if (_listener != null) { _listener.Stop(); _listener.Close(); } } catch { }
            Log.Write("EnsariPOS Garson durduruldu.");
        }

        public IEnumerable<string> PublicUrls()
        {
            yield return "http://localhost:" + _port;
            foreach (var a in LanAddresses()) yield return "http://" + a + ":" + _port;
        }

        void OnContext(IAsyncResult ar)
        {
            HttpListenerContext ctx = null;
            try { ctx = _listener.EndGetContext(ar); }
            catch { }
            if (_running)
            {
                try { _listener.BeginGetContext(OnContext, null); }
                catch (Exception ex) { Log.Write("Dinleyici hatasi: " + ex.Message); }
            }
            if (ctx == null) return;
            var c = ctx;
            ThreadPool.QueueUserWorkItem(delegate { Handle(c); });
        }

        // ============================================================== Istek yonlendirme
        void Handle(HttpListenerContext ctx)
        {
            var req = ctx.Request;
            var res = ctx.Response;
            string path = req.Url.AbsolutePath;
            try
            {
                res.Headers["X-Content-Type-Options"] = "nosniff";
                // /signalr: SambaPOS negotiate yanitindaki "Url":"/signalr" koku yuzunden SignalR istemcisi
                // sonraki istekleri (connect/poll/send) /samba-lan OLMADAN gonderiyor - ayni kopruye alinir.
                if (path.StartsWith("/samba-lan", StringComparison.OrdinalIgnoreCase) || path.StartsWith("/signalr/", StringComparison.OrdinalIgnoreCase)) { ProxySamba(ctx); return; }
                if (path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase)) { HandleApi(ctx, path); return; }
                ServeStatic(ctx, path);
            }
            catch (HttpListenerException) { }
            catch (IOException) { }
            catch (Exception ex)
            {
                Log.Write("HATA " + req.HttpMethod + " " + path + ": " + ex);
                try { SendJson(res, 500, Err(ex.Message)); } catch { }
            }
            finally
            {
                try { res.Close(); } catch { }
            }
        }

        static Dictionary<string, object> Err(string msg)
        {
            return new Dictionary<string, object> { { "error", msg } };
        }

        static void SendJson(HttpListenerResponse res, int status, object data)
        {
            byte[] b = Encoding.UTF8.GetBytes(Json.Stringify(data));
            res.StatusCode = status;
            res.ContentType = "application/json; charset=utf-8";
            res.Headers["Cache-Control"] = "no-store";
            res.ContentLength64 = b.Length;
            res.OutputStream.Write(b, 0, b.Length);
        }

        static byte[] ReadBody(HttpListenerRequest req, int max)
        {
            if (!req.HasEntityBody) return new byte[0];
            using (var ms = new MemoryStream())
            {
                var buf = new byte[16384];
                int n;
                while ((n = req.InputStream.Read(buf, 0, buf.Length)) > 0)
                {
                    ms.Write(buf, 0, n);
                    if (ms.Length > max) throw new InvalidDataException("İstek çok büyük.");
                }
                return ms.ToArray();
            }
        }

        static Dictionary<string, object> ReadJsonBody(HttpListenerRequest req)
        {
            byte[] b = ReadBody(req, 1024 * 1024);
            if (b.Length == 0) return new Dictionary<string, object>();
            try { return Json.AsDict(Json.Parse(Encoding.UTF8.GetString(b))); }
            catch { return new Dictionary<string, object>(); }
        }

        static bool IsJsonRequest(HttpListenerRequest req)
        {
            return (req.ContentType ?? "").StartsWith("application/json", StringComparison.OrdinalIgnoreCase);
        }

        static string ClientIp(HttpListenerRequest req)
        {
            try { return req.RemoteEndPoint.Address.ToString(); } catch { return "?"; }
        }

        static void SetCookie(HttpListenerResponse res, string name, string value, int maxAgeSeconds, string sameSite)
        {
            res.AppendHeader("Set-Cookie", name + "=" + value + "; Path=/; HttpOnly; SameSite=" + sameSite + "; Max-Age=" + maxAgeSeconds);
        }

        static string CookieValue(HttpListenerRequest req, string name)
        {
            var c = req.Cookies[name];
            return c != null ? c.Value : null;
        }

        Session CurrentSession(HttpListenerRequest req)
        {
            string t = CookieValue(req, "garson_session");
            if (string.IsNullOrEmpty(t)) return null;
            Session s;
            if (!_sessions.TryGetValue(t, out s)) return null;
            if (s.ExpiresUtc < DateTime.UtcNow) { _sessions.TryRemove(t, out s); return null; }
            return s;
        }

        bool IsAdminUnlocked(HttpListenerRequest req)
        {
            var s = CurrentSession(req);
            if (s != null && s.IsAdmin) return true;
            string t = CookieValue(req, "garson_admin");
            if (string.IsNullOrEmpty(t)) return false;
            DateTime exp;
            if (!_adminTokens.TryGetValue(t, out exp)) return false;
            if (exp < DateTime.UtcNow) { _adminTokens.TryRemove(t, out exp); return false; }
            return true;
        }

        // ============================================================== API
        void HandleApi(HttpListenerContext ctx, string path)
        {
            var req = ctx.Request;
            var res = ctx.Response;
            string m = req.HttpMethod;
            string p = path.ToLowerInvariant().TrimEnd('/');

            if (m == "POST" && !IsJsonRequest(req) && p != "/api/logout" && p != "/api/admin/lock")
            {
                SendJson(res, 415, Err("İçerik tipi application/json olmalı."));
                return;
            }

            switch (p)
            {
                case "/api/login": if (m == "POST") { ApiLogin(ctx); return; } break;
                case "/api/logout": if (m == "POST") { ApiLogout(ctx); return; } break;
                case "/api/me": if (m == "GET") { ApiMe(ctx); return; } break;
                case "/api/health": if (m == "GET") { ApiHealth(ctx); return; } break;
                case "/api/local-info": if (m == "GET") { ApiLocalInfo(ctx); return; } break;
                case "/api/settings":
                    if (m == "GET") { ApiGetSettings(ctx); return; }
                    if (m == "POST") { ApiSaveSettings(ctx); return; }
                    break;
                case "/api/admin/terminal-config-options": if (m == "GET") { ApiConfigOptions(ctx); return; } break;
                case "/api/admin/status": if (m == "GET") { SendJson(res, 200, new Dictionary<string, object> { { "unlocked", IsAdminUnlocked(req) } }); return; } break;
                case "/api/admin/unlock": if (m == "POST") { ApiAdminUnlock(ctx); return; } break;
                case "/api/admin/lock": if (m == "POST") { ApiAdminLock(ctx); return; } break;
                case "/api/admin/scan-samba-servers":
                    if (m == "GET") { if (!RequireAdmin(ctx)) return; ApiScan(ctx); return; }
                    break;
                case "/api/admin/set-samba-host":
                    if (m == "POST") { if (!RequireAdmin(ctx)) return; ApiSetSambaHost(ctx); return; }
                    break;
                // Mutfak ekrani + "siparis hazir" bildirimi (29.09.2026) - giris yapmis herkes
                case "/api/kitchen/orders": if (m == "GET") { if (!RequireLogin(ctx)) return; ApiKitchenOrders(ctx); return; } break;
                case "/api/kitchen/ready": if (m == "POST") { if (!RequireLogin(ctx)) return; ApiKitchenReady(ctx, true); return; } break;
                case "/api/kitchen/unready": if (m == "POST") { if (!RequireLogin(ctx)) return; ApiKitchenReady(ctx, false); return; } break;
                case "/api/kitchen/notices": if (m == "GET") { if (!RequireLogin(ctx)) return; ApiKitchenNotices(ctx); return; } break;
            }
            SendJson(res, 404, Err("Bulunamadı."));
        }

        bool RequireLogin(HttpListenerContext ctx)
        {
            if (CurrentSession(ctx.Request) != null) return true;
            SendJson(ctx.Response, 401, Err("Giriş gerekli."));
            return false;
        }

        // ============================================================== Mutfak (29.09.2026)
        // Mutfak ekrani siparisleri DOGRUDAN SambaPOS veritabanindan okur (son 6 saat).
        // "Hazir" isaretleri ve garson bildirimleri data\kitchen.json'da tutulur -
        // SambaPOS'a HICBIR SEY yazilmaz.
        class KitchenNotice { public long Id; public string At; public string Table; public string Waiter; public string Items; }
        readonly object _kitchenLock = new object();
        Dictionary<int, DateTime> _kReady;
        List<KitchenNotice> _kNotices;
        long _kSeq;

        string KitchenPath { get { return Path.Combine(_dataDir, "kitchen.json"); } }

        void KitchenLoad()
        {
            if (_kReady != null) return;
            _kReady = new Dictionary<int, DateTime>();
            _kNotices = new List<KitchenNotice>();
            try
            {
                if (!File.Exists(KitchenPath)) return;
                var d = Json.AsDict(Json.Parse(File.ReadAllText(KitchenPath, Encoding.UTF8)));
                long seq; if (long.TryParse(Json.Str(d, "seq"), out seq)) _kSeq = seq;
                var ready = d.ContainsKey("ready") ? d["ready"] as Dictionary<string, object> : null;
                if (ready != null)
                    foreach (var kv in ready)
                    {
                        int id; long ticks;
                        if (int.TryParse(kv.Key, out id) && long.TryParse(Convert.ToString(kv.Value, CultureInfo.InvariantCulture), out ticks)) _kReady[id] = new DateTime(ticks, DateTimeKind.Utc);
                    }
                var notices = d.ContainsKey("notices") ? d["notices"] as object[] : null;
                if (notices != null)
                    foreach (var o in notices)
                    {
                        var n = o as Dictionary<string, object>;
                        if (n == null) continue;
                        long nid; long.TryParse(Json.Str(n, "id"), out nid);
                        _kNotices.Add(new KitchenNotice { Id = nid, At = Json.Str(n, "at"), Table = Json.Str(n, "table"), Waiter = Json.Str(n, "waiter"), Items = Json.Str(n, "items") });
                    }
            }
            catch (Exception ex) { Log.Write("kitchen.json okunamadi (sifirdan baslaniyor): " + ex.Message); }
        }

        void KitchenSave()
        {
            var cutoff = DateTime.UtcNow.AddHours(-24);
            foreach (var id in _kReady.Where(kv => kv.Value < cutoff).Select(kv => kv.Key).ToList()) _kReady.Remove(id);
            if (_kNotices.Count > 200) _kNotices.RemoveRange(0, _kNotices.Count - 200);
            var ready = new Dictionary<string, object>();
            foreach (var kv in _kReady) ready[kv.Key.ToString(CultureInfo.InvariantCulture)] = kv.Value.Ticks.ToString(CultureInfo.InvariantCulture);
            var notices = _kNotices.Select(n => (object)new Dictionary<string, object> { { "id", n.Id }, { "at", n.At }, { "table", n.Table }, { "waiter", n.Waiter }, { "items", n.Items } }).ToList();
            try { Json.WriteFileAtomic(KitchenPath, Json.Stringify(new Dictionary<string, object> { { "seq", _kSeq }, { "ready", ready }, { "notices", notices } })); }
            catch (Exception ex) { Log.Write("kitchen.json yazilamadi: " + ex.Message); }
        }

        static readonly Regex OrderTagValue = new Regex("\"TV\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
        static bool IsVoidState(string states)
        {
            if (string.IsNullOrEmpty(states)) return false;
            string f = Txt.Fold(states);
            return f.Contains("\"s\":\"void\"") || f.Contains("iptal") || f.Contains("iade");
        }

        void ApiKitchenOrders(HttpListenerContext ctx)
        {
            List<object[]> rows, ents;
            try
            {
                rows = Db.Query(
                    "SELECT o.Id, o.TicketId, t.TicketNumber, o.MenuItemName, o.PortionName, o.Quantity, o.CreatingUserName, " +
                    "DATEDIFF(SECOND, o.CreatedDateTime, GETDATE()), o.OrderTags, o.OrderStates " +
                    "FROM Orders o JOIN Tickets t ON t.Id = o.TicketId " +
                    // Odemesi alinip KAPANMIS adisyonlarin siparisleri servis edilmis sayilir (son 90 dk haric)
                    "WHERE o.CreatedDateTime >= DATEADD(HOUR, -6, GETDATE()) AND (t.IsClosed = 0 OR o.CreatedDateTime >= DATEADD(MINUTE, -90, GETDATE())) " +
                    "ORDER BY o.CreatedDateTime, o.Id");
                var ticketIds = rows.Select(r => Convert.ToInt32(r[1], CultureInfo.InvariantCulture)).Distinct().ToList();
                ents = ticketIds.Count == 0 ? new List<object[]>() : Db.Query(
                    "SELECT te.Ticket_Id, te.EntityName, ISNULL(et.Name, '') FROM TicketEntities te LEFT JOIN EntityTypes et ON et.Id = te.EntityTypeId " +
                    "WHERE te.Ticket_Id IN (" + string.Join(",", ticketIds.Select(i => i.ToString(CultureInfo.InvariantCulture))) + ")");
            }
            catch (Exception ex) { SendJson(ctx.Response, 500, Err("Veritabanı okunamadı: " + ex.Message)); return; }

            // Masa adi: ayarlardaki varlik tipine (ör. "Masalar") ait varlik; yoksa tum varliklar
            string tableType = Json.Str(LoadSettings(), "entityType") ?? "";
            var tableOf = new Dictionary<int, string>();
            foreach (var g in ents.GroupBy(e => Convert.ToInt32(e[0], CultureInfo.InvariantCulture)))
            {
                var pick = g.Where(e => tableType != "" && string.Equals(Convert.ToString(e[2]), tableType, StringComparison.OrdinalIgnoreCase)).Select(e => Convert.ToString(e[1])).FirstOrDefault();
                tableOf[g.Key] = pick ?? string.Join(" · ", g.Select(e => Convert.ToString(e[1])).Where(s => !string.IsNullOrEmpty(s)));
            }

            var cards = new List<Dictionary<string, object>>();
            var byTicket = new Dictionary<int, Dictionary<string, object>>();
            lock (_kitchenLock)
            {
                KitchenLoad();
                foreach (var r in rows)
                {
                    int id = Convert.ToInt32(r[0], CultureInfo.InvariantCulture);
                    if (_kReady.ContainsKey(id) || IsVoidState(Convert.ToString(r[9]))) continue;
                    int tid = Convert.ToInt32(r[1], CultureInfo.InvariantCulture);
                    Dictionary<string, object> card;
                    if (!byTicket.TryGetValue(tid, out card))
                    {
                        string table;
                        tableOf.TryGetValue(tid, out table);
                        card = new Dictionary<string, object> {
                            { "ticketId", tid }, { "number", Convert.ToString(r[2]) ?? "" }, { "table", string.IsNullOrEmpty(table) ? "Adisyon " + Convert.ToString(r[2]) : table },
                            { "ageSec", Convert.ToInt32(r[7], CultureInfo.InvariantCulture) }, { "items", new List<object>() } };
                        byTicket[tid] = card;
                        cards.Add(card);
                    }
                    card["waiter"] = Convert.ToString(r[6]) ?? "";
                    var tags = OrderTagValue.Matches(Convert.ToString(r[8]) ?? "").Cast<Match>().Select(mm => Regex.Unescape(mm.Groups[1].Value)).Where(s => s != "").ToList();
                    string portion = Convert.ToString(r[4]) ?? "";
                    ((List<object>)card["items"]).Add(new Dictionary<string, object> {
                        { "id", id }, { "name", Convert.ToString(r[3]) ?? "" },
                        { "portion", Txt.Fold(portion) == "normal" ? "" : portion },
                        { "qty", Convert.ToDecimal(r[5], CultureInfo.InvariantCulture) }, { "tags", string.Join(", ", tags) } });
                }
            }
            SendJson(ctx.Response, 200, new Dictionary<string, object> { { "cards", cards } });
        }

        void ApiKitchenReady(HttpListenerContext ctx, bool ready)
        {
            var body = ReadJsonBody(ctx.Request);
            var ids = new List<int>();
            var arr = body.ContainsKey("orderIds") ? body["orderIds"] as object[] : null;
            if (arr != null) foreach (var o in arr) { int id; if (int.TryParse(Convert.ToString(o, CultureInfo.InvariantCulture), out id) && id > 0) ids.Add(id); }
            if (ids.Count == 0 || ids.Count > 500) { SendJson(ctx.Response, 400, Err("Sipariş seçilmedi.")); return; }
            Func<string, int, string> clip = (x, n) => { x = (x ?? "").Trim(); return x.Length > n ? x.Substring(0, n) : x; };
            long noticeId = 0;
            lock (_kitchenLock)
            {
                KitchenLoad();
                bool silent = string.Equals(Json.Str(body, "silent"), "true", StringComparison.OrdinalIgnoreCase);
                if (ready && silent) foreach (var id in ids) _kReady[id] = DateTime.UtcNow;   // "Tumunu temizle": bildirim YOK
                else if (ready)
                {
                    foreach (var id in ids) _kReady[id] = DateTime.UtcNow;
                    // Siparisi giren kisi su an bu garson sisteminde oturumu acik bir garson DEGILSE
                    // (ör. "MobileClient", "QR Menü" gibi sistem kullanicilari) bildirim HERKESE gider -
                    // kimseye ulasmamasindansa.
                    string waiter = clip(Json.Str(body, "waiter"), 60);
                    string wf = Txt.Fold(waiter);
                    if (wf == "" || !_sessions.Values.Any(x => x.ExpiresUtc > DateTime.UtcNow && Txt.Fold(x.UserName) == wf)) waiter = "";
                    var n = new KitchenNotice { Id = ++_kSeq, At = DateTime.Now.ToString("HH:mm", CultureInfo.InvariantCulture),
                        Table = clip(Json.Str(body, "table"), 60), Waiter = waiter, Items = clip(Json.Str(body, "items"), 200) };
                    _kNotices.Add(n);
                    noticeId = n.Id;
                }
                else foreach (var id in ids) _kReady.Remove(id);
                KitchenSave();
            }
            var s = CurrentSession(ctx.Request);
            Log.Write("Mutfak: " + (ready ? "hazir" : "geri alindi") + " - " + (Json.Str(body, "table") ?? "") + " (" + ids.Count + " kalem) - " + (s != null ? s.UserName : ""));
            SendJson(ctx.Response, 200, new Dictionary<string, object> { { "ok", true }, { "noticeId", noticeId } });
        }

        void ApiKitchenNotices(HttpListenerContext ctx)
        {
            var s = CurrentSession(ctx.Request);
            long since; long.TryParse(ctx.Request.QueryString["since"], out since);
            string me = Txt.Fold(s.UserName ?? "");
            List<object> items; long last;
            lock (_kitchenLock)
            {
                KitchenLoad();
                last = _kSeq;
                // Garson SADECE kendi siparislerinin bildirimini alir (garson adi bos ise herkes)
                items = _kNotices.Where(n => n.Id > since && (string.IsNullOrEmpty(n.Waiter) || Txt.Fold(n.Waiter) == me))
                    .Select(n => (object)new Dictionary<string, object> { { "id", n.Id }, { "at", n.At }, { "table", n.Table }, { "items", n.Items } }).ToList();
            }
            if (items.Count > 10) items = items.Skip(items.Count - 10).ToList();
            SendJson(ctx.Response, 200, new Dictionary<string, object> { { "last", last }, { "items", items } });
        }

        bool RequireAdmin(HttpListenerContext ctx)
        {
            if (IsAdminUnlocked(ctx.Request)) return true;
            SendJson(ctx.Response, 403, Err("Bu işlem için yönetici PIN'i gerekli."));
            return false;
        }

        void ApiLogin(HttpListenerContext ctx)
        {
            var req = ctx.Request;
            string ip = ClientIp(req);
            int wait = _limiter.LockedSeconds("pin:" + ip);
            if (wait > 0) { SendJson(ctx.Response, 429, Err("Çok fazla hatalı deneme. " + wait + " saniye sonra tekrar deneyin.")); return; }
            var body = ReadJsonBody(req);
            string pin = (Json.Str(body, "pin") ?? "").Trim();
            if (!Regex.IsMatch(pin, @"^\d{1,12}$")) { _limiter.Fail("pin:" + ip); SendJson(ctx.Response, 401, Err("PIN hatalı.")); return; }
            UserInfo u;
            try { u = Db.UserByPin(pin); }
            catch (Exception ex) { SendJson(ctx.Response, 500, Err("Veritabanına bağlanılamadı: " + ex.Message)); return; }
            if (u == null) { _limiter.Fail("pin:" + ip); SendJson(ctx.Response, 401, Err("PIN hatalı.")); return; }

            var tok = SambaLogin(u.Name, pin);
            if (tok.Access == null)
            {
                string msg = tok.Unreachable
                    ? "SambaPOS mesaj sunucusuna bağlanılamadı (" + _sambaHost + ":" + _sambaPort + "). SambaPOS açık ve Mesaj Sunucusu çalışıyor mu?"
                    : "SambaPOS girişi reddetti: " + tok.Error;
                SendJson(ctx.Response, 502, Err(msg));
                return;
            }
            _limiter.Success("pin:" + ip);
            var s = new Session
            {
                Token = Txt.RandomToken(),
                UserId = u.Id,
                UserName = u.Name,
                RoleId = u.RoleId,
                RoleName = u.RoleName,
                IsAdmin = u.IsAdmin,
                CanTakePayment = CanTakePayment(u.RoleName),
                ExpiresUtc = DateTime.UtcNow + SessionTtl,
                Pin = pin,
                SambaAccess = tok.Access,
                SambaRefresh = tok.Refresh,
                SambaExpiresUtc = DateTime.UtcNow.AddSeconds(Math.Max(60, tok.ExpiresIn - 60))
            };
            _sessions[s.Token] = s;
            CleanupSessions();
            SetCookie(ctx.Response, "garson_session", s.Token, (int)SessionTtl.TotalSeconds, "Lax");
            Log.Write("Giris: " + u.Name + " (" + u.RoleName + ")" + (s.CanTakePayment ? "" : " [odeme kisitli]") + " - " + ip);
            SendJson(ctx.Response, 200, MeObject(s));
        }

        Dictionary<string, object> MeObject(Session s)
        {
            s.CanTakePayment = CanTakePayment(s.RoleName);   // Ayarlar'dan rol listesi degismis olabilir
            var d = new Dictionary<string, object>
            {
                { "ok", true },
                { "userName", s.UserName },
                { "roleId", s.RoleId },
                { "roleName", s.RoleName },
                { "isAdmin", s.IsAdmin },
                { "canTakePayment", s.CanTakePayment }
            };
            if (!s.CanTakePayment)
            {
                try { d["paymentCommands"] = PaymentCommandNames(); }
                catch { d["paymentCommands"] = new string[0]; }
            }
            return d;
        }

        void CleanupSessions()
        {
            var now = DateTime.UtcNow;
            foreach (var kv in _sessions) if (kv.Value.ExpiresUtc < now) { Session x; _sessions.TryRemove(kv.Key, out x); }
            foreach (var kv in _adminTokens) if (kv.Value < now) { DateTime x; _adminTokens.TryRemove(kv.Key, out x); }
        }

        void ApiLogout(HttpListenerContext ctx)
        {
            string t = CookieValue(ctx.Request, "garson_session");
            Session s;
            if (!string.IsNullOrEmpty(t)) _sessions.TryRemove(t, out s);
            SetCookie(ctx.Response, "garson_session", "", 0, "Lax");
            SendJson(ctx.Response, 200, new Dictionary<string, object> { { "ok", true } });
        }

        void ApiMe(HttpListenerContext ctx)
        {
            var s = CurrentSession(ctx.Request);
            if (s == null) { SendJson(ctx.Response, 401, Err("Giriş gerekli.")); return; }
            SendJson(ctx.Response, 200, MeObject(s));
        }

        void ApiHealth(HttpListenerContext ctx)
        {
            bool sql;
            lock (_cacheLock)
            {
                if ((DateTime.UtcNow - _healthAt).TotalSeconds > 5)
                {
                    string err = null;
                    try { _healthSql = Db.Ping(out err); }
                    catch (Exception ex) { _healthSql = false; err = ex.Message; }
                    _healthSqlError = err;
                    _healthAt = DateTime.UtcNow;
                }
                sql = _healthSql;
            }
            bool samba = TcpProbe(_sambaHost, _sambaPort, 1500);
            var d = new Dictionary<string, object>
            {
                { "sql", sql }, { "samba", samba }, { "sambaHost", _sambaHost }, { "sambaPort", _sambaPort }, { "version", Program.Version }
            };
            if (!sql && IsAdminUnlocked(ctx.Request)) d["sqlError"] = _healthSqlError;
            SendJson(ctx.Response, 200, d);
        }

        void ApiLocalInfo(HttpListenerContext ctx)
        {
            var addrs = LanAddresses();
            SendJson(ctx.Response, 200, new Dictionary<string, object> { { "addresses", addrs }, { "port", _port } });
        }

        // ---------------------------------------------------------- Paylasilan ayarlar
        Dictionary<string, object> LoadSettings()
        {
            lock (_settingsLock)
            {
                if (!File.Exists(_settingsPath)) return new Dictionary<string, object>();
                try { return Json.AsDict(Json.Parse(File.ReadAllText(_settingsPath, Encoding.UTF8))); }
                catch (Exception ex) { Log.Write("settings.json okunamadi: " + ex.Message); return new Dictionary<string, object>(); }
            }
        }

        void ApiGetSettings(HttpListenerContext ctx)
        {
            SendJson(ctx.Response, 200, LoadSettings());
        }

        static readonly Regex SettingKey = new Regex(@"^[A-Za-z][A-Za-z0-9_]{0,48}$");

        void ApiSaveSettings(HttpListenerContext ctx)
        {
            if (!RequireAdmin(ctx)) return;
            var body = ReadJsonBody(ctx.Request);
            if (body.Count > 100) { SendJson(ctx.Response, 400, Err("Çok fazla ayar.")); return; }
            lock (_settingsLock)
            {
                var current = LoadSettings();
                foreach (var kv in body)
                {
                    if (!SettingKey.IsMatch(kv.Key)) continue;
                    if (kv.Value == null) { current.Remove(kv.Key); continue; }
                    string v = kv.Value is string ? (string)kv.Value : Json.Stringify(kv.Value);
                    if (kv.Value is bool) v = ((bool)kv.Value) ? "true" : "false";
                    else if (kv.Value is int || kv.Value is decimal || kv.Value is double || kv.Value is long) v = Convert.ToString(kv.Value, CultureInfo.InvariantCulture);
                    if (v.Length > 8000) continue;
                    current[kv.Key] = v;
                }
                current["_version"] = DateTime.UtcNow.Ticks.ToString(CultureInfo.InvariantCulture);
                Json.WriteFileAtomic(_settingsPath, Json.Pretty(current));
                Log.Write("Paylasilan ayarlar kaydedildi (" + current.Count + " anahtar) - " + ClientIp(ctx.Request));
                SendJson(ctx.Response, 200, new Dictionary<string, object> { { "ok", true }, { "_version", current["_version"] } });
            }
        }

        // ---------------------------------------------------------- Yonetici kilidi (Ayarlar sifresi)
        void ApiAdminUnlock(HttpListenerContext ctx)
        {
            string ip = ClientIp(ctx.Request);
            int wait = _limiter.LockedSeconds("admin:" + ip);
            if (wait > 0) { SendJson(ctx.Response, 429, Err("Çok fazla hatalı deneme. " + wait + " saniye sonra tekrar deneyin.")); return; }
            var body = ReadJsonBody(ctx.Request);
            string pin = (Json.Str(body, "pin") ?? "").Trim();
            UserInfo u = null;
            if (Regex.IsMatch(pin, @"^\d{1,12}$"))
            {
                try { u = Db.UserByPin(pin); }
                catch (Exception ex) { SendJson(ctx.Response, 500, Err("Veritabanına bağlanılamadı: " + ex.Message)); return; }
            }
            if (u == null || !u.IsAdmin)
            {
                _limiter.Fail("admin:" + ip);
                SendJson(ctx.Response, 401, Err(u == null ? "PIN hatalı." : "\"" + u.Name + "\" yönetici değil. SambaPOS'ta yönetici (Admin) rolündeki bir kullanıcının PIN'ini girin."));
                return;
            }
            _limiter.Success("admin:" + ip);
            string t = Txt.RandomToken();
            _adminTokens[t] = DateTime.UtcNow + AdminTtl;
            SetCookie(ctx.Response, "garson_admin", t, (int)AdminTtl.TotalSeconds, "Strict");
            Log.Write("Ayarlar kilidi acildi: " + u.Name + " - " + ip);
            SendJson(ctx.Response, 200, new Dictionary<string, object> { { "ok", true }, { "userName", u.Name } });
        }

        void ApiAdminLock(HttpListenerContext ctx)
        {
            string t = CookieValue(ctx.Request, "garson_admin");
            DateTime x;
            if (!string.IsNullOrEmpty(t)) _adminTokens.TryRemove(t, out x);
            SetCookie(ctx.Response, "garson_admin", "", 0, "Strict");
            SendJson(ctx.Response, 200, new Dictionary<string, object> { { "ok", true } });
        }

        // ---------------------------------------------------------- SQL listeleri (Ayarlar ekrani)
        List<string> SafeNames(string sql)
        {
            try { return Db.Names(sql); }
            catch (Exception ex) { Log.Write("Liste okunamadi (" + sql.Substring(0, Math.Min(40, sql.Length)) + "...): " + ex.Message); return new List<string>(); }
        }

        void ApiConfigOptions(HttpListenerContext ctx)
        {
            string err;
            bool ok;
            try { ok = Db.Ping(out err); }
            catch (Exception ex) { ok = false; err = ex.Message; }
            if (!ok) { SendJson(ctx.Response, 500, Err("Veritabanına bağlanılamadı: " + err)); return; }

            var screens = new List<object>();
            try
            {
                foreach (var r in Db.Query("SELECT es.Name, et.Name FROM EntityScreens es LEFT JOIN EntityTypes et ON et.Id = es.EntityTypeId ORDER BY es.Id"))
                    screens.Add(new Dictionary<string, object> { { "name", Convert.ToString(r[0]) }, { "entityType", Convert.ToString(r[1] ?? "") } });
            }
            catch (Exception ex) { Log.Write("Varlik ekranlari okunamadi: " + ex.Message); }

            var d = new Dictionary<string, object>
            {
                { "terminals", SafeNames("SELECT Name FROM Terminals ORDER BY Id") },
                { "departments", SafeNames("SELECT Name FROM Departments ORDER BY Id") },
                { "ticketTypes", SafeNames("SELECT Name FROM TicketTypes ORDER BY Id") },
                { "menus", SafeNames("SELECT Name FROM ScreenMenus ORDER BY Id") },
                { "entityScreens", screens },
                { "automationCommands", SafeNames("SELECT Name FROM AutomationCommands ORDER BY Id") },
                { "paymentTypes", SafeNames("SELECT Name FROM PaymentTypes ORDER BY SortOrder, Id") },
                { "userRoles", SafeNames("SELECT Name FROM UserRoles ORDER BY Id") },
                { "paymentRestrictedRoles", RestrictedRoles() }
            };
            SendJson(ctx.Response, 200, d);
        }

        // ---------------------------------------------------------- Odeme yetkisi
        // Oncelik: Ayarlar ekranindan kaydedilen (settings.json) liste, sonra config.json, sonra varsayilan.
        List<string> RestrictedRoles()
        {
            var fromSettings = Json.Str(LoadSettings(), "paymentRestrictedRoles");
            if (fromSettings != null)
            {
                try
                {
                    var arr = Json.Parse(fromSettings) as object[];
                    if (arr != null) return arr.Where(x => x != null).Select(x => Convert.ToString(x, CultureInfo.InvariantCulture)).ToList();
                }
                catch { }
            }
            var restricted = Config.StrList("paymentRestrictedRoles");
            if (restricted.Count == 0) restricted = new List<string> { "garson", "waiter" };
            return restricted;
        }

        bool CanTakePayment(string roleName)
        {
            string r = Txt.Fold(roleName);
            return !RestrictedRoles().Any(x => Txt.Fold(x) == r);
        }

        Regex PaymentPattern()
        {
            string custom = Config.Str("paymentCommandPattern");
            // "Hesap Yaz" (hesabi yazdir) ODEME DEGILDIR - garson adisyonu yazdirabilmeli.
            string pattern = string.IsNullOrWhiteSpace(custom) ? @"(odeme|kredi ?kart|nakit|payment|tahsil|hesap ?kapat)" : custom;
            try { return new Regex(pattern, RegexOptions.IgnoreCase); }
            catch { return new Regex(@"(odeme|kredi ?kart|nakit|payment|tahsil|hesap ?kapat)", RegexOptions.IgnoreCase); }
        }

        HashSet<string> PaymentTypeNamesFolded()
        {
            lock (_cacheLock)
            {
                if (_paymentNames != null && (DateTime.UtcNow - _paymentNamesAt).TotalSeconds < 60) return _paymentNames;
            }
            var set = new HashSet<string>(SafeNames("SELECT Name FROM PaymentTypes").Select(Txt.Fold));
            lock (_cacheLock) { _paymentNames = set; _paymentNamesAt = DateTime.UtcNow; }
            return set;
        }

        public bool IsPaymentCommand(string name)
        {
            string f = Txt.Fold(name);
            if (PaymentPattern().IsMatch(f) || PaymentPattern().IsMatch(name)) return true;
            return PaymentTypeNamesFolded().Contains(f);
        }

        List<string> PaymentCommandNames()
        {
            return SafeNames("SELECT Name FROM AutomationCommands ORDER BY Id").Where(IsPaymentCommand).ToList();
        }

        // ---------------------------------------------------------- SambaPOS token
        string ClientId()
        {
            string fixedId = Config.Str("sambaClientId");
            if (!string.IsNullOrWhiteSpace(fixedId)) return fixedId;
            lock (_cacheLock)
            {
                if (_clientId != null && (DateTime.UtcNow - _clientIdAt).TotalMinutes < 10) return _clientId;
            }
            string id = "mobilepos";
            try
            {
                var rows = Db.Query("SELECT TOP 1 Identifier FROM GraphqlClients WHERE Active = 1 ORDER BY CASE WHEN Identifier = 'mobilepos' THEN 0 WHEN Identifier = 'pda' THEN 1 ELSE 2 END, Id");
                if (rows.Count > 0 && rows[0][0] != null) id = Convert.ToString(rows[0][0]);
            }
            catch (Exception ex) { Log.Write("GraphqlClients okunamadi, 'mobilepos' kullanilacak: " + ex.Message); }
            lock (_cacheLock) { _clientId = id; _clientIdAt = DateTime.UtcNow; }
            return id;
        }

        SambaTokenResult RequestToken(string form)
        {
            var result = new SambaTokenResult();
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(SambaBase + "/Token");
                req.Method = "POST";
                req.ContentType = "application/x-www-form-urlencoded";
                req.Proxy = null;
                req.Timeout = 10000;
                req.ReadWriteTimeout = 10000;
                byte[] b = Encoding.UTF8.GetBytes(form);
                req.ContentLength = b.Length;
                using (var s = req.GetRequestStream()) s.Write(b, 0, b.Length);
                using (var resp = (HttpWebResponse)req.GetResponse())
                using (var sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                {
                    var d = Json.AsDict(Json.Parse(sr.ReadToEnd()));
                    result.Access = Json.Str(d, "access_token");
                    result.Refresh = Json.Str(d, "refresh_token");
                    int ei;
                    result.ExpiresIn = int.TryParse(Json.Str(d, "expires_in"), out ei) ? ei : 3600;
                }
            }
            catch (WebException ex)
            {
                if (ex.Response == null) { result.Unreachable = true; result.Error = ex.Message; return result; }
                try
                {
                    using (var sr = new StreamReader(ex.Response.GetResponseStream(), Encoding.UTF8))
                    {
                        var d = Json.AsDict(Json.Parse(sr.ReadToEnd()));
                        result.Error = Json.Str(d, "error_description") ?? Json.Str(d, "error") ?? ex.Message;
                    }
                }
                catch { result.Error = ex.Message; }
            }
            catch (Exception ex) { result.Error = ex.Message; }
            return result;
        }

        SambaTokenResult SambaLogin(string userName, string pin)
        {
            string cid = ClientId();
            string form = "grant_type=password&username=" + Uri.EscapeDataString(userName) + "&password=" + Uri.EscapeDataString(pin) +
                          "&client_id=" + Uri.EscapeDataString(cid) + "&client_secret=test";
            var r = RequestToken(form);
            if (r.Access != null || r.Unreachable) return r;
            // Yedek: config.json'da ozel bir API kullanicisi tanimliysa onunla dene
            string apiUser = Config.Str("sambaApiUser"), apiPin = Config.Str("sambaApiPin");
            if (!string.IsNullOrEmpty(apiUser) && !string.IsNullOrEmpty(apiPin))
            {
                Log.Write("SambaPOS token '" + userName + "' ile alinamadi (" + r.Error + "), config.json'daki API kullanicisi deneniyor.");
                var r2 = RequestToken("grant_type=password&username=" + Uri.EscapeDataString(apiUser) + "&password=" + Uri.EscapeDataString(apiPin) +
                                      "&client_id=" + Uri.EscapeDataString(cid) + "&client_secret=test");
                if (r2.Access != null) return r2;
            }
            Log.Write("SambaPOS token alinamadi (" + userName + ", istemci " + cid + "): " + r.Error);
            return r;
        }

        bool RenewSambaToken(Session s)
        {
            lock (s.Lock)
            {
                if (!string.IsNullOrEmpty(s.SambaRefresh))
                {
                    var r = RequestToken("grant_type=refresh_token&refresh_token=" + Uri.EscapeDataString(s.SambaRefresh) + "&client_id=" + Uri.EscapeDataString(ClientId()) + "&client_secret=test");
                    if (r.Access != null)
                    {
                        s.SambaAccess = r.Access; s.SambaRefresh = r.Refresh ?? s.SambaRefresh;
                        s.SambaExpiresUtc = DateTime.UtcNow.AddSeconds(Math.Max(60, r.ExpiresIn - 60));
                        return true;
                    }
                }
                var l = SambaLogin(s.UserName, s.Pin);
                if (l.Access == null) return false;
                s.SambaAccess = l.Access; s.SambaRefresh = l.Refresh;
                s.SambaExpiresUtc = DateTime.UtcNow.AddSeconds(Math.Max(60, l.ExpiresIn - 60));
                return true;
            }
        }

        // ============================================================== SambaPOS koprusu (/samba-lan)
        static readonly HashSet<string> SkipRequestHeaders = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "Host", "Connection", "Content-Length", "Transfer-Encoding", "Expect", "Cookie", "Authorization",
            "Keep-Alive", "Proxy-Connection", "Upgrade", "Origin", "Referer", "Accept", "Content-Type",
            "User-Agent", "If-Modified-Since", "Range", "Date", "TE", "Trailer"
        };
        static readonly HashSet<string> SkipResponseHeaders = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "Transfer-Encoding", "Content-Length", "Connection", "Keep-Alive", "Server", "Date", "Set-Cookie",
            "Access-Control-Allow-Origin", "Access-Control-Allow-Credentials", "Access-Control-Allow-Headers", "Access-Control-Allow-Methods", "Content-Type"
        };

        void ProxySamba(HttpListenerContext ctx)
        {
            var req = ctx.Request;
            var res = ctx.Response;
            var s = CurrentSession(req);
            if (s == null) { SendJson(res, 401, Err("Giriş gerekli.")); return; }

            string abs = req.Url.AbsolutePath;
            string sub = abs.StartsWith("/samba-lan", StringComparison.OrdinalIgnoreCase) ? abs.Substring("/samba-lan".Length) : abs;
            if (sub.Length == 0) sub = "/";

            // Tarayici artik SambaPOS'a KENDISI token almaz: token sunucuda, oturuma bagli.
            if (sub.Equals("/Token", StringComparison.OrdinalIgnoreCase))
            {
                ReadBody(req, 64 * 1024);
                SendJson(res, 200, new Dictionary<string, object>
                {
                    { "access_token", "garson-session" }, { "refresh_token", "garson-session" },
                    { "token_type", "bearer" }, { "expires_in", 43199 }, { "userName", s.UserName }
                });
                return;
            }
            // WebSocket yukseltmesi desteklenmiyor - SignalR otomatik olarak long polling'e duser
            if ((req.Headers["Upgrade"] ?? "").Length > 0) { res.StatusCode = 400; return; }

            byte[] body = (req.HttpMethod == "GET" || req.HttpMethod == "HEAD") ? new byte[0] : ReadBody(req, 10 * 1024 * 1024);
            bool isGraphql = sub.StartsWith("/api/graphql", StringComparison.OrdinalIgnoreCase);
            if (isGraphql)
            {
                if (req.HttpMethod != "POST") { SendJson(res, 405, Err("GraphQL sadece POST ile.")); return; }
                s.CanTakePayment = CanTakePayment(s.RoleName);   // Ayarlar'dan rol listesi degismis olabilir
                string reason;
                body = InspectGraphql(body, s, out reason);
                if (reason != null)
                {
                    Log.Write("ENGELLENDI: " + s.UserName + " (" + s.RoleName + "): " + reason);
                    SendJson(res, 403, new Dictionary<string, object>
                    {
                        { "error", reason },
                        { "errors", new object[] { new Dictionary<string, object> { { "message", reason } } } }
                    });
                    return;
                }
                if (s.SambaExpiresUtc < DateTime.UtcNow) RenewSambaToken(s);
            }

            bool retried = false;
            while (true)
            {
                HttpWebResponse up = null;
                try
                {
                    var fwd = (HttpWebRequest)WebRequest.Create(SambaBase + sub + req.Url.Query);
                    fwd.Method = req.HttpMethod;
                    fwd.Proxy = null;
                    fwd.AllowAutoRedirect = false;
                    fwd.KeepAlive = true;
                    fwd.Timeout = 300000;
                    fwd.ReadWriteTimeout = 300000;
                    foreach (string h in req.Headers.AllKeys)
                    {
                        if (SkipRequestHeaders.Contains(h)) continue;
                        try { fwd.Headers[h] = req.Headers[h]; } catch { }
                    }
                    if (req.AcceptTypes != null) fwd.Accept = req.Headers["Accept"];
                    if (!string.IsNullOrEmpty(req.ContentType)) fwd.ContentType = req.ContentType;
                    if (!string.IsNullOrEmpty(req.UserAgent)) fwd.UserAgent = req.UserAgent;
                    if (isGraphql) fwd.Headers["Authorization"] = "Bearer " + s.SambaAccess;
                    if (body.Length > 0 || (req.HttpMethod != "GET" && req.HttpMethod != "HEAD"))
                    {
                        fwd.ContentLength = body.Length;
                        using (var rs = fwd.GetRequestStream()) rs.Write(body, 0, body.Length);
                    }
                    try { up = (HttpWebResponse)fwd.GetResponse(); }
                    catch (WebException wex)
                    {
                        up = wex.Response as HttpWebResponse;
                        if (up == null) throw;
                    }

                    if (isGraphql && (int)up.StatusCode == 401 && !retried)
                    {
                        up.Close();
                        retried = true;
                        if (RenewSambaToken(s)) continue;
                        SendJson(res, 401, Err("SambaPOS oturumu yenilenemedi, tekrar giriş yapın."));
                        return;
                    }
                    CopyResponse(up, res);
                    return;
                }
                catch (WebException ex)
                {
                    Log.Write("SambaPOS koprusu hatasi (" + sub + "): " + ex.Message);
                    try { SendJson(res, 502, Err("SambaPOS mesaj sunucusuna erişilemedi. SambaPOS açık ve Mesaj Sunucusu etkin mi kontrol edin.")); } catch { }
                    return;
                }
                finally
                {
                    if (up != null) try { up.Close(); } catch { }
                }
            }
        }

        byte[] InspectGraphql(byte[] body, Session s, out string reason)
        {
            reason = null;
            object parsed;
            try { parsed = Json.Parse(Encoding.UTF8.GetString(body)); }
            catch { reason = "Geçersiz GraphQL isteği."; return body; }

            var ops = new List<Dictionary<string, object>>();
            var single = parsed as Dictionary<string, object>;
            if (single != null) ops.Add(single);
            else if (parsed is object[]) foreach (var o in (object[])parsed) { var d = o as Dictionary<string, object>; if (d != null) ops.Add(d); }
            if (ops.Count == 0) { reason = "Geçersiz GraphQL isteği."; return body; }

            bool changed = false;
            foreach (var op in ops)
            {
                string q = Json.Str(op, "query") ?? "";
                Dictionary<string, object> vars = null;
                object vo;
                if (op.TryGetValue("variables", out vo))
                {
                    vars = vo as Dictionary<string, object>;
                    if (vars == null && vo is string && ((string)vo).Trim().Length > 0)
                    {
                        try { vars = Json.Parse((string)vo) as Dictionary<string, object>; } catch { }
                    }
                }
                reason = GqlPolicy.Check(q, vars, s, IsPaymentCommand);
                if (reason != null) return body;
                string block;
                string q2 = GqlPolicy.EnforceUser(q, s, out block);
                if (block != null) { reason = block; return body; }
                if (!ReferenceEquals(q2, q) && q2 != q) { op["query"] = q2; changed = true; }
            }
            if (!changed) return body;
            return Encoding.UTF8.GetBytes(Json.Stringify(single != null ? (object)single : ops.ToArray()));
        }

        static void CopyResponse(HttpWebResponse up, HttpListenerResponse res)
        {
            res.StatusCode = (int)up.StatusCode;
            try { res.StatusDescription = up.StatusDescription; } catch { }
            foreach (string h in up.Headers.AllKeys)
            {
                if (SkipResponseHeaders.Contains(h)) continue;
                try { res.Headers[h] = up.Headers[h]; } catch { }
            }
            if (!string.IsNullOrEmpty(up.ContentType)) res.ContentType = up.ContentType;
            res.Headers["Cache-Control"] = up.Headers["Cache-Control"] ?? "no-store";
            long len = up.ContentLength;
            if (len >= 0) res.ContentLength64 = len;
            else res.SendChunked = true;
            using (var us = up.GetResponseStream())
            {
                var buf = new byte[8192];
                int n;
                while ((n = us.Read(buf, 0, buf.Length)) > 0)
                {
                    res.OutputStream.Write(buf, 0, n);
                    res.OutputStream.Flush();
                }
            }
        }

        // ============================================================== Sunucu Bul / ag
        static bool IsPrivate(IPAddress ip)
        {
            var b = ip.GetAddressBytes();
            if (b.Length != 4) return false;
            return b[0] == 10 || (b[0] == 172 && b[1] >= 16 && b[1] <= 31) || (b[0] == 192 && b[1] == 168);
        }

        static List<IPAddress> LocalIPv4()
        {
            var list = new List<IPAddress>();
            try
            {
                foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (ni.OperationalStatus != OperationalStatus.Up || ni.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                    foreach (var ua in ni.GetIPProperties().UnicastAddresses)
                        if (ua.Address.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(ua.Address)) list.Add(ua.Address);
                }
            }
            catch { }
            return list;
        }

        // Ozel (LAN) adresler ONCE - telefonlarin kullanacagi adres budur
        public static List<string> LanAddresses()
        {
            return LocalIPv4().OrderBy(a => IsPrivate(a) ? 0 : 1).Select(a => a.ToString()).Distinct().ToList();
        }

        static bool TcpProbe(string host, int port, int timeoutMs)
        {
            try
            {
                using (var c = new TcpClient())
                {
                    var ar = c.BeginConnect(host, port, null, null);
                    if (!ar.AsyncWaitHandle.WaitOne(timeoutMs)) return false;
                    c.EndConnect(ar);
                    return true;
                }
            }
            catch { return false; }
        }

        void ApiScan(HttpListenerContext ctx)
        {
            var bases = LocalIPv4().Where(IsPrivate).Select(a => { var b = a.GetAddressBytes(); return b[0] + "." + b[1] + "." + b[2]; }).Distinct().ToList();
            var result = new Dictionary<string, object> { { "port", _sambaPort }, { "current", _sambaHost } };
            if (bases.Count == 0)
            {
                result["found"] = new string[0];
                result["scanned"] = false;
                result["reason"] = "public-network";
                SendJson(ctx.Response, 200, result);
                return;
            }
            var hosts = new List<string>();
            foreach (var b in bases) for (int i = 1; i <= 254; i++) hosts.Add(b + "." + i);
            var found = new ConcurrentBag<string>();
            Parallel.ForEach(hosts, new ParallelOptions { MaxDegreeOfParallelism = 48 }, h => { if (TcpProbe(h, _sambaPort, 400)) found.Add(h); });
            if (TcpProbe("127.0.0.1", _sambaPort, 400)) found.Add("127.0.0.1");
            result["found"] = found.Distinct().OrderBy(x => x == "127.0.0.1" ? "" : x).ToList();
            result["scanned"] = true;
            result["local"] = LanAddresses();
            SendJson(ctx.Response, 200, result);
        }

        void ApiSetSambaHost(HttpListenerContext ctx)
        {
            var body = ReadJsonBody(ctx.Request);
            string host = (Json.Str(body, "host") ?? "").Trim();
            int port;
            if (!int.TryParse(Json.Str(body, "port"), out port) || port < 1 || port > 65535) port = _sambaPort;
            if (host.Length == 0 || host.Length > 253 || !Regex.IsMatch(host, @"^[A-Za-z0-9.\-]+$"))
            {
                SendJson(ctx.Response, 400, Err("Geçersiz adres."));
                return;
            }
            _sambaHost = host;
            _sambaPort = port;
            Config.Set("sambaposHost", host);
            Config.Set("sambaposPort", port);
            // Eski mesaj sunucusunun token'lari yenisinde gecersiz - herkes yeniden girsin
            _sessions.Clear();
            lock (_cacheLock) { _clientId = null; }
            Log.Write("SambaPOS mesaj sunucusu degisti: " + host + ":" + port);
            SendJson(ctx.Response, 200, new Dictionary<string, object> { { "ok", true }, { "sambaHost", host }, { "sambaPort", port } });
        }

        // ============================================================== Statik dosyalar
        static readonly Dictionary<string, string> Mime = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { ".html", "text/html; charset=utf-8" }, { ".htm", "text/html; charset=utf-8" },
            { ".js", "text/javascript; charset=utf-8" }, { ".css", "text/css; charset=utf-8" },
            { ".json", "application/json; charset=utf-8" }, { ".webmanifest", "application/manifest+json; charset=utf-8" },
            { ".map", "application/json; charset=utf-8" }, { ".txt", "text/plain; charset=utf-8" },
            { ".png", "image/png" }, { ".jpg", "image/jpeg" }, { ".jpeg", "image/jpeg" }, { ".gif", "image/gif" },
            { ".webp", "image/webp" }, { ".svg", "image/svg+xml" }, { ".ico", "image/x-icon" },
            { ".woff", "font/woff" }, { ".woff2", "font/woff2" }, { ".ttf", "font/ttf" },
            { ".apk", "application/vnd.android.package-archive" }, { ".exe", "application/octet-stream" }
        };

        void ServeStatic(HttpListenerContext ctx, string path)
        {
            var req = ctx.Request;
            var res = ctx.Response;
            if (req.HttpMethod != "GET" && req.HttpMethod != "HEAD") { res.StatusCode = 405; return; }
            string rel;
            try { rel = Uri.UnescapeDataString(path).TrimStart('/'); } catch { rel = ""; }
            if (rel.Length == 0) rel = "index.html";
            string full;
            try { full = Path.GetFullPath(Path.Combine(_wwwRoot, rel.Replace('/', '\\'))); }
            catch { NotFound(res); return; }
            if (!full.StartsWith(_wwwRoot + "\\", StringComparison.OrdinalIgnoreCase)) { NotFound(res); return; }
            if (Directory.Exists(full)) full = Path.Combine(full, "index.html");
            string ext = Path.GetExtension(full);
            string mime;
            if (!Mime.TryGetValue(ext, out mime) || !File.Exists(full)) { NotFound(res); return; }

            var fi = new FileInfo(full);
            DateTime lm = fi.LastWriteTimeUtc;
            lm = new DateTime(lm.Year, lm.Month, lm.Day, lm.Hour, lm.Minute, lm.Second, DateTimeKind.Utc);
            string etag = "\"" + lm.Ticks.ToString("x", CultureInfo.InvariantCulture) + "-" + fi.Length.ToString("x", CultureInfo.InvariantCulture) + "\"";
            res.ContentType = mime;
            // Her istekte dogrula (guncelleme HEMEN gorunsun), degismediyse 304 (hizli)
            res.Headers["Cache-Control"] = "no-cache";
            res.Headers["ETag"] = etag;
            res.Headers["Last-Modified"] = lm.ToString("R", CultureInfo.InvariantCulture);
            if (req.Headers["If-None-Match"] == etag) { res.StatusCode = 304; return; }

            bool text = mime.StartsWith("text/") || mime.Contains("json") || mime.Contains("svg");
            bool gzip = text && fi.Length > 1024 && (req.Headers["Accept-Encoding"] ?? "").IndexOf("gzip", StringComparison.OrdinalIgnoreCase) >= 0;
            byte[] data;
            if (gzip)
            {
                Tuple<DateTime, byte[]> cached;
                if (!_gzCache.TryGetValue(full, out cached) || cached.Item1 != fi.LastWriteTimeUtc)
                {
                    byte[] raw = File.ReadAllBytes(full);
                    using (var ms = new MemoryStream())
                    {
                        using (var gz = new GZipStream(ms, CompressionMode.Compress, true)) gz.Write(raw, 0, raw.Length);
                        cached = Tuple.Create(fi.LastWriteTimeUtc, ms.ToArray());
                    }
                    _gzCache[full] = cached;
                }
                data = cached.Item2;
                res.Headers["Content-Encoding"] = "gzip";
                res.Headers["Vary"] = "Accept-Encoding";
            }
            else
            {
                if (req.HttpMethod == "HEAD") { res.ContentLength64 = fi.Length; return; }
                // buyuk dosyalar (apk/exe) akis olarak
                if (fi.Length > 4 * 1024 * 1024)
                {
                    res.ContentLength64 = fi.Length;
                    using (var fs = File.OpenRead(full)) fs.CopyTo(res.OutputStream);
                    return;
                }
                data = File.ReadAllBytes(full);
            }
            res.ContentLength64 = data.Length;
            if (req.HttpMethod == "HEAD") return;
            res.OutputStream.Write(data, 0, data.Length);
        }

        static void NotFound(HttpListenerResponse res)
        {
            byte[] b = Encoding.UTF8.GetBytes("Bulunamadı");
            res.StatusCode = 404;
            res.ContentType = "text/plain; charset=utf-8";
            res.ContentLength64 = b.Length;
            res.OutputStream.Write(b, 0, b.Length);
        }
    }
}
