/* =========================================================================
   Medicion del sitio (assets/js/analytics.js): GA4 + contador propio.

   Se prueba con el navegador real (Playwright) y el sitio tal cual, con Google y el contador propio SIMULADOS
   (se capturan los pedidos). Lo que se comprueba:
     - GA4 solo carga si hay ID de medicion, y respeta el consentimiento (rechazar, opt_in, navegador del equipo, vista previa).
     - CADA clic a WhatsApp se mide, con el lugar donde estaba el boton, y NUNCA viaja el texto del mensaje.
     - El esquema de comercio electronico de GA4: view_item_list, select_item, view_item, add_to_cart, remove_from_cart,
       view_cart, begin_checkout, checkout_error, purchase (una sola vez, con el pago aprobado), payment_failed, search.
     - El contador propio recibe lo importante, sin datos personales.
     - Todas las paginas publicas llevan el script (y los enlaces a WhatsApp de la web de Fate tambien se miden).

     python3 -m http.server 8143   (en la raiz del repo)
     node tools/analytics-site-test.mjs
   ========================================================================= */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(process.env.PW_MODULES || "/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const ROOT = process.cwd(), B = "http://localhost:8143";
let fail = 0;
const t = (l, ok, x = "") => { if (!ok) fail++; console.log((ok ? "ok    " : "FALLA ") + l + (ok ? "" : "  -> " + x)); };
const br = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const wait = ms => new Promise(r => setTimeout(r, ms));
const GA = "G-TEST123456";

/* Abre una pagina con Google y el contador propio simulados. cfg = lo que dice data/analytics.json.
   consent: "accept" (por defecto: el aviso de cookies no tapa nada) | "reject" | "none" (sin decision). */
async function open(url, { cfg = { ga4MeasurementId: GA, consentMode: "opt_out", firstParty: true }, consent = "accept", ls = {}, init = null, routes = null, debug = true } = {}) {
  const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", e => errs.push(e.message));
  const out = { page, ctx, errs, fp: [], google: [], wa: [] };
  ls = { stike_newsletter_v1: "subscribed", ...ls };   // el aviso del boletin no tapa botones
  if (consent !== "none") ls = { stike_cookie_consent_v1: JSON.stringify({ choice: consent, ts: 1 }), ...ls };
  ctx.on("page", p => { if (p !== page) p.close().catch(() => {}); });
  await page.route("**/data/analytics.json", r => r.fulfill({ json: cfg }));
  await page.route("**/api/track", r => { try { out.fp.push(JSON.parse(r.request().postData() || "{}")); } catch (e) { out.fp.push({ bad: true }); } r.fulfill({ status: 204 }); });
  await page.route(/https:\/\/(www\.)?(googletagmanager|google-analytics)\.com\/.*/, r => { out.google.push(r.request().url()); r.fulfill({ status: 200, contentType: "application/javascript", body: "/* simulado */" }); });
  await ctx.route(/https:\/\/(wa\.me|api\.whatsapp\.com)\/.*/, r => { out.wa.push(r.request().url()); r.fulfill({ status: 200, contentType: "text/html", body: "<html>WhatsApp</html>" }); });
  await page.route("**/api/wompi-sign", r => r.fulfill({ status: 500, json: { error: "wompi_not_configured" } }));
  if (routes) await routes(page);
  await page.addInitScript(lsv => { try { for (const k in lsv) localStorage.setItem(k, lsv[k]); } catch (e) {} window.alert = () => {}; window.confirm = () => true; }, ls);
  if (init) await page.addInitScript(init);
  await page.goto(B + url + (debug ? (url.includes("?") ? "&" : "?") + "stike_debug=1" : ""), { waitUntil: "load" });
  await wait(500);
  out.events = async () => (await page.evaluate(() => (window.dataLayer || []).map(a => Array.from(a)))).filter(a => a[0] === "event").map(a => ({ name: a[1], params: a[2] || {} }));
  out.dl = () => page.evaluate(() => (window.dataLayer || []).map(a => Array.from(a)));
  out.ev = async name => (await out.events()).filter(e => e.name === name);
  /* los clics se hacen con el propio navegador sobre el elemento (no por coordenadas): no los tapa el aviso de cookies ni el carrito flotante */
  out.click = async (sel, nth = 0) => { await page.locator(sel).nth(nth).evaluate(el => el.click()); await wait(300); };
  return out;
}
const noPII = o => !/Hola|quiero|text=|%20|Calle|3001112233|jparra375/i.test(JSON.stringify(o));

/* ===================================================== 1. carga y consentimiento ===================================================== */
console.log("\nCarga de GA4 y consentimiento");
{
  const a = await open("/", { cfg: { ga4MeasurementId: "", consentMode: "opt_out", firstParty: true } });
  t("sin ID de medicion no se carga Google", a.google.length === 0 && !(await a.dl()).some(x => x[0] === "config"), JSON.stringify(a.google));
  t("pero el contador propio igual cuenta la visita (page_view, con su dispositivo y tipo de página)", a.fp.some(p => p.e === "page_view" && p.t === "home" && p.d === "d" && p.p === "/"), JSON.stringify(a.fp));
  t("el page_view del contador propio NO se manda a GA4 como evento (gtag lo manda solo)", (await a.events()).every(e => !/page_view/.test(e.name)));
  await a.ctx.close();
}
{
  const a = await open("/");
  const dl = await a.dl();
  t("con ID de medicion carga gtag.js de googletagmanager.com con ese ID", a.google.some(u => u.includes("googletagmanager.com/gtag/js?id=" + GA)), JSON.stringify(a.google));
  t("antes del config declara el consentimiento: analítica sí, publicidad NO", dl.some(x => x[0] === "consent" && x[1] === "default" && x[2].analytics_storage === "granted" && x[2].ad_storage === "denied" && x[2].ad_user_data === "denied" && x[2].ad_personalization === "denied"), JSON.stringify(dl.slice(0, 3)));
  const conf = dl.find(x => x[0] === "config");
  t("config de GA4 sin señales de Google ni personalización de anuncios", conf && conf[1] === GA && conf[2].allow_google_signals === false && conf[2].allow_ad_personalization_signals === false, JSON.stringify(conf));
  t("sin errores de JavaScript", a.errs.length === 0, a.errs.join(" | "));
  await a.ctx.close();
}
{
  const n = await open("/", { consent: "none" });
  t("consentMode «opt_out» sin decisión todavía (aviso de cookies sin contestar): mide", n.google.some(u => u.includes("gtag/js")) && n.fp.some(p => p.e === "page_view"), JSON.stringify([n.google, n.fp]));
  await n.ctx.close();
  const r = await open("/", { consent: "reject" });
  t("si la persona rechazó las cookies opcionales: no carga Google ni cuenta nada (ni el contador propio)", r.google.length === 0 && r.fp.length === 0, JSON.stringify([r.google, r.fp]));
  await r.ctx.close();
}
{
  /* «No rastrear» (DNT): se prueba sin depuración en un host permitido -> se simula con un dominio de la tienda */
  const ctx = await br.newContext();
  const page = await ctx.newPage();
  const fp = [], google = [];
  await page.route("**/*", route => {
    const u = route.request().url();
    if (u.startsWith("https://stikebikeshop.com/api/track")) { fp.push(1); return route.fulfill({ status: 204 }); }
    if (u.startsWith("https://stikebikeshop.com/data/analytics.json")) return route.fulfill({ json: { ga4MeasurementId: GA, firstParty: true } });
    if (/googletagmanager/.test(u)) { google.push(u); return route.fulfill({ status: 200, contentType: "application/javascript", body: "" }); }
    if (u.startsWith("https://stikebikeshop.com/")) return route.fulfill({ status: 200, contentType: "text/html", body: '<!doctype html><html><head><meta charset="utf-8"><base href="https://stikebikeshop.com/"></head><body>hola<script src="assets/js/analytics.js"></script></body></html>' });
    if (u === "https://stikebikeshop.com/assets/js/analytics.js") return route.continue();
    return route.fulfill({ status: 200, body: "" });
  });
  await page.route("https://stikebikeshop.com/assets/js/analytics.js", r => r.fulfill({ status: 200, contentType: "application/javascript", body: fs.readFileSync(path.join(ROOT, "assets/js/analytics.js"), "utf8") }));
  await page.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => false }); Object.defineProperty(navigator, "doNotTrack", { get: () => "1" }); });
  await page.goto("https://stikebikeshop.com/", { waitUntil: "load" }); await wait(700);
  t("con «No rastrear» (DNT) activado en el navegador no se mide nada, aunque sea el dominio de la tienda", fp.length === 0 && google.length === 0, JSON.stringify([fp, google]));
  await ctx.close();
  const ctx2 = await br.newContext();
  const page2 = await ctx2.newPage();
  const fp2 = [], google2 = [];
  await page2.route("**/*", route => {
    const u = route.request().url();
    if (u.startsWith("https://stikebikeshop.com/api/track")) { fp2.push(1); return route.fulfill({ status: 204 }); }
    if (u.startsWith("https://stikebikeshop.com/data/analytics.json")) return route.fulfill({ json: { ga4MeasurementId: GA, firstParty: true } });
    if (/googletagmanager/.test(u)) { google2.push(u); return route.fulfill({ status: 200, contentType: "application/javascript", body: "" }); }
    if (u === "https://stikebikeshop.com/assets/js/analytics.js") return route.fulfill({ status: 200, contentType: "application/javascript", body: fs.readFileSync(path.join(ROOT, "assets/js/analytics.js"), "utf8") });
    if (u.startsWith("https://stikebikeshop.com/")) return route.fulfill({ status: 200, contentType: "text/html", body: '<!doctype html><html><head><meta charset="utf-8"><base href="https://stikebikeshop.com/"></head><body>hola<script src="assets/js/analytics.js"></script></body></html>' });
    return route.fulfill({ status: 200, body: "" });
  });
  await page2.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => false }); });
  await page2.goto("https://stikebikeshop.com/", { waitUntil: "load" }); await wait(700);
  t("en el dominio de la tienda, sin ninguna señal de privacidad, SÍ mide (carga Google y cuenta la visita)", fp2.length >= 1 && google2.some(u => u.includes("gtag/js")), JSON.stringify([fp2, google2]));
  await ctx2.close();
}
{
  const o = await open("/", { cfg: { ga4MeasurementId: GA, consentMode: "opt_in", firstParty: true }, consent: "none" });
  t("consentMode «opt_in» sin decisión: espera (no carga Google ni cuenta)", o.google.length === 0 && o.fp.length === 0, JSON.stringify([o.google, o.fp]));
  await o.page.evaluate(() => { try { localStorage.setItem("stike_cookie_consent_v1", JSON.stringify({ choice: "accept", ts: 1 })); } catch (e) {} document.dispatchEvent(new CustomEvent("stike:consent", { detail: { choice: "accept" } })); });
  await wait(500);
  t("al aceptar (evento stike:consent) empieza a medir: carga Google", o.google.some(u => u.includes("gtag/js")), JSON.stringify(o.google));
  await o.page.evaluate(() => { try { localStorage.setItem("stike_cookie_consent_v1", JSON.stringify({ choice: "reject", ts: 2 })); } catch (e) {} document.dispatchEvent(new CustomEvent("stike:consent", { detail: { choice: "reject" } })); });
  await wait(300);
  const dl = await o.dl();
  t("y al rechazar después lo apaga: consent update «denied» y ga-disable", dl.some(x => x[0] === "consent" && x[1] === "update" && x[2].analytics_storage === "denied") && (await o.page.evaluate(id => window["ga-disable-" + id], GA)) === true, JSON.stringify(dl.slice(-2)));
  await o.ctx.close();
}
{
  const i = await open("/", { ls: { stike_internal: "1" }, debug: false });
  t("un navegador marcado como del equipo (stike_internal=1) no cuenta", i.google.length === 0 && i.fp.length === 0);
  await i.ctx.close();
  const p = await open("/?admin-preview=1", { debug: false });
  t("la vista previa dentro del panel (?admin-preview=1) no cuenta", p.google.length === 0 && p.fp.length === 0);
  await p.ctx.close();
  const l = await open("/", { debug: false });
  t("localhost (no es el dominio de la tienda) no cuenta fuera de depuración", l.google.length === 0 && l.fp.length === 0);
  await l.ctx.close();
}

/* ===================================================== 2. WhatsApp ===================================================== */
console.log("\nCada clic a WhatsApp se mide, sin el texto del mensaje");
async function clickWa(o, sel, nth = 0) {
  const before = (await o.ev("whatsapp_click")).length, fpBefore = o.fp.filter(p => p.e === "whatsapp_click").length;
  await o.click(sel, nth);
  const evs = await o.ev("whatsapp_click");
  return { evs, ev: evs[evs.length - 1], added: evs.length - before, fp: o.fp.filter(p => p.e === "whatsapp_click").slice(fpBefore) };
}
{
  const o = await open("/");
  await o.page.waitForSelector(".wa-float");
  let r = await clickWa(o, ".wa-float");
  t("botón flotante: link_location=floating_button, page_type=home", r.added === 1 && r.ev.params.link_location === "floating_button" && r.ev.params.page_type === "home", JSON.stringify(r.ev));
  t("lo mismo llega al contador propio (evento, lugar, tipo de página, dispositivo, ruta)", r.fp.length === 1 && r.fp[0].l === "floating_button" && r.fp[0].t === "home" && r.fp[0].d === "d" && r.fp[0].p === "/", JSON.stringify(r.fp));
  r = await clickWa(o, '#site-header a[href*="wa.me"]');
  t("ícono del encabezado: link_location=header", r.added === 1 && r.ev.params.link_location === "header", JSON.stringify(r.ev));
  r = await clickWa(o, '#site-footer a[href*="wa.me"]');
  t("enlaces del pie de página: link_location=footer", r.added === 1 && r.ev.params.link_location === "footer", JSON.stringify(r.ev));
  r = await clickWa(o, ".rd-fiend-wa");
  t("el botón del banner de FIEND en el inicio (con mensaje escrito): se mide y no manda el texto", r.added === 1 && r.ev.params.page_type === "home" && noPII(r.ev.params) && noPII(r.fp), JSON.stringify(r.ev));
  const all = await o.ev("whatsapp_click");
  t("4 clics, 4 eventos (ni uno de más ni de menos)", all.length === 4, String(all.length));
  t("ningún evento de WhatsApp lleva el texto del mensaje (ni «Hola», ni «text=»)", all.every(e => noPII(e.params)), JSON.stringify(all.map(e => e.params)));
  t("solo trae los parámetros esperados (sin datos personales)", all.every(e => Object.keys(e.params).every(k => ["link_location", "page_type", "link_domain", "items", "value", "currency", "transaction_id", "items_in_cart"].includes(k))), JSON.stringify(all.map(e => Object.keys(e.params))));
  t("el enlace sigue funcionando: abre WhatsApp con el número de la tienda", o.wa.some(u => /wa\.me\/573118108848/.test(u)), JSON.stringify(o.wa));
  t("sin errores de JavaScript", o.errs.length === 0, o.errs.join(" | "));
  await o.ctx.close();
}
{
  const o = await open("/producto/grips-odi-soft-negros.html");
  await o.page.waitForSelector("#wa-buy");
  const r = await clickWa(o, "#wa-buy");
  t("ficha de producto: link_location=product_page, con el producto, su precio y COP", r.added === 1 && r.ev.params.link_location === "product_page" && r.ev.params.page_type === "product" && r.ev.params.items[0].item_name === "Grips ODI Soft Negros" && r.ev.params.currency === "COP" && r.ev.params.value > 0, JSON.stringify(r.ev));
  t("y el contador propio sabe de qué producto fue (slug)", r.fp[0] && r.fp[0].s === "grips-odi-soft-negros", JSON.stringify(r.fp));
  const before = (await o.ev("share")).length;
  await o.click("#share-wa");
  const sh = await o.ev("share");
  t("«Compartir por WhatsApp» NO es un contacto: cuenta como share (method=whatsapp), no como whatsapp_click", sh.length === before + 1 && sh[sh.length - 1].params.method === "whatsapp" && (await o.ev("whatsapp_click")).length === 1, JSON.stringify(sh));
  await o.click("#share-copy");
  t("«Copiar enlace» es otro share (method=copy_link)", (await o.ev("share")).some(e => e.params.method === "copy_link"));
  await o.ctx.close();
}
{
  const o = await open("/contacto.html");
  const r = await clickWa(o, "#wa a");
  t("página de contacto: link_location=contact_page", r.added === 1 && r.ev.params.link_location === "contact_page" && r.ev.params.page_type === "contact", JSON.stringify(r.ev));
  await o.page.evaluate(() => {
    const mk = (id, href) => { const a = document.createElement("a"); a.id = id; a.href = href; a.textContent = id; document.body.appendChild(a); a.addEventListener("click", e => e.preventDefault()); };
    mk("t-tel", "tel:+573118108848"); mk("t-mail", "mailto:jparra375@gmail.com"); mk("t-ig", "https://www.instagram.com/stikebikeshop"); mk("t-fb", "https://www.facebook.com/share/1Cz3ezfUvL/"); mk("t-tt", "https://tiktok.com/@stikebikeshop"); mk("t-map", "https://www.google.com/maps/place/Stike");
  });
  for (const id of ["t-tel", "t-mail", "t-ig", "t-fb", "t-tt", "t-map"]) await o.click("#" + id);
  const cc = await o.ev("contact_click");
  t("teléfono, correo, Instagram, Facebook, TikTok y mapa se miden como contact_click con su método", JSON.stringify(cc.map(c => c.params.method)) === JSON.stringify(["phone", "email", "instagram", "facebook", "tiktok", "maps"]), JSON.stringify(cc.map(c => c.params.method)));
  t("y el contador propio también (sin el número ni el correo)", o.fp.filter(p => p.e === "contact_click").length === 6 && noPII(o.fp.filter(p => p.e === "contact_click")), JSON.stringify(o.fp.filter(p => p.e === "contact_click")));
  await o.ctx.close();
}
{
  /* window.open con wa.me: el formulario de contacto, sin llave de correo, abre WhatsApp por código */
  const o = await open("/contacto.html");
  await o.page.fill('form[onsubmit*="stikeContact"] input[type="text"]', "Cliente Prueba");
  await o.page.fill('form[onsubmit*="stikeContact"] input[type="tel"]', "3001112233");
  await o.page.fill('form[onsubmit*="stikeContact"] textarea', "Quiero una cadena para mi BMX, mi calle es Calle 1 # 2-3");
  await o.page.check('form[onsubmit*="stikeContact"] input[name="consent"]');
  await o.page.click('form[onsubmit*="stikeContact"] button[type="submit"]'); await wait(800);
  const wa = await o.ev("whatsapp_click"), lead = await o.ev("generate_lead");
  t("el formulario de contacto que abre WhatsApp por código (window.open) también se mide: form_fallback", wa.length === 1 && wa[0].params.link_location === "form_fallback", JSON.stringify(wa));
  t("y NO manda lo que escribió la persona (nombre, teléfono, mensaje, dirección)", wa.every(e => noPII(e.params)) && noPII(o.fp) && !/Cliente Prueba|cadena|Calle/.test(JSON.stringify([await o.dl(), o.fp])), JSON.stringify([wa, o.fp]));
  t("además se cuenta como generate_lead (form_id=contact)", lead.length === 1 && lead[0].params.form_id === "contact" && o.fp.some(p => p.e === "generate_lead" && p.f === "contact"), JSON.stringify(lead));
  t("y el mensaje de WhatsApp sí llegó a abrirse con lo que escribió la persona (el medidor no lo cambia)", o.wa.some(u => /Cliente%20Prueba|Cliente\+Prueba/.test(u) || /text=/.test(u)), JSON.stringify(o.wa));
  await o.ctx.close();
}
{
  /* La web de Fate (otro conjunto de páginas, sin app.js) también se mide */
  const o = await open("/fate/index.html");
  t("la web de Fate carga el medidor", (await o.page.evaluate(() => !!window.__stikeAnalyticsLoaded)) === true);
  const r = await clickWa(o, 'a[href*="wa.me"]');
  t("un clic a WhatsApp en la web de Fate: page_type=fate", r.added === 1 && r.ev.params.page_type === "fate" && noPII(r.ev.params), JSON.stringify(r.ev));
  await o.ctx.close();
}

/* ===================================================== 3. comercio electronico ===================================================== */
console.log("\nEventos de tienda (esquema de comercio electrónico de GA4)");
{
  const o = await open("/producto/grips-odi-soft-negros.html");
  const vi = await o.ev("view_item");
  t("ficha: view_item con item_id (SKU), nombre, marca, categoría, precio y moneda COP", vi.length === 1 && vi[0].params.currency === "COP" && vi[0].params.items[0].item_id && vi[0].params.items[0].item_name === "Grips ODI Soft Negros" && vi[0].params.items[0].item_brand && vi[0].params.items[0].item_category && vi[0].params.items[0].price > 0 && vi[0].params.value === vi[0].params.items[0].price, JSON.stringify(vi));
  t("el contador propio anota la vista del producto por su slug", o.fp.some(p => p.e === "view_item" && p.s === "grips-odi-soft-negros" && p.t === "product"), JSON.stringify(o.fp));
  await o.page.evaluate(() => stikeAddToCart("grips-odi-soft-negros", 2));
  await wait(200);
  const ad = await o.ev("add_to_cart");
  t("add_to_cart: cantidad 2, valor = precio × 2, moneda COP", ad.length === 1 && ad[0].params.items[0].quantity === 2 && ad[0].params.value === ad[0].params.items[0].price * 2 && ad[0].params.currency === "COP", JSON.stringify(ad));
  t("el contador propio anota el producto agregado", o.fp.some(p => p.e === "add_to_cart" && p.s === "grips-odi-soft-negros"), JSON.stringify(o.fp));
  const key = await o.page.evaluate(() => stikeLineKey(stikeGetCart()[0]));
  await o.page.evaluate(k => stikeRemoveFromCart(k), key);
  await wait(200);
  const rm = await o.ev("remove_from_cart");
  t("remove_from_cart con el producto que se quitó", rm.length === 1 && rm[0].params.items[0].quantity === 2, JSON.stringify(rm));
  t("el carrito de verdad quedó vacío (el medidor no cambia lo que hace la tienda)", (await o.page.evaluate(() => stikeGetCart().length)) === 0);
  t("sin errores de JavaScript", o.errs.length === 0, o.errs.join(" | "));
  await o.ctx.close();
}
{
  const o = await open("/tienda.html");
  await o.page.waitForSelector("article.card"); await wait(1200);
  const vl = await o.ev("view_item_list");
  t("tienda: view_item_list con productos visibles (hasta 20 por evento), con lista y posición", vl.length >= 1 && vl[0].params.items.length >= 1 && vl[0].params.items.length <= 20 && vl[0].params.item_list_name && vl[0].params.items[0].item_list_id && vl[0].params.items[0].index !== undefined, JSON.stringify(vl[0]).slice(0, 300));
  await o.page.evaluate(() => document.addEventListener("click", e => { if (e.target.closest("article.card a")) e.preventDefault(); }));
  await o.click("article.card a.thumb-link");
  const sel = await o.ev("select_item");
  t("clic en un producto de la lista: select_item con su lista", sel.length === 1 && sel[0].params.items[0].item_name && sel[0].params.item_list_name, JSON.stringify(sel));
  await o.ctx.close();
}
{
  const o = await open("/carrito.html", { init: () => { try { if (!localStorage.getItem("stike_cart_v1")) localStorage.setItem("stike_cart_v1", JSON.stringify([{ slug: "grips-odi-soft-negros", qty: 2 }])); } catch (e) {} } });
  await o.page.waitForSelector("#pay-btn");
  const vc = await o.ev("view_cart");
  t("carrito: view_cart con los productos y el valor", vc.length === 1 && vc[0].params.items.length === 1 && vc[0].params.items[0].quantity === 2 && vc[0].params.value === vc[0].params.items[0].price * 2, JSON.stringify(vc));
  const r = await clickWa(o, "#wa-order");
  t("cart: «Finalizar por WhatsApp» (con la dirección escrita en el mensaje) = link_location=cart, con el valor del carrito, sin el texto", r.added === 1 && r.ev.params.link_location === "cart" && r.ev.params.value > 0 && noPII(r.ev.params), JSON.stringify(r.ev));
  await o.page.fill("#ship-name", "Cliente Prueba"); await o.page.fill("#ship-phone", "3001112233"); await o.page.fill("#ship-address", "Calle 1 # 2-3"); await o.page.fill("#ship-city", "Bogota");
  await o.page.check("#ship-ack");
  await o.page.click("#pay-btn"); await wait(900);
  const bc = await o.ev("begin_checkout"), ce = await o.ev("checkout_error");
  t("«Pagar ahora»: begin_checkout con los productos y el total que ve el cliente", bc.length === 1 && bc[0].params.items.length === 1 && bc[0].params.value === bc[0].params.items[0].price * 2 && bc[0].params.currency === "COP", JSON.stringify(bc));
  t("si el pago no puede iniciar (el servidor responde error): checkout_error con el código", ce.length === 1 && /wompi_not_configured|HTTP|wompi-sign/i.test(ce[0].params.error_code), JSON.stringify(ce));
  t("begin_checkout NO lleva nombre, teléfono ni dirección del cliente", noPII(bc[0].params) && noPII(o.fp) && !/Cliente Prueba|Calle/.test(JSON.stringify([bc, ce, o.fp])), JSON.stringify(bc));
  t("el contador propio anota begin_checkout", o.fp.some(p => p.e === "begin_checkout"), JSON.stringify(o.fp));
  t("y la tienda siguió mostrando su mensaje de error al cliente (no se rompió el flujo)", await o.page.locator("#pay-error").isVisible());
  await o.ctx.close();
}
{
  /* purchase: solo con el pago APROBADO, una vez por referencia, con lo que había en el carrito */
  const REF = "stike-1700000000000-abcdef0123456789";
  const mock = status => async page => {
    await page.route("**/api/wompi-status*", r => r.fulfill({ json: { data: { id: "txn-1", status, reference: REF, amount_in_cents: 12000000, currency: "COP" } } }));
    await page.route("**/api/wompi-order", r => r.fulfill({ json: { ok: true } }));
  };
  const cartInit = () => { try { if (!localStorage.getItem("stike_cart_v1")) localStorage.setItem("stike_cart_v1", JSON.stringify([{ slug: "grips-odi-soft-negros", qty: 2 }])); } catch (e) {} };
  const o = await open("/pago-resultado.html?id=txn-1", { routes: mock("APPROVED"), init: cartInit });
  await o.page.waitForFunction(() => document.body.innerText.includes("Pago exitoso"), null, { timeout: 20000 }).catch(() => {});
  await wait(500);
  let pur = await o.ev("purchase");
  t("pago APROBADO: se manda purchase con transaction_id = referencia, valor cobrado (120.000), COP y los productos", pur.length === 1 && pur[0].params.transaction_id === REF && pur[0].params.value === 120000 && pur[0].params.currency === "COP" && pur[0].params.items.length === 1 && pur[0].params.items[0].quantity === 2, JSON.stringify(pur));
  t("el envío no se cobró en el pago: shipping 0 (coherente con el cobro)", pur[0] && pur[0].params.shipping === 0, JSON.stringify(pur[0]));
  t("«Pedir el valor del envío por WhatsApp» (mensaje con la dirección) se mide como payment_result y no manda el texto", await (async () => { const r = await clickWa(o, 'a.btn.wa'); return r.added === 1 && r.ev.params.link_location === "payment_result" && noPII(r.ev.params); })());
  await o.page.reload({ waitUntil: "load" });
  await o.page.waitForFunction(() => document.body.innerText.includes("Pago exitoso") || document.body.innerText.includes("No encontramos"), null, { timeout: 20000 }).catch(() => {});
  await wait(600);
  pur = await o.ev("purchase");
  t("recargar la página de resultado NO cuenta una segunda compra (se acuerda de la referencia)", pur.length === 0 && (await o.page.evaluate(() => JSON.parse(localStorage.getItem("stike_an_purchases") || "[]"))).length === 1, JSON.stringify(pur));
  await o.ctx.close();

  const d = await open("/pago-resultado.html?id=txn-2", { routes: mock("DECLINED"), init: cartInit });
  await d.page.waitForFunction(() => document.body.innerText.includes("no se completó"), null, { timeout: 20000 }).catch(() => {});
  await wait(500);
  const evs2 = await d.events();
  t("pago RECHAZADO: NO hay purchase y sí payment_failed con el estado", !evs2.some(e => e.name === "purchase") && evs2.some(e => e.name === "payment_failed" && e.params.status === "DECLINED"), JSON.stringify(evs2));
  t("y el carrito del cliente sigue intacto (no se vació por un pago que no se hizo)", (await d.page.evaluate(() => stikeGetCart().length)) === 1);
  await d.ctx.close();
}

/* ===================================================== 4. busqueda y 404 ===================================================== */
console.log("\nBúsqueda interna y página no encontrada");
{
  const o = await open("/tienda.html");
  await o.page.evaluate(() => { stikeOpenSearch(); document.addEventListener("keydown", e => { if (e.key === "Enter") e.stopImmediatePropagation(); }, true); });
  await o.page.fill("#overlay-search", "cadena fiend");
  await wait(300);
  await o.page.press("#overlay-search", "Enter");
  await wait(400);
  const s = await o.ev("search");
  t("buscar en la lupa: evento search con el término", s.length === 1 && s[0].params.search_term === "cadena fiend", JSON.stringify(s));
  t("y el contador propio guarda el término (para saber qué buscan)", o.fp.some(p => p.e === "search" && p.q === "cadena fiend"), JSON.stringify(o.fp));
  await o.ctx.close();
  const f = await open("/404.html");
  t("la página 404 manda page_not_found", (await f.ev("page_not_found")).length === 1);
  await f.ctx.close();
}

/* ===================================================== 5. todas las paginas llevan el medidor ===================================================== */
console.log("\nTodas las páginas públicas llevan el medidor");
{
  const skipDirs = new Set([".git", "node_modules", "bmx-builder", "vercel-wompi-api", "tools"]);
  const missing = [], withApp = [], dobles = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!skipDirs.has(e.name)) walk(path.join(d, e.name)); continue; }
      if (!e.name.endsWith(".html")) continue;
      const f = path.join(d, e.name);
      if (/(^|\/)(admin|propuesta)\.html$/.test(f)) continue;
      const html = fs.readFileSync(f, "utf8");
      const tags = (html.match(/<script src="assets\/js\/analytics\.js/g) || []).length;
      if (tags > 1) dobles.push(f);
      if (/http-equiv="refresh"/i.test(html) && tags) dobles.push(f + " (redirección con medidor)");
      if (!(/assets\/js\/app\.js/.test(html) || /fate\/assets\/js\/fate\.js/.test(html))) continue;
      withApp.push(f);
      if (!/<script src="assets\/js\/analytics\.js(\?v=[^"]*)?" defer><\/script>/.test(html)) missing.push(f);
    }
  })(ROOT);
  t(`las ${withApp.length} páginas con la tienda o la web de Fate llevan <script src="assets/js/analytics.js" defer>`, withApp.length > 300 && missing.length === 0, missing.slice(0, 5).join(", "));
  t("ninguna lo lleva dos veces y las que solo redirigen no lo cargan (no se cuentan visitas dobles)", dobles.length === 0, dobles.slice(0, 5).join(", "));
  t("la plantilla de las fichas (_template.html) también: las fichas nuevas lo heredan", /assets\/js\/analytics\.js/.test(fs.readFileSync(path.join(ROOT, "_template.html"), "utf8")));
}

await br.close();
console.log(fail ? `\n${fail} falla(s)` : "\nTodo bien");
process.exit(fail ? 1 : 0);
