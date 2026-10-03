/* EnsariPOS Local Garson - ek ozellikler (29.09.2026)
   1) Baglanti kopunca: kirmizi uyari bandi. Gonderilemeyen urunler (addOrderToTerminalTicket)
      telefonda saklanir; baglanti gelince garson "Tekrar Gonder" ile kendisi gonderir.
      Otomatik tekrar gonderme BILEREK YOK: istek sunucuya ulasip cevap kaybolduysa urun
      adisyona iki kez dusebilirdi - karari adisyonu goren garson verir.
   2) Mutfak "Hazir" dedikce garsonun telefonunda bildirim (titresim + ses + kart).
   ES5 yazim: eski Android telefonlarda da calismali (?? / => / let / async YOK). */
(function () {
    var PENDING_KEY = 'egPendingOrders', SEEN_KEY = 'egNoticeSeen';
    var bar = null, healthTimer = null, isDown = false;

    function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { } return null; }
    function pending() { try { return JSON.parse(ls(PENDING_KEY) || '[]'); } catch (e) { return []; } }
    function setPending(a) { if (a.length) ls(PENDING_KEY, JSON.stringify(a)); else ls(PENDING_KEY, null); }
    function toast(m) { if (window.egToast) window.egToast(m); }

    // ------------------------------------------------------------ 1) Baglanti
    function showBar(html, back) {
        if (!document.body) return;
        if (!bar) { bar = document.createElement('div'); document.body.appendChild(bar); }
        bar.className = 'eg-net' + (back ? ' is-back' : '');
        bar.innerHTML = html;
    }
    function hideBar() { if (bar && bar.parentNode) bar.parentNode.removeChild(bar); bar = null; }

    function render() {
        var n = pending().length;
        if (isDown) {
            showBar('⚠️ Bağlantı yok' + (n ? ' — ' + n + ' ürün GÖNDERİLMEDİ' : '') +
                '<br><small>Wi-Fi\'ı kontrol edin. Bağlantı gelince buradan tekrar gönderebilirsiniz.</small>');
        } else if (n) {
            showBar('✅ Bağlantı geldi — ' + n + ' ürün gönderilememişti' +
                '<br><button type="button" id="egResendBtn">Tekrar Gönder</button><button type="button" id="egDropBtn">Vazgeç</button>', true);
            document.getElementById('egResendBtn').onclick = resend;
            document.getElementById('egDropBtn').onclick = function () {
                if (!confirm(n + ' ürün gönderilmeyecek. Emin misiniz?')) return;
                setPending([]); hideBar();
            };
        } else hideBar();
    }

    function checkHealth(cb) {
        var x = new XMLHttpRequest();
        x.open('GET', '/api/health?t=' + Date.now(), true);
        x.timeout = 4000;
        x.onreadystatechange = function () { if (x.readyState === 4) cb(x.status === 200); };
        x.ontimeout = function () { };
        try { x.send(null); } catch (e) { cb(false); }
    }
    function startWatch() {
        if (healthTimer) return;
        healthTimer = setInterval(function () {
            checkHealth(function (ok) {
                if (!ok) return;
                clearInterval(healthTimer); healthTimer = null;
                isDown = false;
                render();
                if (!pending().length) toast('Bağlantı geri geldi.');
            });
        }, 3000);
    }
    function goDown() { isDown = true; render(); startWatch(); }

    // Queries.js $.postJSON baglanti hatasinda cagirir
    window.egOnNetFail = function (query) {
        if (/addOrderToTerminalTicket/.test(String(query || ''))) {
            var a = pending();
            a.push({ q: String(query), at: Date.now() });
            setPending(a);
        }
        goDown();
    };

    function resend() {
        var list = pending();
        if (!list.length || !window.$ || !$.postJSON) { hideBar(); return; }
        showBar('Gönderiliyor…', true);
        var i = 0, failed = [], errors = 0;
        (function next() {
            if (i >= list.length) {
                setPending(failed);
                if (failed.length) { render(); return; }
                toast(errors ? 'Gönderildi (' + errors + ' ürün SambaPOS tarafından reddedildi).' : 'Gönderilemeyen ürünler gönderildi.');
                setTimeout(function () { location.reload(); }, 900);   // adisyonu guncel haliyle goster
                return;
            }
            var item = list[i++];
            var before = isDown;
            $.postJSON(item.q, function (res) {
                if (!res) { failed.push(item); if (!before) goDown(); next(); return; }
                if (res.errors) errors++;   // ör. adisyon bu arada kapatilmis - tekrar denemenin anlami yok
                next();
            });
        })();
    }

    window.addEventListener('offline', goDown);
    window.addEventListener('online', function () { if (isDown) startWatch(); });
    function onReady() {
        if (pending().length) checkHealth(function (ok) { isDown = !ok; render(); if (!ok) startWatch(); });
        pollNotices();
    }

    // ------------------------------------------------------------ 2) Mutfak "hazir" bildirimi
    var audioCtx = null;
    function unlockAudio() {
        try {
            if (!audioCtx) { var AC = window.AudioContext || window.webkitAudioContext; if (AC) audioCtx = new AC(); }
            if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        } catch (e) { }
    }
    document.addEventListener('touchstart', unlockAudio, true);
    document.addEventListener('click', unlockAudio, true);
    function beep() {
        try {
            if (!audioCtx) return;
            [0, 0.28, 0.56].forEach(function (t) {
                var o = audioCtx.createOscillator(), g = audioCtx.createGain();
                o.type = 'sine'; o.frequency.value = 880;
                g.gain.setValueAtTime(0.0001, audioCtx.currentTime + t);
                g.gain.exponentialRampToValueAtTime(0.4, audioCtx.currentTime + t + 0.02);
                g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + t + 0.22);
                o.connect(g); g.connect(audioCtx.destination);
                o.start(audioCtx.currentTime + t); o.stop(audioCtx.currentTime + t + 0.24);
            });
        } catch (e) { }
    }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    var readyBox = null, readyTimer = null;
    function showReady(n, more) {
        if (readyBox && readyBox.parentNode) readyBox.parentNode.removeChild(readyBox);
        readyBox = document.createElement('div');
        readyBox.className = 'eg-ready';
        readyBox.innerHTML = '<b>🔔 ' + esc(n.table || 'Sipariş') + ' hazır</b>' + (n.items ? '<small>' + esc(n.items) + '</small>' : '') +
            (more ? '<small>+' + more + ' hazır sipariş daha</small>' : '') + '<small>Kapatmak için dokunun</small>';
        readyBox.onclick = function () { if (readyBox.parentNode) readyBox.parentNode.removeChild(readyBox); };
        document.body.appendChild(readyBox);
        try { if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 400]); } catch (e) { }
        beep();
        clearTimeout(readyTimer);
        readyTimer = setTimeout(function () { if (readyBox && readyBox.parentNode) readyBox.parentNode.removeChild(readyBox); }, 25000);
    }
    var pollTimer = null, pollPause = 0;
    function pollNotices() {
        if (pollTimer) return;
        pollTimer = setInterval(tick, 8000);
        tick();
    }
    function tick() {
        if (document.hidden || isDown || Date.now() < pollPause) return;
        var seen = ls(SEEN_KEY);
        var x = new XMLHttpRequest();
        x.open('GET', '/api/kitchen/notices?since=' + encodeURIComponent(seen || '0') + '&t=' + Date.now(), true);
        x.onreadystatechange = function () {
            if (x.readyState !== 4) return;
            if (x.status === 401) { pollPause = Date.now() + 60000; return; }   // giris yapilmamis
            if (x.status !== 200) return;
            var d; try { d = JSON.parse(x.responseText); } catch (e) { return; }
            // Ilk calisma: eski bildirimleri gosterme, sadece bundan sonrakiler
            if (seen === null) { ls(SEEN_KEY, String(d.last || 0)); return; }
            // Sunucudaki sayac sifirlandiysa (kitchen.json silindi) telefon da sifirlanir
            if ((d.last || 0) < (parseInt(seen, 10) || 0)) { ls(SEEN_KEY, String(d.last || 0)); return; }
            var items = d.items || [];
            if (items.length) showReady(items[items.length - 1], items.length - 1);
            ls(SEEN_KEY, String(d.last || seen));
        };
        try { x.send(null); } catch (e) { }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady);
    else onReady();
})();
