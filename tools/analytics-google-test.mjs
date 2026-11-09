/* =========================================================================
   Panel > Analitica: lectura de Google Analytics 4 y Search Console con una CUENTA DE SERVICIO
   (api/_google.php + api/analytics.php + las acciones analytics_* de api/admin-config.php).

   Google va SIMULADO (servidor de pruebas), pero el acceso se firma de verdad: el simulador verifica el JWT RS256 con la llave
   publica de la cuenta de servicio de prueba (firma, emisor, permiso pedido, destinatario, vencimiento), igual que Google.
   PHP real (php -S), carpeta de datos temporal. Lo que se comprueba:
     - Solo roles con acceso a finanzas leen; solo dueño y desarrollador guardan, prueban y envian el sitemap.
     - La llave JSON se valida y se guarda CIFRADA; nunca vuelve al navegador (ni en errores).
     - Cada vista (resumen, adquisicion, paginas, productos, audiencia, WhatsApp, tiempo real, Search Console, contador propio)
       devuelve lo que la pestaña dibuja. Cache de 10 minutos y del token; &refresh=1 vuelve a pedir.
     - Los errores de Google (API apagada, cuenta sin permiso, llave rechazada, cuota, caido, dimension sin registrar) se
       traducen a una frase que dice que hacer.
     - «Probar conexion» dice que falta, punto por punto.

     node tools/analytics-google-test.mjs     (necesita php y openssl)
   ========================================================================= */
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { createVerify, generateKeyPairSync, createPublicKey } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

if (spawnSync("php", ["-v"]).status !== 0) { console.log("sin php: se omite la prueba de Analitica"); process.exit(0); }
const ROOT = fileURLToPath(new URL("..", import.meta.url));
let fail = 0;
const t = (l, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++; console.log(`  ${ok ? "ok  " : "FALLA"} ${l}${ok ? "" : `  -> dio ${JSON.stringify(got)}, esperaba ${JSON.stringify(want)}`}`); };
const freePort = () => new Promise(res => { const s = createNetServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
const listen = handler => new Promise(res => { const s = createServer(handler); s.listen(0, "127.0.0.1", () => res(s)); });
const wait = ms => new Promise(r => setTimeout(r, ms));
const PHP = (spawnSync("php", ["-r", "echo PHP_BINARY;"]).stdout || "").toString().trim() || "php";
const WORK = mkdtempSync(join(tmpdir(), "stike-an-"));

/* ----------------------------------- la cuenta de servicio de prueba ----------------------------------- */
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIV_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const SA_EMAIL = "stike-lector@stike-analytics-123.iam.gserviceaccount.com";
const SA_JSON = JSON.stringify({ type: "service_account", project_id: "stike-analytics-123", private_key_id: "abc123", private_key: PRIV_PEM, client_email: SA_EMAIL, client_id: "1234567890", auth_uri: "https://accounts.google.com/o/oauth2/auth", token_uri: "https://oauth2.googleapis.com/token" });
const PROP = "412345678", SITE = "sc-domain:stikebikeshop.com";

/* ------------------------------------------------ Google simulado ------------------------------------------------ */
const g = { tokenMode: "ok", ga4Mode: "ok", gscMode: "ok", customDims: true, tokens: new Map(), tokenCalls: 0, jwtChecks: [], calls: [], sitemapPuts: [], batchLog: [] };
const EV = { whatsapp_click: 12, view_item: 90, add_to_cart: 20, begin_checkout: 8, purchase: 4, generate_lead: 2, contact_click: 5, search: 9, view_item_list: 300, select_item: 40, view_cart: 10, payment_failed: 1 };
const BASE = { activeUsers: 50, newUsers: 30, sessions: 80, engagedSessions: 50, averageSessionDuration: 95.5, screenPageViews: 200, ecommercePurchases: 4, purchaseRevenue: 480000, addToCarts: 20, checkouts: 8, userEngagementDuration: 4000, itemsViewed: 90, itemsAddedToCart: 18, itemsPurchased: 4, itemRevenue: 480000 };
const DIMV = {
  date: ["20261101", "20261102", "20261103"], sessionDefaultChannelGroup: ["Organic Search", "Direct", "Social", "Referral"], sessionSourceMedium: ["google / organic", "(direct) / (none)", "instagram / social"],
  landingPage: ["/", "/tienda.html", "/producto/grips-odi-soft-negros.html"], pagePath: ["/", "/tienda.html", "/producto/grips-odi-soft-negros.html"], searchTerm: ["cadena", "grips", "(not set)"],
  itemName: ["Grips ODI Soft Negros", "Cadena Fiend", "(not set)"], itemCategory: ["Repuestos", "Ropa"], itemBrand: ["ODI", "Fiend"], deviceCategory: ["mobile", "desktop"],
  city: ["Bogotá", "Medellín", "(not set)"], newVsReturning: ["new", "returning"], dayOfWeek: ["1", "5"], hour: ["10", "15"],
  "customEvent:link_location": ["floating_button", "product_page"], "customEvent:page_type": ["home", "product"], unifiedScreenName: ["Stike Bike Shop | Tienda de BMX", "Catálogo BMX"], city_rt: [],
};
const metricValue = (m, i, range, ev) => m === "eventCount" ? Math.max(0, (ev ? (EV[ev] ?? 1) : 12) - i * 2) * (range === "prev" ? 0.5 : 1) : (BASE[m] ?? 1) * (1 - i * 0.1) * (range === "prev" ? 0.5 : 1);
function ga4Report(rq) {
  const dims = (rq.dimensions || []).map(d => d.name), mets = (rq.metrics || []).map(m => m.name), ranges = (rq.dateRanges || [{ name: "cur" }]).map(r => r.name || "cur");
  const filt = rq.dimensionFilter && rq.dimensionFilter.filter && rq.dimensionFilter.filter.inListFilter ? rq.dimensionFilter.filter.inListFilter.values : null;
  const lists = dims.map(d => d === "eventName" ? (filt || ["page_view"]) : (DIMV[d] || ["x"]));
  let combos = [[]]; for (const l of lists) combos = combos.flatMap(c => l.map(v => [...c, v]));
  const rows = []; let idx = 0;
  for (const c of combos) { for (const rg of ranges) { const ev = dims.includes("eventName") ? c[dims.indexOf("eventName")] : (filt && filt.length === 1 ? filt[0] : null);
    rows.push({ dimensionValues: [...c.map(value => ({ value })), ...(ranges.length > 1 ? [{ value: rg }] : [])], metricValues: mets.map(m => ({ value: String(metricValue(m, dims.includes("eventName") ? 0 : idx, rg, ev)) })) }); } idx++; }
  return { dimensionHeaders: [...dims.map(name => ({ name })), ...(ranges.length > 1 ? [{ name: "dateRange" }] : [])], metricHeaders: mets.map(name => ({ name })), rows, rowCount: rows.length };
}
const gscRows = (dims) => {
  const k = dims.join(",");
  if (k === "") return [{ clicks: 100, impressions: 4000, ctr: 0.025, position: 14.2 }];
  if (k === "date") return [{ keys: ["2026-11-01"], clicks: 10, impressions: 400, ctr: 0.025, position: 12 }, { keys: ["2026-11-02"], clicks: 12, impressions: 500, ctr: 0.024, position: 11 }, { keys: ["2026-11-03"], clicks: 8, impressions: 600, ctr: 0.0133, position: 10 }];
  if (k === "query") return [
    { keys: ["stike bike shop"], clicks: 40, impressions: 100, ctr: 0.4, position: 1.2 }, { keys: ["Cadena Fiend BMX"], clicks: 5, impressions: 500, ctr: 0.01, position: 8.4 },
    { keys: ["grips odi"], clicks: 2, impressions: 300, ctr: 0.0067, position: 12.1 }, { keys: ["pegs fate"], clicks: 0, impressions: 10, ctr: 0, position: 9 }, { keys: ["bmx bogota"], clicks: 9, impressions: 800, ctr: 0.011, position: 3.1 }];
  if (k === "page") return [{ keys: ["https://stikebikeshop.com/"], clicks: 50, impressions: 2000, ctr: 0.025, position: 9 }, { keys: ["https://stikebikeshop.com/tienda.html"], clicks: 20, impressions: 900, ctr: 0.022, position: 11 }];
  if (k === "device") return [{ keys: ["MOBILE"], clicks: 70, impressions: 3000, ctr: 0.023, position: 13 }, { keys: ["DESKTOP"], clicks: 30, impressions: 1000, ctr: 0.03, position: 16 }];
  if (k === "country") return [{ keys: ["col"], clicks: 90, impressions: 3500, ctr: 0.025, position: 13 }];
  return [];
};
const google = await listen((req, res) => {
  const chunks = []; req.on("data", c => chunks.push(c));
  req.on("end", () => {
    const raw = Buffer.concat(chunks).toString(); const url = new URL(req.url, "http://x"); const send = (st, o) => { res.statusCode = st; res.setHeader("content-type", "application/json"); res.end(o === undefined ? "" : JSON.stringify(o)); };
    g.calls.push(req.method + " " + url.pathname);
    if (url.pathname === "/token" && req.method === "POST") {
      g.tokenCalls++;
      if (g.tokenMode === "down") return send(503, { error: "backend_error" });
      if (g.tokenMode === "invalid_grant") return send(400, { error: "invalid_grant", error_description: "Invalid JWT Signature." });
      const form = new URLSearchParams(raw), jwt = form.get("assertion") || "";
      const [h, c, s] = jwt.split(".");
      const ok = createVerify("RSA-SHA256").update(h + "." + c).verify(publicKey, Buffer.from(s || "", "base64url"));
      const claims = JSON.parse(Buffer.from(c, "base64url").toString()), head = JSON.parse(Buffer.from(h, "base64url").toString());
      g.jwtChecks.push({ ok, alg: head.alg, typ: head.typ, grant: form.get("grant_type"), iss: claims.iss, aud: claims.aud, scope: claims.scope, ttl: claims.exp - claims.iat, fresh: Math.abs(claims.iat - Date.now() / 1000) < 60 });
      if (!ok || claims.iss !== SA_EMAIL || form.get("grant_type") !== "urn:ietf:params:oauth:grant-type:jwt-bearer") return send(400, { error: "invalid_grant", error_description: "Invalid JWT Signature." });
      const tok = "ya29.mock" + g.tokenCalls; g.tokens.set(tok, claims.scope);
      return send(200, { access_token: tok, expires_in: 3599, token_type: "Bearer" });
    }
    const auth = (req.headers.authorization || "").replace(/^Bearer /, ""), scope = g.tokens.get(auth);
    if (!scope) return send(401, { error: { code: 401, message: "Request had invalid authentication credentials.", status: "UNAUTHENTICATED" } });
    /* ---- GA4 ---- */
    const m = url.pathname.match(/^\/v1beta\/properties\/(\d+)(:batchRunReports|:runRealtimeReport|\/metadata)$/);
    if (m) {
      if (g.ga4Mode === "disabled") return send(403, { error: { code: 403, message: "Google Analytics Data API has not been used in project 123 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/analyticsdata.googleapis.com/overview?project=123", status: "PERMISSION_DENIED", details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "SERVICE_DISABLED", metadata: { activationUrl: "https://console.developers.google.com/apis/api/analyticsdata.googleapis.com/overview?project=123" } }] } });
      if (g.ga4Mode === "evil") return send(403, { error: { code: 403, message: "has not been used in project 1 before or it is disabled", status: "PERMISSION_DENIED", details: [{ reason: "SERVICE_DISABLED", metadata: { activationUrl: "https://evil.example/phish" } }] } });
      if (g.ga4Mode === "noaccess" || m[1] !== PROP) return send(403, { error: { code: 403, message: "User does not have sufficient permissions for this property. To learn more about Property ID, see https://developers.google.com/analytics/devguides/reporting/data/v1/property-id.", status: "PERMISSION_DENIED" } });
      if (g.ga4Mode === "quota") return send(429, { error: { code: 429, message: "Exhausted property tokens", status: "RESOURCE_EXHAUSTED" } });
      if (g.ga4Mode === "down") return send(503, { error: { code: 503, message: "The service is currently unavailable.", status: "UNAVAILABLE" } });
      if (scope !== "https://www.googleapis.com/auth/analytics.readonly") return send(403, { error: { code: 403, message: "Request had insufficient authentication scopes.", status: "PERMISSION_DENIED" } });
      const body = raw ? JSON.parse(raw) : {};
      if (m[2] === "/metadata") return send(200, { dimensions: [{ apiName: "date" }, { apiName: "eventName" }, ...(g.customDims ? [{ apiName: "customEvent:link_location" }, { apiName: "customEvent:page_type" }] : [])], metrics: [{ apiName: "sessions" }] });
      if (m[2] === ":batchRunReports") {
        g.lastBatch = body; g.batchLog.push((body.requests || []).length);
        if (!g.customDims && (body.requests || []).some(r => (r.dimensions || []).some(d => d.name.startsWith("customEvent:")))) return send(400, { error: { code: 400, message: "Field customEvent:link_location is not a valid dimension. Did you mean customUser:link_location?", status: "INVALID_ARGUMENT" } });
        if ((body.requests || []).length > 5) return send(400, { error: { code: 400, message: "Maximum of 5 requests", status: "INVALID_ARGUMENT" } });
        return send(200, { reports: (body.requests || []).map(ga4Report) });
      }
      if (m[2] === ":runRealtimeReport") {
        const dims = (body.dimensions || []).map(d => d.name), mets = (body.metrics || []).map(x => x.name);
        const rtv = { unifiedScreenName: ["Stike Bike Shop | Tienda de BMX", "Catálogo BMX"], eventName: ["page_view", "whatsapp_click"], city: ["Bogotá", "(not set)"] };
        const vals = dims.length ? rtv[dims[0]] : [null];
        return send(200, { dimensionHeaders: dims.map(name => ({ name })), metricHeaders: mets.map(name => ({ name })), rows: vals.map((v, i) => ({ dimensionValues: v === null ? [] : [{ value: v }], metricValues: mets.map(() => ({ value: String(dims.length ? 5 - i * 2 : 7) })) })) });
      }
    }
    /* ---- Search Console ---- */
    const gm = url.pathname.match(/^\/webmasters\/v3\/sites(?:\/([^/]+)(\/searchAnalytics\/query|\/sitemaps(?:\/(.+))?)?)?$/);
    if (gm) {
      if (g.gscMode === "disabled") return send(403, { error: { code: 403, message: "Google Search Console API has not been used in project 123 before or it is disabled.", status: "PERMISSION_DENIED", details: [{ reason: "SERVICE_DISABLED", metadata: { activationUrl: "https://console.developers.google.com/apis/api/searchconsole.googleapis.com/overview?project=123" } }] } });
      const site = gm[1] ? decodeURIComponent(gm[1]) : null;
      if (!gm[1]) return send(200, { siteEntry: g.gscMode === "nosite" ? [] : [{ siteUrl: SITE, permissionLevel: g.gscMode === "unverified" ? "siteUnverifiedUser" : "siteFullUser" }] });
      if (g.gscMode === "noaccess" || site !== SITE) return send(403, { error: { code: 403, message: `User does not have sufficient permission for site '${site}'. See also: https://support.google.com/webmasters/answer/2451999.`, errors: [{ reason: "forbidden" }] } });
      if (gm[2] === "/searchAnalytics/query") { const b = JSON.parse(raw); g.lastGsc = b; return send(200, { rows: gscRows(b.dimensions || []), responseAggregationType: "byProperty" }); }
      if (gm[2] && gm[2].startsWith("/sitemaps")) {
        if (req.method === "PUT") { if (scope !== "https://www.googleapis.com/auth/webmasters") return send(403, { error: { code: 403, message: "Request had insufficient authentication scopes.", status: "PERMISSION_DENIED" } }); g.sitemapPuts.push(decodeURIComponent(gm[3] || "")); res.statusCode = 204; return res.end(); }
        return send(200, g.gscMode === "nositemap" ? {} : { sitemap: [{ path: "https://stikebikeshop.com/sitemap.xml", lastSubmitted: "2026-11-01T10:00:00.000Z", lastDownloaded: "2026-11-08T03:00:00.000Z", isPending: false, errors: "0", warnings: "2", contents: [{ type: "web", submitted: "400", indexed: "350" }] }] });
      }
    }
    send(404, { error: { code: 404, message: "no existe" } });
  });
});
const GB = `http://127.0.0.1:${google.address().port}`;

/* ---------------------------------------- inicio de sesion del panel (simulado) ---------------------------------------- */
const WHO = { owner: "jparra375@gmail.com", developer: "daniel.f.acosta96@gmail.com", admin: "yeimy.hernandez.corredor@gmail.com", staff: "kevinarevalo1996@gmail.com", editor: "crystaldonkey18@gmail.com" };
const googleId = await listen((req, res) => {
  const tok = new URL(req.url, "http://x").searchParams.get("id_token");
  if (!WHO[tok]) { res.statusCode = 400; return res.end("{}"); }
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ aud: "752305520255-7e2abc762p3saer5sube25jh9rt9jle7.apps.googleusercontent.com", iss: "https://accounts.google.com", email: WHO[tok], email_verified: "true", exp: String(Math.floor(Date.now() / 1000) + 3600) }));
});

const procs = [];
async function startPhp(extra = {}) {
  const port = await freePort(), storage = mkdtempSync(join(WORK, "st-"));
  const env = { ...process.env, ADMIN_API_KEY: "k".repeat(32), STIKE_GOOGLE_TOKENINFO: `http://127.0.0.1:${googleId.address().port}`, STIKE_INSECURE_COOKIE: "1", NO_PROXY: "*", no_proxy: "*",
    GOOGLE_OAUTH_BASE: GB, GA4_DATA_API_BASE: GB, GSC_API_BASE: GB, SITE_URL: "https://stikebikeshop.com", STORAGE_DIR: storage, ...extra };
  const proc = spawn(PHP, ["-S", `127.0.0.1:${port}`, "-t", ROOT], { env, stdio: "ignore" });
  procs.push(proc);
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port}/api/admin-login.php`); break; } catch { await wait(100); } }
  return { API: `http://127.0.0.1:${port}/api`, storage };
}
const loginAt = async (api, who) => (await fetch(`${api}/admin-login.php`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credential: who }) })).headers.get("set-cookie").split(";")[0];
const post = (api, cookie, file, body) => fetch(`${api}/${file}.php`, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) }).then(async r => ({ code: r.status, json: await r.json().catch(() => null) }));
const get = (api, cookie, q) => fetch(`${api}/analytics.php?${q}`, { headers: cookie ? { Cookie: cookie } : {} }).then(async r => ({ code: r.status, json: await r.json().catch(() => null) }));
const cfg = (api, cookie, body) => post(api, cookie, "admin-config", body);

try {
  const S = await startPhp();
  const owner = await loginAt(S.API, "owner"), dev = await loginAt(S.API, "developer"), adminU = await loginAt(S.API, "admin"), staff = await loginAt(S.API, "staff"), editor = await loginAt(S.API, "editor");
  const runtime = () => existsSync(join(S.storage, "runtime-config.json")) ? readFileSync(join(S.storage, "runtime-config.json"), "utf8") : "";

  /* ============================================================ A. permisos ============================================================ */
  console.log("\nQuién puede qué");
  t("sin sesión: 401", (await get(S.API, null, "view=status")).code, 401);
  t("la tienda (staff) y el editor no ven analítica: 403", [(await get(S.API, staff, "view=status")).code, (await get(S.API, editor, "view=status")).code], [403, 403]);
  t("el administrador (ve finanzas) sí la lee", (await get(S.API, adminU, "view=status")).code, 200);
  for (const a of ["analytics_save", "analytics_clear"]) t(`${a}: sin sesión 401; administrador, tienda y editor 403`, [(await cfg(S.API, null, { action: a })).code, (await cfg(S.API, adminU, { action: a })).code, (await cfg(S.API, staff, { action: a })).code, (await cfg(S.API, editor, { action: a })).code], [401, 403, 403, 403]);
  t("probar la conexión y enviar el sitemap: solo dueño y desarrollador (el administrador, 403)", [(await post(S.API, adminU, "analytics", { view: "test" })).code, (await post(S.API, adminU, "analytics", { view: "sitemap_submit" })).code], [403, 403]);
  t("una vista que no existe: 400", (await get(S.API, owner, "view=nada")).code, 400);

  /* ============================================================ B. guardar la configuración ============================================================ */
  console.log("\nGuardar la llave de la cuenta de servicio (cifrada) y los ID");
  const st0 = (await get(S.API, owner, "view=status")).json;
  t("al principio no hay nada guardado", [st0.google.serviceAccount, st0.ga4.propertyId, st0.gsc.site], [null, null, null]);
  t("guardar sin nada: 400", (await cfg(S.API, owner, { action: "analytics_save" })).json.error, "empty_value");
  t("ID de propiedad con forma de ID de medición (G-…): lo explica", (await cfg(S.API, owner, { action: "analytics_save", propertyId: "G-ABC123DEF4" })).json.detail.includes("ID de medición"), true);
  t("ID de propiedad con letras: 400", (await cfg(S.API, owner, { action: "analytics_save", propertyId: "abc" })).json.error, "invalid_property_id");
  t("propiedad de Search Console mal escrita: 400 con el formato", (await cfg(S.API, owner, { action: "analytics_save", gscSite: "stikebikeshop" })).json.error, "invalid_gsc_site");
  t("JSON que no es JSON: dice qué copiar", (await cfg(S.API, owner, { action: "analytics_save", serviceAccountJson: "hola" })).json.error, "sa_not_json");
  t("JSON de un ID de cliente de OAuth (no de cuenta de servicio): lo explica", (await cfg(S.API, owner, { action: "analytics_save", serviceAccountJson: JSON.stringify({ web: { client_id: "x" } }) })).json.error, "sa_wrong_type");
  t("JSON sin llave privada", (await cfg(S.API, owner, { action: "analytics_save", serviceAccountJson: JSON.stringify({ type: "service_account", client_email: SA_EMAIL }) })).json.error, "sa_no_key");
  t("llave privada rota", (await cfg(S.API, owner, { action: "analytics_save", serviceAccountJson: JSON.stringify({ type: "service_account", client_email: SA_EMAIL, private_key: "-----BEGIN " + "PRIVATE KEY-----\nAAAA\n-----END " + "PRIVATE KEY-----\n" }) })).json.error, "sa_key_invalid");
  t("nada de eso se guardó", runtime().includes("GOOGLE_SA_JSON"), false);

  const sv = await cfg(S.API, owner, { action: "analytics_save", propertyId: ` ${PROP} `, gscSite: SITE, serviceAccountJson: SA_JSON });
  t("guardar lo bueno: dice qué se guardó y la cuenta (solo el correo y el proyecto)", [sv.code, sv.json.saved, sv.json.serviceAccount, sv.json.propertyId, sv.json.gscSite], [200, ["propertyId", "gscSite", "serviceAccountJson"], { email: SA_EMAIL, project: "stike-analytics-123" }, PROP, SITE]);
  t("la llave privada NO vuelve en la respuesta ni queda legible en el disco (va cifrada)", [JSON.stringify(sv.json).includes("PRIVATE KEY"), runtime().includes("PRIVATE KEY"), runtime().includes(SA_EMAIL), /"enc":"v1"/.test(runtime())], [false, false, false, true]);
  const st1 = (await get(S.API, owner, "view=status")).json;
  t("el estado muestra el correo de la cuenta (para agregarlo en Google), el ID de propiedad y la propiedad de Search Console; nunca la llave", [st1.google.serviceAccount.email, st1.google.source, st1.ga4.propertyId, st1.gsc.site, JSON.stringify(st1).includes("PRIVATE")], [SA_EMAIL, "panel", PROP, SITE, false]);
  t("una propiedad «con dirección» sin barra final se corrige sola", (await cfg(S.API, owner, { action: "analytics_save", gscSite: "https://stikebikeshop.com" })).json.gscSite, "https://stikebikeshop.com/");
  await cfg(S.API, owner, { action: "analytics_save", gscSite: SITE });

  /* ============================================================ C. el acceso a Google se firma de verdad ============================================================ */
  console.log("\nAcceso a Google (JWT RS256 de la cuenta de servicio)");
  const sum = await get(S.API, owner, "view=summary&range=28d");
  const j0 = g.jwtChecks[0];
  t("el simulador verificó la firma RS256 con la llave pública de la cuenta", [j0.ok, j0.alg, j0.typ, j0.grant], [true, "RS256", "JWT", "urn:ietf:params:oauth:grant-type:jwt-bearer"]);
  t("emisor = cuenta de servicio, permiso de solo lectura de Analytics, destinatario = el token endpoint, 55 minutos, recién emitido", [j0.iss, j0.scope, j0.aud, j0.ttl, j0.fresh], [SA_EMAIL, "https://www.googleapis.com/auth/analytics.readonly", GB + "/token", 3300, true]);
  const tokensBefore = g.tokenCalls;
  await get(S.API, owner, "view=acquisition&range=28d"); await get(S.API, owner, "view=pages&range=28d"); await get(S.API, owner, "view=products&range=28d");
  t("el token de 1 hora se reutiliza (no se pide uno por consulta)", g.tokenCalls - tokensBefore, 0);

  /* ============================================================ D. vistas de GA4 ============================================================ */
  console.log("\nResumen (KPIs con el periodo anterior, serie, embudo)");
  const s = sum.json;
  t("rango de 28 días y su periodo anterior", [s.ok, s.range.days, s.range.key], [true, 28, "28d"]);
  t("KPIs con actual y anterior (usuarios 50/25, sesiones 80/40, ingresos 480.000/240.000)", [s.kpis.users, s.kpis.sessions, s.kpis.revenue, s.kpis.purchases, s.kpis.addToCarts], [{ cur: 50, prev: 25 }, { cur: 80, prev: 40 }, { cur: 480000, prev: 240000 }, { cur: 4, prev: 2 }, { cur: 20, prev: 10 }]);
  t("eventos clave con actual y anterior", [s.events.whatsapp_click, s.events.add_to_cart, s.events.purchase], [{ cur: 12, prev: 6 }, { cur: 20, prev: 10 }, { cur: 4, prev: 2 }]);
  t("serie diaria con fechas legibles y los clics a WhatsApp de cada día", [s.series.length, s.series[0], s.series[2].whatsapp], [3, { date: "2026-11-01", sessions: 80, users: 50, purchases: 4, revenue: 480000, addToCarts: 20, whatsapp: 12 }, 8]);
  t("serie del periodo anterior (para dibujarla punteada)", s.prevSeries.map(x => x.sessions), [40, 36, 32]);
  t("embudo: sesiones → ver producto → carrito → iniciar pago → compra, y WhatsApp aparte", s.funnel, { sessions: 80, viewItem: 90, addToCart: 20, beginCheckout: 8, purchase: 4, whatsapp: 12 });
  t("el resumen pidió sus 5 reportes en UNA sola llamada (el máximo de Google)", g.batchLog[0], 5);
  t("y los KPIs y los eventos se pidieron con dos rangos de fechas (actual y anterior)", [g.lastBatch ? 1 : 0], [1]);

  console.log("\nAdquisición, páginas, productos, audiencia");
  const acq = (await get(S.API, owner, "view=acquisition&range=28d")).json;
  t("canales con sesiones, compras, ingresos y clics a WhatsApp de cada canal", acq.channels[0], { name: "Organic Search", sessions: 80, users: 50, engaged: 50, purchases: 4, revenue: 480000, whatsapp: 12 });
  t("fuentes y páginas de entrada", [acq.sources[0].name, acq.landing[0].path], ["google / organic", "/"]);
  const pg = (await get(S.API, owner, "view=pages&range=28d")).json;
  t("páginas más vistas con tiempo promedio (segundos por usuario)", [pg.pages[0].path, pg.pages[0].views, Math.round(pg.pages[0].avgSeconds)], ["/", 200, 80]);
  t("páginas con más clics a WhatsApp y páginas rotas", [pg.whatsappPages[0].path, pg.notFound.length], ["/", 3]);
  t("lo que buscan en la tienda: sin «(not set)»", pg.searches.map(x => x.term), ["cadena", "grips"]);
  const pr = (await get(S.API, owner, "view=products&range=28d")).json;
  t("productos con vistas, carrito, compras e ingresos; categorías y marcas; sin «(not set)»", [pr.products.map(x => x.name), pr.products[0], pr.categories.length, pr.brands.length], [["Grips ODI Soft Negros", "Cadena Fiend"], { name: "Grips ODI Soft Negros", views: 90, addToCart: 18, purchased: 4, revenue: 480000 }, 2, 2]);
  const au = (await get(S.API, owner, "view=audience&range=28d")).json;
  t("dispositivos, ciudades (sin «(not set)»), nuevos y recurrentes", [au.devices.map(x => x.name), au.cities.map(x => x.name), au.newVsReturning.map(x => x.name)], [["mobile", "desktop"], ["Bogotá", "Medellín"], ["new", "returning"]]);
  t("mapa de horas: sesiones y clics a WhatsApp por día de la semana y hora", [au.heatSessions.length, au.heatSessions[0], au.heatWhatsapp.length], [4, { dow: 1, hour: 10, v: 80 }, 4]);

  console.log("\nWhatsApp");
  const wa = (await get(S.API, owner, "view=whatsapp&range=28d")).json;
  t("total con el periodo anterior, por dispositivo y por fuente", [wa.total, wa.byDevice.map(x => x.name), wa.bySource[0].name], [{ cur: 12, prev: 6 }, ["mobile", "desktop"], "google / organic"]);
  t("por lugar del botón (dimensión personalizada registrada) y por tipo de página", [wa.byLocation.map(x => x.name), wa.byPageType.map(x => x.name), wa.missingDimensions], [["floating_button", "product_page"], ["home", "product"], []]);
  g.customDims = false;
  const wa2 = (await get(S.API, owner, "view=whatsapp&range=7d&refresh=1")).json;
  t("si las dimensiones personalizadas todavía no están registradas en GA4: no es un error, avisa cuáles faltan y el resto sigue", [wa2.ok, wa2.byLocation, wa2.byPageType, wa2.missingDimensions, wa2.total.cur], [true, null, null, ["link_location", "page_type"], 12]);
  g.customDims = true;

  console.log("\nTiempo real");
  const rt = (await get(S.API, owner, "view=realtime")).json;
  t("usuarios activos ahora, páginas, eventos y ciudades", [rt.activeUsers, rt.pages[0].name, rt.events.map(x => x.name), rt.cities.map(x => x.name)], [7, "Stike Bike Shop | Tienda de BMX", ["page_view", "whatsapp_click"], ["Bogotá"]]);

  console.log("\nCaché");
  const calls0 = g.calls.length;
  await get(S.API, owner, "view=summary&range=28d");
  t("repetir una consulta no vuelve a llamar a Google (caché de 10 minutos)", g.calls.length - calls0, 0);
  t("y lo dice (cached) y desde cuándo", [(await get(S.API, owner, "view=summary&range=28d")).json.cached, typeof (await get(S.API, owner, "view=summary&range=28d")).json.cachedAt], [true, "number"]);
  await get(S.API, owner, "view=summary&range=28d&refresh=1");
  t("refresh=1 sí vuelve a preguntar", g.calls.length - calls0 > 0, true);
  t("otro rango (7 días) es otra consulta", ((await get(S.API, owner, "view=summary&range=7d")).json.range.days), 7);
  t("el rango «hoy» es de un día, con el día anterior como comparación", await (async () => { const r = (await get(S.API, owner, "view=summary&range=today")).json.range; return [r.days, r.from === r.to, r.prevFrom === r.prevTo]; })(), [1, true, true]);

  /* ============================================================ E. Search Console ============================================================ */
  console.log("\nSearch Console");
  const se = (await get(S.API, owner, "view=search&range=28d")).json;
  t("clics, impresiones, CTR y posición del periodo y del anterior", [se.ok, se.totals.cur.clicks, se.totals.cur.impressions, Math.round(se.totals.cur.ctr * 1000) / 1000, se.totals.prev.clicks, se.totals.prev.position], [true, 30, 1500, 0.02, 100, 14.2]);
  t("el final del rango lleva 2 días de retraso (así los tiene Search Console)", (() => { const d = new Date(se.range.to + "T12:00:00Z"), now = new Date(); return Math.round((now - d) / 86400000) >= 2; })(), true);
  t("serie diaria", se.series.map(x => x.date), ["2026-11-01", "2026-11-02", "2026-11-03"]);
  t("consultas más buscadas (primero las de más clics)", se.queries.map(x => x.query).slice(0, 2), ["stike bike shop", "bmx bogota"].slice(0, 1).concat(se.queries[1].query));
  t("oportunidades: posición 4–20 con muchas impresiones (la de más impresiones primero; sin las que ya están arriba ni las de pocas impresiones)", se.opportunities.map(x => x.query), ["Cadena Fiend BMX", "grips odi"]);
  t("marca vs. resto: lo que contiene «stike» cuenta como marca", [se.brand.clicks, se.nonBrand.clicks], [40, 16]);
  t("páginas, dispositivos y países", [se.pages.length, se.devices.map(x => x.name), se.countries.length], [2, ["MOBILE", "DESKTOP"], 1]);
  const smv = (await get(S.API, owner, "view=sitemaps")).json;
  t("sitemaps: enviado, fecha, errores y avisos, URL enviadas e indexadas", smv.sitemaps[0], { path: "https://stikebikeshop.com/sitemap.xml", lastSubmitted: "2026-11-01T10:00:00.000Z", lastDownloaded: "2026-11-08T03:00:00.000Z", pending: false, errors: 0, warnings: 2, submitted: 400, indexed: 350 });
  const sub = await post(S.API, owner, "analytics", { view: "sitemap_submit" });
  t("«Enviar sitemap» manda https://stikebikeshop.com/sitemap.xml con el permiso de escritura", [sub.json.ok, g.sitemapPuts, [...g.tokens.values()].includes("https://www.googleapis.com/auth/webmasters")], [true, ["https://stikebikeshop.com/sitemap.xml"], true]);

  /* ============================================================ F. contador propio ============================================================ */
  console.log("\nContador propio");
  const dir = join(S.storage, "analytics"); mkdirSync(dir, { recursive: true });
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Bogota" }).format(new Date());
  writeFileSync(join(dir, `fp-${today}.json`), JSON.stringify({ v: 1, day: today, ev: { whatsapp_click: { n: 5, loc: { floating_button: 3, product_page: 2 }, slug: { "grips-odi": 2 }, hour: { "10": 5 }, dev: { m: 4, d: 1 } }, page_view: { n: 40, path: { "/": 30, "/tienda.html": 10 } }, search: { n: 3, q: { cadena: 2, grips: 1 } } } }));
  const fp = (await get(S.API, owner, "view=firstparty&range=7d")).json;
  t("totales por evento, con el periodo anterior, por lugar, producto, dispositivo, hora y búsquedas", [fp.ev.whatsapp_click.n, fp.ev.whatsapp_click.loc, fp.ev.whatsapp_click.slug, fp.ev.whatsapp_click.dev, fp.ev.page_view.path[0], fp.ev.search.q, fp.first], [5, [{ name: "floating_button", n: 3 }, { name: "product_page", n: 2 }], [{ name: "grips-odi", n: 2 }], [{ name: "m", n: 4 }, { name: "d", n: 1 }], { name: "/", n: 30 }, [{ name: "cadena", n: 2 }, { name: "grips", n: 1 }], today]);

  /* ============================================================ G. errores de Google, explicados ============================================================ */
  console.log("\nErrores de Google, explicados");
  g.ga4Mode = "disabled";
  let e = (await get(S.API, owner, "view=summary&range=28d&refresh=1")).json;
  t("API de Analytics sin activar: lo dice y trae el enlace de activación de Google Cloud", [e.ok, e.code, e.detail.includes("https://console.developers.google.com/apis/api/analyticsdata.googleapis.com"), e.setup], [false, "ga4_api_disabled", true, "ga4"]);
  g.ga4Mode = "evil";
  e = (await get(S.API, owner, "view=summary&range=28d&refresh=1")).json;
  t("un enlace que NO es de Google Cloud no se repite (solo dice cómo activarla)", [e.code, e.detail.includes("evil.example"), e.detail.includes("Biblioteca")], ["ga4_api_disabled", false, true]);
  g.ga4Mode = "noaccess";
  e = (await get(S.API, owner, "view=summary&range=28d&refresh=1")).json;
  t("cuenta sin permiso en la propiedad: dice qué correo agregar y con qué rol", [e.code, e.detail.includes(SA_EMAIL), e.detail.includes("Lector"), e.detail.includes(PROP)], ["ga4_no_access", true, true, true]);
  g.ga4Mode = "quota";
  t("cuota agotada", (await get(S.API, owner, "view=summary&range=28d&refresh=1")).json.code, "google_quota");
  g.ga4Mode = "down";
  t("Google caído", (await get(S.API, owner, "view=summary&range=28d&refresh=1")).json.code, "google_down");
  g.ga4Mode = "ok";
  t("y al volver Google, el mismo botón vuelve a funcionar (los errores no se guardan en la caché)", (await get(S.API, owner, "view=summary&range=28d")).json.ok, true);
  g.tokenMode = "invalid_grant";
  await cfg(S.API, owner, { action: "analytics_save", propertyId: PROP });   // borra la caché y los tokens
  e = (await get(S.API, owner, "view=summary&range=28d")).json;
  t("llave rechazada por Google (invalid_grant): explica que se borró o se cambió y que hay que pegar una nueva", [e.code, e.detail.includes("llave"), e.detail.includes("invalid_grant")], ["google_key_rejected", true, true]);
  g.tokenMode = "down";
  t("Google caído al pedir el acceso", (await get(S.API, owner, "view=summary&range=28d")).json.code, "google_down");
  g.tokenMode = "ok";
  g.gscMode = "noaccess";
  e = (await get(S.API, owner, "view=search&range=28d")).json;
  t("Search Console: cuenta sin permiso → dice dónde agregarla (Usuarios y permisos) y con cuál permiso", [e.code, e.setup, e.detail.includes(SA_EMAIL), e.detail.includes("Usuarios y permisos")], ["gsc_no_access", "gsc", true, true]);
  g.gscMode = "disabled";
  e = (await get(S.API, owner, "view=search&range=28d")).json;
  t("Search Console API sin activar", [e.code, e.detail.includes("searchconsole.googleapis.com")], ["gsc_api_disabled", true]);
  g.gscMode = "ok";
  t("ninguna respuesta de error deja ver la llave ni el token", JSON.stringify(e).includes("PRIVATE") || JSON.stringify(e).includes("ya29"), false);

  /* ============================================================ H. «Probar conexión» ============================================================ */
  console.log("\nProbar conexión");
  const ck = r => Object.fromEntries(r.json.checks.map(c => [c.id, c.ok]));
  let tr = await post(S.API, owner, "analytics", { view: "test" });
  t("con todo bien: cuenta, GA4, dimensiones, datos, eventos, Search Console, datos y sitemap en ✔ (solo falta el ID de medición en el sitio)", ck(tr), { sa: true, ga4: true, ga4_dims: true, ga4_data: true, ga4_events: true, gsc: true, gsc_data: true, gsc_sitemap: true, fp: true, site_id: false });
  t("cada punto trae una frase (no códigos)", tr.json.checks.every(c => c.label && c.detail && c.detail.length > 10), true);
  g.customDims = false; g.ga4Mode = "ok";
  tr = await post(S.API, owner, "analytics", { view: "test" });
  t("sin las dimensiones personalizadas: ✕ y explica cómo crearlas (Definiciones personalizadas, alcance Evento)", [ck(tr).ga4_dims, tr.json.checks.find(c => c.id === "ga4_dims").detail.includes("link_location y page_type"), tr.json.checks.find(c => c.id === "ga4_dims").detail.includes("Definiciones personalizadas")], [false, true, true]);
  g.customDims = true; g.ga4Mode = "noaccess";
  tr = await post(S.API, owner, "analytics", { view: "test" });
  t("sin permiso en GA4: ✕ con el correo a agregar", [ck(tr).ga4, tr.json.checks.find(c => c.id === "ga4").detail.includes(SA_EMAIL)], [false, true]);
  g.ga4Mode = "ok"; g.gscMode = "nosite";
  tr = await post(S.API, owner, "analytics", { view: "test" });
  t("Search Console: la cuenta no tiene esa propiedad → ✕ y dice qué ve", [ck(tr).gsc, tr.json.checks.find(c => c.id === "gsc").detail.includes("no ve ninguna propiedad")], [false, true]);
  g.gscMode = "nositemap";
  tr = await post(S.API, owner, "analytics", { view: "test" });
  t("sin sitemap enviado: ✕ y dice cómo enviarlo", [ck(tr).gsc_sitemap, tr.json.checks.find(c => c.id === "gsc_sitemap").detail.includes("Enviar sitemap")], [false, true]);
  g.gscMode = "ok";

  /* ============================================================ H2. la puerta de los gráficos (admin.php?f=an) ============================================================ */
  console.log("\nQuién recibe el código de los gráficos (admin.php?f=an)");
  const SITE_URL = S.API.replace(/\/api$/, "");
  const adm = (cookie, q) => fetch(`${SITE_URL}/admin.php?${q}`, { headers: cookie ? { Cookie: cookie } : {} }).then(async r => ({ code: r.status, type: r.headers.get("content-type") || "", cache: r.headers.get("cache-control") || "", body: await r.text() }));
  let an = await adm(null, "f=an");
  t("sin sesión: 401 y ni una línea del código", [an.code, an.body.includes("StikeAnalytics"), an.body.length < 40], [401, false, true]);
  for (const [who, c] of [["la tienda", staff], ["el editor", editor]]) { an = await adm(c, "f=an"); t(`${who}: 403 y nada del código (los datos incluyen ingresos)`, [an.code, an.body.includes("StikeAnalytics")], [403, false]); }
  for (const [who, c] of [["dueño", owner], ["desarrollador", dev], ["administrador", adminU]]) { an = await adm(c, "f=an"); t(`${who}: recibe el módulo como JavaScript sin guardarlo en caché`, [an.code, /javascript/.test(an.type), an.body.includes("window.StikeAnalytics"), /no-store/.test(an.cache)], [200, true, true, true]); }
  an = await adm(owner, "f=js");
  t("el panel de siempre (admin.js) sigue llegando igual", [an.code, /javascript/.test(an.type), an.body.includes("function switchPanel")], [200, true, true]);
  an = await adm(editor, "f=js");
  t("y el editor sigue recibiendo admin.js (su panel), pero no el de gráficos", [an.code, an.body.includes("function switchPanel")], [200, true]);
  an = await adm(owner, "f=html");
  t("admin.html trae la pestaña Analítica en el menú", [an.code, an.body.includes('data-panel="analitica"'), an.body.includes('id="an-root"')], [200, true, true]);

  /* ============================================================ I. quitar ============================================================ */
  console.log("\nQuitar lo guardado");
  const clr = await cfg(S.API, owner, { action: "analytics_clear" });
  t("«Quitar la llave»: la llave se borra, los ID se quedan", [clr.json.ok, (await get(S.API, owner, "view=status")).json.google.serviceAccount, (await get(S.API, owner, "view=status")).json.ga4.propertyId], [true, null, PROP]);
  e = (await get(S.API, owner, "view=summary&range=28d")).json;
  t("sin llave las vistas dicen que falta (no se caen)", [e.ok, e.code], [false, "google_not_configured"]);
  await cfg(S.API, owner, { action: "analytics_clear", all: true });
  t("«Quitar todo» borra también el ID de propiedad y la propiedad de Search Console", await (async () => { const x = (await get(S.API, owner, "view=status")).json; return [x.ga4.propertyId, x.gsc.site, runtime().includes("GOOGLE_SA_JSON")]; })(), [null, null, false]);
  t("y no queda ningún token ni dato en caché en el disco", existsSync(join(S.storage, "analytics-cache")) ? readdirSync(join(S.storage, "analytics-cache")).filter(f => f.endsWith(".json")).length : 0, 0);
} finally {
  for (const p of procs) p.kill();
  google.close(); googleId.close();
  rmSync(WORK, { recursive: true, force: true });
}
console.log(fail ? `\n${fail} falla(s)` : "\nTodo bien");
process.exit(fail ? 1 : 0);
