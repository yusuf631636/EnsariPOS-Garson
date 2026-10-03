/* EnsariPOS Garson - ortak UI bilesenleri (29.09.2026, kullanici istegi:
   referans "Samba Garson" ekranindaki gibi bir İşlemler paneli). ticket.html
   VE ticket_load.html arasinda PAYLAŞILIR. NOT: ilk surumde bunun yanina bir
   de alt navigasyon (bottom nav) sekmeleri eklenip Menü/Sipariş gorunumleri
   birbirinin YERINE geçirilmişti - CANLIDA "sipariş/ödeme çalışmıyor"
   şikayetine yol açtı ve geri alındı (bkz. ticket.html/ticket_load.html'deki
   29.09.2026 notlari). Artık İşlemler sadece EK bir ikon/buton ile açılan,
   var olan hiçbir görünümü gizlemeyen bağımsız bir panel. Fonksiyon adları
   çarpışmasın diye hepsi "eg" önekiyle. */
var EG_DURUMLAR_CAPTIONS = ['void', 'cancel_void', 'gift', 'cancel_gift'].map(function (k) { return storage.getItem(k); });
/* server.js'deki auth.PAYMENT_PATTERN ile AYNI - odeme/tahsilat gibi
   davranan komut adlarini yakalar (bkz. asagida egHandleTicketResult). */
var EG_PAYMENT_PATTERN = /(ödeme|odeme|kredi ?kart|nakit|payment|hesap ?(yaz|kapat))/i;

/* terminalID: aktif terminal. getTicketUid: uid()=>string dondüren fonksiyon
   (ticket seviyesi komutlar icin bos "" olabilir, SambaPOS zaten terminalId
   üzerinden hangi adisyon oldugunu biliyor). opts.fixedButtons: [{label,onClick}]
   - hesap/tasi/adekle/adsnot gibi hazir, sayfaya ozel islemler. opts.onDone:
   otomasyon komutu calistirildiktan sonra (result)=>{} - ekrani yenilemek icin. */
function egOpenIslemler(terminalID, getTicketUid, opts) {
    opts = opts || {};
    egCloseIslemler();
    $('<div class="eg-islemler-backdrop" style="display:block;"></div>').appendTo('body').on('click', egCloseIslemler);
    var sheet = $('<div class="eg-islemler-sheet"><div class="eg-islemler-sheet__title">İşlemler</div><div id="egIslemlerList"></div></div>').appendTo('body');
    var list = sheet.find('#egIslemlerList');
    (opts.fixedButtons || []).forEach(function (b) {
        $('<button type="button" class="eg-islemler-btn eg-islemler-btn--alt"></button>').text(b.label).on('click', function () {
            egCloseIslemler();
            b.onClick();
        }).appendTo(list);
    });
    var loading = $('<div class="eg-islemler-empty">Yükleniyor...</div>').appendTo(list);
    var excludeNames = opts.excludeNames || [];
    getAutomationCommandButtonsForTerminalTicket(terminalID, "[]", function (result) {
        loading.remove();
        var allowedList = [];
        try { allowedList = JSON.parse(storage.getItem('automationCommandsAllowed') || '[]'); } catch (e) { allowedList = []; }
        var paymentPattern = /(ödeme|odeme|kredi ?kart|nakit|payment|hesap ?(yaz|kapat))/i;
        var items = (result && result.data) ? result.data.slice() : [];
        if (allowedList.length) items = items.filter(function (it) { return allowedList.indexOf(it.name) !== -1; });
        if (storage.getItem('canTakePayment') === '0') items = items.filter(function (it) { return !paymentPattern.test(it.name); });
        items = items.filter(function (it) {
            if (excludeNames.indexOf(it.name) !== -1) return false;
            var cap = (it.caption || '').replace(/(?:\\[rn]|[\r\n]+)+/g, ' ').trim();
            return EG_DURUMLAR_CAPTIONS.indexOf(cap) === -1;
        });
        if (!items.length && !(opts.fixedButtons || []).length) {
            list.append('<div class="eg-islemler-empty">Kullanılabilir işlem yok.</div>');
            return;
        }
        items.forEach(function (item) {
            var caption = (item.caption || item.name).replace(/(?:\\[rn]|[\r\n]+)+/g, ' ').trim();
            var btn = $('<button type="button" class="eg-islemler-btn"></button>').text(caption);
            if (item.canExecute === false) btn.prop('disabled', true);
            btn.on('click', function () {
                if (item.canExecute === false) return;
                var values = String(item.values || '').split(',').map(function (v) { return v.trim(); }).filter(Boolean);
                if (values.length > 1) {
                    egOpenValuePicker(values, function (val) { egExecuteIslemler(terminalID, getTicketUid(), item.name, val, opts.onOpen, opts.onClosed); });
                } else {
                    egExecuteIslemler(terminalID, getTicketUid(), item.name, '', opts.onOpen, opts.onClosed);
                }
            });
            list.append(btn);
        });
    });
}
/* executeAutomationCommandForTerminalTicket callback degerini yorumlar:
   undefined = hata (Queries.js zaten alert gosterdi, hicbir sey yapma).
   null = basarili AMA adisyon artik yok - onClosed() cagrilir (masa
   listesine donulur). obje = basarili, adisyon hala acik - onOpen(result)
   cagrilir (ekran yenilenir).
   29.09.2026 UCUNCU duzeltme (kullanici bulgusu, canli test: "Nakit'e
   basinca aslinda odeme aliyor ama adisyon icinde belli etmiyor/kapatmiyor,
   ama AYNI komutu 'Hesap Yaz Otomasyon Komutu' alanina yazinca direkt
   calisiyor"). KOK NEDEN: hesap() (ticket_load.html) hicbir sey KONTROL
   ETMEDEN, HER ZAMAN calistirdiktan sonra closeTerminalTicket cagiriyor -
   remainingAmount'a bakan bu genel yol ise SambaPOS'un o anki yanitinda
   bakiye henuz guncellenmemis olabildigi icin (odeme aslinda basarili
   olsa bile) HICBIR ZAMAN "kapandi" durumuna DUSMUYORDU. Artik hesap()'le
   AYNI mantik: komutun ADI odeme/nakit/kredi kart/hesap yaz-kapat gibi
   gorunuyorsa (server.js'deki auth.PAYMENT_PATTERN ile AYNI desen),
   SONUCA BAKMADAN dogrudan "kapandi" sayilir. */
function egHandleTicketResult(result, commandName, onOpen, onClosed) {
    if (result === undefined) return;
    var looksLikePayment = commandName && EG_PAYMENT_PATTERN.test(commandName);
    var fullyPaid = result && typeof result.remainingAmount === 'number' && result.remainingAmount <= 0 && result.totalAmount > 0;
    if (result === null || fullyPaid || looksLikePayment) { if (onClosed) onClosed(); return; }
    if (onOpen) onOpen(result);
}
function egExecuteIslemler(terminalID, uid, name, value, onOpen, onClosed) {
    executeAutomationCommandForTerminalTicket(terminalID, uid, name, value, function (result) {
        egCloseIslemler();
        egHandleTicketResult(result, name, onOpen, onClosed);
    });
}
function egOpenValuePicker(values, onPick) {
    $('#egValuePicker').remove();
    var box = $('<div id="egValuePicker" class="eg-islemler-sheet" style="z-index:43;"><div class="eg-islemler-sheet__title">' + (storage.getItem('select_reasons') || 'Seçiniz') + '</div></div>');
    values.forEach(function (v) {
        $('<button type="button" class="eg-islemler-btn eg-islemler-btn--alt"></button>').text(v).on('click', function () { box.remove(); onPick(v); }).appendTo(box);
    });
    $('body').append(box);
}
function egCloseIslemler() {
    $('.eg-islemler-backdrop,.eg-islemler-sheet').remove();
}

/* "Ara" sekmesi - basit bir arama kutusu; hangi ogeler filtrelenecegini
   (urun butonlari veya siparis satirlari) caller "onFilter(text)" ile belirler. */
function egToggleSearch(show, onFilter) {
    var bar = $('#egSearchBar');
    if (!bar.length) {
        bar = $('<div id="egSearchBar" class="eg-search-bar"><input type="search" id="egSearchInput" placeholder="Ara..." /></div>').appendTo('body');
        bar.find('input').on('input', function () { onFilter($(this).val() || ''); });
    }
    bar.css('display', show ? 'block' : 'none');
    if (show) { bar.find('input').val('').focus(); onFilter(''); }
}
