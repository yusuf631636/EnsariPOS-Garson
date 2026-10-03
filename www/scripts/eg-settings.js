/* EnsariPOS Garson v2 - PAYLASILAN AYARLAR (garsonsys'teki SettingsSync'in
   gelistirilmis hali). Yonetici Ayarlar ekranindan BIR KEZ kaydeder, sunucu
   (data/settings.json) TUM garson cihazlarina dagitir - her telefonda tek tek
   ayar yapmak gerekmez.

   garsonsys'ten farki: orada sunucu ayari SADECE cihazda hic ayar yokken
   uygulaniyor, sonradan yapilan degisiklikler eski telefonlara HIC ulasmiyordu.
   Burada sunucudaki _version degistiginde HER cihaz yeni ayarlari alir.

   Bu dosya Queries.js'TEN ONCE yuklenmeli - appconfig() localStorage'i sayfa
   acilirken okuyor. Bu yuzden istek bilerek SENKRON (yerel sunucu, milisaniyeler). */
(function () {
    // Cihaza ozel anahtarlar asla sunucudan ezilmez
    var SKIP = { terminalId: 1, accessToken: 1, refreshToken: 1, deviceid: 1, username: 1, canTakePayment: 1, web_device_uuid: 1, egTheme: 1 };
    try {
        var x = new XMLHttpRequest();
        x.open('GET', '/api/settings', false);
        x.send(null);
        if (x.status !== 200) return;
        var s = JSON.parse(x.responseText || '{}');
        var v = s._version;
        if (!v || localStorage.getItem('egSettingsVersion') === v) return;
        var before = [localStorage.getItem('terminal'), localStorage.getItem('department'), localStorage.getItem('ticketType')].join('|');
        Object.keys(s).forEach(function (k) {
            if (k.charAt(0) === '_' || SKIP[k]) return;
            var val = s[k];
            // Bos deger = kapali/silinmis ayar (ör. "sorulsun" isaretsiz)
            if (val === null || val === undefined || val === '') localStorage.removeItem(k);
            else localStorage.setItem(k, String(val));
        });
        var after = [localStorage.getItem('terminal'), localStorage.getItem('department'), localStorage.getItem('ticketType')].join('|');
        if (before !== after && localStorage.getItem('terminalId')) {
            // Terminal/departman/adisyon tipi degisti: eski terminal kaydi index.html'de kapatilip yenisi alinir
            localStorage.setItem('egStaleTerminalId', localStorage.getItem('terminalId'));
            localStorage.removeItem('terminalId');
        }
        localStorage.setItem('egSettingsVersion', v);
    } catch (e) { /* sunucu yoksa cihazdaki ayarlarla devam */ }
})();

/* Yonetici Ayarlar'da "Kaydet" dediginde: obj = { anahtar: deger } (bos string = kapat/sil) */
function egSaveSettingsToServer(obj, done) {
    var x = new XMLHttpRequest();
    x.open('POST', '/api/settings', true);
    x.setRequestHeader('Content-Type', 'application/json; charset=utf-8');
    x.onreadystatechange = function () {
        if (x.readyState !== 4) return;
        var res = {};
        try { res = JSON.parse(x.responseText || '{}'); } catch (e) { }
        if (x.status >= 200 && x.status < 300) {
            if (res._version) localStorage.setItem('egSettingsVersion', res._version);
            done(true);
        } else {
            done(false, res.error || ('HTTP ' + x.status));
        }
    };
    x.send(JSON.stringify(obj));
}

/* Tema (acik/koyu) - cihaza ozel, garsonsys'teki 🌙 dugmesi gibi */
(function () {
    try {
        var t = localStorage.getItem('egTheme');
        if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    } catch (e) { }
})();
function egToggleTheme() {
    var dark = document.documentElement.getAttribute('data-theme') !== 'dark';
    if (dark) document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('egTheme', dark ? 'dark' : 'light'); } catch (e) { }
    return dark;
}

/* Dokunmatik titresim (garsonsys'teki "hapticFeedback") - Ayarlar'dan acilir */
function egHaptic(ms) {
    try { if (localStorage.getItem('hapticFeedback') === 'evet' && navigator.vibrate) navigator.vibrate(ms || 15); } catch (e) { }
}

function egToast(msg) {
    var old = document.querySelector('.eg-toast');
    if (old) old.parentNode.removeChild(old);
    var t = document.createElement('div');
    t.className = 'eg-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2800);
}

function egEsc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

/* 30.09.2026: SambaPOS varlik/ekran metinlerindeki bicim etiketleri (<size 60>, <color black>,
   <b>, <i>, <br/>, <panel #FFEB5109>Masalar</panel> ...) ham yaziliyordu. egSambaText etiketleri
   atip duz metin verir; egSambaHtml ayrica <panel renk>yazi</panel>'i renkli etiket yapar. */
function egSambaText(s) {
    return String(s == null ? '' : s)
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/?[a-zA-Z][^<>]*>/g, '')
        .replace(/\s+/g, ' ')
        .replace(/^\s+|\s+$/g, '');
}
function egSambaHtml(s, removeText) {
    var panels = [];
    var str = String(s == null ? '' : s).replace(/<panel\s*([^<>]*)>([\s\S]*?)<\/panel>/gi, function (m, attr, txt) {
        panels.push({ color: (attr.match(/#[0-9a-fA-F]{6,8}\b|[a-zA-Z]+/) || [''])[0], text: egSambaText(txt) });
        return ' \u0001' + (panels.length - 1) + '\u0002 ';
    });
    var txt = egSambaText(str);
    if (removeText) txt = txt.replace(removeText, '').replace(/^\s+|\s+$/g, '');
    return egEsc(txt).replace(/\u0001(\d+)\u0002/g, function (m, i) {
        var p = panels[+i];
        if (!p || !p.text) return '';
        var bg = p.color ? parseAlfaColor(p.color) : '';
        return '<span class="eg-sbadge"' + (bg && bg !== 'transparent' ? ' style="background:' + egEsc(bg) + '"' : '') + '>' + egEsc(p.text) + '</span>';
    }).replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
}
