"use strict";

//import $ from 'jquery';
//import jQuery form 'jquery'
//import {appconfig} from './config';

var storage = window.localStorage;
var config = appconfig();
var accessToken = storage.getItem("accessToken");

/* 29.09.2026, kullanici bulgusu: "baska pcde masalar bomboş görünüyor".
   KOK NEDEN: SambaPOS/AlfaPOS varlik renklerini Windows ARGB formatinda
   (#AARRGGBB, alfa EN BASTA) doner. Bu restorandaki SambaPOS kurulumunda
   renkler 6 haneli (#RRGGBB) geldigi icin sorun hic gorunmedi, ama baska
   bir kurulumda 8 haneli (#AARRGGBB) donunce CSS bunu KENDI 8 haneli
   formatiyla (#RRGGBBAA, alfa EN SONDA) karistirip GECERSIZ sayiyor ve
   TUM background-color/color degerini SESSIZCE YOK SAYIYOR - butonlar bu
   yuzden bombos/gri kaliyordu. Referans: calisan baska bir AlfaPOS
   urununde (garsonsys) AYNI cevirici zaten var. */
function parseAlfaColor(c) {
    if (!c || c === 'transparent') return 'transparent';
    c = ('' + c).trim();
    if (/^#[0-9a-fA-F]{8}$/.test(c)) {
        return '#' + c.substring(3, 9);
    }
    return c;
}
function appconfig() {
    // create Object to hold config info
    var config = {};

    /* 20.09.2026 kullanıcı isteği: "bu alan olmasa, eskisi gibi IP yeterli
       olsa" - web sürümünde (bu dosya SADECE https://ozurfa.ornek-alanadi.com/garson
       altında servis edilir) "Mesaj Sunucu IP" alanı NE YAZILIRSA YAZILSIN
       YOK SAYILIR, HER ZAMAN kendi proxy adresi (/samba-lan) kullanılır.
       Düz bir LAN IP'si (http://) yazılırsa tarayıcı HTTPS sayfadan HTTP'ye
       isteği güvenlik gereği ENGELLER ("mixed content") - bu alanı tamamen
       devre dışı bırakmak, eski (APK'dan kalma) bir değerin karışmasını da
       önlüyor. */
    var webHost = location.origin + '/samba-lan';
    // myServer.com
    var webPort = location.port; // blank assumes port 80
    var webPath = location.pathname; // might be like /app/mysite/blah
    var webParm = location.search; // things after '?', like ?module=customer_display
    var webProto = 'http:'; // usually http: or https:

    var webUrl = webProto + '//' + webHost + (location.port ? ':' + location.port : '') + webPath;

    // Message Server
    var msgsrv = webHost;

    /* 20.09.2026 kullanıcı isteği: "yap bitir bu işi" - router'daki cihaz
       izolasyonu yüzünden telefon LAN IP'sine (192.168.1.x:9000) hiç
       ulaşamıyordu. "Mesaj Sunucu IP" alanına artık DÜZ bir IP yerine TAM
       BİR ADRES de girilebilir (örn. https://ozurfa.ornek-alanadi.com/samba-lan)
       - "http" ile başlıyorsa OLDUĞU GİBİ kullanılır (port/http: EKLENMEZ),
       eski davranış (düz IP + otomatik :9000) tamamen korunur. */
    var isFullUrl = /^https?:\/\//i.test(webHost);

    // GraphQL server
    var GQLhost = msgsrv;
    var GQLport = '9000';
    var GQLpath = '/api/graphql/';
    var GQLserv = isFullUrl ? webHost.replace(/\/$/, '') : (webProto + '//' + GQLhost + ':' + GQLport);
    var GQLurl = GQLserv + GQLpath;

    // SIGNALR server
    var SIGNALRhost = msgsrv;
    var SIGNALRport = GQLport;
    var SIGNALRpath = '/signalr';
    var SIGNALRhubs = '/signalr/hubs/';
    var SIGNALRserv = isFullUrl ? webHost.replace(/\/$/, '') : (webProto + '//' + SIGNALRhost + ':' + SIGNALRport);
    var SIGNALRurl = SIGNALRserv + SIGNALRpath;
    var SIGNALRhub = SIGNALRserv + SIGNALRhubs;

    // Terminal settings
    var terminalName = storage.getItem("terminal");
    var userName = storage.getItem("username");
    var departmentName = storage.getItem("department");
    var ticketTypeName = storage.getItem("ticketType");
    var menuName = storage.getItem("menu");
    var entityScreenName = storage.getItem("entityScreen");
    var entityScreenType = storage.getItem("entityType");
    //var terminalName = 'Sunucu';
    //var userName = 'Onur';
    //var departmentName = 'Restoran';
    //var ticketTypeName = 'Adisyon';
    //var menuName = 'Menu';
    //var entityScreenName = 'Masa';
    //var entityScreenType = 'Masalar';

    // assign some stuff to the Object
    // you can override the "auto config" here if you wish
    config.GQLserv = GQLserv;
    config.GQLurl = GQLurl;
    config.SIGNALRserv = SIGNALRserv;
    config.SIGNALRurl = SIGNALRurl;

    // the rest comes from Terminal settings (above)
    config.terminalName = terminalName;
    config.userName = userName;
    config.departmentName = departmentName;
    config.ticketTypeName = ticketTypeName;
    config.menuName = menuName;
    config.entityScreenName = entityScreenName;
    config.entityScreenType = entityScreenType;
    return config; // return the Object to the caller
}
//$.postJSON = function (query, callback) {
//    var data = JSON.stringify({ query: query });
//    return jQuery.ajax({
//        'type': 'POST',
//        'url': config.GQLurl,
//        headers: { 'Authorization': 'Bearer ' + accessToken },
//        'contentType': 'application/json',
//        'data': data,
//        'dataType': 'json'
//    }).done(function (response) {
//        if (callback) callback(response);
//    }).fail(function (response) {
//        if (callback) callback(response.responseJSON);
//    });
//};
//function Authorize(password, callback) {
//    jQuery.ajax({
//        'type': 'POST',
//        'url': config.GQLserv + '/Token',
//        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
//        data: $.param({ grant_type: 'password', username: 'onur', password: password })
//    }).done(function (response) {
//        accessToken = response.access_token;
//        callback();
//    }).fail(function (response) {
//        accessToken = response.access_token;
//        if (callback) callback(response.access_token);
//    });
//}
$.postJSON = function (query, callback) {
    var accessToken = storage.getItem("accessToken");
    var refreshToken = storage.getItem("refreshToken");
    var data = JSON.stringify({ query: query });
    return jQuery.ajax({
        'type': 'POST',
        'url': config.GQLurl,
        headers: { 'Authorization': 'Bearer ' + accessToken },
        'contentType': 'application/json',
        'data': data,
        'dataType': 'json'
    }).done(function (response) {
        if (callback) callback(response);
    }).fail(function (response) {
        var str = JSON.stringify(response);
        console.log(str);
        if (response.status === 401 && refreshToken) {
            console.log(refreshToken);
            RefreshToken(refreshToken, function (response) {
                if (response.status === 200) {
                    $.postJSON(query, callback);
                    return;
                }
            });
            window.location = 'index.html';
            return;
        }
        if (response.status === 401 && !refreshToken) {
            window.location = 'index.html';
            return;
        }
        /* 29.09.2026: Wi-Fi/baglanti koptu (status 0) ya da servis yanit vermedi -
           eskiden sessizce kayboluyordu; eg-extra.js kirmizi uyari gosterir ve
           gonderilemeyen urunu "tekrar gonder" listesine alir. */
        if ((response.status === 0 || response.status >= 502) && window.egOnNetFail) window.egOnNetFail(query);
        if (callback) callback(response.responseJSON);
    });
};

function RefreshToken(refreshToken, callback) {
    var deviceid = storage.getItem("deviceid");
    storage.removeItem("accessToken");
    storage.removeItem("refreshToken");
    jQuery.ajax({
        'type': 'POST',
        'url': config.GQLserv + '/Token',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: $.param({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: 'mobilepos', client_secret: 'test', device_id: deviceid })
    }).done(function (response) {
        storage.setItem("accessToken", response.access_token);
        storage.setItem("refreshToken", response.refresh_token);
        callback(response);
    }).fail(function (response) {
        storage.removeItem("accessToken");
        storage.removeItem("refreshToken");
        callback(response);
    });
}
function Authenticate(userName, password, callback, failCallback) {
    var deviceid = storage.getItem("deviceid");
    jQuery.ajax({
        'type': 'POST',
        'url': config.GQLserv + '/Token',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: $.param({ grant_type: 'password', username: userName, password: password, client_id: 'mobilepos', client_secret: 'test', device_id: deviceid })
    }).done(function (response) {
        callback(response.access_token, response.refresh_token);
    }).fail(function (response) {
        var error = response.responseText ? JSON.parse(response.responseText).error_description : undefined;
        if (!error) {
            error = response.statusText;
        }
        console.log('error', error);
        failCallback(response.status, error);
    });
}
function getTerminalTicket(terminalId, callback) {
    var query = getGetTerminalTicketScript(terminalId);
    $.postJSON(query, function (response) {
        if (response.errors) {
            console.log(response.errors);
            if (callback) callback(undefined);
        } else {
            if (callback) callback(response.data.ticket);
        }
    });
}


function getTicket(ticketId, callback) {
    var query = getGetTicketScript(ticketId);
    $.postJSON(query, function (response) {
        if (response.errors) {
            console.log(response.errors);
            if (callback) callback(undefined);
        } else {
            if (callback) callback(response.data.ticket);
        }
    });
}


function updateTerminalTickettag(terminalId, tagName,tag, callback) {
    var query = getUpdateTerminalTickettag(terminalId,tagName, tag);
    $.postJSON(query, function (response) {
        if (response.errors) {
            console.log(response.errors);
            if (callback) callback(undefined);
        } else {
            if (callback) callback(response.data.ticket);
        }
    });
}
function updateTerminalTicket(terminalId, note, callback) {
    var query = getUpdateTerminalTicket(terminalId, note);
    $.postJSON(query, function (response) {
        if (response.errors) {
            console.log(response.errors);
            if (callback) callback(undefined);
        } else {
            if (callback) callback(response.data.ticket);
        }
    });
}

function getAutomationCommandButtonsForTerminalTicket(terminalId, orderUids, callback) {
    var query;
    if (orderUids != "") {
        query = getgetAutomationCommandButtonsForTerminalTicket(terminalId, orderUids);
    } else {
        query = getgetAutomationCommandButtonsForTerminalTicketTerminal(terminalId);
        
    }
    $.postJSON(query, function (response) {
        if (response.errors) {
            console.log(response.errors);
        } else {
            if (callback) callback(response.data);
        }
    });
}

function getTickets(name, callback) {
    var query = getGetTicets(name);
    $.postJSON(query, function (response) {
        if (response.errors) {
            console.log(response.errors);
            if (callback) callback(undefined);
        } else {
            if (callback) callback(response.data.ticket);
        }
    });
}
function getUser(pin, callback) {
    var query = getGetUser(pin);
    $.postJSON(query, function (response) {
        if (response.errors) {
            console.log(response.errors);
            if (callback) callback(undefined);
        } else {
            if (callback) callback(response.data.name);
        }
    });
}
function executeAutomationCommandForTerminalTicket(terminalId, uid, name, value, callback) {
    var query = getexecuteAutomationCommandForTerminalTicketScript(terminalId, uid, name, value);
    $.postJSON(query, function (response) {
        /* 29.09.2026 duzeltmesi (kullanici bulgusu: "odeme tipi calismiyor",
           "butonlar calismiyor" - hicbir hata gorunmeden SESSIZCE calismiyordu).
           KOK NEDEN: server.js odeme yetkisi olmayan bir komut reddedince
           {error:"..."} DONUYOR (GraphQL {errors:[...]} DEGIL) - buradaki eski
           kod SADECE response.errors'a bakiyordu, response.error'u (tekil)
           hic yakalamiyordu ve "else" dalina dusup response.data.ticket'a
           erismeye calisirken (response.data TANIMSIZ oldugu icin) sessizce
           bir TypeError firlatip HICBIR SEY yapmiyordu - kullaniciya "hicbir
           sey olmadi" gibi gorunuyordu. */
        /* 29.09.2026 ikinci duzeltme (kullanici bulgusu: "nakite basiyorum
           ekranda tepki olmuyor ama cikis yapinca almis oluyor" - Nakit/Odeme
           gibi komutlar adisyonu KAPATIYOR, bu durumda SambaPOS
           "data.ticket: null" DONUYOR (basarili ama artik acik bir adisyon
           yok demek) - bir onceki duzeltme bunu da HATA sanip hicbir sey
           yapmiyordu. response.data varsa (ticket null bile olsa) BASARILI
           sayilir. */
        if (response && response.error) {
            alert(response.error);
            if (callback) callback(undefined);
        } else if (response && response.errors) {
            console.log(response);
            var msg = (response.errors[0] && response.errors[0].message) || 'İşlem gerçekleştirilemedi.';
            alert(msg);
            if (callback) callback(undefined);
        } else if (response && response.data) {
            if (callback) callback(response.data.ticket === undefined ? null : response.data.ticket);
        } else {
            if (callback) callback(undefined);
        }
    });
}
function executePrintJob(name, ticketId, callback) {
    var query = getExecutePrintJobScript(name, ticketId);
    $.postJSON(query, function (response) {
        if (response.errors) {
            // handle errors
        } else {
            if (callback) callback(response);
        }
    });
}
function mergeTickets(tickets, callback) {
    var query = getMergeTicketsScript(tickets);
    $.postJSON(query, function (response) {
        if (response.errors) {
            console.log(response);
        } else {
            if (callback) callback(response);
        }
    });
}

function loadTerminalTicket(terminalId, ticketId, callback) {
    var query = getLoadTerminalTicketScript(terminalId, ticketId);
    $.postJSON(query, function (response) {
        if (response.errors) {
            if (callback) callback(undefined);
        } else {
            if (callback) callback(response.data.ticket);
        }
    });
}
function updateTableColor(tablename) {
    var query = getUpdateTableColorScript(tablename);
    $.postJSON(query, function (response) {
        if (response.errors) {
            console.log(response);
        } else {
            console.log(response);
        }
    });
}

function getTerminalTickets(terminalId, callback) {
    var query = getGetTerminalTicketsScript(terminalId);
    $.postJSON(query, function (response) {
        if (response.errors) {
            if (callback) callback(undefined);
        } else {
            if (callback) callback(response.data.tickets);
        }
    });
}
function postRefresh(callback) {
    var query = 'mutation m{postTicketRefreshMessage(id:0){id}}';
    $.postJSON(query,callback);
}
function getMenu(callback) {
    var query = getMenuScript();
    $.postJSON(query, function (response) {
        if (response.errors) {
            //handle
        } else {
            if (callback) callback(response.data.menu);
        }
    });
}

function getProductPortions(productId, callback) {
    var query = getProductPortionsScript(productId);
    $.postJSON(query, function (response) {
        if (response.errors) {
            //handle
        } else {
            if (callback) callback(response.data.portions);
        }
    });
}
function getOrderTagsForTerminalTicketOrder(terminalId, orderUid, callback) {
    var query = getGetOrderTagsForTerminalTicketOrderScript(terminalId, orderUid);
    $.postJSON(query, function (response) {
        if (response.errors) {
            //handle 
        } else {
            if (callback) callback(response.data.tags);
        }
    });
}
function getProductOrderTags(productId, portion, callback) {
    var query = getProductOrderTagsScript(productId, portion);
    $.postJSON(query, function (response) {
        if (response.errors) {
            //handle
        } else {
            if (callback) callback(response.data.orderTags);
        }
    });
}

function registerTerminal(callback) {
    var query = getRegisterTerminalScript();
    $.postJSON(query, function (response) {
        if (response.errors) {
            //handle
        } else {

            if (callback) callback(response.data.terminalId);
        }
    });
}

function createTerminalTicket(terminalId, callback) {
    var query = getCreateTerminalTicketScript(terminalId);
    $.postJSON(query, function (response) {
        if (response.errors) {
            //handle
        } else {
            if (callback) callback(response.data.ticket);
        }
    });
}

function clearTerminalTicketOrders(terminalId, callback) {
    var query = getClearTerminalTicketScript(terminalId);
    $.postJSON(query, function (response) {
        if (response.errors) {
            //handle
        } else {
            if (callback) callback(response.data.ticket);
        }
    });
}

function closeTerminalTicket(terminalId, callback) {
    var query = getCloseTerminalTicketScript(terminalId);
    $.postJSON(query, function (response) {
        if (response.errors) {
            //handle
        } else {
            if (callback) callback(response.data.errorMessage);
        }
    });
}

function getTerminalExists(terminalId, callback) {
    var query = getGetTerminalExistsScript(terminalId);
    $.postJSON(query, function (response) {
        if (response.errors) {
            console.log(response.errors);
        } else {
            if (callback) callback(response.data.result);
        }
    });
}

function addOrderToTicket(ticket, productId) {
    var quantity = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 1;
    var callback = arguments[3];

    var query = getAddOrderToTicketQuery(ticket, productId, quantity);
    $.postJSON(query, function (response) {
        if (response.errors) {
            // handle errors
        } else {
            if (callback) callback(response.data.ticket);
        }
    });
}

function addOrderToTerminalTicket(terminalId, productId, quantity, callback) {
    var orderTags = '';
    var query = getAddOrderToTerminalTicketScript(terminalId, productId, quantity, orderTags);
    $.postJSON(query, function (response) {
        if (!response) return;   // baglanti hatasi - eg-extra.js uyari gosterdi, urun "tekrar gonder" listesinde
        if (response.errors) {
            console.log(response.errors);
        } else {
            if (callback) callback(response.data.ticket);
        }
    });
}

function changeEntityOfTerminalTicket(terminalId, name, callback) {
    var query = getChangeEntityOfTerminalTicketScript(terminalId, name);
    $.postJSON(query, function (response) {
        if (response.errors) {
            // handle errors
        } else {
            if (callback) callback(response.data.ticket);
        }
    });
}

function getEntityScreenItems(callback) {
    var query = getGetEntityScreenItemsScript();
    $.postJSON(query, function (response) {
        if (response.errors) {
        } else {
            if (callback) callback(response.data.items);
        }
    });
}
function updateOrderQuantityOfTerminalTicket(terminalId, orderUid, quantity, callback) {
    var query = getUpdateOrderQuantityOfTerminalTicketScript(terminalId, orderUid, quantity);
    $.postJSON(query, function (response) {
        if (response.errors) {
            // handle errors
        } else {
            if (callback) callback(response.data.ticket);
        }
    });
}

function updateOrderPortionOfTerminalTicket(terminalId, orderUid, portion, callback) {
    var query = getUpdateOrderPortionOfTerminalTicketScript(terminalId, orderUid, portion);
    $.postJSON(query, function (response) {
        if (response.errors) {
            // handle errors
        } else {
            if (callback) callback(response.data.ticket);
        }
    });
}

function updateOrderTagOfTerminalTicket(terminalId, orderUid, name, tag, callback) {
    var query = getUpdateOrderTagOfTerminalTicketScript(terminalId, orderUid, name, tag);
    $.postJSON(query, function (response) {
        if (response.errors) {
            // handle errors
        } else {
            if (callback) callback(response.data.ticket);
        }
    });
}

function getOrderTagsForTerminal(terminalId, orderUid, callback) {
    var query = getGetOrderTagsForTerminalScript(terminalId, orderUid);
    $.postJSON(query, function (response) {
        if (response.errors) {
            callback([]);
        } else {
            if (callback) callback(response.data.orderTags);
        }
    });
}

function getOrderTagColors(callback) {
    var query = getGetOrderTagColorsScript();
    $.postJSON(query, function (response) {
        if (response.errors) {
            // handle errors
        } else {
            if (callback) callback(response.data.colors);
        }
    });
}

function cancelOrderOnTerminalTicket(terminalId, orderUid, callback) {
    var query = getCancelOrderOnTerminalTicketScript(terminalId, orderUid);
    $.postJSON(query, function (response) {
        if (response.errors) {
            // handle errors
        } else {
            if (callback) callback(response.data.ticket);
        }
    });
}
function mergeTickets(tickets, callback) {
    var query = getMergeTicketsScript(tickets);
    $.postJSON(query, function (response) {
        if (response.errors) {
            console.log(response);
        } else {
            if (callback) callback(response.data.id);
        }
    });
}
function broadcastMessage(msg, callback) {
    var query = getPostBroadcastMessageScript(msg);
    $.postJSON(query, function (response) {
        if (response.errors) {
            // handle errors
        } else {
            if (callback) callback(response.data.postBroadcastMessage);
        }
    });
}
function getUrunler(kategoriname, callback) {
    var query = getUrunlerScript(kategoriname);
    $.postJSON(query, function (response) {
        if (response.errors) {
            //handle
        } else {
            if (callback) callback(response.data);
        }
    });
}
function getMasalar(callback) {
    var query = getMasalarScript();
    $.postJSON(query, function (response) {
        if (response.errors) {
            //handle
        } else {
            if (callback) callback(response.data);
        }
    });
}
function getProduct(productId, callback) {
    var query = getProductScript(productId);
    $.postJSON(query, function (response) {
        if (response.errors) {
            //handle
        } else {
            if (callback) callback(response.data);
        }
    });
}
function getEntity(name, callback) {
    var query = getEntityScript(name);
    $.postJSON(query, function (response) {
        if (response.errors) {
            console.log(response);
        } else {
            if (callback) callback(response.data);
        }
    });
}

function unregisterTerminal(terminalId, callback) {
    var query = getUnregisterTerminal(terminalId);
    $.postJSON(query, function (response) {
        if (response.errors) {
            
        } else {
            if (callback) callback(response.data);
        }
    });
}
function getUnregisterTerminal(terminalId) {
    return "mutation m{unregisterTerminal(terminalId:\"" + terminalId + "\")}";
}
function getUpdateTerminalTicket(terminalId, note) {
    return "mutation m{ticket:updateTerminalTicket(terminalId:\"" + terminalId + "\",note:\"" + note + "\")" + getTicketResult() + "}";
}
function getUpdateTerminalTickettag(terminalId, tagName,tag) {
    return "mutation m{ticket:updateTerminalTicket(terminalId:\"" + terminalId + "\",tags:{tagName:\""+tagName+"\",tag:\""+tag+"\"})" + getTicketResult() + "}";
}
function getEntityScript(name) {
    return "{data:getEntity(type:\"Tables\",name:\"" + name + "\"){id,type,name,customData{name,value},states{stateName,state}}}";
}
function getProductScript(productId) {
    return "{product:getProduct(id:" + productId + "){id,name,groupCode,price,portions{name,productId,productId,id}}}";
}
function getUpdateTableColorScript(tablename) {
    return "mutation m{updateEntityState(\n                entityTypeName: \"Tables\",\n                entityName: \"" + tablename + "\",\n                stateName: \"Status\",\n                state:\"New Orders\"\n                ){name}}";
}
function getMasalarScript() {
    return "{menu:getEntities(type:\"Tables\"){id,name,type,customData{name,value},states{stateName,state}}}";
}
function getUpdateOrderQuantityOfTerminalTicketScript(terminalId, orderUid, quantity) {
    return "mutation m{ticket:updateOrderOfTerminalTicket(\n        terminalId:\"" + terminalId + "\",\n        orderUid:\"" + orderUid + "\",\n\t    quantity:" + quantity + ")\n    " + getTicketResult() + "}";
}
function getMergeTicketsScript(tickets) {
    return "mutation m{id:mergeTickets(ticketIds:[" + tickets + "],user:\""+config.userName+"\",terminal:\""+config.terminalName+"\",department:\""+config.departmentName+"\",ticketType:\""+config.ticketTypeName+"\")}";
}
function getGetTicets(name) {
    return "{ticket:getTickets(entities:{entityType:\"" + config.entityScreenType + "\",name:\"" + name + "\"},isClosed:false)" + getTicketResult() + "}";
}

function getgetAutomationCommandButtonsForTerminalTicket(terminalId, orderUids) {
    return "mutation m{data:getAutomationCommandButtonsForTerminalTicket(terminalId:\"" + terminalId + "\",orderUids:" + orderUids + "){name,caption,color,values,canExecute}}";
}
function getgetAutomationCommandButtonsForTerminalTicketTerminal(terminalId) {
    return "mutation m{data:getAutomationCommandButtonsForTerminalTicket(terminalId:\"" + terminalId + "\"){name,caption,color,values,canExecute}}";
}
function getUpdateTicketScript(ticketId, note) {
    return "mutation m{updateTicket(name:" + ticketId + ",note:\"" + note + "\")" + getTicketResult() + "}";
}
function getGetUser(pin) {
    return "{name:getUser(pin:\""+pin+"\"){name}}";
}
function getMenuScript() {
    return "{menu:getMenu(name:\"" + config.menuName + "\"){categories{id,name,color,foreground,menuItems{id,name,color,caption,foreground,productId,defaultOrderTags}}}}";
}

function getProductPortionsScript(productId) {
    return "{portions:getProductPortions(productId:" + productId + "){id,name,price}}";
}
function getGetOrderTagsForTerminalTicketOrderScript(terminalId, orderUid) {
    return "mutation m{tags:getOrderTagsForTerminalTicketOrder(terminalId:\"" + terminalId + "\",orderUid:\"" + orderUid + "\"){name,maxSelection,requiredSelection,tags{name,groupName,color,labelColor,isSelected,isVisible,fontSize,caption},categories{name,value,color,level,sortOrder},prefixes{name,color,fontSize}}}";
}
function getProductOrderTagsScript(productId, portion) {
    return "{orderTags:getOrderTagGroups(productId:" + productId + ",portion:\"" + portion + "\",hidden:false){name,tags{name}}}";
}

function getGetOrderTagsForTerminalScript(terminalId, orderUid) {
    return "\n    mutation tags{orderTags:getOrderTagsForTerminalTicketOrder(\n        terminalId:\"" + terminalId + "\"\n\t    orderUid:\"" + orderUid + "\")\n    {name,tags{caption,color,labelColor,name}}}";
}

function getRegisterTerminalScript() {
    return "mutation m{terminalId:registerTerminal(terminal:\"" + config.terminalName + "\",department:\"" + config.departmentName + "\",user:\"" + config.userName + "\",ticketType:\"" + config.ticketTypeName + "\")}";
}
function getCreateTerminalTicketScript(terminalId) {
    return "mutation m{\n            ticket:createTerminalTicket(terminalId:\"" + terminalId + "\")\n        " + getTicketResult() + "}";
}
function getExecutePrintJobScript(name, ticketId) {
    return "mutation m{executePrintJob(name:\"" + name + "\",ticketId:" + ticketId + "){name}}";
}
function getexecuteAutomationCommandForTerminalTicketScript(terminalId, uid, name, value) {
    return "mutation m{ticket:executeAutomationCommandForTerminalTicket(terminalId:\"" + terminalId + "\",orderUid:\"" + uid + "\",name:\"" + name + "\",value:\"" + value + "\")" + getTicketResult() + "}";
}
function getGetTerminalTicketScript(terminalId) {
    return "query q{ticket:getTerminalTicket(terminalId:\"" + terminalId + "\")" + getTicketResult() + "}";
}

function getGetTicketScript(ticketId) {
    return "query q{ticket:getTicket(id:" + ticketId + ")" + getTicketResult() + "}";
}

function getLoadTerminalTicketScript(terminalId, ticketId) {
    return "mutation m{\n            ticket:loadTerminalTicket(terminalId:\"" + terminalId + "\", ticketId:\"" + ticketId + "\")\n        " + getTicketResult() + "}";
}

function getGetTerminalTicketsScript(terminalId) {
    return "query q{\n            tickets:getTerminalTickets(terminalId:\"" + terminalId + "\")\n        {id,date,lastOrderDate,remaining,number,entities{type,name}}}";
}

function getClearTerminalTicketScript(terminalId) {
    return "mutation m{\n            ticket:clearTerminalTicketOrders(terminalId:\"" + terminalId + "\")\n        " + getTicketResult() + "}";
}

function getUpdateOrderPortionOfTerminalTicketScript(terminalId, orderUid, portion) {
    return "mutation m {ticket:updateOrderOfTerminalTicket(\n        terminalId:\"" + terminalId + "\",orderUid:\"" + orderUid + "\",portion:\"" + portion + "\")\n    " + getTicketResult() + "}";
}

function getUpdateOrderTagOfTerminalTicketScript(terminalId, orderUid, name, tag) {
    return "mutation m{ticket:updateOrderOfTerminalTicket(\n        terminalId:\"" + terminalId + "\",\n        orderUid:\"" + orderUid + "\",\n\t    orderTags:[{tagName:\"" + name + "\",tag:\"" + tag + "\"}])\n    " + getTicketResult() + "}";
}

function getCancelOrderOnTerminalTicketScript(terminalId, orderUid) {
    return "mutation m{ticket:cancelOrderOnTerminalTicket(terminalId:\"" + terminalId + "\",orderUid:\"" + orderUid + "\")\n    " + getTicketResult() + "}";
}

function getCloseTerminalTicketScript(terminalId) {
    return "mutation m{\n            errorMessage:closeTerminalTicket(terminalId:\"" + terminalId + "\")}";
}

function getGetTerminalExistsScript(terminalId) {
    return "query q{\n            result:getTerminalExists(terminalId:\"" + terminalId + "\")}";
}

function getUrunlerScript(groupCode) {
    return "{urun:getProducts(groupCode:\"" + groupCode + "\"){name,id,price,portions{name,id,price,productId}}}";
}
function getAddOrderToTerminalTicketScript(terminalId, productId, quantity, orderTags) {
  
    return "mutation m{ticket:addOrderToTerminalTicket(terminalId:\"" + terminalId + "\",productId:" + productId + ",orderTags:\"" + orderTags + "\",quantity:" + quantity + ")\n        " + getTicketResult() + "}";

}

function getChangeEntityOfTerminalTicketScript(terminalId, name) {
    return "mutation m{\n            ticket:changeEntityOfTerminalTicket(terminalId:\"" + terminalId + "\",\n            type:\"" + config.entityScreenType + "\"\n            name:\"" + name + "\")\n        " + getTicketResult() + "}";
}

function getGetEntityScreenItemsScript() {
    return "query q{items:getEntityScreenItems(name:\"" + config.entityScreenName + "\"){name,caption,color,labelColor}}";
}

function getGetOrderTagColorsScript() {
    return '{colors:getOrderTagColors{name,value}}';
}

function getTicketResult() {
    return "{id,uid,type,number,date,totalAmount,remainingAmount,note\n  entities{name,type},      \n  states{stateName,state},\n  tags{tagName,tag},\n\torders{\n    id,\n    uid,\n    productId,\n    name,\n    quantity,\n    portion,\n    price,\n    priceTag,\n date,\n lastUpdateDate,\n number,\n  calculatePrice,\n    increaseInventory,\n    decreaseInventory,\n  locked,\n    tags{\n      tag,tagName,price,quantity,rate,userId   },\n    states{\n      stateName,state,stateValue\n    }}\n}";
}
function getPostBroadcastMessageScript(msg) {
    msg = msg.replace(/"/g, '\\"');
    return 'mutation m {postBroadcastMessage(message:"' + msg + '"){message}}';
}

/* ---- EnsariPOS Garson v2 eklemeleri (garsonsys'teki masa ozeti + Odeme Al) ---- */
function egGqlString(s) {
    return JSON.stringify(String(s == null ? '' : s));
}
/* Tum acik adisyonlar: masa kutularinda "12 dk  25.00 TL" ve ustteki "3 / 42 masa" icin */
function getOpenTickets(callback) {
    /* 29.09.2026: lastOrderDate "bekleyen masa" uyarisi icin eklendi. Bazi SambaPOS
       surumleri bu alani getTickets'ta tanimiyorsa sorgunun tamami hata verir ve
       masalar bos gorunurdu - o durumda alan OLMADAN bir kez daha denenir ve
       bir daha istenmez (uyari masanin acilis saatine gore calisir). */
    var withLast = storage.getItem('egNoLastOrderDate') !== '1';
    var query = "query q{tickets:getTickets(isClosed:false){id,date," + (withLast ? "lastOrderDate," : "") + "entities{type,name},totalAmount,remaining:remainingAmount,lastModifiedUserName}}";
    $.postJSON(query, function (response) {
        if (withLast && response && response.errors && /lastOrderDate/i.test(JSON.stringify(response.errors))) {
            storage.setItem('egNoLastOrderDate', '1');
            getOpenTickets(callback);
            return;
        }
        if (!response || response.errors || response.error || !response.data) { if (callback) callback(null); return; }
        if (callback) callback(response.data.tickets || []);
    });
}
/* SambaPOS'taki odeme tipleri - rol eslestirmesine gore (SambaPOS'un kendi kurali) */
function getPaymentTypesForRole(roleId, callback) {
    var query = "{types:getPaymentTypes(userRoleId:" + (parseInt(roleId, 10) || 0) + "){id,name,sortOrder,buttonColor}}";
    $.postJSON(query, function (response) {
        if (!response || response.errors || response.error || !response.data) { if (callback) callback(null); return; }
        if (callback) callback(response.data.types || []);
    });
}
/* SambaPOS hesaplama seciciler (% Iskonto, Yuvarla...) - rol eslestirmesine gore */
function getCalculationSelectorsForRole(roleId, callback) {
    var query = "{s:getCalculationSelectors(userRoleId:" + (parseInt(roleId, 10) || 0) + "){name,buttonHeader,calculationTypes{name,calculationMethod,amount}}}";
    $.postJSON(query, function (response) {
        if (!response || response.errors || response.error || !response.data) { if (callback) callback([]); return; }
        if (callback) callback(response.data.s || []);
    });
}
/* Iskonto/yuvarlama uygula (sunucu, yetkisiz garsonu SambaPOS'a iletmeden reddeder) */
function addCalculationToTerminalTicket(terminalId, calculationName, amount, callback) {
    var query = "mutation m{addCalculationToTerminalTicket(terminalId:" + egGqlString(terminalId) + ",calculationName:" + egGqlString(calculationName) +
        ",amount:" + (Number(amount) || 0) + ")" + getTicketResult() + "}";
    $.postJSON(query, function (response) {
        if (!response || response.error || response.errors || !response.data) {
            var msg = (response && (response.error || (response.errors && response.errors[0] && response.errors[0].message))) || 'İşlem yapılamadı.';
            alert(msg);
            if (callback) callback(null);
            return;
        }
        if (callback) callback(response.data.addCalculationToTerminalTicket);
    });
}
/* Odeme: sunucu, odeme yetkisi olmayan garsonun istegini SambaPOS'a hic iletmeden reddeder */
function payTerminalTicket(terminalId, paymentTypeName, amount, callback) {
    var query = "mutation m{payTerminalTicket(terminalId:" + egGqlString(terminalId) + ",paymentTypeName:" + egGqlString(paymentTypeName) +
        ",amount:" + Number(amount).toFixed(2) + "){ticketId,remainingAmount,errorMessage}}";
    $.postJSON(query, function (response) {
        if (response && response.error) { if (callback) callback({ errorMessage: response.error }); return; }
        if (!response || response.errors || !response.data) {
            var msg = (response && response.errors && response.errors[0] && response.errors[0].message) || 'Ödeme alınamadı.';
            if (callback) callback({ errorMessage: msg });
            return;
        }
        if (callback) callback(response.data.payTerminalTicket || { errorMessage: 'Ödeme alınamadı.' });
    });
}