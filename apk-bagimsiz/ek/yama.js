/* Garson Direkt - mevcut sayfalara kucuk gorunum eklemeleri (sayfa sonunda yuklenir).
   www dosyalari degistirilmez; burada sadece DOM'a ekleme yapilir. */
(function () {
    if (!window.BG) return;
    var page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    function el(html) { var d = document.createElement('div'); d.innerHTML = html; return d.firstChild; }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function onReady(f) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', f); else f(); }

    onReady(function () {
        if (page === 'index.html') {
            // Giris ekraninda: hangi SambaPOS'a bagli + sunucu degistir (PC'nin IP'si degistiyse buradan)
            var sub = document.querySelector('#garsonLoginBox .eg-login-sub');
            if (sub) sub.parentNode.insertBefore(el('<div style="font-size:12px;color:var(--eg-muted);margin-top:4px;">📡 <span id="bgSrvLbl">' + esc(BG.label()) +
                '</span> · <a href="kurulum.html" style="color:#ff7a30;font-weight:700;">⚙️ Ayarlar</a></div>'), sub.nextSibling);
            // Acilis: kayitli SambaPOS'a ulasilamiyorsa garsona soru sormadan agi tarayip yeniden baglan.
            var banner = el('<div id="bgBanner" style="display:none;position:fixed;left:12px;right:12px;top:12px;z-index:3000;border-radius:12px;padding:12px 14px;font-size:14px;font-weight:700;line-height:1.4;box-shadow:0 6px 20px rgba(0,0,0,.25)"></div>');
            document.body.appendChild(banner);
            var setBanner = function (html, kind) { banner.innerHTML = html; banner.style.display = html ? 'block' : 'none'; banner.style.background = kind === 'ok' ? '#1f6b44' : kind === 'bad' ? '#5a1f2a' : '#1d2b63'; banner.style.color = '#fff'; };
            BG.probe(BG.base(), 2500, function (ok) {
                if (ok) return;
                setBanner('📡 SambaPOS aranıyor… (sunucu adresi değişmiş olabilir)');
                BG.reconnect(function (ok2) {
                    if (ok2) { setBanner('✓ SambaPOS bulundu: ' + esc(BG.label()), 'ok'); setTimeout(function () { location.reload(); }, 800); return; }
                    setBanner('SambaPOS bulunamadı. Kasa bilgisayarı ve SambaPOS açık mı, telefon aynı Wi-Fi\'da mı? ' +
                        '<a href="#" id="bgRetry" style="color:#ffb47a">Tekrar dene</a> · <a href="kurulum.html" style="color:#ffb47a">⚙️ Ayarlar (yönetici)</a>', 'bad');
                    var r = document.getElementById('bgRetry'); if (r) r.onclick = function (e) { e.preventDefault(); location.reload(); };
                });
            });
            var foot = document.querySelector('#garsonLoginBox .eg-login-footer strong');
            if (foot) foot.textContent = 'EnsariPOS Garson Direkt v' + BG.version;
            var brand = document.querySelector('.eg-brandline b');
            if (brand) brand.textContent = 'Garson Direkt';
            // APK zaten uygulama: tarayicidaki "ana ekrana ekle" ipucu gosterilmez
            try { localStorage.setItem('egInstallHintClosed', '1'); } catch (e) { }
            var hint = document.getElementById('egInstallHint');
            if (hint) hint.style.display = 'none';
        }
        if (page === 'config.html') {
            // "telefonlarda acilacak adres" ve "telefona kurulum" bolumleri bu uygulamada anlamsiz
            var url = document.getElementById('egPhoneUrl');
            if (url) url.innerHTML = '📡 Bağlı SambaPOS: <b>' + esc(BG.label()) + '</b><br><small>Bağlantı kullanıcısı: ' + esc((BG.conn() || {}).user || '-') + '</small>' +
                '<div style="margin-top:8px;"><a href="kurulum.html" class="eg-btn eg-btn--dark" style="display:inline-flex;height:40px;align-items:center;padding:0 14px;text-decoration:none;">🔑 Bağlantı / sunucu ayarını değiştir</a></div>';
            var help = document.querySelector('#egManualHost') && document.querySelector('#egManualHost').closest('.eg-field').querySelector('.eg-help');
            if (help) help.innerHTML = 'Yerel IP (192.168.1.10), restoranın <b>sabit IP</b>\'si (85.10.20.30) veya alan adı yazılabilir. Port genelde 9000. Sabit IP ile dışarıdan bağlanmak için modemde 9000 portu bu bilgisayara yönlendirilmelidir.';
            var host = document.getElementById('egManualHost');
            if (host) host.setAttribute('placeholder', '192.168.1.10 / sabit IP');
            var topSmall = document.querySelector('.eg-cfg-top__title small');
            if (topSmall) topSmall.textContent = 'Garson Direkt';
            var sql = document.getElementById('stSql');
            if (sql && sql.parentNode) sql.parentNode.style.display = 'none';
            var cards = document.querySelectorAll('.eg-cfg-card');
            for (var i = 0; i < cards.length; i++) {
                var t = cards[i].querySelector('.eg-cfg-card__title');
                if (!t) continue;
                if (/Telefona/.test(t.textContent)) cards[i].style.display = 'none';
                if (/^Bağlantı$/.test(t.textContent.trim())) {
                    var s1 = cards[i].querySelector('.eg-cfg-card__sub');
                    if (s1) s1.textContent = 'Bu telefon → SambaPOS mesaj sunucusu (doğrudan, exe yok)';
                }
                if (/Ödeme/.test(t.textContent)) {
                    var h5 = cards[i].querySelectorAll('.eg-help');
                    if (h5.length) h5[h5.length - 1].textContent = 'İşaretli roldeki kullanıcılar (ör. Garson) ödeme alamaz, iskonto yapamaz; ödeme/nakit/kredi kartı komutlarını göremez. Bu ayar bu telefona kaydedilir; her telefonda bir kez yapılır.';
                }
                if (/SambaPOS \/ AlfaPOS/.test(t.textContent)) {
                    var s2 = cards[i].querySelector('.eg-cfg-card__sub');
                    if (s2) s2.textContent = 'Listede olmayan adı elle yazabilirsiniz';
                }
                if (/Bu Cihaz/.test(t.textContent)) {
                    var s3 = cards[i].querySelector('.eg-cfg-card__sub');
                    if (s3) s3.textContent = 'Sorun giderme: bu telefondaki terminal kaydı ve önbelleği temizler (bağlantı ayarı korunur)';
                }
            }
            var ver = document.getElementById('egVersion');
            if (ver && ver.parentNode) ver.parentNode.firstChild.textContent = 'EnsariPOS Garson Direkt ';
            // Terminal/departman/adisyon tipi/menu: GraphQL bu listeleri her kurulumda vermeyebilir ->
            // secim kutusu yerine "yaz veya listeden sec" kutusu (secenekler korunur)
            var ids = ['terminal', 'department', 'ticket', 'menu'];
            var tries = 0;
            (function convert() {
                var ready = ids.every(function (id) { var s = document.getElementById(id); return s && (s.tagName !== 'SELECT' || s.options.length); });
                if (!ready && ++tries < 60) return setTimeout(convert, 250);
                ids.forEach(function (id) {
                    var s = document.getElementById(id);
                    if (!s || s.tagName !== 'SELECT') return;
                    var inp = document.createElement('input'), dl = document.createElement('datalist');
                    inp.className = 'eg-input'; inp.id = id; inp.value = s.value || ''; inp.setAttribute('list', id + 'List'); inp.autocomplete = 'off';
                    dl.id = id + 'List';
                    for (var j = 0; j < s.options.length; j++) { var o = document.createElement('option'); o.value = s.options[j].value; dl.appendChild(o); }
                    s.parentNode.replaceChild(inp, s);
                    inp.parentNode.insertBefore(dl, inp.nextSibling);
                });
            })();
            // "Bu cihazin onbellegini temizle" baglanti ayarini da silmesin
            var reset = document.getElementById('egResetDevice');
            if (reset) reset.addEventListener('click', function () {
                var keep = { bgConn: localStorage.getItem('bgConn') };
                setTimeout(function () { if (keep.bgConn && !localStorage.getItem('bgConn')) localStorage.setItem('bgConn', keep.bgConn); }, 0);
            }, true);
        }
    });
})();
