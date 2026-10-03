"use strict";

/* EnsariPOS Garson v2: SignalR (canli masa/adisyon guncellemesi) artik
   dogrudan telefon -> PC:9000 DEGIL, garson sunucusunun kendi
   /samba-lan koprusu uzerinden gider. Boylece:
   - PC'de 9000 portu guvenlik duvarinda kapali olsa bile calisir,
   - Ayarlar'da baska bir SambaPOS mesaj sunucusu secildiyse oraya gider,
   - telefonlarin ayri bir port/IP bilmesine gerek kalmaz.
   Kopru WebSocket tasimaz; "longPolling" her tarayicida ve APK'da calisir. */
function test() {
    var config = {};
    var serv = location.origin + '/samba-lan';
    config.GQLserv = serv;
    config.GQLurl = serv + '/api/graphql/';
    config.SIGNALRserv = serv;
    config.SIGNALRurl = serv + '/signalr';
    return config;
}
var test = test();
var egSignalrConnection = null;
function connect(callback) {
    if (callback) connect._cb = callback;
    try { if (egSignalrConnection) egSignalrConnection.stop(); } catch (e) { }
    var connection = $.hubConnection(test.SIGNALRserv);
    egSignalrConnection = connection;
    var proxy = connection.createHubProxy('default');

    proxy.on('update', function (message) {
        if (connect._cb) connect._cb(message);
    });
    connection.disconnected(function () {
        // Baglanti koptuysa (Wi-Fi degisimi, PC yeniden basladi) 5 sn sonra yeniden dene
        setTimeout(function () { if (egSignalrConnection === connection) connect(); }, 5000);
    });

    connection.start({ transport: 'longPolling' }).done(function () {
        console.log('Signalr now connected, connection ID=' + connection.id);
        if (window.egOnLive) window.egOnLive(true);
    }).fail(function () {
        console.log('Signalr could not connect');
        if (window.egOnLive) window.egOnLive(false);
        setTimeout(function () { if (egSignalrConnection === connection) connect(); }, 10000);
    });
}
