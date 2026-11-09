/* =========================================================================
   Panel > Analítica (admin-analytics.js): gráficos de GA4, Search Console y contador propio.

   Se prueba con el servidor simulado: api/analytics (todas las vistas), api/admin-config, api/gh y el inicio de sesión. Se
   mira que cada pestaña dibuje lo que debe con los números del simulador, que los gráficos respondan (ventana con el valor,
   teclado, tabla equivalente), que sin Google se vea el contador propio, que lo que viene de los datos NUNCA se ejecute como
   HTML, que cada rol vea solo lo suyo y que el formulario de Conexión guarde y pruebe bien.

     python3 -m http.server 8143   (en la raiz del repo)
     node tools/admin-analytics-test.mjs
   ========================================================================= */
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(process.env.PW_MODULES || "/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const ROOT = process.cwd(), B = "http://localhost:8143";
const SHOTS = process.env.AN_SHOTS || "";
let fail = 0;
const t = (l, ok, x = "") => { if (!ok) fail++; console.log((ok ? "ok    " : "FALLA ") + l + (ok ? "" : "  -> " + x)); };
const br = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ------------------------------------------------------------ datos simulados ------------------------------------------------------------ */
const TODAY = "2026-11-09";
const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const eachDay = (a, b) => { const o = []; for (let d = a; d <= b; d = addDays(d, 1)) o.push(d); return o; };
const rangeOf = (key, lag = 0) => { const days = { today: 1, "7d": 7, "28d": 28, "90d": 90 }[key] || 28; const to = addDays(TODAY, -lag), from = addDays(to, -(days - 1)), prevTo = addDays(from, -1); return { key: { today: 1, "7d": 1, "28d": 1, "90d": 1 }[key] ? key : "28d", days, from, to, prevFrom: addDays(prevTo, -(days - 1)), prevTo }; };
const EVIL = `<img src=x onerror="window.__pwned=1">`;

function summary(rg) {
  const dates = eachDay(rg.from, rg.to);
  const series = dates.filter((d, i) => i % 5 !== 3).map((d, i) => ({ date: d, sessions: 40 + (i * 7) % 23, users: 30 + (i * 5) % 17, purchases: i % 9 === 0 ? 1 : 0, revenue: i % 9 === 0 ? 180000 : 0, addToCarts: 3 + i % 4, whatsapp: 2 + (i * 3) % 6 }));
  const prevSeries = eachDay(rg.prevFrom, rg.prevTo).filter((d, i) => i % 6 !== 2).map((d, i) => ({ date: d, sessions: 35 + (i * 11) % 19 }));
  return {
    ok: true, range: rg,
    kpis: { users: { cur: 1200, prev: 1000 }, newUsers: { cur: 900, prev: 800 }, sessions: { cur: 1534, prev: 1400 }, engaged: { cur: 900, prev: 800 }, avgDuration: { cur: 95, prev: 80 }, pageViews: { cur: 5200, prev: 4800 }, purchases: { cur: 3, prev: 4 }, revenue: { cur: 540000, prev: 720000 }, addToCarts: { cur: 120, prev: 90 }, checkouts: { cur: 40, prev: 30 } },
    events: { whatsapp_click: { cur: 87, prev: 60 }, view_item: { cur: 800, prev: 700 }, add_to_cart: { cur: 120, prev: 90 }, begin_checkout: { cur: 40, prev: 30 }, purchase: { cur: 3, prev: 4 }, search: { cur: 55, prev: 50 }, page_not_found: { cur: 9, prev: 3 } },
    series, prevSeries, funnel: { sessions: 1534, viewItem: 800, addToCart: 120, beginCheckout: 40, purchase: 3, whatsapp: 87 },
  };
}
const acquisition = rg => ({ ok: true, range: rg, channels: [{ name: "Organic Search", sessions: 700, users: 600, engaged: 420, purchases: 2, revenue: 400000, whatsapp: 40 }, { name: "Direct", sessions: 500, users: 420, engaged: 250, purchases: 1, revenue: 140000, whatsapp: 30 }, { name: "Organic Social", sessions: 300, users: 280, engaged: 120, purchases: 0, revenue: 0, whatsapp: 17 }], sources: [{ name: "google / organic", sessions: 650, purchases: 2, revenue: 400000 }, { name: "(direct) / (none)", sessions: 500, purchases: 1, revenue: 140000 }], landing: [{ path: "/", sessions: 600, engaged: 300, purchases: 1 }, { path: "/producto/grips-odi-soft-negros.html", sessions: 200, engaged: 150, purchases: 1 }] });
const pages = rg => ({ ok: true, range: rg, pages: [{ path: "/", views: 2000, users: 900, avgSeconds: 75 }, { path: "/tienda.html", views: 900, users: 500, avgSeconds: 130 }], whatsappPages: [{ path: "/producto/grips-odi-soft-negros.html", clicks: 30 }, { path: "/carrito.html", clicks: 12 }], notFound: [{ path: "/producto/viejo.html", views: 6 }, { path: "/x/" + EVIL, views: 3 }], searches: [{ term: "grips", count: 20 }, { term: EVIL, count: 8 }, { term: "cadena", count: 5 }] });
const products = rg => ({ ok: true, range: rg, products: [{ name: "Grips ODI Soft Negros", views: 300, addToCart: 40, purchased: 2, revenue: 300000 }, { name: "Cuadro Fit Series", views: 250, addToCart: 3, purchased: 0, revenue: 0 }, { name: EVIL, views: 100, addToCart: 10, purchased: 0, revenue: 0 }, { name: "Pedales Sunday", views: 60, addToCart: 9, purchased: 1, revenue: 90000 }], categories: [{ name: "Grips", views: 400, addToCart: 50, purchased: 3, revenue: 390000 }, { name: "Cuadros", views: 250, addToCart: 3, purchased: 0, revenue: 0 }], brands: [{ name: "ODI", views: 300, addToCart: 40, purchased: 2, revenue: 300000 }, { name: "Fit", views: 250, addToCart: 3, purchased: 0, revenue: 0 }] });
const heat = (m) => { const o = []; for (let d = 0; d < 7; d++) for (let h = 8; h < 22; h++) o.push({ dow: d, hour: h, v: ((d + 1) * (h - 6) * m) % 17 }); return o; };
const audience = rg => ({ ok: true, range: rg, devices: [{ name: "mobile", sessions: 1100, users: 900, purchases: 2 }, { name: "desktop", sessions: 380, users: 300, purchases: 1 }, { name: "tablet", sessions: 54, users: 50, purchases: 0 }], cities: [{ name: "Bogotá", sessions: 900, users: 700 }, { name: "Medellín", sessions: 200, users: 150 }], newVsReturning: [{ name: "new", sessions: 900, users: 850 }, { name: "returning", sessions: 600, users: 300 }], heatSessions: heat(1), heatWhatsapp: heat(2) });
const whatsapp = (rg, missing = false) => ({ ok: true, range: rg, total: { cur: 87, prev: 60 }, byDevice: [{ name: "mobile", clicks: 70 }, { name: "desktop", clicks: 17 }], bySource: [{ name: "google / organic", clicks: 40 }, { name: "(direct) / (none)", clicks: 30 }], byLocation: missing ? null : [{ name: "floating_button", clicks: 50 }, { name: "product_page", clicks: 25 }, { name: "cart", clicks: 12 }], byPageType: missing ? null : [{ name: "product", clicks: 45 }, { name: "home", clicks: 30 }], missingDimensions: missing ? ["link_location", "page_type"] : [] });
const search = key => { const rg = rangeOf(key, 2); const days = eachDay(rg.from, rg.to); return { ok: true, range: rg, totals: { cur: { clicks: 210, impressions: 6400, ctr: 0.0328, position: 14.2 }, prev: { clicks: 180, impressions: 5000, ctr: 0.036, position: 16.1 } }, series: days.map((d, i) => ({ date: d, clicks: 5 + i % 7, impressions: 200 + (i * 13) % 90, ctr: 0.03, position: 14 })), queries: [{ query: "stike bike shop", clicks: 80, impressions: 300, ctr: 0.26, position: 1.2 }, { query: "grips bmx bogota", clicks: 20, impressions: 900, ctr: 0.022, position: 8.4 }, { query: EVIL, clicks: 1, impressions: 30, ctr: 0.03, position: 9 }], opportunities: [{ query: "grips bmx bogota", clicks: 20, impressions: 900, ctr: 0.022, position: 8.4 }], brand: { clicks: 85, impressions: 400 }, nonBrand: { clicks: 125, impressions: 6000 }, pages: [{ page: "https://stikebikeshop.com/", clicks: 120, impressions: 2000, ctr: 0.06, position: 9 }, { page: "https://stikebikeshop.com/producto/x.html", clicks: 30, impressions: 800, ctr: 0.03, position: 12 }], devices: [{ name: "MOBILE", clicks: 150, impressions: 4000, ctr: 0.03, position: 14 }, { name: "DESKTOP", clicks: 60, impressions: 2400, ctr: 0.02, position: 14 }], countries: [{ name: "col", clicks: 190, impressions: 5800, ctr: 0.03, position: 14 }, { name: "usa", clicks: 10, impressions: 300, ctr: 0.03, position: 20 }] }; };
const fpData = rg => { const days = {}; eachDay(rg.from, rg.to).forEach((d, i) => { days[d] = { page_view: 100 + i % 9, whatsapp_click: 3 + i % 4, view_item: 40, add_to_cart: 6, begin_checkout: 2 }; }); return { ok: true, range: rg, first: addDays(rg.from, 3), days, ev: {
  page_view: { n: 5900, prev: 5000, ref: [{ name: "direct", n: 2000 }, { name: "search", n: 2500 }, { name: "social", n: 900 }], dev: [{ name: "m", n: 4000 }, { name: "d", n: 1900 }], hour: {}, pt: [], loc: [], path: [], slug: [], q: [], m: [], f: [] },
  whatsapp_click: { n: 95, prev: 70, loc: [{ name: "floating_button", n: 55 }, { name: "product_page", n: 30 }, { name: "weird_loc", n: 10 }], pt: [{ name: "product", n: 50 }, { name: "home", n: 45 }], path: [{ name: "/producto/grips-odi-soft-negros.html", n: 33 }], slug: [{ name: "grips-odi-soft-negros", n: 30 }, { name: "cuadro-fit", n: 7 }], dev: [{ name: "m", n: 80 }, { name: "d", n: 15 }], hour: { 9: 5, 10: 12, 15: 20, 20: 30 }, ref: [], q: [], m: [], f: [] },
  view_item: { n: 820, prev: 700 }, add_to_cart: { n: 130, prev: 90 }, begin_checkout: { n: 45, prev: 30 },
  search: { n: 55, prev: 50, q: [{ name: "grips", n: 20 }, { name: EVIL, n: 4 }] } } }; };
const realtime = () => ({ ok: true, activeUsers: 7, pages: [{ name: "Stike Bike Shop | Inicio", users: 4 }, { name: "Grips ODI", users: 3 }], events: [{ name: "page_view", count: 30 }, { name: "whatsapp_click", count: 2 }], cities: [{ name: "Bogotá", users: 5 }] });
const status = (o = {}) => ({ ok: true, site: { measurementId: "G-AB12CD34EF", consentMode: "opt_out", firstParty: true, gscVerification: "" }, ga4: { propertyId: "412345678" }, gsc: { site: "sc-domain:stikebikeshop.com" }, google: { serviceAccount: { email: "stike@proy.iam.gserviceaccount.com", project: "proy" }, source: "panel", openssl: true }, firstParty: { first: "2026-11-01", events30d: 4000 }, ...o });
const notConf = { ok: false, code: "google_not_configured", detail: "Todavía no hay una llave de Google guardada. Pega el JSON de la cuenta de servicio en la pestaña Conexión.", setup: "ga4" };

/* ------------------------------------------------------------ el panel con todo simulado ------------------------------------------------------------ */
async function open(role, { google = true, statusOver = {}, missingDims = false, viewport = { width: 1300, height: 1000 }, onAnalytics = null, adminConfig = null } = {}) {
  const page = await br.newPage({ viewport });
  const errs = []; page.on("pageerror", e => errs.push(e.message));
  const dialogs = []; page.on("dialog", d => { dialogs.push(d.message()); d.accept(); });
  const st = { analyticsReqs: [], posts: [], puts: [], cfg: { text: JSON.stringify({ ga4MeasurementId: "", consentMode: "opt_out", firstParty: true }, null, 2) + "\n", sha: "a1" }, moduleReqs: 0 };
  await page.route("**/api/admin-login", r => r.fulfill({ json: { email: role + "@test.com", role } }));
  await page.route("**/api/admin-health", r => r.fulfill({ json: { ok: true, ready: true, checks: [] } }));
  await page.route("**/api/sales", r => r.fulfill({ json: [] }));
  page.on("request", rq => { if (/admin-analytics\.js/.test(rq.url())) st.moduleReqs++; });
  await page.route("**/api/gh?**", r => {
    const path = new URL(r.request().url()).searchParams.get("path"), method = r.request().method();
    if (path === "data/analytics.json") {
      if (method === "GET") return r.fulfill({ json: { sha: st.cfg.sha, content: Buffer.from(st.cfg.text).toString("base64") } });
      const body = r.request().postDataJSON(); st.puts.push({ path, message: body.message, text: Buffer.from(body.content, "base64").toString("utf8"), sha: body.sha });
      st.cfg = { text: st.puts.at(-1).text, sha: "a" + (st.puts.length + 1) };
      return r.fulfill({ json: { content: { sha: st.cfg.sha }, commit: { sha: "c" } } });
    }
    const f = ROOT + "/" + path;
    return method === "GET" && fs.existsSync(f) ? r.fulfill({ json: { sha: "s", content: fs.readFileSync(f).toString("base64") } }) : r.fulfill({ status: 404, json: {} });
  });
  await page.route("**/api/admin-config", r => {
    const body = r.request().postDataJSON(); st.posts.push({ url: "admin-config", body });
    if (adminConfig) return r.fulfill(adminConfig(body));
    return r.fulfill({ json: { ok: true, saved: Object.keys(body).filter(k => k !== "action"), serviceAccount: { email: "stike@proy.iam.gserviceaccount.com", project: "proy" } } });
  });
  await page.route("**/api/analytics**", r => {
    const rq = r.request(), u = new URL(rq.url());
    if (rq.method() === "POST") {
      const body = rq.postDataJSON(); st.posts.push({ url: "analytics", body });
      if (body.view === "test") return r.fulfill({ json: { ok: true, checks: [{ id: "sa", ok: true, label: "Cuenta de servicio de Google", detail: "stike@proy.iam.gserviceaccount.com" }, { id: "ga4", ok: true, label: "Google Analytics 4: acceso", detail: "La cuenta lee la propiedad 412345678." }, { id: "gsc", ok: false, label: "Search Console: acceso", detail: "La cuenta no tiene la propiedad." }] } });
      if (body.view === "sitemap_submit") return r.fulfill({ json: { ok: true, sitemap: "https://stikebikeshop.com/sitemap.xml" } });
      return r.fulfill({ status: 400, json: { error: "invalid_view" } });
    }
    const view = u.searchParams.get("view"), key = u.searchParams.get("range") || "28d", rg = rangeOf(key);
    st.analyticsReqs.push({ view, range: key, refresh: u.searchParams.get("refresh") });
    if (onAnalytics) { const x = onAnalytics(view, key); if (x) return r.fulfill(x); }
    if (view === "status") return r.fulfill({ json: status(statusOver) });
    if (view === "firstparty") return r.fulfill({ json: fpData(rg) });
    if (!google) return r.fulfill({ json: view === "search" || view === "sitemaps" ? { ...notConf, code: "gsc_not_configured", setup: "gsc" } : notConf });
    const map = { summary: () => summary(rg), acquisition: () => acquisition(rg), pages: () => pages(rg), products: () => products(rg), audience: () => audience(rg), whatsapp: () => whatsapp(rg, missingDims), realtime, search: () => search(key), sitemaps: () => ({ ok: true, sitemaps: [{ path: "https://stikebikeshop.com/sitemap.xml", lastSubmitted: "2026-11-05T10:00:00Z", lastDownloaded: "2026-11-08T03:00:00Z", pending: false, errors: 0, warnings: 1, submitted: 320, indexed: 0 }] }) };
    return map[view] ? r.fulfill({ json: map[view]() }) : r.fulfill({ status: 400, json: { error: "invalid_view" } });
  });
  await page.goto(B + "/admin.html", { waitUntil: "networkidle" }); await page.waitForTimeout(700);
  const go = async (tab) => { await page.click(`[data-tab="${tab}"]`); await page.waitForFunction(() => !document.querySelector("#an-body.loading")); await page.waitForTimeout(150); };
  const openPanel = async () => { await page.click('.navbtn[data-panel="analitica"]'); await page.waitForSelector("#an-body .an-tile, #an-body .an-note, #an-body .an-card"); await page.waitForFunction(() => !document.querySelector("#an-body.loading")); await page.waitForTimeout(150); };
  const shot = async name => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };
  return { page, errs, dialogs, st, go, openPanel, shot, body: () => page.locator("#an-body").innerText() };
}
const hover = async (page, sel, fx = 0.5) => { await page.locator(sel).first().scrollIntoViewIfNeeded(); const bb = await page.locator(sel).first().boundingBox(); await page.mouse.move(bb.x + bb.width * fx, bb.y + bb.height * 0.5); await page.waitForTimeout(120); };

/* ============================================================ 1. RESUMEN con Google ============================================================ */
console.log("\nResumen (Google Analytics conectado)");
{
  const a = await open("owner");
  t("el dueño ve «Analítica» en el menú", (await a.page.locator('.navbtn[data-panel="analitica"]').count()) === 1 && await a.page.locator('.navbtn[data-panel="analitica"]').isVisible());
  t("el módulo de gráficos NO se pide hasta abrir la pestaña", a.st.moduleReqs === 0, String(a.st.moduleReqs));
  await a.openPanel();
  t("al abrirla se pide el módulo una vez y el título dice Analítica", a.st.moduleReqs === 1 && (await a.page.locator("#panel-title").innerText()) === "Analítica", String(a.st.moduleReqs));
  t("hay 8 pestañas: Resumen, WhatsApp, Cómo llegan, Qué ven, Quiénes, Google (SEO), En vivo y Conexión", (await a.page.locator("#an-tabs .an-tab").allInnerTexts()).map(x => x.trim()).join("|") === "Resumen|WhatsApp|Cómo llegan|Qué ven|Quiénes|Google (SEO)|En vivo|Conexión", (await a.page.locator("#an-tabs .an-tab").allInnerTexts()).join("|"));
  t("el periodo por defecto es 28 días", (await a.page.locator("#an-ranges .active").innerText()) === "28 días");
  const txt = await a.body();
  t("fichas: visitantes, sesiones (1.534), clics a WhatsApp (87), compras (3) e ingresos ($540.000)", /Visitantes/.test(txt) && /1[.,]534/.test(txt) && /Clics a WhatsApp\s*\n\s*87/.test(txt) && /Compras online\s*\n\s*3/.test(txt) && /\$540[.,]000/.test(txt), txt.slice(0, 400));
  t("hay 8 fichas con su cambio frente al periodo anterior", (await a.page.locator(".an-tile").count()) === 8 && (await a.page.locator(".an-tile .an-d").count()) >= 7);
  t("sesiones subió (verde ▲) e ingresos bajó (rojo ▼)", await a.page.locator(".an-tile", { hasText: "Sesiones" }).locator(".an-d.good").count() === 1 && await a.page.locator(".an-tile", { hasText: "Ingresos online" }).locator(".an-d.bad").count() === 1);
  t("la tendencia se dibuja (línea con área y puntos) y no hay texto de «sin datos»", (await a.page.locator(".an-plot svg path").count()) >= 3 && (await a.page.locator(".an-plot svg circle").count()) >= 1);
  t("las miniaturas de las fichas se dibujan", (await a.page.locator(".an-tile svg.sp").count()) >= 5);
  // ventana con el valor
  await hover(a.page, ".an-plot svg");
  const tip = a.page.locator(".an-tt");
  t("al pasar el mouse por la línea aparece la ventana con la fecha, las sesiones y el periodo anterior", await tip.isVisible() && /Sesiones/.test(await tip.innerText()) && /Periodo anterior/.test(await tip.innerText()), await tip.innerText());
  t("la línea guía vertical y los puntos aparecen", await a.page.locator(".an-plot .xh").evaluate(e => e.style.display !== "none"));
  await a.page.mouse.move(5, 5); await a.page.waitForTimeout(100);
  t("al salir el mouse la ventana se oculta", !(await tip.isVisible()));
  // teclado
  await a.page.locator(".an-plot[tabindex]").first().focus();
  await a.page.keyboard.press("ArrowLeft");
  t("con el teclado (flechas) también se ve el valor", await tip.isVisible() && /Sesiones/.test(await tip.innerText()));
  await a.page.keyboard.press("Escape");
  t("Escape cierra la ventana", !(await tip.isVisible()));
  // tabla equivalente
  const card = a.page.locator(".an-card", { hasText: "Sesiones por día" }).first();
  await card.locator("[data-vt]").click();
  t("«Ver tabla» muestra los mismos datos en una tabla y oculta el gráfico", await card.locator(".an-tv").isVisible() && !(await card.locator(".an-view:not(.an-tv)").isVisible()) && (await card.locator(".an-tv tbody tr").count()) === 28, String(await card.locator(".an-tv tbody tr").count()));
  await card.locator("[data-vt]").click();
  t("y se puede volver al gráfico", await card.locator(".an-view:not(.an-tv)").isVisible());
  t("el embudo muestra sus 5 etapas y la alternativa de WhatsApp", (await a.page.locator(".an-funnel .row").count()) === 6 && /Alternativa: escribieron por WhatsApp/.test(txt) && /del paso anterior/.test(txt));
  t("«Acciones clave» lista las acciones con su nombre en español y el código", /Clics a WhatsApp\s+whatsapp_click/.test(txt) && /Compras online\s+purchase/.test(txt));
  t("compara Google Analytics con el contador propio", /¿Google Analytics está viendo todo\?/.test(txt) && /contador propio/i.test(txt), txt.slice(-700));
  t("«Lo que se nota» resume en palabras", /Hubo 1[.,]534 sesiones de 1[.,]200 personas/.test(txt) && /87 clics a WhatsApp/.test(txt) && /3 compras online por \$540[.,]000/.test(txt), txt);
  t("no se pidió nada que no existe y no hubo errores de script", a.errs.length === 0, a.errs.join(" | "));
  await a.shot("resumen");

  // periodo
  await a.page.click('#an-ranges [data-range="7d"]'); await a.page.waitForFunction(() => !document.querySelector("#an-body.loading")); await a.page.waitForTimeout(200);
  t("al cambiar a 7 días se vuelve a pedir con range=7d y el botón queda activo", a.st.analyticsReqs.some(x => x.view === "summary" && x.range === "7d") && (await a.page.locator("#an-ranges .active").innerText()) === "7 días");
  t("el periodo elegido se recuerda", await a.page.evaluate(() => localStorage.getItem("stike_an_range")) === "7d");
  const n0 = a.st.analyticsReqs.length;
  await a.page.click("#an-refresh"); await a.page.waitForFunction(() => !document.querySelector("#an-body.loading")); await a.page.waitForTimeout(200);
  t("«Actualizar» pide los datos de nuevo con refresh=1", a.st.analyticsReqs.slice(n0).some(x => x.refresh === "1"), JSON.stringify(a.st.analyticsReqs.slice(n0)));
  // «hoy»
  await a.page.click('#an-ranges [data-range="today"]'); await a.page.waitForFunction(() => !document.querySelector("#an-body.loading")); await a.page.waitForTimeout(200);
  t("con «Hoy» (un solo día) la pestaña no se rompe", (await a.page.locator(".an-tile").count()) === 8 && a.errs.length === 0, a.errs.join("|"));
  await a.page.close();
}

/* ============================================================ 2. SIN GOOGLE: contador propio ============================================================ */
console.log("\nResumen y WhatsApp sin Google conectado");
{
  const a = await open("owner", { google: false, statusOver: { google: { serviceAccount: null, source: null, openssl: true }, ga4: { propertyId: "" }, gsc: { site: "" } } });
  await a.openPanel();
  const txt = await a.body();
  t("avisa que Google no está conectado y ofrece abrir Conexión", /Google Analytics todavía no está conectado/.test(txt) && (await a.page.locator('[data-go="conexion"]').count()) >= 1, txt.slice(0, 300));
  t("mientras tanto muestra el contador propio: visitas (5.900), WhatsApp (95)", /Visitas a páginas\s*\n\s*5[.,]900/.test(txt) && /Clics a WhatsApp\s*\n\s*95/.test(txt), txt.slice(0, 600));
  t("dibuja la línea de visitas por día y el embudo con el contador propio", (await a.page.locator(".an-plot svg path").count()) >= 2 && (await a.page.locator(".an-funnel .row").count()) >= 4);
  await a.page.click('[data-go="conexion"]'); await a.page.waitForTimeout(300);
  t("el botón «Abrir Conexión» lleva a la pestaña Conexión", (await a.page.locator("#an-tabs .an-tab.active").innerText()).includes("Conexión"));
  await a.go("whatsapp");
  const w = await a.body();
  t("WhatsApp sin Google: total 95, botones y productos del contador propio", /\b95\b/.test(w) && /Botón flotante/.test(w) && /Ficha de producto/.test(w) && /Otro lugar|weird_loc/.test(w), w.slice(0, 500));
  t("los productos salen por su slug cuando no hay catálogo cargado (grips-odi-soft-negros)", /grips-odi-soft-negros|Grips ODI/.test(w));
  t("la hora se dibuja con el contador propio (columnas)", (await a.page.locator(".an-plot .bar").count()) >= 4, String(await a.page.locator(".an-plot .bar").count()));
  await a.go("seo");
  t("Google (SEO) sin conectar muestra el aviso de Search Console", /Search Console todavía no está conectado/.test(await a.body()));
  await a.go("quienes");
  t("Quiénes sin Google muestra el aviso y no se rompe", /todavía no está conectado/.test(await a.body()) && a.errs.length === 0, a.errs.join("|"));
  await a.shot("sin-google");
  await a.page.close();
}

/* ============================================================ 3. WHATSAPP ============================================================ */
console.log("\nPestaña WhatsApp (con Google)");
{
  const a = await open("owner");
  await a.openPanel(); await a.go("whatsapp");
  const txt = await a.body();
  t("cifra grande: 87 clics con su cambio (▲) y el % de las sesiones (5,7 %)", /\b87\b/.test(txt) && /▲/.test(txt) && /5,7 % de las sesiones/.test(txt), txt.slice(0, 300));
  t("clics por día en columnas, con tabla equivalente", (await a.page.locator(".an-plot .bar").count()) >= 20);
  t("botones desde donde escriben, con nombres en español (Botón flotante 50, Ficha de producto 25, Carrito 12)", /Botón flotante/.test(txt) && /Ficha de producto/.test(txt) && /Carrito/.test(txt) && /Fuente: Google Analytics/.test(txt));
  t("tipo de página: Fichas de producto e Inicio", /Fichas de producto/.test(txt) && /Inicio/.test(txt));
  t("productos que más generan chats usan el contador propio", /Productos que más generan chats/.test(txt) && /grips-odi-soft-negros/.test(txt));
  t("mapa de calor de la hora (7 días × 24 horas)", (await a.page.locator(".an-hg .c").count()) === 168 && /¿A qué hora escriben\?/.test(txt));
  t("aparato (Celular/Computador) y fuente de la visita", /Celular/.test(txt) && /Computador/.test(txt) && /google \/ organic/.test(txt));
  await hover(a.page, ".an-hg .c[style]");
  const tip = a.page.locator(".an-tt");
  t("al pasar por una celda del mapa aparece el día, la hora y los clics", await tip.isVisible() && /·/.test(await tip.innerText()) && /clics a WhatsApp/.test(await tip.innerText()), await tip.innerText());
  await a.page.locator(".an-hg .c").first().focus(); await a.page.keyboard.press("ArrowRight"); await a.page.keyboard.press("ArrowDown");
  t("con el teclado (flechas) se recorre el mapa", (await a.page.evaluate(() => Array.from(document.querySelectorAll(".an-hg .c")).indexOf(document.activeElement))) === 25);
  await hover(a.page, ".an-plot .bw", 0.5);
  t("sobre una columna aparece la ventana con el día y los clics", await tip.isVisible() && /clics a WhatsApp/.test(await tip.innerText()));
  t("sin errores", a.errs.length === 0, a.errs.join("|"));
  await a.shot("whatsapp");
  await a.page.close();
}
console.log("\nWhatsApp: faltan las dimensiones personalizadas en GA4");
{
  const a = await open("owner", { missingDims: true });
  await a.openPanel(); await a.go("whatsapp");
  const txt = await a.body();
  t("avisa que falta registrar link_location y page_type (no es un error) y cómo hacerlo", /Falta registrar dos dimensiones/.test(txt) && /link_location/.test(txt) && /page_type/.test(txt) && /Definiciones personalizadas/.test(txt), txt.slice(0, 400));
  t("mientras tanto esas tarjetas usan el contador propio", /Fuente: contador propio/.test(txt) && /Botón flotante/.test(txt));
  t("el resto de la pestaña sigue con Google (cifra, mapa de calor)", /\b87\b/.test(txt) && (await a.page.locator(".an-hg .c").count()) === 168);
  await a.page.close();
}

/* ============================================================ 4. COMO LLEGAN / QUE VEN / QUIENES ============================================================ */
console.log("\nCómo llegan, Qué ven y Quiénes");
{
  const a = await open("owner");
  await a.openPanel(); await a.go("llegan");
  let txt = await a.body();
  t("canales con nombres en español, sesiones, interacción (60 %), WhatsApp y compras", /Búsqueda en Google y otros \(gratis\)/.test(txt) && /Directo/.test(txt) && /Redes sociales \(gratis\)/.test(txt) && /60 %/.test(txt) && /\$400[.,]000/.test(txt), txt.slice(0, 500));
  t("¿qué canal trae más chats?: barras con 40, 30 y 17", /¿Qué canal trae más chats/.test(txt) && (await a.page.locator(".an-hb .row").count()) >= 3);
  t("páginas de entrada y fuente / medio", /Páginas por donde entran/.test(txt) && /google \/ organic/.test(txt) && /\/producto\/grips-odi-soft-negros\.html/.test(txt));

  await a.go("ven");
  txt = await a.body();
  t("productos más vistos con vistas, carrito, % del total, compras e ingresos", /Grips ODI Soft Negros/.test(txt) && /13,3 %/.test(txt) && /\$300[.,]000/.test(txt), txt.slice(0, 600));
  t("«Para revisar» detecta el producto muy visto con casi nada al carrito (Cuadro Fit: 250 vistas, 3 al carrito)", /Cuadro Fit Series/.test(txt) && /Revisa precio, fotos y tallas/.test(txt));
  t("«Para revisar» detecta lo que se agrega al carrito y no se compra", /nadie lo compró online/.test(txt));
  await a.page.selectOption("#an-sort", "revenue"); await a.page.waitForTimeout(250);
  const firstRow = await a.page.locator(".an-card", { hasText: "Productos más vistos" }).locator("tbody tr").first().innerText();
  t("ordenar por ingresos pone primero el de más ingresos", /Grips ODI Soft Negros/.test(firstRow) && (await a.page.locator("#an-sort").inputValue()) === "revenue", firstRow);
  t("búsquedas en la tienda, 404 y páginas más vistas", /Lo que buscan en la tienda/.test(txt) && /grips/.test(txt) && /Páginas que no existen/.test(txt) && /\/producto\/viejo\.html/.test(txt) && /Páginas más vistas/.test(txt) && /1 min 15 s/.test(txt));
  t("LO QUE VIENE DE LOS DATOS NUNCA SE EJECUTA (nombre de producto, búsqueda y ruta con <img onerror>)", (await a.page.evaluate(() => window.__pwned)) === undefined && (await a.page.locator("#an-body img[src='x']").count()) === 0 && /<img src=x onerror=/.test(txt), String(await a.page.evaluate(() => window.__pwned)));

  await a.go("quienes");
  txt = await a.body();
  t("aparatos (Celular/Computador/Tableta), nuevos y recurrentes, ciudades y mapa de calor", /Celular/.test(txt) && /Tableta/.test(txt) && /Nuevos/.test(txt) && /Recurrentes/.test(txt) && /Bogotá/.test(txt) && (await a.page.locator(".an-hg .c").count()) === 168);
  t("la barra de aparatos tiene una parte por aparato con su color y el reparto en %", (await a.page.locator(".an-seg i").count()) >= 3 && /72 %/.test(txt), txt.slice(0, 300));
  await hover(a.page, ".an-seg i");
  t("sobre una parte de la barra sale el nombre, la cifra y el %", await a.page.locator(".an-tt").isVisible() && /%/.test(await a.page.locator(".an-tt").innerText()));
  t("sin errores", a.errs.length === 0, a.errs.join("|"));
  await a.shot("quienes");
  await a.page.close();
}

/* ============================================================ 5. SEO, EN VIVO ============================================================ */
console.log("\nGoogle (SEO) y En vivo");
{
  const a = await open("owner");
  await a.openPanel(); await a.go("seo");
  let txt = await a.body();
  t("fichas de Search Console: 210 clics, 6.400 apariciones, CTR 3,3 %, posición 14,2", /\b210\b/.test(txt) && /6[.,]400/.test(txt) && /3,3 %/.test(txt) && /14,2/.test(txt), txt.slice(0, 300));
  t("posición media: BAJAR es bueno (16,1 → 14,2 sale en verde)", await a.page.locator(".an-tile", { hasText: "Posición media" }).locator(".an-d.good").count() === 1);
  t("dos gráficos de línea separados (clics y apariciones), nunca con dos ejes", (await a.page.locator(".an-plot svg").count()) >= 2 && !/dual|segundo eje/i.test(txt));
  t("avisa del retraso de 2 días de Search Console con las fechas", /unos 2 días de retraso/.test(txt) && /7 nov/.test(txt), txt.slice(0, 400));
  t("marca y no marca, búsquedas, oportunidades, páginas (solo la ruta), aparatos y países con nombre", /Buscaron «Stike»/.test(txt) && /stike bike shop/.test(txt) && /Oportunidades/.test(txt) && /grips bmx bogota/.test(txt) && /\/producto\/x\.html/.test(txt) && !/https:\/\/stikebikeshop\.com\/producto/.test(txt.replace(/Enviado[\s\S]*/, "")) && /Colombia/.test(txt) && /Estados Unidos/.test(txt));
  t("sitemap: lista el enviado y el dueño puede enviarlo otra vez", /sitemap\.xml/.test(txt) && (await a.page.locator("#an-sm-send").count()) === 1);
  await a.page.click("#an-sm-send"); await a.page.waitForTimeout(300);
  t("«Enviar sitemap a Google» manda la orden y confirma", a.st.posts.some(p => p.url === "analytics" && p.body.view === "sitemap_submit") && /Google recibió/.test(await a.page.locator("#an-sm-msg").innerText()));
  t("la búsqueda con <img onerror> se muestra como texto", (await a.page.evaluate(() => window.__pwned)) === undefined && /<img src=x onerror=/.test(txt));
  await a.shot("seo");

  await a.go("vivo");
  txt = await a.body();
  t("En vivo: 7 personas, páginas, acciones en español y ciudades", /\b7\b/.test(txt) && /Stike Bike Shop \| Inicio/.test(txt) && /Clics a WhatsApp/.test(txt) && /Bogotá/.test(txt));
  t("el rango de fechas no aparece en En vivo", await a.page.locator("#an-ranges").isHidden());
  await a.page.close();
}
console.log("\nEn vivo se actualiza solo y se detiene");
{
  const a = await open("owner");
  await a.page.clock.install();
  await a.openPanel(); await a.go("vivo");
  const n0 = a.st.analyticsReqs.filter(x => x.view === "realtime").length;
  await a.page.clock.fastForward(31000); await a.page.waitForTimeout(400);
  const n1 = a.st.analyticsReqs.filter(x => x.view === "realtime").length;
  t("a los 30 segundos vuelve a pedir el tiempo real sin que nadie toque nada", n1 === n0 + 1, n0 + " → " + n1);
  await a.page.click('.navbtn[data-panel="productos"]'); await a.page.waitForTimeout(100);
  await a.page.clock.fastForward(95000); await a.page.waitForTimeout(300);
  t("al salir de la pestaña Analítica deja de consultar", a.st.analyticsReqs.filter(x => x.view === "realtime").length === n1, String(a.st.analyticsReqs.filter(x => x.view === "realtime").length));
  await a.page.close();
}

/* ============================================================ 6. CONEXION ============================================================ */
console.log("\nConexión (dueño)");
{
  const a = await open("owner");
  await a.openPanel(); await a.go("conexion");
  let txt = await a.body();
  t("lista el estado: ID de medición, contador propio, cuenta de servicio, propiedad GA4 y Search Console", /G-AB12CD34EF/.test(txt) && /4\.?000 eventos/.test(txt) && /stike@proy\.iam\.gserviceaccount\.com/.test(txt) && /412345678/.test(txt) && /sc-domain:stikebikeshop\.com/.test(txt), txt.slice(0, 500));
  t("el punto de la pestaña Conexión queda verde cuando todo está conectado", await a.page.locator("#an-dot.ok").count() === 1);
  t("la llave nunca se muestra: el cuadro está vacío y solo se ve el correo", (await a.page.locator("#an-key").inputValue()) === "" && !/BEGIN PRIVATE/.test(txt));
  t("trae la guía paso a paso (Google Cloud, cuenta de servicio, Lector, Completo, evento clave, dimensiones)", /Google Analytics Data API/.test(await a.page.locator("#an-body").innerHTML()) && /evento clave/.test(await a.page.locator("#an-body").innerHTML()) && /link_location/.test(await a.page.locator("#an-body").innerHTML()));

  await a.page.click("#an-test"); await a.page.waitForTimeout(300);
  const out = await a.page.locator("#an-test-out").innerText();
  t("«Probar conexión» muestra cada punto con ✔ o ✕ y por qué", /Cuenta de servicio de Google/.test(out) && /✔/.test(out) && /✕/.test(out) && /La cuenta no tiene la propiedad/.test(out), out);

  // medición del sitio
  await a.page.fill("#an-mid", "ga-123");
  await a.page.click("#an-site-save"); await a.page.waitForTimeout(250);
  t("un ID de medición mal escrito se rechaza con una explicación y no se escribe nada", /empieza por G-/.test(await a.page.locator("#an-site-msg").innerText()) && a.st.puts.length === 0);
  await a.page.fill("#an-mid", "g-ab12cd34ef");
  await a.page.selectOption("#an-consent", "opt_in");
  await a.page.uncheck("#an-fp");
  await a.page.fill("#an-gsc", `<meta name="google-site-verification" content="abcDEF123_-abcDEF123_-abcDEF123" />`);
  await a.page.click("#an-site-save"); await a.page.waitForTimeout(500);
  const put = a.st.puts[0], saved = put && JSON.parse(put.text);
  t("«Guardar y publicar» escribe data/analytics.json por el GitHub del panel, con el ID en mayúsculas", !!put && put.path === "data/analytics.json" && saved.ga4MeasurementId === "G-AB12CD34EF", JSON.stringify(put));
  t("guarda el modo de permiso, el contador propio apagado y saca el token de la etiqueta pegada", saved.consentMode === "opt_in" && saved.firstParty === false && saved.gscVerification === "abcDEF123_-abcDEF123_-abcDEF123", JSON.stringify(saved));
  t("el mensaje dice que se publica solo en 1 a 3 minutos", /1 a 3 minutos/.test(await a.page.locator("#an-site-msg").innerText()));
  t("el mensaje del commit dice qué cambió", /Analítica: medición del sitio \(G-AB12CD34EF\)/.test(put.message), put.message);

  // conexión con Google
  await a.page.fill("#an-prop", "G-AB12CD34EF");
  await a.page.fill("#an-key", '{"type":"service_account","client_email":"x@y.iam.gserviceaccount.com","private_key":"-----BEGIN ' + 'PRIVATE KEY-----\\nAAA\\n-----END ' + 'PRIVATE KEY-----\\n"}');
  await a.page.fill("#an-site", "sc-domain:stikebikeshop.com");
  await a.page.click("#an-g-save"); await a.page.waitForTimeout(800);
  const cfgPost = a.st.posts.find(p => p.url === "admin-config" && p.body.action === "analytics_save");
  t("«Guardar y probar» manda el ID, la propiedad y la llave a api/admin-config", !!cfgPost && cfgPost.body.propertyId === "G-AB12CD34EF" && cfgPost.body.gscSite === "sc-domain:stikebikeshop.com" && /service_account/.test(cfgPost.body.serviceAccountJson), JSON.stringify(cfgPost));
  t("la llave desaparece del cuadro apenas se guarda", (await a.page.locator("#an-key").inputValue()) === "");
  t("y enseguida corre la prueba de conexión sola", a.st.posts.some(p => p.url === "analytics" && p.body.view === "test") && /Resultado de la prueba/.test(await a.page.locator("#an-test-out").innerText()), await a.page.locator("#an-test-out").innerText());
  t("ningún campo, mensaje ni texto de la pantalla tiene la llave privada", !(await a.page.content()).includes("BEGIN " + "PRIVATE KEY"));
  await a.shot("conexion");

  // quitar lo guardado
  await a.page.click("#an-g-clear"); await a.page.waitForTimeout(500);
  t("«Quitar lo guardado aquí» pide confirmación y manda analytics_clear con all", a.dialogs.some(d => /Quitar la llave/.test(d)) && a.st.posts.some(p => p.url === "admin-config" && p.body.action === "analytics_clear" && p.body.all === true));

  // probar el seguimiento: excluir este navegador
  await a.go("conexion");
  t("el navegador del equipo está excluido de las visitas por defecto", /no cuenta/.test(await a.body()) && (await a.page.evaluate(() => localStorage.getItem("stike_internal"))) === "1");
  await a.page.click("#an-int"); await a.page.waitForTimeout(300);
  t("«Contar mis visitas» deja stike_internal=0 y cambia el botón", (await a.page.evaluate(() => localStorage.getItem("stike_internal"))) === "0" && /Volver a excluir/.test(await a.body()));
  await a.page.click("#an-int"); await a.page.waitForTimeout(300);
  t("«Volver a excluir» lo deja en 1", (await a.page.evaluate(() => localStorage.getItem("stike_internal"))) === "1");
  t("sin errores", a.errs.length === 0, a.errs.join("|"));
  await a.page.close();
}
console.log("\nConexión: errores del servidor al guardar");
{
  const a = await open("developer", { adminConfig: () => ({ status: 400, json: { error: "invalid_property_id", detail: "Eso es un ID de medición o de etiqueta, no el ID de la propiedad." } }) });
  await a.openPanel(); await a.go("conexion");
  await a.page.fill("#an-prop", "G-AB12CD34EF"); await a.page.click("#an-g-save"); await a.page.waitForTimeout(400);
  t("el desarrollador también puede; el error del servidor se muestra en español y la prueba NO corre", /no el ID de la propiedad/.test(await a.page.locator("#an-g-msg").innerText()) && !a.st.posts.some(p => p.url === "analytics" && p.body.view === "test"));
  await a.page.fill("#an-prop", ""); await a.page.click("#an-g-save"); await a.page.waitForTimeout(200);
  t("sin escribir nada pide al menos un dato y no llama al servidor", /Escribe el ID/.test(await a.page.locator("#an-g-msg").innerText()) && a.st.posts.filter(p => p.url === "admin-config").length === 1);
  await a.page.close();
}

/* ============================================================ 7. ROLES ============================================================ */
console.log("\nRoles");
{
  const a = await open("admin");
  await a.openPanel(); await a.go("conexion");
  const txt = await a.body();
  t("el administrador ve la analítica pero NO puede cambiar la conexión (sin formularios ni botón de probar)", (await a.page.locator("#an-mid, #an-key, #an-test, #an-g-save").count()) === 0 && /Solo el dueño y el desarrollador pueden cambiar la conexión/.test(txt), txt.slice(0, 200));
  await a.go("seo");
  t("y tampoco puede enviar el sitemap", (await a.page.locator("#an-sm-send").count()) === 0);
  await a.page.close();
}
for (const role of ["staff", "editor"]) {
  const a = await open(role);
  t(`rol «${role}»: el menú Analítica no se ve`, !(await a.page.locator('.navbtn[data-panel="analitica"]').isVisible()));
  await a.page.evaluate(() => switchPanel("analitica")); await a.page.waitForTimeout(400);
  t(`rol «${role}»: aunque lo intente por código, cae en Productos y no se pide el módulo ni los datos`, (await a.page.locator("#panel-title").innerText()) === "Productos" && a.st.moduleReqs === 0 && a.st.analyticsReqs.length === 0, `${a.st.moduleReqs} ${a.st.analyticsReqs.length}`);
  await a.page.close();
}

/* ============================================================ 8. ERRORES DE GOOGLE y CELULAR ============================================================ */
console.log("\nErrores de Google y pantalla de celular");
{
  const a = await open("owner", { onAnalytics: view => view === "summary" ? { json: { ok: false, code: "ga4_no_access", detail: "La cuenta de servicio no tiene permiso en esta propiedad. En Google Analytics → Administrar → Acceso a la propiedad agrégala como Lector.", setup: "ga4" } } : view === "acquisition" ? { status: 500, json: { error: "internal_error" } } : null });
  await a.openPanel();
  let txt = await a.body();
  t("un error de Google sale como tarjeta clara con lo que hay que hacer y NO tumba la pestaña (el contador propio sigue)", /Google Analytics no entregó los datos/.test(txt) && /agrégala como Lector/.test(txt) && /Reintentar/.test(txt) && /Visitas a páginas/.test(txt), txt.slice(0, 400));
  await a.go("llegan");
  txt = await a.body();
  t("si el servidor falla (500) se dice con calma y se puede reintentar", /no entregó los datos/.test(txt) && /El servidor no contestó bien \(500\)/.test(txt), txt.slice(0, 300));
  await a.page.close();
}
{
  const a = await open("owner", { viewport: { width: 390, height: 800 } });
  await a.openPanel();
  const sw = await a.page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  t("en pantalla de celular (390 px) no hay desplazamiento horizontal de la página", sw.doc <= sw.win + 1, JSON.stringify(sw));
  t("el gráfico se ajusta al ancho del celular", (await a.page.locator(".an-plot svg").first().evaluate(e => e.getBoundingClientRect().width)) <= 390);
  await a.go("quienes");
  const sw2 = await a.page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  t("Quiénes (mapa de calor) en celular: la página no se ensancha, el mapa se desplaza dentro de su tarjeta", sw2.doc <= sw2.win + 1, JSON.stringify(sw2));
  await a.shot("celular");
  await a.page.close();
}

await br.close();
console.log(fail ? `\n${fail} FALLA(S)` : "\nTodo bien");
process.exit(fail ? 1 : 0);
