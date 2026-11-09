/* =========================================================================
   STIKE BIKE SHOP: medicion del sitio (Google Analytics 4 + contador propio).

   Que hace
     1. Carga Google Analytics 4 (gtag.js) si data/analytics.json trae un ID de medicion (G-XXXXXXXXXX).
     2. Manda los eventos de la tienda con el esquema de comercio electronico de GA4: view_item_list, select_item, view_item,
        add_to_cart, remove_from_cart, view_cart, begin_checkout, purchase (solo cuando el pago quedo APROBADO), search.
     3. Mide TODO clic a WhatsApp (evento whatsapp_click, con el lugar donde estaba el boton) y los clics a telefono, correo,
        mapa y redes (contact_click), compartir (share), formularios (generate_lead) y errores de pago (checkout_error).
     4. Cuenta los eventos importantes TAMBIEN en el servidor (api/track.php): conteos anonimos por dia, sin cookies ni IP.
        Sirve de respaldo cuando un bloqueador de anuncios tapa Google y para comparar las cifras (panel > Analitica).

   Lo que NO hace
     - No manda NUNCA el texto de un mensaje de WhatsApp (puede traer nombre, telefono o direccion del cliente): del enlace
       solo se usa el numero de la tienda y si es contacto o compartir.
     - No manda nombres, telefonos, correos ni direcciones. No usa publicidad ni Google Signals.
     - No cuenta las visitas del equipo (navegadores marcados con ?stike_internal=1, y el que abre el panel), ni las del panel
       de vista previa, ni las de un robot, ni las de otro dominio (localhost) salvo con ?stike_debug=1.

   Consentimiento: respeta el aviso de cookies del sitio (app.js guarda la decision en localStorage y avisa con el evento
   "stike:consent"). "Rechazar opcionales", "No rastrear" (DNT) y "Global Privacy Control" apagan GA4 y el contador propio.
   data/analytics.json > consentMode: "opt_out" (mide hasta que la persona rechace) o "opt_in" (espera a que acepte).

   Depuracion: abrir cualquier pagina con ?stike_debug=1 (o localStorage.stike_debug = "1"): los eventos salen por consola y
   quedan en window.__stikeAnalytics.log; GA4 los marca como debug (aparecen en DebugView).
   ========================================================================= */
(function () {
  "use strict";
  if (window.__stikeAnalyticsLoaded) return;
  window.__stikeAnalyticsLoaded = true;

  var CONFIG_URL = "data/analytics.json";
  var FP_URL = "api/track";
  var CONSENT_KEY = "stike_cookie_consent_v1";
  var SITE_HOST = /(^|\.)stikebikeshop\.com$/i;
  var GA_ID_RE = /^G-[A-Z0-9]{6,14}$/;

  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { window.localStorage.removeItem(k); } catch (e) {} }
  function ssGet(k) { try { return window.sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { window.sessionStorage.setItem(k, v); } catch (e) {} }

  /* ?stike_internal=1 marca este navegador como del equipo (no cuenta); ?stike_internal=0 lo desmarca. */
  var qs = location.search || "";
  if (/[?&]stike_internal=1(&|$)/.test(qs)) lsSet("stike_internal", "1");
  if (/[?&]stike_internal=0(&|$)/.test(qs)) lsSet("stike_internal", "0");
  if (/[?&]stike_debug=1(&|$)/.test(qs)) lsSet("stike_debug", "1");
  if (/[?&]stike_debug=0(&|$)/.test(qs)) lsDel("stike_debug");

  var DEBUG = lsGet("stike_debug") === "1";
  var LOG = [];
  if (DEBUG) window.__stikeAnalytics = { log: LOG };

  /* ------------------------------ ¿se mide esta visita? ------------------------------ */
  function environmentAllowed() {
    if (DEBUG) return true;
    if (/[?&]admin-preview=1(&|$)/.test(qs)) return false;            // vista previa dentro del panel
    if (navigator.webdriver) return false;                              // robots y pruebas automaticas
    if (lsGet("stike_internal") === "1") return false;                  // navegadores del equipo
    if (!SITE_HOST.test(location.hostname)) return false;               // localhost, vistas previas, otros dominios
    if (window.top !== window.self) return false;                       // dentro de un iframe ajeno
    return true;
  }
  function privacySignal() {
    return navigator.doNotTrack === "1" || window.doNotTrack === "1" || navigator.globalPrivacyControl === true;
  }
  function consentChoice() {
    try { var c = JSON.parse(lsGet(CONSENT_KEY)); return c && c.choice ? c.choice : null; } catch (e) { return null; }
  }
  /* ¿se puede medir ahora? Rechazo o senal de privacidad: no. Aceptado: si. Sin decision: depende de consentMode. */
  function measuringAllowed(cfg) {
    if (privacySignal() && !DEBUG) return false;
    var c = consentChoice();
    if (c === "reject") return false;
    if (c === "accept") return true;
    return (cfg && cfg.consentMode) !== "opt_in";
  }

  if (!environmentAllowed()) return;

  /* ------------------------------------ estado ------------------------------------ */
  var CFG = null, GA_ID = "", GA_LOADED = false, GA_ON = false, FP_ON = false, READY = false;
  var queue = [];

  /* ---------------------------------- utilidades ---------------------------------- */
  function pageType() {
    var p = location.pathname.replace(/\/index\.html$/, "/");
    if (p === "/" || p === "") return "home";
    if (/^\/producto\/[^/]+\.html$/.test(p)) return "product";
    if (/^\/(tienda|marcas)\.html$/.test(p) || /^\/(categoria|marca)\/[^/]+\.html$/.test(p)) return "catalog";
    if (/^\/carrito\.html$/.test(p)) return "cart";
    if (/^\/pago-resultado\.html$/.test(p)) return "payment_result";
    if (/^\/armar\.html$/.test(p)) return "build";
    if (/^\/contacto\.html$/.test(p)) return "contact";
    if (/^\/blog[^/]*\.html$/.test(p)) return "blog";
    if (/^\/fate(\/|$)/.test(p)) return "fate";
    if (/^\/(terminos|privacidad|cookies|devoluciones|envios|preguntas-frecuentes)\.html$/.test(p)) return "legal";
    return "other";
  }
  function slugFromPath() {
    var m = location.pathname.match(/^\/producto\/([a-z0-9-]+)\.html$/);
    return m ? m[1] : "";
  }
  function slugFromHref(href) {
    var m = String(href || "").match(/producto\/([a-z0-9-]+)\.html/);
    return m ? m[1] : "";
  }
  function deviceClass() {
    try { return window.matchMedia("(max-width: 820px)").matches ? "m" : "d"; } catch (e) { return "d"; }
  }
  function referrerType() {
    var utm = /[?&]utm_(source|medium|campaign)=/.test(qs);
    var ref = document.referrer || "";
    if (!ref) return utm ? "campaign" : "direct";
    var h = "";
    try { h = new URL(ref).hostname.toLowerCase(); } catch (e) { return "other"; }
    if (SITE_HOST.test(h) || h === location.hostname) return "internal";
    if (utm) return "campaign";
    if (/(^|\.)(google|bing|duckduckgo|yahoo|ecosia|yandex|baidu|brave)\./.test(h) || /(^|\.)(google|bing)\.[a-z.]+$/.test(h)) return "search";
    if (/(facebook|fb|instagram|tiktok|twitter|x|t|youtube|youtu|whatsapp|wa|pinterest|linkedin|reddit)\.(com|me|co|be|net)$/.test(h) || /^l\.(instagram|facebook)\.com$/.test(h)) return "social";
    return "other";
  }
  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }

  /* ------------------------------- productos / carrito ------------------------------- */
  function findProduct(slug) {
    try {
      if (typeof window.stikeFindProduct === "function") return window.stikeFindProduct(slug) || null;
      var all = window.STIKE_PRODUCTS || [];
      for (var i = 0; i < all.length; i++) if (all[i].slug === slug) return all[i];
    } catch (e) {}
    return null;
  }
  function categoryName(p) {
    try { var c = typeof window.stikeCategory === "function" ? window.stikeCategory(p.cat) : null; return (c && c.name) || p.cat || ""; } catch (e) { return p.cat || ""; }
  }
  function unitPrice(p, size, color) {
    try {
      if (typeof window.stikePriceFor === "function") { var v = window.stikePriceFor(p, size || null, color || null); if (v > 0) return Math.round(v); }
      return Math.round(p.price || 0);
    } catch (e) { return Math.round(p.price || 0); }
  }
  function gaItem(p, o) {
    o = o || {};
    var it = { item_id: String(p.sku || p.slug), item_name: String(p.n || p.slug), price: unitPrice(p, o.size, o.color), quantity: o.qty || 1 };
    if (p.brand) it.item_brand = String(p.brand);
    var cat = categoryName(p); if (cat) it.item_category = String(cat);
    if (p.sub) it.item_category2 = String(p.sub);
    var variant = [o.size, o.color].filter(Boolean).join(" / "); if (variant) it.item_variant = variant;
    if (o.list) { it.item_list_id = o.list.id; it.item_list_name = o.list.name; }
    if (o.index != null) it.index = o.index;
    return it;
  }
  function cartLines() {
    try { return typeof window.stikeGetCart === "function" ? window.stikeGetCart() : []; } catch (e) { return []; }
  }
  function cartItems() {
    var out = [];
    cartLines().forEach(function (r) { var p = findProduct(r.slug); if (p) out.push(gaItem(p, { qty: r.qty || 1, size: r.size, color: r.color })); });
    return out;
  }
  function sumValue(items) { return items.reduce(function (a, i) { return a + (i.price || 0) * (i.quantity || 1); }, 0); }

  /* -------------------------------- envio a GA4 / propio -------------------------------- */
  function log(name, params, fp) {
    if (!DEBUG) return;
    LOG.push({ name: name, params: params || {}, fp: fp || null });
    try { console.log("[stike-analytics]", name, params || {}, fp || ""); } catch (e) {}
  }
  function ga(name, params) {
    if (!GA_ID || !GA_ON || typeof window.gtag !== "function") return;
    try { window.gtag("event", name, params || {}); } catch (e) {}
  }
  function fpSend(payload) {
    if (!FP_ON) return;
    var body = JSON.stringify(payload);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(FP_URL, new Blob([body], { type: "text/plain;charset=UTF-8" }))) return;
    } catch (e) {}
    try { fetch(FP_URL, { method: "POST", body: body, headers: { "Content-Type": "text/plain;charset=UTF-8" }, keepalive: true, credentials: "omit" }).catch(function () {}); } catch (e) {}
  }
  /* params: los de GA4 (null = no mandar nada a GA4). fp: false = solo GA4; objeto = tambien el contador propio (se le agregan
     dispositivo, tipo de pagina y ruta). */
  function track(name, params, fp) {
    if (!READY) { queue.push([name, params, fp]); return; }
    var payload = null;
    if (fp) {
      payload = { e: fp.e || name, d: deviceClass(), t: pageType(), p: location.pathname };
      for (var k in fp) if (Object.prototype.hasOwnProperty.call(fp, k) && k !== "e") payload[k] = fp[k];
      if (!payload.s) { var s = slugFromPath(); if (s) payload.s = s; }
    }
    log(params === null ? "(solo contador propio) " + (payload && payload.e) : name, params, payload);
    if (params !== null) ga(name, params);
    if (payload) fpSend(payload);
  }

  /* -------------------------------------- GA4 -------------------------------------- */
  function clearGaCookies() {
    try {
      var names = (document.cookie || "").split(";").map(function (c) { return c.split("=")[0].trim(); }).filter(function (n) { return n === "_ga" || n.indexOf("_ga_") === 0 || n === "_gid"; });
      var host = location.hostname, parts = host.split("."), domains = ["", host, "." + host];
      if (parts.length > 2) domains.push("." + parts.slice(-2).join("."));
      names.forEach(function (n) {
        domains.forEach(function (d) { document.cookie = n + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/" + (d ? "; domain=" + d : ""); });
      });
    } catch (e) {}
  }
  function loadGa() {
    if (GA_LOADED || !GA_ID) return;
    GA_LOADED = true;
    window.dataLayer = window.dataLayer || [];
    if (typeof window.gtag !== "function") window.gtag = function () { window.dataLayer.push(arguments); };
    window["ga-disable-" + GA_ID] = false;
    window.gtag("consent", "default", { analytics_storage: "granted", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
    window.gtag("js", new Date());
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(GA_ID);
    document.head.appendChild(s);
    var conf = { allow_google_signals: false, allow_ad_personalization_signals: false, cookie_flags: "SameSite=Lax;Secure" };
    if (DEBUG) conf.debug_mode = true;
    window.gtag("config", GA_ID, conf);
    log("ga4_loaded", { measurement_id: GA_ID });
  }
  function applyConsent() {
    var allowed = measuringAllowed(CFG);
    var wasGa = GA_ON;
    FP_ON = allowed && CFG.firstParty !== false;
    GA_ON = allowed && !!GA_ID;
    if (GA_ON && !GA_LOADED) loadGa();
    if (GA_LOADED && GA_ON !== wasGa) {
      window["ga-disable-" + GA_ID] = !GA_ON;
      try { window.gtag("consent", "update", { analytics_storage: GA_ON ? "granted" : "denied" }); } catch (e) {}
      if (!GA_ON) clearGaCookies();
    }
    log("consent", { ga: GA_ON, first_party: FP_ON, choice: consentChoice() || "sin_decision" });
  }

  /* ------------------------------------ WhatsApp ------------------------------------ */
  /* Devuelve {kind: "contact"|"share", key} o null. NUNCA devuelve el texto del mensaje. */
  function parseWa(raw) {
    var u;
    try { u = new URL(String(raw), location.href); } catch (e) { return null; }
    var host = u.hostname.toLowerCase(), phone = "";
    if (host === "wa.me") phone = u.pathname.replace(/\D/g, "");
    else if (host === "api.whatsapp.com" || host === "web.whatsapp.com") phone = (u.searchParams.get("phone") || "").replace(/\D/g, "");
    else if (u.protocol === "whatsapp:") phone = (u.searchParams.get("phone") || "").replace(/\D/g, "");
    else return null;
    return phone ? { kind: "contact", key: "wa:" + phone } : { kind: "share", key: "wa:share" };
  }
  var LOC_RULES = [
    ["[data-wa-loc]", null],
    [".wa-float", "floating_button"],
    ["#wa-order", "cart"],
    ["#wa-build", "build"],
    ["#wa-buy", "product_page"],
    [".mega-parts, .mg-side, .dropdown", "menu"],
    ["#site-footer, footer", "footer"],
    ["#site-header, header", "header"],
    ["form", "form_fallback"]
  ];
  function waLocation(el) {
    if (el && el.closest) {
      for (var i = 0; i < LOC_RULES.length; i++) {
        var hit = el.closest(LOC_RULES[i][0]);
        if (hit) return LOC_RULES[i][1] || hit.getAttribute("data-wa-loc") || "other";
      }
    }
    switch (pageType()) {
      case "product": return "product_page";
      case "cart": return "cart";
      case "build": return "build";
      case "payment_result": return "payment_result";
      case "contact": return "contact_page";
      case "home": return "home";
      case "fate": return "fate";
      case "blog": return "blog";
      default: return "other";
    }
  }
  var lastWa = { key: "", t: 0 }, lastClick = { el: null, t: 0 };
  function pageContext(params, fp) {
    var pt = pageType();
    if (pt === "product") {
      var p = findProduct(slugFromPath());
      if (p) { var it = gaItem(p); params.items = [it]; params.value = it.price; params.currency = "COP"; fp.s = p.slug; }
    } else if (pt === "cart" || pt === "build") {
      var items = cartItems();
      if (items.length) { params.value = sumValue(items); params.currency = "COP"; params.items_in_cart = items.length; }
    } else if (pt === "payment_result") {
      var ref = new URLSearchParams(qs).get("id");   // id de la transaccion de Wompi (no lleva datos de la persona)
      if (ref) params.transaction_id = String(ref).slice(0, 64);
    }
  }
  function trackWa(raw, el) {
    var info = parseWa(raw);
    if (!info) return;
    var now = Date.now();
    if (lastWa.key === info.key && now - lastWa.t < 250) return;   // un mismo gesto puede pasar por el enlace y por window.open a la vez
    lastWa = { key: info.key, t: now };
    if (info.kind === "share") {
      var sp = findProduct(slugFromPath());
      var shareParams = { method: "whatsapp", content_type: sp ? "product" : "page" };
      if (sp) shareParams.item_id = String(sp.sku || sp.slug);
      track("share", shareParams, { e: "share" });
      return;
    }
    var loc = waLocation(el), params = { link_location: loc, page_type: pageType(), link_domain: "wa.me" }, fp = { e: "whatsapp_click", l: loc };
    pageContext(params, fp);
    track("whatsapp_click", params, fp);
  }

  /* --------------------------------------- clics --------------------------------------- */
  function listFor(el) {
    var sec = el && el.closest ? el.closest("section, .section, main, .wrap") : null;
    var h = sec ? sec.querySelector("h1, h2, h3") : null;
    var name = (h && h.textContent || "").replace(/\s+/g, " ").trim();
    if (!name) name = (document.title || "Tienda").split("|")[0].replace(/\s+/g, " ").trim();
    name = name.slice(0, 60) || "Tienda";
    return { id: name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "lista", name: name };
  }
  function cardItem(card, list) {
    var a = card.querySelector('a[href*="producto/"]'), slug = a ? slugFromHref(a.getAttribute("href")) : "";
    var p = slug ? findProduct(slug) : null;
    if (!p) return null;
    var idx = card.parentNode ? Array.prototype.indexOf.call(card.parentNode.children, card) : 0;
    return gaItem(p, { list: list, index: idx });
  }
  function contactMethod(href) {
    if (/^tel:/i.test(href)) return "phone";
    if (/^mailto:/i.test(href)) return "email";
    var h = ""; try { h = new URL(href, location.href).hostname.toLowerCase(); } catch (e) { return ""; }
    if (/(^|\.)instagram\.com$/.test(h)) return "instagram";
    if (/(^|\.)(facebook\.com|fb\.me|fb\.com)$/.test(h)) return "facebook";
    if (/(^|\.)tiktok\.com$/.test(h)) return "tiktok";
    if (/(^|\.)(maps\.app\.goo\.gl|waze\.com)$/.test(h) || (/(^|\.)google\.[a-z.]+$/.test(h) && /\/maps/.test(href))) return "maps";
    return "";
  }
  function onClick(e) {
    var t = e.target;
    if (!t || !t.closest) return;
    lastClick = { el: t, t: Date.now() };
    var a = t.closest("a[href]");
    if (a) {
      var href = a.getAttribute("href") || "";
      if (parseWa(href)) { trackWa(href, a); return; }
      var m = contactMethod(href);
      if (m) { track("contact_click", { method: m, page_type: pageType() }, { e: "contact_click", m: m }); return; }
      var card = a.closest("article.card");
      if (card && slugFromHref(href)) {
        var list = listFor(card), item = cardItem(card, list);
        if (item) track("select_item", { item_list_id: list.id, item_list_name: list.name, items: [item] }, false);
        return;
      }
    }
    if (t.closest("#share-copy")) {
      var p = findProduct(slugFromPath());
      track("share", { method: "copy_link", content_type: p ? "product" : "page", item_id: p ? String(p.sku || p.slug) : undefined }, { e: "share" });
      return;
    }
    if (t.closest("#add-build")) {
      var bi = cartItems();   // «Agregar todo al carrito» del armador: el carrito ya lo llena stikeAddToCart (add_to_cart por pieza)
      track("build_add_to_cart", { items_in_cart: bi.length, value: sumValue(bi), currency: "COP" }, false);
      return;
    }
    if (t.closest("#overlay-results .sr-row")) searchFromOverlay();
  }

  /* --------------------------------------- busqueda --------------------------------------- */
  var lastSearch = { q: "", t: 0 };
  function trackSearch(term) {
    term = String(term || "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (term.length < 2) return;
    var now = Date.now();
    if (lastSearch.q === term.toLowerCase() && now - lastSearch.t < 3000) return;
    lastSearch = { q: term.toLowerCase(), t: now };
    track("search", { search_term: term }, { e: "search", q: term });
  }
  function searchFromOverlay() { var i = document.getElementById("overlay-search"); if (i) trackSearch(i.value); }

  /* ------------------------------------ carrito y pago ------------------------------------ */
  function wrapFunctions() {
    var origAdd = window.stikeAddToCart;
    if (typeof origAdd === "function" && !origAdd.__stikeWrapped) {
      window.stikeAddToCart = function (slug, qty, size, color) {
        var r = origAdd.apply(this, arguments);
        try {
          var p = findProduct(slug);
          if (p) { var it = gaItem(p, { qty: qty || 1, size: size, color: color }); track("add_to_cart", { currency: "COP", value: it.price * it.quantity, items: [it] }, { e: "add_to_cart", s: p.slug }); }
        } catch (e) {}
        return r;
      };
      window.stikeAddToCart.__stikeWrapped = true;
    }
    var origRemove = window.stikeRemoveFromCart;
    if (typeof origRemove === "function" && !origRemove.__stikeWrapped) {
      window.stikeRemoveFromCart = function (key) {
        var gone = null;
        try {
          var row = cartLines().filter(function (r) { return typeof window.stikeLineKey === "function" && window.stikeLineKey(r) === key; })[0];
          var p = row ? findProduct(row.slug) : null;
          if (p) gone = gaItem(p, { qty: row.qty || 1, size: row.size, color: row.color });
        } catch (e) {}
        var r = origRemove.apply(this, arguments);
        if (gone) track("remove_from_cart", { currency: "COP", value: gone.price * gone.quantity, items: [gone] }, false);
        return r;
      };
      window.stikeRemoveFromCart.__stikeWrapped = true;
    }
    var origPay = window.stikeWompiCheckout;
    if (typeof origPay === "function" && !origPay.__stikeWrapped) {
      window.stikeWompiCheckout = function (items, total) {
        var gi = [];
        try { (items || []).forEach(function (r) { var p = findProduct(r.slug); if (p) gi.push(gaItem(p, { qty: r.qty || 1, size: r.size, color: r.color })); }); } catch (e) {}
        track("begin_checkout", { currency: "COP", value: total != null ? Math.round(total) : sumValue(gi), items: gi }, { e: "begin_checkout" });
        var res = origPay.apply(this, arguments);
        if (res && typeof res.catch === "function") {
          res.catch(function (err) { track("checkout_error", { error_code: String((err && (err.code || err.message)) || "desconocido").slice(0, 80) }, false); });
        }
        return res;
      };
      window.stikeWompiCheckout.__stikeWrapped = true;
    }
  }
  var lastForm = {};
  function onSubmit(e) {
    var form = e.target;
    if (!form || !form.getAttribute) return;
    var h = form.getAttribute("onsubmit") || "", f = "";
    if (/stikeContact/.test(h)) f = "contact";
    else if (/stikeSubscribe|newsletter/i.test(h + " " + (form.id || "") + " " + (form.className || ""))) f = "newsletter";
    if (!f) return;
    var now = Date.now();
    if (lastForm[f] && now - lastForm[f] < 8000) return;
    lastForm[f] = now;
    track("generate_lead", { form_id: f, page_type: pageType() }, { e: "generate_lead", f: f });
  }
  function onKeydown(e) {
    if (e.key === "Enter" && e.target && e.target.id === "overlay-search") trackSearch(e.target.value);
  }
  function onHeaderSearchSubmit(e) {
    var i = e.target && e.target.querySelector ? e.target.querySelector("#site-search") : null;
    if (i) trackSearch(i.value);   // (el buscador en vivo de la lupa es el overlay; este es el formulario clasico del encabezado)
  }

  /* purchase y pagos fallidos: los manda pago-resultado.html con estos eventos del documento (solo con el estado FINAL). */
  function onPurchase(ev) {
    var d = (ev && ev.detail) || {}, ref = String(d.reference || "").slice(0, 64);
    if (!ref) return;
    var key = "stike_an_purchases", seen = [];
    try { seen = JSON.parse(lsGet(key) || "[]"); } catch (e) {}
    if (seen.indexOf(ref) >= 0) return;            // recargar la pagina de resultado no cuenta otra compra
    seen.push(ref); lsSet(key, JSON.stringify(seen.slice(-30)));
    var items = [];
    (d.items || []).forEach(function (r) { var p = findProduct(r.slug); if (p) items.push(gaItem(p, { qty: r.qty || 1, size: r.size, color: r.color })); });
    var value = Math.round(Number(d.value) || sumValue(items));
    track("purchase", { transaction_id: ref, value: value, currency: "COP", shipping: 0, tax: 0, affiliation: "Stike Bike Shop", items: items }, false);
  }
  function onPaymentFailed(ev) {
    var d = (ev && ev.detail) || {};
    track("payment_failed", { transaction_id: String(d.reference || "").slice(0, 64) || undefined, status: String(d.status || "").slice(0, 30) }, false);
  }

  /* ----------------------------- vistas de pagina y listas ----------------------------- */
  function onPageLoad() {
    var pt = pageType();
    track("page_view_fp", null, { e: "page_view", r: referrerType() });   // el page_view de GA4 lo manda gtag solo; este es el del contador propio
    if (pt === "product") {
      var p = findProduct(slugFromPath());
      if (p) { var it = gaItem(p); track("view_item", { currency: "COP", value: it.price, items: [it] }, { e: "view_item", s: p.slug }); }
    }
    if (pt === "cart") {
      var items = cartItems();
      if (items.length) track("view_cart", { currency: "COP", value: sumValue(items), items: items }, false);
    }
    if (/p[a\u00e1]gina no encontrada/i.test(document.title) || /\/404\.html$/.test(location.pathname)) {
      track("page_not_found", { page_location: location.href }, false);
    }
    initLists();
  }
  function initLists() {
    if (!("IntersectionObserver" in window)) return;
    var pending = {}, timer = null;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        io.unobserve(en.target);
        var list = listFor(en.target), item = cardItem(en.target, list);
        if (!item) return;
        (pending[list.id] = pending[list.id] || { list: list, items: [] }).items.push(item);
      });
      clearTimeout(timer); timer = setTimeout(flush, 700);
    }, { threshold: 0.5 });
    function flush() {
      Object.keys(pending).forEach(function (k) {
        var q = pending[k]; delete pending[k];
        for (var i = 0; i < q.items.length; i += 20) track("view_item_list", { item_list_id: q.list.id, item_list_name: q.list.name, items: q.items.slice(i, i + 20) }, false);
      });
    }
    function scan() {
      var cards = document.querySelectorAll("article.card:not([data-an])");
      for (var i = 0; i < cards.length; i++) { cards[i].setAttribute("data-an", "1"); io.observe(cards[i]); }
    }
    scan();
    try { new MutationObserver(debounce(scan, 250)).observe(document.body, { childList: true, subtree: true }); } catch (e) {}
  }

  /* ------------------------------------- arranque ------------------------------------- */
  function start(cfg) {
    CFG = cfg && typeof cfg === "object" ? cfg : {};
    GA_ID = GA_ID_RE.test(String(CFG.ga4MeasurementId || "")) ? String(CFG.ga4MeasurementId) : "";
    applyConsent();
    READY = true;
    var q = queue; queue = [];
    q.forEach(function (a) { track(a[0], a[1], a[2]); });
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", onPageLoad); else onPageLoad();
  }
  function loadConfig(cb) {
    var cached = ssGet("stike_an_cfg");
    if (cached) { try { var o = JSON.parse(cached); if (o && Date.now() - o.t < 600000) { cb(o.c); return; } } catch (e) {} }
    var done = false;
    function finish(c, ok) { if (done) return; done = true; if (ok) ssSet("stike_an_cfg", JSON.stringify({ t: Date.now(), c: c })); cb(c); }
    try {
      fetch(CONFIG_URL, { credentials: "omit" }).then(function (r) { return r.ok ? r.json() : Promise.reject(); }).then(function (c) { finish(c, true); }, function () { finish({}, false); });
      setTimeout(function () { finish({}, false); }, 4000);
    } catch (e) { finish({}, false); }
  }

  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeydown, true);
  document.addEventListener("submit", function (e) { onSubmit(e); onHeaderSearchSubmit(e); }, true);
  document.addEventListener("stike:purchase", onPurchase);
  document.addEventListener("stike:payment_failed", onPaymentFailed);
  document.addEventListener("stike:consent", function () { if (CFG) applyConsent(); });

  /* window.open("https://wa.me/...") (formularios y avisos que abren WhatsApp por codigo): se mide igual. */
  var nativeOpen = window.open;
  window.open = function (url) {
    try { if (url && parseWa(url)) trackWa(url, Date.now() - lastClick.t < 2000 ? lastClick.el : null); } catch (e) {}
    return nativeOpen.apply(this, arguments);
  };

  wrapFunctions();
  loadConfig(start);
})();
