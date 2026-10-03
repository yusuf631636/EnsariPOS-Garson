/* EnsariPOS Garson Direkt (bagimsiz APK) - 02.10.2026
   Mevcut Garson ekranlari (www) HIC DEGISTIRILMEDEN, exe/bulut olmadan dogrudan
   SambaPOS mesaj sunucusuna (IP:9000) baglanir. Bu dosya her sayfada EN BASTA yuklenir ve
   C# Garson servisinin (EnsariGarsonSrv) yaptigi isi telefonda yapar:
   - /samba-lan/...  -> http://<SambaPOS IP>:<port>/... (token telefonda, istemci EnsariGarson)
   - /api/login      -> PIN SambaPOS'a sorulur (getUser(pin)); PIN hicbir yere KAYDEDILMEZ
   - /api/settings, /api/admin/*, /api/health ... -> localStorage + GraphQL
   - Odeme yetkisi olmayan rolden odeme komutlari gizlenir/engellenir
   ES5 yazim (eski Android WebView). */
(function () {
    'use strict';
    var LS = window.localStorage;
    var CLIENT_ID = 'EnsariGarson';
    var APP_VERSION = '1.1.0';
    var SESSION_MS = 12 * 3600 * 1000, ADMIN_MS = 30 * 60 * 1000;
    var RX = window.XMLHttpRequest;

    function jget(k, d) { try { var v = JSON.parse(LS.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }
    function jset(k, v) { try { if (v == null) LS.removeItem(k); else LS.setItem(k, JSON.stringify(v)); } catch (e) { } }
    function form(o) { var a = []; for (var k in o) if (o.hasOwnProperty(k)) a.push(encodeURIComponent(k) + '=' + encodeURIComponent(o[k] == null ? '' : o[k])); return a.join('&'); }
    function gqlStr(s) { return JSON.stringify(String(s == null ? '' : s)); }
    function fold(s) {
        return String(s || '').toLocaleLowerCase('tr').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/\s+/g, ' ').trim();
    }
    function uniq(a) { var o = [], seen = {}; (a || []).forEach(function (x) { x = String(x == null ? '' : x).trim(); if (x && !seen[fold(x)]) { seen[fold(x)] = 1; o.push(x); } }); return o; }

    var BG = window.BG = { version: APP_VERSION, clientId: CLIENT_ID, fold: fold, jget: jget, jset: jset };

    // ------------------------------------------------------------ baglanti adresi
    // bgConn = { host, port, user, pass }  host: "192.168.1.20", "85.10.20.30" (sabit IP), "kasa.firma.com" ya da tam adres "http://x:9000"
    BG.conn = function () { return jget('bgConn', null); };
    BG.parseHost = function (host, port) {
        var h = String(host || '').trim().replace(/\/+$/, '');
        if (!h) return null;
        if (/^https?:\/\//i.test(h)) return { host: h, port: null };
        var m = h.match(/^\[?([^\]\/]+?)\]?:(\d{1,5})$/);
        if (m) return { host: m[1], port: parseInt(m[2], 10) };
        return { host: h, port: parseInt(port, 10) || 9000 };
    };
    BG.base = function (c) {
        c = c || BG.conn();
        if (!c || !c.host) return '';
        if (/^https?:\/\//i.test(c.host)) return String(c.host).replace(/\/+$/, '');
        return 'http://' + c.host + ':' + (c.port || 9000);
    };
    BG.label = function (c) { c = c || BG.conn(); return c ? (c.name ? c.name + ' · ' : '') + String(BG.base(c)).replace(/^https?:\/\//, '') : ''; };

    // ------------------------------------------------------------ dusuk seviye istek (gercek XHR)
    BG.raw = function (method, url, headers, body, timeout, cb) {
        var x = new RX(), done = false;
        function fin(st, txt) { if (done) return; done = true; cb(st, txt || '', x); }
        try {
            x.open(method, url, true);
            for (var k in headers) if (headers.hasOwnProperty(k)) x.setRequestHeader(k, headers[k]);
            if (timeout) x.timeout = timeout;
            x.onreadystatechange = function () { if (x.readyState === 4) fin(x.status, x.responseText); };
            x.ontimeout = function () { fin(0, ''); };
            x.onerror = function () { fin(0, ''); };
            x.send(body == null ? null : body);
        } catch (e) { setTimeout(function () { fin(0, ''); }, 0); }
        return x;
    };
    // SambaPOS mesaj sunucusu mu? (SignalR negotiate cevabi ConnectionToken icerir)
    BG.probe = function (base, timeout, cb) {
        BG.raw('GET', base + '/signalr/negotiate?clientProtocol=1.5&connectionData=%5B%5D&_=' + Date.now(), {}, null, timeout || 2500, function (st, txt) {
            cb(st === 200 && /ConnectionToken/.test(txt));
        });
    };

    // ------------------------------------------------------------ token (baglanti kullanicisi)
    function tokenError(st, txt) {
        if (st === 0) return 'SambaPOS mesaj sunucusuna ulaşılamıyor (' + BG.label() + '). Bilgisayar ve SambaPOS açık mı, telefon aynı ağda mı?';
        var e = {}; try { e = JSON.parse(txt || '{}'); } catch (x) { }
        if (e.error === 'invalid_client') return 'SambaPOS\'ta "' + CLIENT_ID + '" uygulama kaydı yok. Restoran bilgisayarında Garson Direkt kurulum aracını bir kez çalıştırın.';
        if (e.error === 'invalid_grant') return 'Bağlantı kullanıcısı adı veya şifresi hatalı. (SambaPOS kullanıcısının "Şifre" alanı yazılır, PIN değil.)';
        return 'SambaPOS girişi reddetti: ' + (e.error_description || e.error || ('HTTP ' + st));
    }
    var tokWait = null;
    BG.login = function (c, cb) {   // c: {host,port,user,pass} -> cb(err, tok)
        BG.raw('POST', BG.base(c) + '/Token', { 'Content-Type': 'application/x-www-form-urlencoded' },
            form({ grant_type: 'password', client_id: CLIENT_ID, username: c.user, password: c.pass }), 12000, function (st, txt) {
                var t = null; try { t = JSON.parse(txt); } catch (e) { }
                if (st === 200 && t && t.access_token) return cb(null, { access: t.access_token, exp: Date.now() + Math.max(60, (t.expires_in || 3600) - 120) * 1000 });
                cb(tokenError(st, txt));
            });
    };
    BG.token = function (cb, force) {
        var t = jget('bgTok', null);
        if (!force && t && t.access && t.exp > Date.now() && t.base === BG.base()) return cb(t.access);
        if (tokWait) { tokWait.push(cb); return; }
        var c = BG.conn();
        if (!c || !c.user) return cb(null, 'Bağlantı ayarı yapılmamış.');
        tokWait = [cb];
        BG.login(c, function (err, tok) {
            if (tok) { tok.base = BG.base(c); jset('bgTok', tok); }
            var list = tokWait; tokWait = null;
            list.forEach(function (f) { f(tok ? tok.access : null, err); });
        });
    };
    // ------------------------------------------------------------ sessiz yeniden baglanma (03.10.2026)
    // Kayitli sunucuya ulasilamazsa (kasa PC'sinin yerel IP'si degisti vb.) ag taranir ve KAYITLI baglanti
    // kullanicisiyla denenir - garsona hicbir sey sorulmaz. Sabit IP / alan adi kayitlarinda tarama yapilmaz.
    function isLan(h) { return /^(10\.\d+|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d+\.\d+$/.test(String(h || '')); }
    var recWait = null;
    BG.reconnect = function (cb) {   // cb(ok)
        if (recWait) { recWait.push(cb); return; }
        var c = BG.conn(); if (!c || !c.user) return cb(false);
        recWait = [cb];
        function fin(ok) { var l = recWait; recWait = null; l.forEach(function (f) { f(ok); }); }
        BG.probe(BG.base(c), 2500, function (ok) {
            if (ok) return fin(true);
            if (!isLan(c.host)) return fin(false);
            var tried = {}, settled = false, logins = 0, scanDone = false;
            BG.scan(c.port || 9000, function (h, p) {
                if (settled || tried[h]) return; tried[h] = 1; logins++;
                var nc = { host: h, port: p, user: c.user, pass: c.pass, name: c.name };
                BG.login(nc, function (err, tok) {
                    logins--;
                    if (!settled && tok) { settled = true; tok.base = BG.base(nc); jset('bgConn', nc); jset('bgTok', tok); return fin(true); }
                    if (!settled && scanDone && !logins) fin(false);
                });
            }, function () { scanDone = true; if (!settled && !logins) fin(false); });
        });
    };

    BG.gql = function (query, cb) {   // cb(err, data)
        BG.token(function (tok, err) {
            if (!tok) return cb(err || 'Token alınamadı.');
            (function send(tk, retried, recTried) {
                BG.raw('POST', BG.base() + '/api/graphql', { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tk },
                    JSON.stringify({ query: query }), 20000, function (st, txt) {
                        if (st === 401 && !retried) return BG.token(function (t2, e2) { if (!t2) cb(e2); else send(t2, true, recTried); }, true);
                        // ag hatasi: bir kez sessizce sunucuyu yeniden bul, sonra tekrar dene
                        if (st === 0 && !recTried) return BG.reconnect(function (ok) {
                            if (!ok) return cb('SambaPOS mesaj sunucusuna ulaşılamıyor.');
                            BG.token(function (t3, e3) { if (!t3) cb(e3); else send(t3, true, true); });
                        });
                        if (st === 0) return cb('SambaPOS mesaj sunucusuna ulaşılamıyor.');
                        var r = null; try { r = JSON.parse(txt); } catch (e) { }
                        if (!r) return cb('SambaPOS cevabı okunamadı (HTTP ' + st + ').');
                        if (r.errors && r.errors.length && !r.data) return cb(r.errors[0].message || 'GraphQL hatası');
                        cb(null, r.data || {}, r.errors);
                    });
            })(tok, false, false);
        });
    };

    // ------------------------------------------------------------ PIN -> SambaPOS kullanicisi
    var LOCK_KEY = 'bgPinFail';
    function lockedSeconds() { var f = jget(LOCK_KEY, null); return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0; }
    function pinFail() { var f = jget(LOCK_KEY, { n: 0 }); f.n = (f.n || 0) + 1; if (f.n >= 5) { f.until = Date.now() + 30000 * Math.min(10, f.n - 4); } jset(LOCK_KEY, f); }
    BG.userByPin = function (pin, cb) {   // cb(err, user)
        var w = lockedSeconds();
        if (w) return cb('Çok fazla hatalı deneme. ' + w + ' saniye sonra tekrar deneyin.', null, 429);
        if (!/^\d{1,12}$/.test(pin || '')) { pinFail(); return cb('PIN hatalı.', null, 401); }
        BG.gql('{u:getUser(pin:' + gqlStr(pin) + '){name terminal{name} userRole{id name isAdmin}}}', function (err, d) {
            if (err) {
                // SambaPOS getUser'i yalnizca yonetici yetkili kullaniciya acar. Baglanti kullanicisi
                // yonetici degilse "Authorization is required ... getUser" doner - ham metin yerine aciklama.
                if (/authorization is required|auth-required|access getuser/i.test(err))
                    return cb('Bağlantı kullanıcısının yönetici yetkisi yok, PIN kontrol edilemiyor. SambaPOS\'ta bu uygulamanın bağlantı kullanıcısını (ilk kurulumda yazdığınız kullanıcı) Yönetici (Admin) rolüne alın.', null, 403);
                return cb(err, null, 502);
            }
            var u = d && d.u;
            if (!u || !u.name || u.name === '*') { pinFail(); return cb('PIN hatalı.', null, 401); }
            jset(LOCK_KEY, null);
            var role = u.userRole || {};
            var isAdmin = role.isAdmin != null ? !!role.isAdmin : /admin|yonetici/.test(fold(role.name));
            cb(null, { userName: u.name, roleId: role.id || 0, roleName: role.name || '', isAdmin: isAdmin, terminal: u.terminal && u.terminal.name });
        });
    };

    // ------------------------------------------------------------ odeme yetkisi (C# GqlPolicy'nin telefon hali)
    function restrictedRoles() {
        var v = jget('paymentRestrictedRoles', null);
        return Array.isArray(v) ? v : ['garson', 'waiter'];
    }
    function canTakePayment(roleName) { var r = fold(roleName); return !restrictedRoles().some(function (x) { return fold(x) === r; }); }
    var PAY_RE = /(odeme|kredi ?kart|nakit|payment|tahsil|hesap ?kapat)/i;
    function isPaymentCommand(name) {
        var f = fold(name);
        if (PAY_RE.test(f)) return true;
        return (jget('bgPayTypes', []) || []).some(function (p) { return fold(p) === f; });
    }
    BG.session = function () { var s = jget('bgSession', null); return s && s.exp > Date.now() ? s : null; };
    function meObject(s) {
        s.canTakePayment = canTakePayment(s.roleName);
        var d = { ok: true, userName: s.userName, roleId: s.roleId, roleName: s.roleName, isAdmin: s.isAdmin, canTakePayment: s.canTakePayment };
        if (!s.canTakePayment) d.paymentCommands = uniq((jget('bgPayTypes', []) || []).concat(jget('bgPayCmds', []) || []));
        return d;
    }
    function stripComments(q) { return String(q || '').replace(/"(?:[^"\\]|\\.)*"|#[^\n]*/g, function (m) { return m.charAt(0) === '#' ? '' : m; }); }
    function policy(bodyText) {
        var s = BG.session();
        if (!s || canTakePayment(s.roleName)) return null;
        var ops; try { ops = JSON.parse(bodyText || '{}'); } catch (e) { return 'Geçersiz GraphQL isteği.'; }
        if (!Array.isArray(ops)) ops = [ops];
        var deny = '"' + s.userName + '" (' + s.roleName + ') ödeme alma yetkisine sahip değil.';
        for (var i = 0; i < ops.length; i++) {
            var q = stripComments(ops[i] && ops[i].query), vars = (ops[i] && ops[i].variables) || {};
            if (typeof vars === 'string') { try { vars = JSON.parse(vars); } catch (e) { vars = {}; } }
            if (/\b(payTerminalTicket|addCalculationToTerminalTicket|settleTerminalTicket|payTicket)\b/i.test(q)) return deny;
            var re = /\bexecuteAutomationCommand(?:ForTerminalTicket)?\s*\(([^)]*)\)/gi, m;
            while ((m = re.exec(q))) {
                var nm = m[1].match(/\bname\s*:\s*(?:"((?:[^"\\]|\\.)*)"|\$([A-Za-z_]\w*))/);
                var name = nm ? (nm[1] != null ? JSON.parse('"' + nm[1] + '"') : vars[nm[2]]) : null;
                if (name == null || isPaymentCommand(name)) return deny;
            }
        }
        return null;
    }
    // Yetkisiz kullaniciya adisyon ekraninda odeme komut butonlari hic gelmesin
    function filterButtons(text) {
        try {
            var r = JSON.parse(text), changed = false, learned = jget('bgPayCmds', []) || [];
            (function walk(o) {
                if (!o || typeof o !== 'object') return;
                for (var k in o) if (o.hasOwnProperty(k)) {
                    var v = o[k];
                    if (Array.isArray(v) && v.length && v[0] && typeof v[0] === 'object' && 'canExecute' in v[0] || (Array.isArray(v) && v.length && v[0] && v[0].name && 'caption' in v[0])) {
                        o[k] = v.filter(function (b) { var p = isPaymentCommand(b.name); if (p) { learned.push(b.name); changed = true; } return !p; });
                    } else walk(v);
                }
            })(r);
            if (changed) { jset('bgPayCmds', uniq(learned)); return JSON.stringify(r); }
        } catch (e) { }
        return text;
    }

    // ------------------------------------------------------------ SambaPOS listeleri (Ayarlar ekrani)
    // GraphQL'de terminal/departman/adisyon tipi/menu listesi YOK. SambaPOS'un kendi rapor motoru
    // (getCustomReport + REPORT SQL DETAILS) denenir; olmazsa kayitli degerler + yaygin adlar onerilir.
    function reportLists(cb) {
        var parts = [['terminals', 'Terminals'], ['departments', 'Departments'], ['ticketTypes', 'TicketTypes'], ['menus', 'ScreenMenus'], ['automationCommands', 'AutomationCommands'], ['entityTypes', 'EntityTypes']];
        var tpl = parts.map(function (p, i) { return '[L' + i + ':1]\n{REPORT SQL DETAILS:SELECT Id,Name FROM ' + p[1] + ' ORDER BY Id:F.Id,F.Name}'; }).join('\n');
        BG.gql('{r:getCustomReport(name:"EnsariGarsonListe",report:' + gqlStr(tpl) + '){tables{name rows{cells}}}}', function (err, d) {
            var out = {};
            if (!err && d && d.r && d.r.tables) {
                d.r.tables.forEach(function (t) {
                    var m = /^L(\d+)$/.exec(t.name || ''); if (!m || !parts[+m[1]]) return;
                    var key = parts[+m[1]][0];
                    out[key] = (t.rows || []).map(function (r) { return { id: parseInt(r.cells && r.cells[0], 10), name: r.cells && r.cells[1] }; }).filter(function (x) { return x.name; });
                });
            }
            cb(out);
        });
    }
    BG.options = function (roleId, cb) {
        var rid = parseInt(roleId, 10) || 1, res = {}, n = 0;
        function part() { if (++n === 3) finish(); }
        BG.gql('{s:getEntityScreens(roleId:' + rid + '){name EntityTypeId} p:getPaymentTypes(userRoleId:' + rid + '){name} r:getUserRoles{name}}', function (err, d) { res.err = err; res.d = d || {}; part(); });
        // deneme modunda (gelistirme testi) liste raporu ve adisyon taramasi yapilmaz
        var dry = LS.getItem('bgDryRun') === '1';
        if (dry) { res.t = []; part(); } else BG.gql('{t:getTickets(isClosed:false){entities{type typeId}}}', function (err, d) { res.t = (d && d.t) || []; part(); });
        if (dry) { res.l = {}; part(); } else reportLists(function (l) { res.l = l; part(); });
        function finish() {
            if (res.err) return cb(res.err);
            var l = res.l || {}, typeName = {};
            (l.entityTypes || []).forEach(function (t) { typeName[t.id] = t.name; });
            res.t.forEach(function (tk) { (tk.entities || []).forEach(function (e) { if (e.typeId && e.type && !typeName[e.typeId]) typeName[e.typeId] = e.type; }); });
            // Acilis ekraninin varlik tipi adi (Ayarlar'da elle de yazilabilir)
            var screens = (res.d.s || []), savedScreen = LS.getItem('entityScreen'), savedType = LS.getItem('entityType');
            screens.forEach(function (s) { if (s.entityTypeId != null && s.name === savedScreen && savedType && !typeName[s.entityTypeId]) typeName[s.entityTypeId] = savedType; });
            var names = function (a) { return (a || []).map(function (x) { return x.name; }); };
            var payTypes = names(res.d.p);
            jset('bgPayTypes', payTypes);
            var s = BG.session();
            cb(null, {
                fromReport: !!(l.departments && l.departments.length),
                terminals: uniq(names(l.terminals).concat([LS.getItem('terminal'), s && s.terminal, 'Server', 'Sunucu'])),
                departments: uniq(names(l.departments).concat((LS.getItem('department') || '').split(','), jget('departmentsAll', []), ['Restoran'])),
                ticketTypes: uniq(names(l.ticketTypes).concat([LS.getItem('ticketType'), 'Adisyon'])),
                menus: uniq(names(l.menus).concat([LS.getItem('menu'), 'Menu', 'Menü'])),
                entityScreens: screens.map(function (x) { return { name: x.name, entityType: typeName[x.entityTypeId] || '', entityTypeId: x.entityTypeId }; }),
                automationCommands: uniq(names(l.automationCommands).concat((LS.getItem('automation') || 'Hesap Yaz').split(','))),
                paymentTypes: payTypes,
                userRoles: names(res.d.r),
                paymentRestrictedRoles: restrictedRoles()
            });
        }
    };

    // ------------------------------------------------------------ ag taramasi (Sunucu Bul)
    BG.myIp = function (cb) {
        var ni = window.networkinterface, called = false;
        function once(v) { if (!called) { called = true; cb(typeof v === 'string' ? v : (v && v.ip) || null); } }
        if (!ni || !ni.getWiFiIPAddress) return once(null);
        setTimeout(function () { once(null); }, 3000);
        try { ni.getWiFiIPAddress(once, function () { once(null); }); } catch (e) { once(null); }
    };
    BG.scan = function (port, onFound, onDone, onProgress) {
        port = parseInt(port, 10) || 9000;
        BG.myIp(function (ip) {
            var m = /^(\d+\.\d+\.\d+)\.(\d+)$/.exec(String(ip || ''));
            if (!m) return onDone({ scanned: false, ip: ip });
            var pre = m[1], list = [], i, next = 0, active = 0, done = 0, found = [];
            var mine = parseInt(m[2], 10);
            for (i = 1; i < 255; i++) list.push(i);
            // telefona yakin adresler once (kasa genelde .1-.50 arasi)
            list.sort(function (a, b) { return Math.abs(a - mine) - Math.abs(b - mine); });
            function pump() {
                while (active < 32 && next < list.length) {
                    (function (host) {
                        active++;
                        BG.probe('http://' + host + ':' + port, 1800, function (ok) {
                            active--; done++;
                            if (ok) { found.push(host); onFound(host, port); }
                            if (onProgress) onProgress(done, list.length);
                            if (done === list.length) onDone({ scanned: true, ip: ip, found: found, port: port });
                            else pump();
                        });
                    })(pre + '.' + list[next++]);
                }
            }
            pump();
        });
    };

    // ------------------------------------------------------------ sahte /api/* uclari (C# servisin yerine)
    function adminUnlocked() { return (jget('bgAdminUntil', 0) || 0) > Date.now(); }
    function virtualApi(method, path, query, body, cb) {
        var b = {}; try { b = JSON.parse(body || '{}') || {}; } catch (e) { }
        switch (path) {
            case '/api/login':
                return BG.userByPin(String(b.pin || '').trim(), function (err, u, st) {
                    if (err) return cb(st || 401, { error: err });
                    var s = { userName: u.userName, roleId: u.roleId, roleName: u.roleName, isAdmin: u.isAdmin, terminal: u.terminal, exp: Date.now() + SESSION_MS };
                    jset('bgSession', s);
                    // odeme tipi adlari (yetkisiz rolde komut gizleme icin) arka planda tazelenir
                    BG.gql('{p:getPaymentTypes(userRoleId:' + (parseInt(u.roleId, 10) || 0) + '){name}}', function (e2, d2) {
                        if (d2 && d2.p) jset('bgPayTypes', d2.p.map(function (x) { return x.name; }));
                        cb(200, meObject(s));
                    });
                });
            case '/api/me': { var s = BG.session(); return s ? cb(200, meObject(s)) : cb(401, { error: 'Giriş gerekli.' }); }
            case '/api/logout': jset('bgSession', null); return cb(200, { ok: true });
            case '/api/health': {
                var c = BG.conn() || {};
                return BG.probe(BG.base(), 3000, function (ok) { cb(200, { sql: ok, samba: ok, sambaHost: c.host || '', sambaPort: c.port || 9000, version: APP_VERSION, direct: true }); });
            }
            case '/api/local-info': return cb(404, { error: 'Bu uygulamada yok.' });   // Ayarlar'daki 'telefon adresi' kutusu yama.js'te
            case '/api/settings':
                if (method === 'GET') return cb(200, {});
                if (!adminUnlocked()) return cb(403, { error: 'Yönetici kilidi kapalı. Ayarlar için yönetici PIN\'i gerekli.' });
                // Telefonda paylasilacak sunucu yok: ayarlar bu cihaza yazilir (Config.html zaten localStorage'a da yazar)
                return cb(200, { ok: true, _version: String(Date.now()) });
            case '/api/admin/status': return cb(200, { unlocked: adminUnlocked() });
            case '/api/admin/lock': jset('bgAdminUntil', null); return cb(200, { ok: true });
            case '/api/admin/unlock':
                return BG.userByPin(String(b.pin || '').trim(), function (err, u, st) {
                    if (err) return cb(st || 401, { error: err });
                    if (!u.isAdmin) return cb(401, { error: '"' + u.userName + '" yönetici değil. SambaPOS\'ta yönetici (Admin) rolündeki bir kullanıcının PIN\'ini girin.' });
                    jset('bgAdminUntil', Date.now() + ADMIN_MS);
                    jset('bgAdminRole', u.roleId);
                    cb(200, { ok: true, userName: u.userName });
                });
            case '/api/admin/terminal-config-options': {
                var ss = BG.session();
                return BG.options((ss && ss.roleId) || jget('bgAdminRole', 1), function (err, o) { if (err) cb(500, { error: err }); else cb(200, o); });
            }
            case '/api/admin/scan-samba-servers': {
                var cc = BG.conn() || {};
                return BG.scan(cc.port || 9000, function () { }, function (r) {
                    if (!r.scanned) return cb(200, { scanned: false, reason: 'no-wifi', port: cc.port || 9000, current: cc.host, found: [] });
                    cb(200, { scanned: true, port: r.port, current: cc.host, found: r.found });
                });
            }
            case '/api/admin/set-samba-host': {
                if (!adminUnlocked()) return cb(403, { error: 'Yönetici kilidi kapalı.' });
                var p = BG.parseHost(b.host, b.port), old = BG.conn() || {};
                if (!p) return cb(400, { error: 'Adres boş.' });
                var nc = { host: p.host, port: p.port, user: old.user, pass: old.pass };
                return BG.probe(BG.base(nc), 4000, function (ok) {
                    if (!ok) return cb(400, { error: BG.base(nc) + ' adresinde SambaPOS mesaj sunucusu cevap vermedi.' });
                    BG.login(nc, function (err) {
                        if (err) return cb(400, { error: err });
                        jset('bgConn', nc); jset('bgTok', null);
                        cb(200, { ok: true, sambaHost: nc.host, sambaPort: nc.port || '' });
                    });
                });
            }
        }
        if (/^\/api\/kitchen\//.test(path)) return cb(401, { error: 'Mutfak ekranı bu sürümde yok.' });
        cb(404, { error: 'Bulunamadı' });
    }

    // ------------------------------------------------------------ XMLHttpRequest yerine gecen sinif
    function route(u) {
        var p = String(u), o = location.origin;
        if (o && o !== 'null' && p.indexOf(o) === 0) p = p.slice(o.length);
        else if (/^[a-z][a-z0-9+.-]*:/i.test(p)) return { kind: 'pass' };
        if (p.charAt(0) !== '/') return { kind: 'pass' };
        var qi = p.indexOf('?'), path = qi < 0 ? p : p.slice(0, qi), query = qi < 0 ? '' : p.slice(qi);
        if (/^\/samba-lan(\/|$)/i.test(path)) {
            var sub = path.slice(10) || '/';
            return { kind: 'samba', sub: sub, query: query, isGql: /^\/api\/graphql/i.test(sub), isToken: /^\/token$/i.test(sub) };
        }
        // SignalR negotiate cevabindaki Url "/signalr" - sonraki connect/poll istekleri koku kullanir
        if (/^\/signalr(\/|$)/i.test(path)) return { kind: 'samba', sub: path, query: query, isGql: false, isToken: false };
        if (/^\/api\//i.test(path)) return { kind: 'virtual', path: path, query: query };
        return { kind: 'pass' };
    }
    function FX() {
        this.readyState = 0; this.status = 0; this.statusText = ''; this.responseText = ''; this.response = '';
        this.responseURL = ''; this.responseType = ''; this.timeout = 0; this.withCredentials = false;
        this.onreadystatechange = null; this.onload = null; this.onerror = null; this.ontimeout = null; this.onabort = null; this.onloadend = null;
        this.upload = { addEventListener: function () { }, removeEventListener: function () { } };
        this._hdr = {}; this._ev = {};
    }
    FX.UNSENT = 0; FX.OPENED = 1; FX.HEADERS_RECEIVED = 2; FX.LOADING = 3; FX.DONE = 4;
    FX.prototype.addEventListener = function (t, f) { (this._ev[t] = this._ev[t] || []).push(f); };
    FX.prototype.removeEventListener = function (t, f) { var a = this._ev[t] || []; var i = a.indexOf(f); if (i >= 0) a.splice(i, 1); };
    FX.prototype._fire = function (t) {
        var self = this, e = { type: t, target: this, currentTarget: this, lengthComputable: false, loaded: 0, total: 0 };
        var h = this['on' + t];
        function call(f) { try { f.call(self, e); } catch (x) { setTimeout(function () { throw x; }, 0); } }
        if (typeof h === 'function') call(h);
        (this._ev[t] || []).slice().forEach(call);
    };
    FX.prototype.open = function (m, u, async) {
        this._m = String(m || 'GET').toUpperCase(); this._u = String(u); this._async = async !== false;
        this._route = route(this._u); this._hdr = {}; this._aborted = false; this._real = null;
        this.readyState = 1; this.status = 0; this.responseText = '';
        this._fire('readystatechange');
    };
    FX.prototype.setRequestHeader = function (k, v) { this._hdr[k] = v; };
    FX.prototype.overrideMimeType = function () { };
    FX.prototype.getResponseHeader = function (k) {
        if (this._real) { try { return this._real.getResponseHeader(k); } catch (e) { return null; } }
        return /^content-type$/i.test(k) && this.readyState === 4 ? 'application/json; charset=utf-8' : null;
    };
    FX.prototype.getAllResponseHeaders = function () {
        if (this._real) { try { return this._real.getAllResponseHeaders(); } catch (e) { return ''; } }
        return this.readyState === 4 ? 'content-type: application/json; charset=utf-8\r\n' : '';
    };
    FX.prototype.abort = function () {
        if (this._aborted) return;
        this._aborted = true;
        if (this._real) { try { this._real.abort(); } catch (e) { } }
        this._fire('abort');
    };
    FX.prototype._finish = function (status, text) {
        if (this._aborted) return;
        this.status = status; this.statusText = status === 200 ? 'OK' : (status ? 'Error' : '');
        this.responseText = text || ''; this.response = this.responseText;
        this.readyState = 4;
        this._fire('readystatechange');
        this._fire(status ? 'load' : 'error');
        this._fire('loadend');
    };
    FX.prototype._json = function (status, obj) {
        var self = this;
        if (!this._async) { this._finish(status, JSON.stringify(obj)); return; }
        setTimeout(function () { self._finish(status, JSON.stringify(obj)); }, 0);
    };
    FX.prototype.send = function (body) {
        var self = this, r = this._route;
        if (r.kind === 'pass') return this._real_send(this._u, body, null, false);
        if (r.kind === 'virtual') {
            if (!this._async) {   // senkron sadece eg-settings.js (GET /api/settings) kullanir
                this._json(200, {});
                return;
            }
            return virtualApi(this._m, r.path, r.query, body, function (st, obj) { self._finish(st, JSON.stringify(obj)); });
        }
        if (!BG.conn()) return this._json(503, { error: 'Bağlantı ayarı yapılmamış.' });
        // Token artik telefonda tutulur; Queries.js'in istedigi yer tutucu verilir (C# servisle ayni)
        if (r.isToken) {
            var s = BG.session();
            return this._json(s ? 200 : 401, s ? { access_token: 'garson-session', refresh_token: 'garson-session', token_type: 'bearer', expires_in: 43199, userName: s.userName } : { error: 'invalid_grant', error_description: 'Giriş gerekli.' });
        }
        var url = BG.base() + r.sub + r.query;
        if (r.isGql) {
            if (!BG.session()) return this._json(401, { error: 'Giriş gerekli.' });
            var reason = policy(body);
            if (reason) return this._json(403, { error: reason, errors: [{ message: reason }] });
            // Deneme modu (bgDryRun=1, sadece gelistirme testi): SambaPOS'a HICBIR yazma islemi gitmez
            if (LS.getItem('bgDryRun') === '1' && /^\s*\{?\s*"query"\s*:\s*"\s*mutation/.test(body || '')) {
                if (/registerTerminal/.test(body)) return this._json(200, { data: { terminalId: 'deneme-modu' } });
                return this._json(200, { data: null, errors: [{ message: 'Deneme modu: SambaPOS\'a yazma kapalı.' }] });
            }
            return BG.token(function (tok, err) {
                if (self._aborted) return;
                if (!tok) return self._finish(err && /ulaşılamıyor/.test(err) ? 0 : 401, JSON.stringify({ error: err }));
                self._real_send(url, body, tok, true);
            });
        }
        this._real_send(url, body, null, false);   // SignalR (canli yenileme) - token gerekmez
    };
    FX.prototype._real_send = function (url, body, tok, isGql, retried) {
        var self = this, x = new RX();
        this._real = x;
        x.open(this._m, url, this._async);
        for (var k in this._hdr) {
            if (!this._hdr.hasOwnProperty(k) || /^(authorization|x-requested-with)$/i.test(k)) continue;
            try { x.setRequestHeader(k, this._hdr[k]); } catch (e) { }
        }
        if (tok) x.setRequestHeader('Authorization', 'Bearer ' + tok);
        else if (this._hdr.Authorization && this._route.kind === 'pass') x.setRequestHeader('Authorization', this._hdr.Authorization);
        if (this._async && this.timeout) x.timeout = this.timeout;
        if (this.withCredentials && this._route.kind === 'pass') x.withCredentials = true;
        function done() {
            if (self._aborted) return;
            if (isGql && x.status === 401 && !retried) {
                return BG.token(function (t2, err) {
                    if (!t2) return self._finish(401, JSON.stringify({ error: err }));
                    self._real_send(url, body, t2, true, true);
                }, true);
            }
            var text = x.responseText;
            if (isGql && /getAutomationCommandButtons/.test(body || '')) { var s = BG.session(); if (s && !canTakePayment(s.roleName)) text = filterButtons(text); }
            self.responseURL = x.responseURL || url;
            self._finish(x.status, text);
        }
        if (this._async) {
            x.onreadystatechange = function () { if (x.readyState === 4) done(); };
            x.ontimeout = function () { if (self._aborted) return; self.readyState = 4; self.status = 0; self._fire('readystatechange'); self._fire('timeout'); self._fire('loadend'); };
        }
        x.send(body == null ? null : body);
        if (!this._async) done();
    };
    window.XMLHttpRequest = FX;
    BG.RealXHR = RX;

    // ------------------------------------------------------------ ilk acilis: baglanti yoksa kuruluma
    var page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    if (page !== 'kurulum.html' && !(BG.conn() && BG.conn().user)) {
        location.replace('kurulum.html');
        return;
    }
    // Uygulama icinde "geri" tusu: ana sayfadaysa uygulamadan cik (Cordova)
    document.addEventListener('deviceready', function () {
        document.addEventListener('backbutton', function (e) {
            if (page === 'index.html' || page === 'kurulum.html') { if (navigator.app && navigator.app.exitApp) navigator.app.exitApp(); }
            else history.back();
        }, false);
    }, false);
})();
