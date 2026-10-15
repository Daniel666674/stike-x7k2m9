/* =========================================================================
   STIKE BIKE SHOP: panel admin. Toda la logica vive aca (admin.html solo
   trae el shell). Habla DIRECTO con la API de contenidos de GitHub, sin
   servidor intermedio: GitHub es el backend. Reusa STIKE_CATEGORIES,
   STIKE_BRANDS, SIZE_CATEGORIES, SKU_CAT_CODES, skuBrandCode, stikeSizeRangeFor,
   stikeStockFor, etc. de assets/js/data.js (ya cargado antes que este script),
   y PdpRender de assets/js/pdp-render.js para regenerar producto/<slug>.html
   con la MISMA plantilla que uso el build inicial.
   ========================================================================= */

/* ============================== CONFIG ================================= */
const CONFIG = {
  owner: "Daniel666674",
  repo: "stike-x7k2m9",
  // Rama que despliega a GitHub Pages (ver .github/workflows/deploy.yml).
  branch: "claude/sweet-albattani-ti0w0e",
  paths: {
    catalog: "assets/js/products-data.js",
    costs: "data/costs.json",
    salesLog: "data/sales-log.json",
    auditLog: "data/audit-log.json",
    siteContent: "data/site-content.json",
    sitemap: "sitemap.xml",
    template: "_template.html",
  },
  // Ventas online (Wompi): las guarda el servidor de Hostinger, no GitHub.
  // Ruta relativa al <base href>; ver api/sales.php.
  salesApi: "api/sales",
};

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const backoffMs = attempt => [0, 400, 900, 1800, 3200][attempt] || 4000;
const money = n => "$" + Math.round(n || 0).toLocaleString("es-CO");

/* ============================== CRASH BANNER =============================
   Si algo revienta (un error de red raro, un bug), que se vea en pantalla
   en vez de dejar la app muerta en silencio (botones que "no hacen nada").
   No depende de ninguna otra funcion del archivo para que nunca falle ella
   misma, ni siquiera si revento antes de que $()/$$() esten disponibles.
   ========================================================================= */
(function () {
  function showCrash(msg) {
    try {
      let box = document.getElementById("crash-banner");
      if (!box) {
        box = document.createElement("div");
        box.id = "crash-banner";
        box.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:99999;background:#4a1216;color:#ffd7da;padding:12px 16px;font:13px/1.5 system-ui,sans-serif;border-bottom:2px solid #ff4d5e;white-space:pre-wrap";
        (document.body || document.documentElement).appendChild(box);
      }
      box.textContent = "⚠ Error en el panel (avísale a soporte con este texto): " + msg;
    } catch {}
  }
  window.addEventListener("error", e => showCrash(e.message + (e.filename ? ` (${e.filename}:${e.lineno})` : "")));
  window.addEventListener("unhandledrejection", e => showCrash((e.reason && e.reason.message) || String(e.reason)));
})();

/* ============================== SESSION =================================
   Demo: sin login. Todos entran directo como "owner" (ven costo/margen,
   KPIs y auditoria); lo unico que realmente controla quien puede publicar
   es el token de GitHub (pestaña Configuración). session.email queda solo
   como firma de commits/ventas/auditoría.
   ========================================================================= */
let session = { name: "demo", email: "demo@stikebikeshop.com", role: "owner", pat: "" };

/* ============================== BASE64 (UTF-8 y binario safe) =========== */
function b64EncodeBytes(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64DecodeBytes(b64) {
  const bin = atob(b64.replace(/\n/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function b64EncodeText(str) { return b64EncodeBytes(new TextEncoder().encode(str)); }
function b64DecodeText(b64) { return new TextDecoder().decode(b64DecodeBytes(b64)); }

/* ============================== GITHUB CLIENT ============================
   Regla de oro: nunca se escribe a ciegas. Todo GET trae el sha actual;
   todo PUT/DELETE lo manda; un 409/422 por sha desactualizado se reintenta
   (hasta 4x, con backoff) volviendo a pedir el sha (y, para el catalogo,
   rehaciendo el merge completo -- ver writeCatalogWithMergeRetry).        */
/* Todo pasa por api/gh.php: el servidor pone el GITHUB_TOKEN (que nunca
   llega al navegador) y valida la sesion, el repo, la rama y la ruta. */
async function ghRequest(path, opts = {}) {
  const res = await fetch(new URL(`api/gh?path=${encodeURIComponent(path)}`, document.baseURI), {
    method: opts.method || "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: opts.body ? { "Content-Type": "application/json" } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) { location.reload(); throw new Error("La sesión venció. Vuelve a iniciar sesión."); }
  return res;
}

async function ghGetMeta(path) {
  const res = await ghRequest(path);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET ${path} -> ${res.status}`);
  return await res.json();
}
async function ghGetFile(path) {
  const meta = await ghGetMeta(path);
  if (!meta) return null;
  return { sha: meta.sha, text: b64DecodeText(meta.content) };
}
async function ghPutOnce(path, contentB64, message, sha) {
  const res = await ghRequest(path, {
    method: "PUT",
    body: { message: `[${session.email}] ${message}`, content: contentB64, branch: CONFIG.branch, sha: sha || undefined },
  });
  if (res.ok) return await res.json();
  const bodyText = await res.text().catch(() => "");
  const err = new Error(`GitHub PUT ${path} -> ${res.status} ${bodyText}`);
  err.conflict = res.status === 409 || res.status === 422;
  err.status = res.status;
  throw err;
}
async function ghDeleteOnce(path, sha, message) {
  const res = await ghRequest(path, { method: "DELETE", body: { message: `[${session.email}] ${message}`, sha, branch: CONFIG.branch } });
  if (res.ok || res.status === 404) return;
  const bodyText = await res.text().catch(() => "");
  const err = new Error(`GitHub DELETE ${path} -> ${res.status} ${bodyText}`);
  err.conflict = res.status === 409;
  throw err;
}
async function ghDeleteIfExists(path, message) {
  const meta = await ghGetMeta(path);
  if (!meta) return;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try { return await ghDeleteOnce(path, meta.sha, message); }
    catch (e) {
      if (e.conflict && attempt < 4) { await sleep(backoffMs(attempt)); const fresh = await ghGetMeta(path); if (!fresh) return; meta.sha = fresh.sha; continue; }
      throw e;
    }
  }
}
/* Crear un archivo NUEVO en un path que se espera libre (fotos con nombre
   aleatorio). Si por una colision astronomicamente improbable ya existe,
   se reintenta con otro nombre aleatorio en vez de pisarlo (regla #2).    */
async function ghCreateWithRetryName(makePath, contentB64, message, maxTries = 5) {
  let lastErr;
  for (let i = 0; i < maxTries; i++) {
    const path = makePath();
    try { const r = await ghPutOnce(path, contentB64, message, undefined); return { path, result: r }; }
    catch (e) { lastErr = e; if (!e.conflict) throw e; }
  }
  throw lastErr;
}

/* ============================== CATALOG (parse/serialize) =============== */
const CATALOG_MARKER = "window.STIKE_PRODUCTS = ";
const CATALOG_HEADER = `/* =========================================================================
   STIKE BIKE SHOP: catalogo (fuente de la verdad)
   Generado y mantenido por el panel admin (admin.html) via GitHub Contents API.
   JS plano (no JSON) para poder incluirlo con <script src> sin fetch/CORS.
   Ver assets/js/data.js para SIZE_CATEGORIES, helpers de stock y variantes.
   ========================================================================= */\n`;
const CATALOG_KEY_ORDER = ["slug", "sku", "n", "brand", "cat", "sub", "spec", "price", "old", "promo", "tag",
  "units", "sizes", "colors", "imgs", "imgColorMap", "imgFit", "imgZoom", "imgPos", "published"];

function parseCatalogFile(text) {
  const i = text.indexOf(CATALOG_MARKER);
  if (i < 0) throw new Error("products-data.js: no se encontro window.STIKE_PRODUCTS");
  const body = text.slice(i + CATALOG_MARKER.length, text.lastIndexOf(";"));
  return JSON.parse(body);
}
function serializeCatalogFile(arr) {
  return CATALOG_HEADER + CATALOG_MARKER + JSON.stringify(arr, null, 2) + ";\n";
}
/* Lo que efectivamente se publica: quita campos internos (cost) y omite
   valores por defecto para que el archivo publicado quede liviano.        */
function toSiteProduct(p) {
  const out = {};
  for (const k of CATALOG_KEY_ORDER) {
    if (k === "tag" && !p.tag) continue;
    if (k === "old" && (!p.promo || !p.old)) continue;
    if (k === "imgFit" && (!p.imgFit || p.imgFit === "auto")) continue;
    if (k === "imgZoom" && (!p.imgZoom || p.imgZoom <= 100)) continue;
    if (k === "imgPos" && (!p.imgPos || p.imgPos === "center center")) continue;
    if (k === "imgColorMap" && (!p.imgColorMap || !Object.keys(p.imgColorMap).length)) continue;
    if (k === "sizes" && !(p.sizes && p.sizes.length)) continue;
    if (k === "colors" && !(p.colors && p.colors.length)) continue;
    if (k === "units" && (p.sizes && p.sizes.length || p.colors && p.colors.length)) continue;
    if (p[k] !== undefined) out[k] = p[k];
  }
  return out;
}

/* ============================== APP STATE ================================ */
let workingCatalog = [];           // copia de trabajo de esta sesion (incluye cost)
let baseline = new Map();          // slug remoto -> snapshot (site-shape) tal como estaba al cargar
let dirtySlugs = new Set();        // slugs (actuales) tocados esta sesion
let deletedSlugs = new Set();      // slugs remotos borrados esta sesion
let renamedFrom = new Map();       // slug nuevo -> slug remoto anterior
let costsMap = {};                 // slug -> costo (interno, nunca se publica en products-data.js)
let salesLog = [];                 // lo que se muestra: salesLogGh + salesLogOnline, ordenado por fecha
let salesLogGh = [];               // data/sales-log.json: ventas registradas a mano (y las de Wompi anteriores al servidor propio)
let salesLogOnline = [];           // ventas de Wompi guardadas en el servidor (Hostinger), solo lectura
let onlineSalesState = { configured: false, ok: false, error: "" };
let auditLog = [];
let siteContent = {};
let pendingUploads = new Map();    // path reservado -> File original (sin comprimir)
let templateCache = null;
let catalogLoaded = false;

/* ============================== MODO DEMO ================================
   Sin token de GitHub el panel no puede leer NADA real, asi que arranca en
   modo demo: reusa el catalogo publico ya cargado por products-data.js y
   genera ventas, costos y auditoria FICTICIOS para que se vea como luce el
   panel con movimiento real. Nada de esto se escribe jamas en GitHub:
   mientras demoMode este activo, publicar y registrar ventas quedan
   bloqueados (ver publishCatalog/registrarVenta). Al guardar un token real,
   loadAll() reemplaza todo por los datos de verdad y demoMode se apaga.
   ========================================================================= */
let demoMode = false;

/* PRNG con semilla fija: los numeros del demo son siempre los mismos entre
   recargas, para que la demo no cambie de cifras cada vez que se abre. */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEMO_SELLERS = ["camilo@stikebikeshop.com", "laura@stikebikeshop.com", "hola@stikebikeshop.com"];

function generateDemoSales(catalog, days) {
  const rnd = mulberry32(20260827);
  const pool = catalog.filter(p => p.published !== false && p.price > 0);
  if (!pool.length) return [];
  // Lo barato rota mas que un marco de $980.000: peso inverso al precio.
  const weights = pool.map(p => 1 + Math.max(0, 500000 - Math.min(p.price, 500000)) / 90000);
  const totalW = weights.reduce((a, b) => a + b, 0);
  const pick = () => {
    let r = rnd() * totalW;
    for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) return pool[i]; }
    return pool[pool.length - 1];
  };
  const out = [];
  for (let d = days - 1; d >= 0; d--) {
    const date = new Date(Date.now() - d * 864e5);
    const dow = date.getDay();
    let n = 1 + Math.floor(rnd() * 4);
    if (dow === 6) n += 2;                    // sabado es el dia fuerte
    if (dow === 0) n = Math.max(0, n - 2);    // domingo flojo
    if (d < 30) n += 1;                       // ultimo mes con mas movimiento
    for (let i = 0; i < n; i++) {
      const p = pick();
      const qty = rnd() < 0.78 ? 1 : (rnd() < 0.7 ? 2 : 3);
      const size = (p.sizes && p.sizes.length) ? p.sizes[Math.floor(rnd() * p.sizes.length)].v : null;
      const color = (p.colors && p.colors.length) ? p.colors[Math.floor(rnd() * p.colors.length)].v : null;
      // Algun descuento puntual de mostrador, como en la vida real.
      const unitPrice = rnd() < 0.12 ? Math.round(p.price * 0.95 / 1000) * 1000 : p.price;
      const ts = new Date(date);
      ts.setHours(10 + Math.floor(rnd() * 9), Math.floor(rnd() * 60), 0, 0);
      out.push({
        ts: ts.toISOString(), slug: p.slug, name: p.n, size, color, qty,
        unitPrice, total: unitPrice * qty,
        admin: DEMO_SELLERS[Math.floor(rnd() * DEMO_SELLERS.length)],
      });
    }
  }
  return out.sort((a, b) => a.ts.localeCompare(b.ts));
}

function generateDemoAudit() {
  const rnd = mulberry32(7788);
  const notes = [
    "Actualizó precios de repuestos (+8%)", "Cargó fotos nuevas de cascos",
    "Registró venta de mostrador", "Creó 3 productos de la marca Fate",
    "Marcó agotado el marco Sunday", "Actualizó textos del sitio",
    "Ajustó stock tras inventario físico", "Publicó la promo de fin de mes",
  ];
  return notes.map((summary, i) => {
    const ts = new Date(Date.now() - (i * 3 + Math.floor(rnd() * 3)) * 864e5);
    return {
      ts: ts.toISOString(), admin: DEMO_SELLERS[Math.floor(rnd() * DEMO_SELLERS.length)],
      summary, created: Math.floor(rnd() * 3), edited: 1 + Math.floor(rnd() * 4),
      deleted: 0, photos: Math.floor(rnd() * 4),
    };
  }).reverse();
}

function seedDemoData() {
  demoMode = true;
  /* STIKE_ALL_PRODUCTS: el catalogo CRUDO. data.js filtra los borradores de
     window.STIKE_PRODUCTS para el sitio, pero el panel tiene que verlos
     todos, marcados como borrador. */
  const base = (window.STIKE_ALL_PRODUCTS || window.STIKE_PRODUCTS || []).map(p => JSON.parse(JSON.stringify(p)));
  costsMap = {};
  base.forEach(p => { costsMap[p.slug] = Math.round((p.price * 0.62) / 1000) * 1000; });
  workingCatalog = base.map(p => ({ ...p, cost: costsMap[p.slug] || 0 }));
  baseline = new Map();
  dirtySlugs = new Set(); deletedSlugs = new Set(); renamedFrom = new Map();
  pendingUploads = new Map();
  window.STIKE_PRODUCTS = workingCatalog;
  salesLog = generateDemoSales(workingCatalog, 120);
  auditLog = generateDemoAudit();
  siteContent = {};
  catalogLoaded = true;
}

function renderDemoBanner() {
  const el = $("#demo-banner");
  if (el) el.innerHTML = "";
}

function findOwnBaselineSlug(currentSlug) {
  for (const [ns, os] of renamedFrom.entries()) if (ns === currentSlug) return os;
  return baseline.has(currentSlug) ? currentSlug : null;
}
function markDirty(slug) { dirtySlugs.add(slug); updateDirtyUI(); }
function updateDirtyUI() {
  const n = dirtySlugs.size + deletedSlugs.size;
  $("#btn-publish").disabled = n === 0;
  const pill = $("#dirty-pill");
  if (n > 0) { pill.style.display = ""; pill.textContent = `${n} cambio${n === 1 ? "" : "s"} sin publicar`; }
  else pill.style.display = "none";
}

/* ====================== VENTAS: dos fuentes, una lista ====================
   Las ventas a mano (formulario y boton "Vender") viven en GitHub
   (data/sales-log.json) y las de Wompi las guarda el servidor de Hostinger
   (api/sales.php). Ahi estan los datos del cliente, por eso exige la clave
   del servidor: se pega UNA vez en Configuracion, igual que el token de
   GitHub, y se queda solo en este navegador. salesLog es la mezcla, sin
   repetidos y en orden de fecha (los renderizadores asumen ese orden). */
function saleKey(s) {
  return s.orderRef ? `${s.orderRef}|${s.slug}|${s.size || ""}|${s.color || ""}` : `${s.ts}|${s.slug}`;
}
function rebuildSalesLog() {
  const seen = new Set(salesLogGh.map(saleKey));
  salesLog = salesLogGh
    .concat(salesLogOnline.filter(s => !seen.has(saleKey(s))))
    .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
}
/* Nunca rechaza: si el servidor no responde, se conserva la ultima lista buena
   y el panel avisa en la pestaña Ventas en vez de romper la carga. */
async function fetchOnlineSales() {
  try {
    const res = await fetch(new URL(CONFIG.salesApi, document.baseURI), { credentials: "same-origin", cache: "no-store" });
    if (res.status === 401) throw new Error("la sesión venció");
    if (!res.ok) throw new Error(`el servidor respondió ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error("respuesta inesperada");
    salesLogOnline = rows;
    onlineSalesState = { configured: true, ok: true, error: "" };
  } catch (e) {
    onlineSalesState = { configured: true, ok: false, error: e.message || "sin conexión" };
  }
}

/* ============================== LOAD ===================================== */
async function loadAll() {
  showStatus([{ text: "Cargando catálogo desde GitHub...", cls: "now" }]);
  const [catFile, costsFile, salesFile, auditFile, contentFile] = await Promise.all([
    ghGetFile(CONFIG.paths.catalog),
    ghGetFile(CONFIG.paths.costs),
    ghGetFile(CONFIG.paths.salesLog),
    ghGetFile(CONFIG.paths.auditLog),
    ghGetFile(CONFIG.paths.siteContent),
    fetchOnlineSales(),
  ]);
  const arr = catFile ? parseCatalogFile(catFile.text) : [];
  costsMap = costsFile ? JSON.parse(costsFile.text) : {};
  salesLogGh = salesFile ? JSON.parse(salesFile.text) : [];
  rebuildSalesLog();
  auditLog = auditFile ? JSON.parse(auditFile.text) : [];
  siteContent = contentFile ? JSON.parse(contentFile.text) : {};

  baseline = new Map(arr.map(p => [p.slug, JSON.parse(JSON.stringify(p))]));
  workingCatalog = arr.map(p => ({ ...p, cost: costsMap[p.slug] || 0 }));
  dirtySlugs = new Set();
  deletedSlugs = new Set();
  renamedFrom = new Map();
  pendingUploads = new Map();
  window.STIKE_PRODUCTS = workingCatalog; // reusa helpers de data.js (stikeStockFor, stikeCategory, ...)
  catalogLoaded = true;
  demoMode = false;       // ya hay datos reales: se apaga la demo
  renderDemoBanner();

  renderProductGrid();
  renderSalesTab();
  renderKpis();
  renderAudit();
  renderContentTab();
  updateDirtyUI();
  renderNotifBadge();
  startSalesPolling();
  reconcileOnlineStock();
  showStatus([{ text: `Listo: ${workingCatalog.length} productos.`, cls: "ok" }]);
}

/* ============================== VALIDATION =============================== */
function validateCatalog(catalog) {
  const errors = [];
  const bySlug = new Map(), bySku = new Map();
  catalog.forEach(p => {
    const label = p.n || p.slug || "(sin nombre)";
    if (!p.n) errors.push(`${label}: falta el nombre`);
    if (!p.brand) errors.push(`${label}: falta la marca`);
    if (!p.cat) errors.push(`${label}: falta la categoría`);
    if (!p.price || p.price <= 0) errors.push(`${label}: precio inválido`);
    if (!p.slug) errors.push(`${label}: falta el slug`);
    if (!p.sku) errors.push(`${label}: falta el SKU`);
    if (p.slug) { if (bySlug.has(p.slug)) errors.push(`Slug duplicado "${p.slug}": ${bySlug.get(p.slug)} y ${label}`); else bySlug.set(p.slug, label); }
    if (p.sku) { if (bySku.has(p.sku)) errors.push(`SKU duplicado "${p.sku}": ${bySku.get(p.sku)} y ${label}`); else bySku.set(p.sku, label); }
    if (SIZE_CATEGORIES.has(p.sub) && !(p.sizes && p.sizes.length)) errors.push(`${label}: la subcategoría "${p.sub}" requiere tabla de tallas con stock`);
    (p.sizes || []).forEach(s => { if (s.u < 0) errors.push(`${label}: stock negativo en talla ${s.v}`); });
    (p.colors || []).forEach(c => { if (c.u < 0) errors.push(`${label}: stock negativo en color ${c.v}`); });
    if (!(p.sizes && p.sizes.length) && !(p.colors && p.colors.length) && typeof p.units !== "number") errors.push(`${label}: falta unidades en stock`);
    /* Sin foto, la ficha sale con el logo generico y el og:image apunta al
       logo: el producto compartido por WhatsApp no muestra el producto. */
    if (!(p.imgs && p.imgs.length)) errors.push(`${label}: falta la foto (al menos una)`);
  });
  return errors;
}
function checkRemoteUniqueness(freshArr, scopeSlugs) {
  const problems = [];
  for (const slug of (scopeSlugs || dirtySlugs)) {
    const d = workingCatalog.find(p => p.slug === slug);
    if (!d) continue;
    const ownSlug = findOwnBaselineSlug(d.slug);
    const slugHit = freshArr.find(r => r.slug === d.slug && r.slug !== ownSlug);
    if (slugHit) problems.push(`El slug "${d.slug}" (${d.n}) ya lo usa otro producto publicado por otra persona mientras editabas. Cambia el nombre/slug e intenta de nuevo.`);
    const ownRow = ownSlug ? freshArr.find(r => r.slug === ownSlug) : null;
    const skuHit = freshArr.find(r => r.sku === d.sku && r !== ownRow);
    if (skuHit) problems.push(`El SKU "${d.sku}" (${d.n}) ya lo usa otro producto publicado por otra persona mientras editabas. Genera un SKU nuevo e intenta de nuevo.`);
  }
  return problems;
}

/* ============================== 3-WAY MERGE ============================== */
function mergeProduct(draftSite, baselineSite, remoteRow) {
  if (!remoteRow) return draftSite; // producto nuevo, nada que fusionar
  const out = { ...remoteRow };
  const keys = new Set([...Object.keys(draftSite), ...Object.keys(remoteRow), ...Object.keys(baselineSite || {})]);
  keys.forEach(k => {
    const changed = JSON.stringify(draftSite[k]) !== JSON.stringify((baselineSite || {})[k]);
    if (changed) out[k] = draftSite[k];
  });
  Object.keys(out).forEach(k => { if (out[k] === undefined) delete out[k]; });
  return out;
}
function buildMergedCatalog(freshArr, scopeSlugs) {
  let merged = freshArr.map(r => ({ ...r }));
  for (const slug of deletedSlugs) if (!scopeSlugs || scopeSlugs.has(slug)) merged = merged.filter(r => r.slug !== slug);
  for (const [newSlug, oldSlug] of renamedFrom.entries()) {
    if (scopeSlugs && !scopeSlugs.has(newSlug)) continue;
    merged = merged.filter(r => r.slug !== oldSlug);
  }
  const slugsToApply = scopeSlugs || dirtySlugs;
  for (const slug of slugsToApply) {
    const d = workingCatalog.find(p => p.slug === slug);
    if (!d) continue;
    const draftSite = toSiteProduct(d);
    const ownSlug = findOwnBaselineSlug(slug);
    const baselineSite = ownSlug ? baseline.get(ownSlug) : null;
    const remoteRow = ownSlug ? merged.find(r => r.slug === ownSlug) : null;
    const mergedRow = mergeProduct(draftSite, baselineSite, remoteRow);
    const idx = ownSlug ? merged.findIndex(r => r.slug === ownSlug) : -1;
    if (idx >= 0) merged[idx] = mergedRow; else merged.push(mergedRow);
  }
  return merged;
}

/* ============================== PUBLISH PIPELINE ========================== */
async function writeCatalogWithMergeRetry(commitMessage, scopeSlugs) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const fresh = await ghGetFile(CONFIG.paths.catalog);
    const freshArr = fresh ? parseCatalogFile(fresh.text) : [];
    const problems = checkRemoteUniqueness(freshArr, scopeSlugs);
    if (problems.length) { const e = new Error(problems.join(" \n")); e.userFacing = true; throw e; }
    const merged = buildMergedCatalog(freshArr, scopeSlugs);
    try {
      await ghPutOnce(CONFIG.paths.catalog, b64EncodeText(serializeCatalogFile(merged)), commitMessage, fresh ? fresh.sha : undefined);
      return merged;
    } catch (e) {
      if (e.conflict && attempt < 4) { pushStatus(`Choque de versión (intento ${attempt}), reintentando...`); await sleep(backoffMs(attempt)); continue; }
      throw e;
    }
  }
}
async function appendJsonLog(path, newEntries, commitMessage) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const fresh = await ghGetFile(path);
    const arr = fresh ? JSON.parse(fresh.text) : [];
    const merged = arr.concat(newEntries);
    try { await ghPutOnce(path, b64EncodeText(JSON.stringify(merged, null, 2) + "\n"), commitMessage, fresh ? fresh.sha : undefined); return merged; }
    catch (e) { if (e.conflict && attempt < 4) { await sleep(backoffMs(attempt)); continue; } throw e; }
  }
}
async function mergeFlatMap(path, updates, deletions, commitMessage) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const fresh = await ghGetFile(path);
    const map = fresh ? JSON.parse(fresh.text) : {};
    Object.assign(map, updates);
    (deletions || []).forEach(k => delete map[k]);
    try { await ghPutOnce(path, b64EncodeText(JSON.stringify(map, null, 2) + "\n"), commitMessage, fresh ? fresh.sha : undefined); return map; }
    catch (e) { if (e.conflict && attempt < 4) { await sleep(backoffMs(attempt)); continue; } throw e; }
  }
}

async function uploadPendingPhotos(scopeSlugs, statusLines) {
  const slugs = scopeSlugs || dirtySlugs;
  for (const slug of slugs) {
    const d = workingCatalog.find(p => p.slug === slug);
    if (!d || !d.imgs) continue;
    for (const path of d.imgs) {
      if (!pendingUploads.has(path)) continue;
      pushStatus(`Subiendo foto ${path.split("/").pop()}...`);
      const file = pendingUploads.get(path);
      const blob = await compressImageFile(file);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      /* Los nombres son aleatorios, asi que normalmente la ruta esta libre.
         Si YA existe algo ahi (se reuso una ruta, o un reintento a medio
         camino), hay que pasarle el sha o GitHub rechaza la escritura; y
         ademas hay que romper el cache: navegadores y CDN siguen sirviendo
         los bytes viejos de una ruta que ya conocian, indefinidamente. */
      const existing = await ghGetMeta(path);
      await ghPutOnce(path, b64EncodeBytes(bytes), `Foto para ${d.n}`, existing ? existing.sha : undefined);
      if (existing) {
        const stamped = `${path}?v=${Date.now()}`;
        d.imgs = d.imgs.map(u => (u === path ? stamped : u));
        if (d.img === path) d.img = stamped;
        /* imgColorMap esta indexado por la ruta de la foto, asi que si la
           ruta cambia hay que mover la clave: si no, la galeria deja de
           saber que foto corresponde a que color y el selector de color
           deja de cambiar la imagen. */
        if (d.imgColorMap && Object.prototype.hasOwnProperty.call(d.imgColorMap, path)) {
          d.imgColorMap[stamped] = d.imgColorMap[path];
          delete d.imgColorMap[path];
        }
      }
      pendingUploads.delete(path);
    }
  }
}

async function regenerateProductPages(merged, scopeSlugs, commitMessage) {
  if (!templateCache) { const t = await ghGetFile(CONFIG.paths.template); templateCache = t ? t.text : null; }
  if (!templateCache) return; // sin plantilla no se puede regenerar (no debería pasar en este repo)
  const catIndex = new Map(STIKE_CATEGORIES.map(c => [c.slug, c]));
  const slugs = scopeSlugs || dirtySlugs;

  const toDelete = new Set();
  for (const slug of deletedSlugs) if (!scopeSlugs || scopeSlugs.has(slug)) toDelete.add(slug);
  for (const [newSlug, oldSlug] of renamedFrom.entries()) if ((!scopeSlugs || scopeSlugs.has(newSlug)) && newSlug !== oldSlug) toDelete.add(oldSlug);
  for (const slug of slugs) {
    const row = merged.find(r => r.slug === slug);
    const ownSlug = findOwnBaselineSlug(slug);
    if ((!row || row.published === false) && ownSlug && baseline.has(ownSlug)) toDelete.add(ownSlug);
  }
  for (const slug of toDelete) await ghDeleteIfExists(`producto/${slug}.html`, commitMessage);

  for (const slug of slugs) {
    const row = merged.find(r => r.slug === slug);
    if (!row || row.published === false) continue;
    const cat = catIndex.get(row.cat);
    const html = PdpRender.renderProductPage(row, templateCache, {
      site: STIKE_SITE,
      categoryName: cat ? cat.name : row.cat,
      whatsapp: STIKE_SITE.whatsapp,
      placeholderImg: stikeProductImage(row, 1200),
    });
    const path = `producto/${row.slug}.html`;
    const meta = await ghGetMeta(path);
    await ghPutOnce(path, b64EncodeText(html), commitMessage, meta ? meta.sha : undefined);
  }
}

/* El sitemap se reconcilia contra el catalogo COMPLETO, no contra lo que se
   toco en esta sesion, asi que se autocorrige solo.
   La lista de paginas fijas y el dominio salen de assets/js/site.js, que es
   la misma fuente que usa tools/build-pages.mjs. Cuando cada uno tenia su
   copia, la de aca se quedo sin las cuatro paginas de Fate y el sitemap
   perdia ese micro-sitio en cada publicacion. */
async function regenerateSitemap(merged, commitMessage) {
  const staticPages = [
    ...STIKE_SITE.staticPages,
    ...(window.STIKE_PART_PAGES || []).map(s => [`categoria/${s}.html`, "0.7", "weekly"]),
  ];
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
  staticPages.forEach(([p, pr, cf]) => { xml += `  <url><loc>${STIKE_SITE.url(p)}</loc><changefreq>${cf}</changefreq><priority>${pr}</priority></url>\n`; });
  merged.filter(p => p.published !== false).forEach(p => { xml += `  <url><loc>${STIKE_SITE.url(`producto/${p.slug}.html`)}</loc><changefreq>weekly</changefreq><priority>0.5</priority></url>\n`; });
  xml += `</urlset>\n`;
  const meta = await ghGetMeta(CONFIG.paths.sitemap);
  await ghPutOnce(CONFIG.paths.sitemap, b64EncodeText(xml), commitMessage, meta ? meta.sha : undefined);
}

let publishing = false;
function setPublishing(v) { publishing = v; $("#btn-publish").disabled = v || (dirtySlugs.size + deletedSlugs.size === 0); $("#btn-refresh").disabled = v; }

/**
 * Publica los cambios pendientes (o, si se pasa scopeSlugs, solo ese subconjunto
 * -- lo usa "Registrar venta" para no arrastrar ediciones de catalogo a medio
 * terminar). Siempre valida el catalogo COMPLETO antes de escribir nada.
 */
async function publishCatalog(opts = {}) {
  const scopeSlugs = opts.scopeSlugs || null;
  // Cortafuegos: los datos de la demo son ficticios y jamas deben viajar al repo.
  if (demoMode) {
    showStatus([{ text: "Modo demo: no se publica nada. Guarda tu token de GitHub en Configuración para publicar de verdad.", cls: "bad" }]);
    return;
  }
  if (!dirtySlugs.size && !deletedSlugs.size) { showStatus([{ text: "No hay cambios para publicar.", cls: "muted" }]); return; }
  const errors = validateCatalog(workingCatalog);
  if (errors.length) { renderValidationErrors(errors); return; }
  clearValidationErrors();

  setPublishing(true);
  const lines = [];
  const push = t => { lines.push({ text: t, cls: "now" }); showStatus(lines); };
  window.pushStatus = push; // usado por helpers internos (uploadPendingPhotos, retry loop)

  const touchedSlugs = scopeSlugs || new Set([...dirtySlugs, ...deletedSlugs]);
  const created = [...touchedSlugs].filter(s => !findOwnBaselineSlug(s) && !deletedSlugs.has(s)).length;
  const deleted = [...deletedSlugs].filter(s => !scopeSlugs || scopeSlugs.has(s)).length;
  const edited = touchedSlugs.size - created - deleted;
  const photosCount = [...pendingUploads.keys()].filter(p => {
    const owner = workingCatalog.find(x => x.imgs && x.imgs.includes(p));
    return owner && (!scopeSlugs || scopeSlugs.has(owner.slug));
  }).length;
  const summary = opts.auditNote || `${created} creado(s), ${edited} editado(s), ${deleted} eliminado(s), ${photosCount} foto(s)`;

  try {
    push("Subiendo fotos nuevas...");
    await uploadPendingPhotos(scopeSlugs, lines);

    push("Fusionando catálogo con la versión más reciente...");
    const merged = await writeCatalogWithMergeRetry(summary, scopeSlugs);

    push("Regenerando fichas de producto...");
    await regenerateProductPages(merged, scopeSlugs, summary);

    push("Actualizando sitemap...");
    await regenerateSitemap(merged, summary);

    push("Guardando costos internos...");
    const costUpdates = {}; const costDeletions = [];
    for (const slug of touchedSlugs) {
      const d = workingCatalog.find(p => p.slug === slug);
      if (deletedSlugs.has(slug) && (!scopeSlugs || scopeSlugs.has(slug))) costDeletions.push(slug);
      else if (d) {
        costUpdates[d.slug] = d.cost || 0;
        const oldSlug = renamedFrom.get(d.slug); // producto renombrado esta sesion: limpia la entrada del slug anterior
        if (oldSlug && oldSlug !== d.slug) costDeletions.push(oldSlug);
      }
    }
    costsMap = await mergeFlatMap(CONFIG.paths.costs, costUpdates, costDeletions, summary);

    push("Escribiendo auditoría...");
    auditLog = await appendJsonLog(CONFIG.paths.auditLog, [{
      ts: new Date().toISOString(), admin: session.email, summary,
      created, edited, deleted, photos: photosCount,
    }], summary);

    // limpiar estado de sesion solo para lo publicado en este scope
    const processedDeletions = scopeSlugs ? [...deletedSlugs].filter(s => scopeSlugs.has(s)) : [...deletedSlugs];
    for (const slug of touchedSlugs) { dirtySlugs.delete(slug); renamedFrom.delete(slug); }
    processedDeletions.forEach(s => deletedSlugs.delete(s));

    // refrescar baseline con el estado recien publicado; borra las entradas de
    // lo eliminado para que un producto NUEVO que reuse ese mismo slug mas
    // tarde en la sesion no herede por error el baseline del que ya no existe.
    merged.forEach(r => baseline.set(r.slug, JSON.parse(JSON.stringify(r))));
    processedDeletions.forEach(s => baseline.delete(s));

    push("✔ Publicado.");
    lines[lines.length - 1].cls = "ok";
    showStatus(lines);
    updateDirtyUI();
    renderProductGrid();
    renderAudit();
  } catch (e) {
    lines.push({ text: (e.userFacing ? e.message : "Error: " + e.message), cls: "bad" });
    showStatus(lines);
    console.error(e);
  } finally {
    setPublishing(false);
  }
}

/* ============================== STATUS TOAST ============================== */
function showStatus(lines) {
  const box = $("#status-box");
  box.innerHTML = lines.map(l => `<div class="line ${l.cls || ""}">${l.text}</div>`).join("");
  box.classList.add("show");
  clearTimeout(showStatus._t);
  if (!publishing) showStatus._t = setTimeout(() => box.classList.remove("show"), 6000);
}
function pushStatus(text) { window.pushStatus ? window.pushStatus(text) : showStatus([{ text, cls: "now" }]); }

function renderValidationErrors(errors) {
  clearValidationErrors();
  const box = document.createElement("div");
  box.className = "errlist"; box.id = "validation-errors";
  box.innerHTML = `<h4>No se puede publicar (${errors.length})</h4><ul>${errors.map(e => `<li>${e}</li>`).join("")}</ul>`;
  $("main").insertBefore(box, $("main").children[1]);
}
function clearValidationErrors() { const el = $("#validation-errors"); if (el) el.remove(); }

/* ============================== SLUG / SKU ================================ */
function slugify(s) {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function isSlugTaken(slug, excludeSlug) { return workingCatalog.some(p => p.slug === slug && p.slug !== excludeSlug); }
function isSkuTaken(sku, excludeSlug) { return workingCatalog.some(p => p.sku === sku && p.slug !== excludeSlug); }
function uniqueSlug(base, excludeSlug) {
  let candidate = base || "producto", n = 2;
  while (isSlugTaken(candidate, excludeSlug)) { candidate = `${base}-${n}`; n++; }
  return candidate;
}
function brandCodeFromCatalog(brand) {
  const existing = workingCatalog.find(p => p.brand === brand && p.sku && p.sku.split("-").length === 3);
  if (existing) return existing.sku.split("-")[1];
  const taken = new Set(workingCatalog.filter(p => p.brand !== brand && p.sku).map(p => p.sku.split("-")[1]));
  return skuBrandCode(brand, taken);
}
function nextSkuSeq(prefix) {
  let max = 0;
  workingCatalog.forEach(p => { if (p.sku && p.sku.startsWith(prefix)) { const n = parseInt(p.sku.slice(prefix.length), 10); if (!isNaN(n)) max = Math.max(max, n); } });
  return String(max + 1).padStart(3, "0");
}
function generateSku(cat, brand) {
  const catCode = SKU_CAT_CODES[cat] || "GEN";
  const brandCode = brandCodeFromCatalog(brand);
  const prefix = `${catCode}-${brandCode}-`;
  return prefix + nextSkuSeq(prefix);
}

/* ============================== PHOTOS ===================================== */
function randomFilename(ext) {
  const id = (crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)));
  return `${id}.${ext}`;
}
function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
/* En moviles con poca memoria -- sobre todo los navegadores embebidos de
   WhatsApp e Instagram -- drawImage() sobre una foto de camara moderna
   puede fallar EN SILENCIO: sin excepcion, sin error. El canvas queda
   transparente y se exporta como un JPEG perfectamente valido que es un
   cuadrado negro, y pasa cualquier verificacion de formato y de tamano.

   Se muestrean 9 puntos -- las cuatro esquinas, los cuatro puntos medios de
   los bordes y el centro -- y se rechaza el resultado si los nueve salen
   identicos byte a byte. Una foto real nunca lo es; un cuadrado de un solo
   color, siempre. */
function canvasLooksReal(ctx, w, h) {
  const mx = w >> 1, my = h >> 1, rx = w - 1, ry = h - 1;
  const pts = [
    [0, 0], [mx, 0], [rx, 0],
    [0, my], [mx, my], [rx, my],
    [0, ry], [mx, ry], [rx, ry],
  ];
  let first = null;
  for (const [x, y] of pts) {
    const d = ctx.getImageData(Math.min(Math.max(x, 0), w - 1), Math.min(Math.max(y, 0), h - 1), 1, 1).data;
    const key = d[0] + "," + d[1] + "," + d[2];
    if (first === null) first = key; else if (key !== first) return true;
  }
  return false;
}
/**
 * Comprime SIEMPRE a partir del File original (nunca de un blob ya comprimido),
 * para que la calidad sea consistente sin importar cuanto tiempo lleve abierta
 * la pestaña. Guarda contra drawImage() fallando en silencio en moviles con
 * poca memoria (deja el canvas en blanco pero igual "codifica" un JPEG
 * valido): se muestrea una grilla de pixeles y, si salen todos iguales, se
 * reintenta el dibujo.
 */
async function compressImageFile(file, maxDim = 1600, quality = 0.87) {
  const bitmap = await createImageBitmap(file).catch(() => null);
  const img = bitmap || await loadImageElement(file);
  const srcW = bitmap ? bitmap.width : img.width, srcH = bitmap ? bitmap.height : img.height;
  const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale)), h = Math.max(1, Math.round(srcH * scale));
  for (let attempt = 1; attempt <= 3; attempt++) {
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    /* Fondo blanco ANTES de dibujar. Un canvas arranca transparente, y al
       exportar a JPEG -- que no tiene canal alfa -- todo lo transparente se
       aplana a NEGRO por especificacion del formato. Sin esto, cualquier
       PNG con fondo recortado (que es como llegan la mitad de las fotos de
       producto) se publica con el fondo negro. */
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap || img, 0, 0, w, h);
    if (!canvasLooksReal(ctx, w, h)) { await sleep(80); continue; }
    const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", quality));
    if (blob) return blob;
  }
  throw new Error("No se pudo procesar la foto (intenta de nuevo o con otra foto)");
}
function previewSrcFor(path) {
  if (pendingUploads.has(path)) {
    const file = pendingUploads.get(path);
    file.__previewUrl = file.__previewUrl || URL.createObjectURL(file);
    return file.__previewUrl;
  }
  return path; // ya publicada: ruta absoluta real (admin.html vive en la raiz del sitio)
}

/* ============================== PRODUCT TABLE ============================== */
function populateCategoryFilter() {
  const sel = $("#p-filter-cat");
  sel.innerHTML = `<option value="">Todas las categorías</option>` + STIKE_CATEGORIES.filter(c => c.slug !== "promo").map(c => `<option value="${c.slug}">${c.name}</option>`).join("");
}

/* Las subcategorias dependen de la categoria elegida (o, sin elegir
   ninguna, se listan todas agrupadas en el mismo orden que STIKE_CATEGORIES).
   Se reconstruye en cada render porque depende de un filtro que puede
   cambiar; se preserva la seleccion si sigue siendo una opcion valida. */
function populateSubFilter() {
  const sel = $("#p-filter-sub");
  const catFilter = $("#p-filter-cat").value;
  const current = sel.value;
  const cats = STIKE_CATEGORIES.filter(c => c.slug !== "promo" && (!catFilter || c.slug === catFilter));
  const subs = [...new Set(cats.flatMap(c => c.subs))];
  sel.innerHTML = `<option value="">Todas las subcategorías</option>` + subs.map(s => `<option value="${escAttr(s)}">${s}</option>`).join("");
  sel.value = subs.includes(current) ? current : "";
}

/* Las marcas que existen HOY en el catalogo (no la lista completa de
   STIKE_BRANDS): filtrar por una marca sin productos no tendria sentido. */
function populateBrandFilter() {
  const sel = $("#p-filter-brand");
  const current = sel.value;
  const brands = [...new Set(workingCatalog.map(p => p.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  sel.innerHTML = `<option value="">Todas las marcas</option>` + brands.map(b => `<option value="${escAttr(b)}">${b}</option>`).join("");
  sel.value = brands.includes(current) ? current : "";
}
/* Grilla de tarjetas con la MISMA estetica que la tienda (foto grande,
   marca, nombre, precio) mas lo que el admin necesita ver de un vistazo:
   SKU, stock real y estado (borrador / bajo / agotado / sin publicar). */
/* ============================== VISTA: TARJETAS / TABLA =====================
   Dos vistas del mismo catalogo filtrado. La preferencia se guarda en este
   navegador (mismo patron que el token de GitHub), no en el catalogo.

   La seleccion para acciones en lote es SOLO de la vista de tabla (las
   tarjetas no tienen checkbox) y se limpia en cada renderProductGrid(): es
   una eleccion corta y en el momento ("filtro, selecciono, actuo"), no un
   estado que tenga sentido arrastrar entre re-renders -- evita el bug de
   actuar sobre un slug que ya no esta ni visible despues de cambiar el filtro.
   El click de un checkbox individual NO llama a renderProductGrid(): solo
   actualiza el Set y la barra, para no perder el resto de la seleccion. */
let productsView = localStorage.getItem("stike_admin_view") === "table" ? "table" : "cards";
let selectedSlugs = new Set();
let tableSort = { key: "n", dir: 1 };

function setProductsView(view) {
  productsView = view === "table" ? "table" : "cards";
  localStorage.setItem("stike_admin_view", productsView);
  $$("#view-toggle .viewtoggle-btn").forEach(b => b.classList.toggle("active", b.getAttribute("data-view") === productsView));
  renderProductGrid();
}

function updateBulkBar() {
  const bar = $("#bulk-bar");
  const n = selectedSlugs.size;
  bar.hidden = n === 0;
  if (n) $("#bulk-count").textContent = `${n} producto${n === 1 ? "" : "s"} seleccionado${n === 1 ? "" : "s"}`;
}

/* Estado de un producto para el filtro y para ordenar la columna Estado:
   un rango de urgencia (0 = lo mas urgente de revisar) mas que una
   categoria exclusiva -- un publicado puede estar tambien bajo de stock,
   por eso el filtro y el rango se calculan aparte de productStatusChip(). */
function productStatusRank(p) {
  if (stikeIsOut(p)) return 0;
  const total = stikeTotalStock(p);
  if (total > 0 && total <= STIKE_LOW_STOCK_ADMIN) return 1;
  if (p.published === false) return 2;
  if (dirtySlugs.has(p.slug)) return 3;
  return 4; // publicado, con stock sano
}
function matchesStatusFilter(p, statusFilter) {
  if (!statusFilter) return true;
  const total = stikeTotalStock(p);
  if (statusFilter === "draft") return p.published === false;
  if (statusFilter === "dirty") return dirtySlugs.has(p.slug);
  if (statusFilter === "published") return p.published !== false && !dirtySlugs.has(p.slug);
  if (statusFilter === "out") return stikeIsOut(p);
  if (statusFilter === "low") return !stikeIsOut(p) && total > 0 && total <= STIKE_LOW_STOCK_ADMIN;
  if (statusFilter === "promo") return !!p.promo;
  return true;
}

function renderProductGrid() {
  populateSubFilter();
  populateBrandFilter();
  const q = ($("#p-search").value || "").toLowerCase().trim();
  const catFilter = $("#p-filter-cat").value;
  const subFilter = $("#p-filter-sub").value;
  const brandFilter = $("#p-filter-brand").value;
  const statusFilter = $("#p-filter-status").value;
  const visible = workingCatalog
    .filter(p => !q || `${p.n} ${p.brand} ${p.sku} ${p.sub || ""}`.toLowerCase().includes(q))
    .filter(p => !catFilter || p.cat === catFilter)
    .filter(p => !subFilter || p.sub === subFilter)
    .filter(p => !brandFilter || p.brand === brandFilter)
    .filter(p => matchesStatusFilter(p, statusFilter));

  selectedSlugs = new Set();
  updateBulkBar();
  $("#product-grid").hidden = productsView !== "cards";
  $("#product-table-wrap").hidden = productsView !== "table";
  if (productsView === "table") renderProductTable(visible); else renderCards(visible);

  $("#p-count").textContent = catalogLoaded
    ? `${visible.length} de ${workingCatalog.length} producto${workingCatalog.length === 1 ? "" : "s"}`
    : "";
  populateSaleProductSelect();
}

function renderCards(visible) {
  const cards = visible.map(p => {
    const total = stikeTotalStock(p);
    const out = total <= 0;
    const low = !out && total <= STIKE_LOW_STOCK_ADMIN;
    const flags = [
      !p.published ? `<span class="pill">Borrador</span>` : "",
      out ? `<span class="pill out dot">Agotado</span>`
        : low ? `<span class="pill low dot">Bajo: ${total}</span>` : "",
      p.promo ? `<span class="pill" style="color:var(--warn)">Oferta</span>` : "",
      dirtySlugs.has(p.slug) ? `<span class="pill dirty">Sin publicar</span>` : "",
    ].filter(Boolean).join("");
    const img = (p.imgs && p.imgs[0]) ? previewSrcFor(p.imgs[0]) : stikeProductImage(p, 600);
    const stockTxt = out ? `<span style="color:var(--bad)">Sin stock</span>`
      : low ? `<span style="color:var(--warn)">${total} en stock</span>`
      : `${total} en stock`;
    return `<article class="pcard" data-slug="${p.slug}">
      <div class="thumb">
        <div class="flags">${flags}</div>
        <img src="${img}" alt="">
      </div>
      <div class="body">
        <span class="brandline">${p.brand}</span>
        <div class="title">${p.n}</div>
        <div class="subline">${stikeCategory(p.cat) ? stikeCategory(p.cat).name : p.cat}${p.sub ? " · " + p.sub : ""}</div>
        <div class="meta">
          <span class="price">${money(p.price)}</span>
          <span class="stockline">${stockTxt}</span>
        </div>
        <div class="subline mono">${p.sku}</div>
        <div class="foot">
          <button class="btn ghost sm" data-edit="${p.slug}">Editar</button>
          <button class="btn cyan sm" data-sell="${p.slug}" ${out ? "disabled title=\"Sin stock\"" : ""}>Vender</button>
        </div>
      </div>
    </article>`;
  }).join("");

  const emptyMsg = !catalogLoaded
    ? `Todavía no se cargó el catálogo — guarda tu token de GitHub en <b>Configuración</b> para verlo.`
    : "Ningún producto coincide con el filtro.";
  $("#product-grid").innerHTML = cards || `<div class="grid-empty">${emptyMsg}</div>`;
  $$("#product-grid [data-edit]").forEach(b => b.addEventListener("click", () => openEditor(b.getAttribute("data-edit"))));
  $$("#product-grid [data-sell]").forEach(b => b.addEventListener("click", () => openQuickSale(b.getAttribute("data-sell"))));
}
const STIKE_LOW_STOCK_ADMIN = 5;

/* La etiqueta y color del estado, compartida por tarjetas (implicita en
   .flags) y tabla (un solo chip .pill): un producto puede estar en
   exactamente uno de estos tres estados a la vez. */
function productStatusChip(p) {
  if (!p.published) return `<span class="pill">Borrador</span>`;
  if (dirtySlugs.has(p.slug)) return `<span class="pill dirty">Sin publicar</span>`;
  return `<span class="pill good">Publicado</span>`;
}

function sortIndicator(key) {
  if (tableSort.key !== key) return "";
  return `<span class="sort-ic">${tableSort.dir > 0 ? "▲" : "▼"}</span>`;
}

function renderProductTable(visible) {
  const catLabel = (p) => `${stikeCategory(p.cat) ? stikeCategory(p.cat).name : p.cat || ""} ${p.sub || ""}`.toLowerCase();
  const sorted = visible.slice().sort((a, b) => {
    let av, bv;
    if (tableSort.key === "n") { av = a.n.toLowerCase(); bv = b.n.toLowerCase(); }
    else if (tableSort.key === "sku") { av = (a.sku || "").toLowerCase(); bv = (b.sku || "").toLowerCase(); }
    else if (tableSort.key === "cat") { av = catLabel(a); bv = catLabel(b); }
    else if (tableSort.key === "price") { av = a.price || 0; bv = b.price || 0; }
    else if (tableSort.key === "status") { av = productStatusRank(a); bv = productStatusRank(b); }
    else { av = stikeTotalStock(a); bv = stikeTotalStock(b); }
    if (av < bv) return -1 * tableSort.dir;
    if (av > bv) return 1 * tableSort.dir;
    return 0;
  });

  $$(".ptable th[data-sort]").forEach(th => {
    th.innerHTML = th.textContent.replace(/[▲▼]/g, "").trim() + sortIndicator(th.getAttribute("data-sort"));
  });

  $("#product-table-body").innerHTML = sorted.map(p => {
    const total = stikeTotalStock(p);
    const out = total <= 0;
    const low = !out && total <= STIKE_LOW_STOCK_ADMIN;
    const img = (p.imgs && p.imgs[0]) ? previewSrcFor(p.imgs[0]) : stikeProductImage(p, 200);
    const stockTxt = out ? `<span style="color:var(--bad)">0</span>` : low ? `<span style="color:var(--warn)">${total}</span>` : total;
    return `<tr data-slug="${p.slug}">
      <td><input type="checkbox" data-pt-select="${p.slug}" ${selectedSlugs.has(p.slug) ? "checked" : ""}></td>
      <td><div class="pt-thumb"><img src="${img}" alt=""></div></td>
      <td><div class="pt-name">${p.n}</div><div class="pt-brand">${p.brand}</div></td>
      <td class="mono">${p.sku}</td>
      <td>${stikeCategory(p.cat) ? stikeCategory(p.cat).name : p.cat}${p.sub ? " · " + p.sub : ""}</td>
      <td class="num tabnum">${money(p.price)}</td>
      <td class="num tabnum">${stockTxt}</td>
      <td>${productStatusChip(p)}</td>
      <td><div class="pt-actions">
        <button class="btn ghost sm" data-edit="${p.slug}">Editar</button>
        <button class="btn cyan sm" data-sell="${p.slug}" ${out ? "disabled title=\"Sin stock\"" : ""}>Vender</button>
      </div></td>
    </tr>`;
  }).join("") || `<tr><td colspan="9" class="muted" style="padding:24px;text-align:center">Ningún producto coincide con el filtro.</td></tr>`;

  $$("#product-table-body [data-edit]").forEach(b => b.addEventListener("click", () => openEditor(b.getAttribute("data-edit"))));
  $$("#product-table-body [data-sell]").forEach(b => b.addEventListener("click", () => openQuickSale(b.getAttribute("data-sell"))));
  $$("#product-table-body [data-pt-select]").forEach(cb => cb.addEventListener("change", e => {
    const slug = e.target.getAttribute("data-pt-select");
    if (e.target.checked) selectedSlugs.add(slug); else selectedSlugs.delete(slug);
    e.target.closest("tr").classList.toggle("selected", e.target.checked);
    $("#ptable-select-all").checked = selectedSlugs.size > 0 && selectedSlugs.size === sorted.length;
    updateBulkBar();
  }));
  $("#ptable-select-all").checked = sorted.length > 0 && sorted.every(p => selectedSlugs.has(p.slug));
}

/* ============================== PRODUCT EDITOR ============================== */
function blankProduct() {
  return { slug: "", sku: "", n: "", brand: STIKE_BRANDS[0], cat: STIKE_CATEGORIES[0].slug, sub: "",
    spec: [], price: 0, cost: 0, old: null, promo: false, tag: "", imgs: [], imgColorMap: {},
    imgFit: "auto", imgZoom: 100, imgPos: "center center", published: true, units: 0, sizes: null, colors: null };
}
let editorDraft = null;
let editorIsNew = false;
let editorSlugManual = false;
let editorSkuManual = false;
let editorOriginalSlug = null; // slug que este producto ocupa HOY en workingCatalog (null = nuevo)

function openEditor(slug) {
  const existing = slug ? workingCatalog.find(p => p.slug === slug) : null;
  editorDraft = existing ? JSON.parse(JSON.stringify(existing)) : blankProduct();
  editorIsNew = !existing;
  editorOriginalSlug = existing ? existing.slug : null;
  editorSlugManual = !editorIsNew;
  editorSkuManual = !editorIsNew;
  renderEditor();
  $("#editor-overlay").classList.add("open");
}
function closeEditor() { $("#editor-overlay").classList.remove("open"); editorDraft = null; editorOriginalSlug = null; }

function subsFor(cat) { const c = STIKE_CATEGORIES.find(x => x.slug === cat); return c ? c.subs : []; }

function renderEditor() {
  const d = editorDraft;
  const isOwner = session.role === "owner";
  const catSubs = subsFor(d.cat);
  const sizeCatActive = SIZE_CATEGORIES.has(d.sub);

  $("#editor-drawer").innerHTML = `
    <div class="ed-head">
      <h3>${editorIsNew ? "Nuevo producto" : "Editar producto"}</h3>
      <button class="btn ghost sm" id="ed-close">Cerrar ✕</button>
    </div>

    <div class="ed-body">
      <h4 class="ed-section first">Identidad</h4>
      <div class="field"><label>Nombre</label><input id="ed-n" value="${escAttr(d.n)}"><div class="err" id="ed-n-err"></div></div>
      <div class="row2">
        <div class="field"><label>Marca</label>
          <select id="ed-brand">${STIKE_BRANDS.map(b => `<option ${b === d.brand ? "selected" : ""}>${b}</option>`).join("")}</select>
        </div>
        <div class="field"><label>Categoría</label>
          <select id="ed-cat">${STIKE_CATEGORIES.filter(c => c.slug !== "promo").map(c => `<option value="${c.slug}" ${c.slug === d.cat ? "selected" : ""}>${c.name}</option>`).join("")}</select>
        </div>
      </div>
      <div class="field"><label>Subcategoría</label>
        <select id="ed-sub"><option value="">— ninguna —</option>${catSubs.map(s => `<option ${s === d.sub ? "selected" : ""}>${s}</option>`).join("")}</select>
        <div class="hint" id="ed-sub-hint">${sizeCatActive ? "Esta subcategoría requiere tallas (ver abajo)." : ""}</div>
      </div>
      <div class="row2">
        <div class="field"><label>Slug (URL)</label><input id="ed-slug" value="${escAttr(d.slug)}" class="mono"><div class="err" id="ed-slug-err"></div></div>
        <div class="field"><label>SKU</label><input id="ed-sku" value="${escAttr(d.sku)}" class="mono"><div class="err" id="ed-sku-err"></div></div>
      </div>

      <h4 class="ed-section">Precio y publicación</h4>
      <div class="row2">
        <div class="field"><label>Precio (COP)</label><input id="ed-price" type="number" min="0" step="1000" value="${d.price || 0}"></div>
        ${isOwner ? `<div class="field"><label>Costo interno (COP) <span class="hint">— nunca se publica</span></label><input id="ed-cost" type="number" min="0" step="1000" value="${d.cost || 0}"></div>` : ""}
      </div>
      <div class="row3">
        <div class="field"><label><input type="checkbox" id="ed-promo" ${d.promo ? "checked" : ""}> En promo</label></div>
        <div class="field" id="ed-old-field" style="${d.promo ? "" : "display:none"}"><label>Precio anterior</label><input id="ed-old" type="number" min="0" step="1000" value="${d.old || ""}"></div>
        <div class="field"><label>Etiqueta</label><select id="ed-tag"><option value="">— ninguna —</option><option value="new" ${d.tag === "new" ? "selected" : ""}>Nuevo</option></select></div>
      </div>
      <div class="field"><label><input type="checkbox" id="ed-published" ${d.published !== false ? "checked" : ""}> Publicado (visible en la tienda)</label></div>

      <h4 class="ed-section">Especificaciones</h4>
      <div class="field"><label>Una por línea, "Clave: valor"</label>
        <textarea id="ed-spec" rows="4">${(d.spec || []).join("\n")}</textarea>
      </div>

      <h4 class="ed-section">Stock</h4>
      <div class="card" style="padding:14px;margin:0 0 4px">
        <div class="err" id="ed-stock-err"></div>
        <div id="ed-sizes-box"></div>
        <div id="ed-colors-box"></div>
      </div>

      <h4 class="ed-section">Fotos <span class="hint" style="text-transform:none;letter-spacing:0">— la primera es la portada</span></h4>
      <div class="card" style="padding:14px;margin:0">
        <div class="photogrid" id="ed-photogrid"></div>
        <label class="uploadbox" style="margin-top:10px;display:block">
          + Agregar fotos<input type="file" id="ed-photo-input" accept="image/*" multiple style="display:none">
        </label>
        <div id="ed-cover-crop"></div>
      </div>
    </div>

    <div class="ed-foot">
      <button class="btn cyan" id="ed-save">Guardar en el borrador</button>
      ${!editorIsNew ? `<button class="btn bad" id="ed-delete">Eliminar producto</button>` : ""}
    </div>
  `;

  $("#ed-close").addEventListener("click", closeEditor);
  $("#ed-n").addEventListener("input", e => { d.n = e.target.value; validateNameField(); if (!editorSlugManual) { $("#ed-slug").value = d.slug = uniqueSlug(slugify(d.n), editorOriginalSlug); validateSlugField(); } });
  $("#ed-brand").addEventListener("change", e => { d.brand = e.target.value; if (editorIsNew && !editorSkuManual) { d.sku = generateSku(d.cat, d.brand); $("#ed-sku").value = d.sku; validateSkuField(); } });
  $("#ed-cat").addEventListener("change", e => { d.cat = e.target.value; d.sub = ""; if (editorIsNew && !editorSkuManual) d.sku = generateSku(d.cat, d.brand); renderEditor(); });
  $("#ed-sub").addEventListener("change", e => { d.sub = e.target.value; renderStockEditor(); $("#ed-sub-hint").textContent = SIZE_CATEGORIES.has(d.sub) ? "Esta subcategoría requiere tallas (ver abajo)." : ""; });
  $("#ed-slug").addEventListener("input", e => { editorSlugManual = true; d.slug = slugify(e.target.value); e.target.value = d.slug; validateSlugField(); });
  $("#ed-sku").addEventListener("input", e => { editorSkuManual = true; d.sku = e.target.value.toUpperCase(); e.target.value = d.sku; validateSkuField(); });
  $("#ed-price").addEventListener("input", e => { d.price = parseInt(e.target.value) || 0; });
  if (isOwner) $("#ed-cost").addEventListener("input", e => { d.cost = parseInt(e.target.value) || 0; });
  $("#ed-promo").addEventListener("change", e => { d.promo = e.target.checked; $("#ed-old-field").style.display = d.promo ? "" : "none"; });
  $("#ed-old").addEventListener("input", e => { d.old = parseInt(e.target.value) || null; });
  $("#ed-tag").addEventListener("change", e => { d.tag = e.target.value; });
  $("#ed-published").addEventListener("change", e => { d.published = e.target.checked; });
  $("#ed-spec").addEventListener("input", e => { d.spec = e.target.value.split("\n").map(s => s.trim()).filter(Boolean); });

  if (editorIsNew && !d.slug) { d.slug = uniqueSlug(slugify(d.n || "producto"), editorOriginalSlug); $("#ed-slug").value = d.slug; }
  if (editorIsNew && !d.sku) { d.sku = generateSku(d.cat, d.brand); $("#ed-sku").value = d.sku; }

  $("#ed-photo-input").addEventListener("change", e => { addPhotosToDraft(Array.from(e.target.files || [])); e.target.value = ""; });
  $("#ed-save").addEventListener("click", saveEditorDraft);
  const delBtn = $("#ed-delete"); if (delBtn) delBtn.addEventListener("click", deleteFromEditor);

  renderStockEditor();
  renderPhotoGrid();
  validateSlugField();
  validateSkuField();
  disableAutofill($("#editor-drawer")); // el drawer se genera por JS en cada apertura
}

function escAttr(s) { return String(s == null ? "" : s).replace(/"/g, "&quot;"); }
/* A diferencia de escAttr (solo comillas, para atributos), esto escapa
   tambien < y > -- hace falta en todo lo que venga de datos escritos por
   un cliente anonimo en el carrito (nombre, direccion, notas de envio) y
   se vaya a mostrar como HTML aca, nunca antes necesario porque el resto
   del panel solo mostraba datos que el propio dueno escribio. */
function escHtml(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function validateNameField() {
  $("#ed-n-err").textContent = editorDraft.n ? "" : "El nombre es obligatorio.";
  return !!editorDraft.n;
}
function validateSlugField() {
  const taken = editorDraft.slug && isSlugTaken(editorDraft.slug, editorOriginalSlug);
  $("#ed-slug-err").textContent = editorDraft.slug ? (taken ? "Ese slug ya lo usa otro producto en tu catálogo local." : "") : "El slug es obligatorio.";
  return !taken && !!editorDraft.slug;
}
function validateSkuField() {
  const taken = editorDraft.sku && isSkuTaken(editorDraft.sku, editorOriginalSlug);
  $("#ed-sku-err").textContent = editorDraft.sku ? (taken ? "Ese SKU ya lo usa otro producto en tu catálogo local." : "") : "El SKU es obligatorio.";
  return !taken && !!editorDraft.sku;
}

/* ---- Tallas y colores: pools de stock INDEPENDIENTES (ver stikeStockFor) ---- */
function renderStockEditor() {
  const d = editorDraft;
  const sizeRequired = SIZE_CATEGORIES.has(d.sub);

  // ---- tallas: obligatorias en SIZE_CATEGORIES, opcionales en cualquier otro producto ----
  if (sizeRequired && (!d.sizes || !d.sizes.length)) {
    const range = stikeSizeRangeFor(d.sub) || ["Única"];
    d.sizes = range.map(v => ({ v, u: 0 }));
  }
  const hasSizes = !!(d.sizes && d.sizes.length);
  if (!hasSizes) {
    $("#ed-sizes-box").innerHTML = `
      <label style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="ed-has-sizes"> Este producto viene en varias tallas o medidas</label>`;
    $("#ed-has-sizes").addEventListener("change", () => { d.sizes = [{ v: "Única", u: 0 }]; renderStockEditor(); });
  } else {
    $("#ed-sizes-box").innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:12.5px;text-transform:uppercase;color:var(--muted)">Tallas${sizeRequired ? ` (obligatorio en "${d.sub}")` : ""}</b>
      <span style="display:flex;gap:6px">${sizeRequired ? "" : `<button class="btn ghost sm" id="ed-size-off" type="button">Quitar tallas</button>`}<button class="btn ghost sm" id="ed-size-add" type="button">+ talla</button></span></div>
      <table class="stockTable"><tbody>${d.sizes.map((s, i) => `
        <tr><td style="width:40%"><input data-size-v="${i}" value="${escAttr(s.v)}"></td>
        <td><input data-size-u="${i}" type="number" min="0" value="${s.u}"></td>
        <td style="width:30px"><button class="btn ghost sm" data-size-rm="${i}" type="button">✕</button></td></tr>`).join("")}</tbody></table>`;
    $("#ed-size-add").addEventListener("click", () => { d.sizes.push({ v: "Nueva", u: 0 }); renderStockEditor(); });
    $$("#ed-sizes-box [data-size-v]").forEach(inp => inp.addEventListener("input", e => { d.sizes[+e.target.getAttribute("data-size-v")].v = e.target.value; }));
    $$("#ed-sizes-box [data-size-u]").forEach(inp => inp.addEventListener("input", e => { d.sizes[+e.target.getAttribute("data-size-u")].u = Math.max(0, parseInt(e.target.value) || 0); }));
    $$("#ed-sizes-box [data-size-rm]").forEach(btn => btn.addEventListener("click", () => { d.sizes.splice(+btn.getAttribute("data-size-rm"), 1); if (!d.sizes.length) d.sizes = null; renderStockEditor(); }));
    const offBtn = $("#ed-size-off"); if (offBtn) offBtn.addEventListener("click", () => { d.sizes = null; renderStockEditor(); });
  }

  // ---- colores: disponibles en cualquier producto, desde 1 color ----
  const hasColors = !!(d.colors && d.colors.length);
  $("#ed-colors-box").innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:${sizeRequired ? "14px" : "0"}">
      <label style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="ed-has-colors" ${hasColors ? "checked" : ""}> Indicar color(es) del producto</label>
    </div>
    <div id="ed-colors-table" style="${hasColors ? "" : "display:none"}">
      <table class="stockTable"><tbody>${(d.colors || []).map((c, i) => `
        <tr><td style="width:40%"><input data-color-v="${i}" value="${escAttr(c.v)}"></td>
        <td><input data-color-u="${i}" type="number" min="0" value="${c.u}"></td>
        <td style="width:30px"><button class="btn ghost sm" data-color-rm="${i}" type="button">✕</button></td></tr>`).join("")}</tbody></table>
      <button class="btn ghost sm" id="ed-color-add" type="button">+ color</button>
    </div>
    ${!sizeRequired ? `<div class="field" id="ed-units-field" style="margin-top:12px;${hasColors ? "display:none" : ""}"><label>Unidades</label><input id="ed-units" type="number" min="0" value="${d.units || 0}"></div>` : ""}
  `;
  $("#ed-has-colors").addEventListener("change", e => {
    if (e.target.checked) { if (!d.colors || !d.colors.length) d.colors = [{ v: "Negro", u: 0 }]; }
    else { d.colors = null; }
    renderStockEditor();
  });
  const addColorBtn = $("#ed-color-add"); if (addColorBtn) addColorBtn.addEventListener("click", () => { d.colors.push({ v: "Nuevo color", u: 0 }); renderStockEditor(); renderPhotoGrid(); });
  $$("#ed-colors-table [data-color-v]").forEach(inp => inp.addEventListener("input", e => { d.colors[+e.target.getAttribute("data-color-v")].v = e.target.value; renderPhotoGrid(); }));
  $$("#ed-colors-table [data-color-u]").forEach(inp => inp.addEventListener("input", e => { d.colors[+e.target.getAttribute("data-color-u")].u = Math.max(0, parseInt(e.target.value) || 0); }));
  $$("#ed-colors-table [data-color-rm]").forEach(btn => btn.addEventListener("click", () => { d.colors.splice(+btn.getAttribute("data-color-rm"), 1); if (!d.colors.length) d.colors = null; renderStockEditor(); renderPhotoGrid(); }));
  const unitsInp = $("#ed-units"); if (unitsInp) unitsInp.addEventListener("input", e => { d.units = Math.max(0, parseInt(e.target.value) || 0); });
}

/* ---- Fotos: nombre aleatorio (nunca por posicion), reorden, portada, tag de color ---- */
function addPhotosToDraft(files) {
  const d = editorDraft;
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    /* Siempre .jpg: compressImageFile reencoda TODO a JPEG, asi que un PNG
       guardado como .png tendria bytes JPEG adentro. El navegador lo
       adivina y lo muestra igual, pero el rastreador de WhatsApp o
       Facebook que lee el og:image no tiene por que perdonarlo. */
    const path = `assets/img/products/${randomFilename("jpg")}`;
    pendingUploads.set(path, file);
    d.imgs = d.imgs || [];
    d.imgs.push(path);
  }
  renderPhotoGrid();
}
function renderPhotoGrid() {
  const d = editorDraft;
  const imgs = d.imgs || [];
  const colorOpts = (d.colors || []).map(c => c.v);
  $("#ed-photogrid").innerHTML = imgs.map((path, i) => `
    <div class="pthumb ${i === 0 ? "cover" : ""}" draggable="true" data-idx="${i}">
      ${i === 0 ? `<span class="cov-badge">Portada</span>` : ""}
      <img src="${previewSrcFor(path)}" alt="">
      <button class="edit" type="button" data-edit-photo="${i}" title="Editar (girar, recortar, fondo, brillo...)">✎</button>
      <button class="rm" type="button" data-rm-photo="${i}" title="Quitar">✕</button>
      ${colorOpts.length ? `<select data-photo-color="${i}">
        <option value="">— color —</option>
        ${colorOpts.map(c => `<option value="${escAttr(c)}" ${d.imgColorMap && d.imgColorMap[path] === c ? "selected" : ""}>${c}</option>`).join("")}
      </select>` : ""}
    </div>`).join("") || `<p class="muted" style="grid-column:1/-1;font-size:12.5px">Sin fotos todavía — se usará un placeholder genérico.</p>`;

  $$("#ed-photogrid [data-rm-photo]").forEach(b => b.addEventListener("click", () => {
    const i = +b.getAttribute("data-rm-photo");
    const [removed] = d.imgs.splice(i, 1);
    if (pendingUploads.has(removed)) pendingUploads.delete(removed); // nunca se llegó a subir, se libera el nombre reservado
    if (d.imgColorMap) delete d.imgColorMap[removed];
    renderPhotoGrid();
  }));
  $$("#ed-photogrid [data-edit-photo]").forEach(b => b.addEventListener("click", () => {
    const i = +b.getAttribute("data-edit-photo");
    const path = d.imgs[i];
    /* openPhotoEditor no sabe nada de pendingUploads: solo pide una URL y
       devuelve un archivo editado. Guardarlo en pendingUploads con la
       MISMA ruta hace que uploadPendingPhotos lo suba al publicar, sea una
       foto recien agregada o una que ya estaba en GitHub (ver ahi el
       manejo de sha/cache-bust para ese segundo caso). */
    window.openPhotoEditor(previewSrcFor(path), {
      onSave(file) {
        pendingUploads.set(path, file);
        renderPhotoGrid();
      },
    });
  }));
  $$("#ed-photogrid [data-photo-color]").forEach(sel => sel.addEventListener("change", e => {
    const i = +e.target.getAttribute("data-photo-color");
    const path = d.imgs[i];
    d.imgColorMap = d.imgColorMap || {};
    if (e.target.value) d.imgColorMap[path] = e.target.value; else delete d.imgColorMap[path];
  }));
  $$("#ed-photogrid .pthumb").forEach(el => {
    el.addEventListener("dragstart", e => { e.dataTransfer.setData("text/plain", el.getAttribute("data-idx")); });
    el.addEventListener("dragover", e => { e.preventDefault(); el.classList.add("dragover"); });
    el.addEventListener("dragleave", () => el.classList.remove("dragover"));
    el.addEventListener("drop", e => {
      e.preventDefault(); el.classList.remove("dragover");
      const from = +e.dataTransfer.getData("text/plain"), to = +el.getAttribute("data-idx");
      if (from === to || isNaN(from)) return;
      const [moved] = d.imgs.splice(from, 1);
      d.imgs.splice(to, 0, moved);
      renderPhotoGrid();
    });
  });

  renderCoverCrop();
}
const CROP_POSITIONS = ["top left", "top center", "top right", "center left", "center center", "center right", "bottom left", "bottom center", "bottom right"];
function renderCoverCrop() {
  const d = editorDraft;
  const box = $("#ed-cover-crop");
  if (!d.imgs || !d.imgs.length) { box.innerHTML = ""; return; }
  const cover = d.imgs[0];
  const zoom = d.imgZoom || 100, pos = d.imgPos || "center center";
  box.innerHTML = `
    <h4 style="font-size:12.5px;text-transform:uppercase;color:var(--muted);margin:14px 0 8px">Encuadre de portada</h4>
    <div class="cropbox">
      <div style="width:110px;height:110px;border-radius:10px;overflow:hidden;border:1px solid var(--line);background:#f3f3f3">
        <img id="crop-preview" src="${previewSrcFor(cover)}" style="width:100%;height:100%;object-fit:cover;object-position:${pos};transform:scale(${zoom / 100})">
      </div>
      <div>
        <label class="hint">Zoom ${zoom}%</label>
        <input type="range" id="crop-zoom" min="100" max="200" value="${zoom}" style="width:160px;display:block">
        <div class="crop-grid" id="crop-grid" style="margin-top:8px">
          ${CROP_POSITIONS.map(p => `<button type="button" data-pos="${p}" class="${p === pos ? "active" : ""}" title="${p}"></button>`).join("")}
        </div>
      </div>
    </div>`;
  $("#crop-zoom").addEventListener("input", e => { d.imgZoom = parseInt(e.target.value); const img = $("#crop-preview"); if (img) img.style.transform = `scale(${d.imgZoom / 100})`; box.querySelector("label.hint").textContent = `Zoom ${d.imgZoom}%`; });
  $$("#crop-grid button").forEach(b => b.addEventListener("click", () => {
    d.imgPos = b.getAttribute("data-pos");
    $$("#crop-grid button").forEach(o => o.classList.remove("active"));
    b.classList.add("active");
    const img = $("#crop-preview"); if (img) img.style.objectPosition = d.imgPos;
  }));
}

function saveEditorDraft() {
  const d = editorDraft;
  const nameOk = validateNameField(), slugOk = validateSlugField(), skuOk = validateSkuField();
  const stockErr = $("#ed-stock-err");
  stockErr.textContent = "";
  let stockOk = true;
  if (SIZE_CATEGORIES.has(d.sub) && (!d.sizes || !d.sizes.length)) { stockErr.textContent = `"${d.sub}" requiere al menos una talla.`; stockOk = false; }

  /* Sin alert() bloqueante: el error queda escrito junto al campo (igual
     que slug/sku ya hacian) y el foco salta al primero con problema, para
     que quien esta cargando 50 productos seguidos no tenga que leer un
     popup nativo cada vez que se le olvida un campo. */
  if (!nameOk) { $("#ed-n").focus(); return; }
  if (!slugOk) { $("#ed-slug").focus(); return; }
  if (!skuOk) { $("#ed-sku").focus(); return; }
  if (!stockOk) { stockErr.scrollIntoView({ block: "center", behavior: "smooth" }); return; }

  const idx = editorOriginalSlug ? workingCatalog.findIndex(p => p.slug === editorOriginalSlug) : -1;
  if (idx >= 0) workingCatalog[idx] = d; else workingCatalog.push(d);
  if (editorOriginalSlug && editorOriginalSlug !== d.slug) {
    // renamedFrom siempre apunta directo al slug remoto real (nunca encadena
    // renombres dentro de la misma sesion) para que findOwnBaselineSlug sea
    // un solo salto.
    const trueBaseline = findOwnBaselineSlug(editorOriginalSlug);
    renamedFrom.delete(editorOriginalSlug);
    if (trueBaseline) renamedFrom.set(d.slug, trueBaseline);
    dirtySlugs.delete(editorOriginalSlug);
  }
  markDirty(d.slug);
  closeEditor();
  renderProductGrid();
}
function deleteFromEditor() {
  const d = editorDraft;
  if (!confirm(`¿Eliminar "${d.n}"? Se quitará de la tienda al publicar.`)) return;
  // El slug remoto a borrar es el de la ULTIMA version publicada de este
  // producto, no necesariamente el que se ve ahora mismo si esta sesion ya
  // le habia cambiado el slug (ver renamedFrom).
  const ownSlug = findOwnBaselineSlug(editorOriginalSlug);
  workingCatalog = workingCatalog.filter(p => p.slug !== editorOriginalSlug);
  if (ownSlug) deletedSlugs.add(ownSlug); // si es null, era un producto nuevo de esta sesion: no llego a publicarse, no hay nada que borrar remoto
  dirtySlugs.delete(editorOriginalSlug);
  dirtySlugs.delete(d.slug);
  renamedFrom.delete(editorOriginalSlug);
  closeEditor();
  updateDirtyUI();
  renderProductGrid();
}

/* ============================== VENTAS ===================================== */
function populateSaleProductSelect() {
  const sel = $("#sale-product");
  const prev = sel.value;
  sel.innerHTML = workingCatalog.filter(p => p.published !== false).map(p => `<option value="${p.slug}">${p.n} (${p.sku})</option>`).join("");
  if (prev && workingCatalog.some(p => p.slug === prev)) sel.value = prev;
  onSaleProductChange();
}
function onSaleProductChange() {
  const p = workingCatalog.find(x => x.slug === $("#sale-product").value);
  $("#sale-price").value = p ? p.price : "";
  const sizeField = $("#sale-size-field"), colorField = $("#sale-color-field");
  sizeField.style.display = p && p.sizes ? "" : "none";
  colorField.style.display = p && p.colors ? "" : "none";
  if (p && p.sizes) $("#sale-size").innerHTML = p.sizes.map(s => `<option value="${escAttr(s.v)}" ${s.u <= 0 ? "disabled" : ""}>${s.v} (${s.u} disp.)</option>`).join("");
  if (p && p.colors) $("#sale-color").innerHTML = p.colors.map(c => `<option value="${escAttr(c.v)}" ${c.u <= 0 ? "disabled" : ""}>${c.v} (${c.u} disp.)</option>`).join("");
  updateSaleStockHint();
}
function updateSaleStockHint() {
  const p = workingCatalog.find(x => x.slug === $("#sale-product").value);
  if (!p) { $("#sale-stock-hint").textContent = ""; return; }
  const size = p.sizes ? $("#sale-size").value : undefined;
  const color = p.colors ? $("#sale-color").value : undefined;
  const stock = stikeStockFor(p, size, color);
  $("#sale-stock-hint").textContent = stock == null ? "Elige talla/color para ver el stock disponible." : `Stock disponible para esa combinación: ${stock}`;
}
/* Nucleo de "registrar venta": valida stock, lo descuenta, arma la entrada
   del log y la persiste (o la deja solo en memoria en modo demo). Lo usan
   las DOS entradas: el formulario del panel Ventas y el boton "Vender" de
   cada tarjeta del inventario. Devuelve true si la venta se registro. */
/* Descuenta una venta de un producto, en la misma pool en que se vendio.
   Espejo de stike_decrement_stock (api/_lib.php): talla y color son pools
   independientes; sin variantes se descuenta de units. */
function decrementStock(p, size, color, qty) {
  let hit = false;
  if (size && p.sizes) { const row = p.sizes.find(s => s.v === size); if (row) { row.u = Math.max(0, (row.u || 0) - qty); hit = true; } }
  if (color && p.colors) { const row = p.colors.find(c => c.v === color); if (row) { row.u = Math.max(0, (row.u || 0) - qty); hit = true; } }
  if (!hit && !(p.sizes && p.sizes.length) && !(p.colors && p.colors.length) && typeof p.units === "number") p.units = Math.max(0, p.units - qty);
}
const STOCK_FIELDS = ["units", "sizes", "colors"];

/* Escribe en GitHub el descuento de stock de una o varias lineas, SIEMPRE
   sobre el catalogo mas reciente (no sobre la copia cargada en el panel,
   que puede estar vieja si otra persona vendio o edito mientras tanto).
   Revalida el stock contra esa version fresca y reintenta si hay choque.
   No pasa por publishCatalog: una venta no puede quedar frenada porque OTRO
   producto tenga un error de validacion. Devuelve el catalogo escrito. */
async function commitStockDelta(lines, message) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const fresh = await ghGetFile(CONFIG.paths.catalog);
    if (!fresh) throw new Error("no se pudo leer el catálogo");
    const arr = parseCatalogFile(fresh.text);
    for (const l of lines) {
      const row = arr.find(r => r.slug === l.slug);
      if (!row) throw Object.assign(new Error(`El producto "${l.name || l.slug}" ya no existe en el catálogo.`), { userFacing: true });
      if (l.check) {
        const avail = stikeStockFor(row, l.size || undefined, l.color || undefined);
        if (avail != null && l.qty > avail) {
          const local = workingCatalog.find(x => x.slug === l.slug);
          if (local) STOCK_FIELDS.forEach(k => { if (row[k] === undefined) delete local[k]; else local[k] = JSON.parse(JSON.stringify(row[k])); });
          renderProductGrid();
        }
        if (avail != null && l.qty > avail) throw Object.assign(new Error(`Solo quedan ${avail} unidades de "${row.n}" para esa combinación (alguien vendió mientras tanto).`), { userFacing: true });
      }
      decrementStock(row, l.size, l.color, l.qty);
    }
    try {
      await ghPutOnce(CONFIG.paths.catalog, b64EncodeText(serializeCatalogFile(arr)), message, fresh.sha);
    } catch (e) {
      if (e.conflict && attempt < 6) { await sleep(backoffMs(Math.min(attempt, 4))); continue; }
      throw e;
    }
    // Reflejar en el panel SOLO los campos de stock (no pisa ediciones sin publicar).
    for (const l of lines) {
      const row = arr.find(r => r.slug === l.slug);
      const local = workingCatalog.find(x => x.slug === l.slug);
      const base = baseline.get(l.slug);
      STOCK_FIELDS.forEach(k => {
        const v = row[k] === undefined ? undefined : JSON.parse(JSON.stringify(row[k]));
        if (local) { if (v === undefined) delete local[k]; else local[k] = JSON.parse(JSON.stringify(v)); }
        if (base) { if (v === undefined) delete base[k]; else base[k] = v; }
      });
    }
    return arr;
  }
}

/* Nucleo de "registrar venta": lo usan las DOS entradas (formulario de
   Ventas y boton "Vender"). Orden a proposito: primero el STOCK, despues el
   log. Si el stock no se pudo escribir, la venta NO se registra (nada de
   ventas anotadas con unidades sin descontar). Devuelve la entrada o false. */
let saleInFlight = false;
async function applySale(p, opts) {
  if (!p || saleInFlight) return false;
  const size = (p.sizes && p.sizes.length) ? (opts.size || null) : null;
  const color = (p.colors && p.colors.length) ? (opts.color || null) : null;
  const qty = Math.max(1, parseInt(opts.qty) || 1);
  const unitPrice = Math.max(0, parseInt(opts.unitPrice) || p.price);
  const stock = stikeStockFor(p, size || undefined, color || undefined);
  if (stock != null && qty > stock) { alert(`Solo hay ${stock} unidades disponibles para esa combinación.`); return false; }

  const discount = opts.customer ? Math.min(unitPrice * qty, opts.customer.discount || 0) : 0;
  const entry = { ts: new Date().toISOString(), slug: p.slug, name: p.n, size: size || null, color: color || null, qty, unitPrice, total: unitPrice * qty - discount, admin: session.email, source: "tienda" };
  if (discount) entry.discount = discount;

  saleInFlight = true;
  setPublishing(true);
  showStatus([{ text: `Descontando stock de ${p.n}...`, cls: "now" }]);
  try {
    const merged = await commitStockDelta([{ slug: p.slug, name: p.n, size, color, qty, check: true }], `Stock: venta en tienda ${qty}x ${p.n}`);
    if (opts.customer) {
      entry.invoice = nextInvoiceNumber();
      entry.payment = opts.customer.pay;
      saveInvoiceCustomer(entry.invoice, opts.customer);
    }
    showStatus([{ text: "Stock descontado. Registrando la venta...", cls: "now" }]);
    try {
      salesLogGh = await appendJsonLog(CONFIG.paths.salesLog, [entry], `Venta: ${qty}x ${p.n}`);
      rebuildSalesLog();
    } catch (e) {
      // El stock YA quedo descontado: se avisa fuerte para no repetir la venta.
      showStatus([{ text: `El stock se descontó, pero la venta no quedó en el historial (${e.message}). NO la vuelvas a registrar: avísale a soporte.`, cls: "bad" }]);
      alert("El stock se descontó, pero la venta no quedó en el historial. No la vuelvas a registrar.");
    }
    regenerateProductPages(merged, new Set([p.slug]), `Stock: venta en tienda ${qty}x ${p.n}`).catch(e => console.warn("ficha no regenerada", e));
    showStatus([{ text: `✔ Venta registrada: ${qty}x ${p.n}. Stock actualizado.`, cls: "ok" }]);
  } catch (e) {
    showStatus([{ text: "La venta NO se registró y el stock no cambió: " + e.message, cls: "bad" }]);
    if (e.userFacing) alert(e.message);
    return false;
  } finally {
    saleInFlight = false;
    setPublishing(false);
  }
  renderSalesTab();
  renderKpis();
  renderProductGrid();
  if (opts.customer) writeInvoice(opts.invWin, entry, opts.customer);
  return entry;
}

/* ===================== Ventas online: conciliacion de stock ===============
   El servidor descuenta el stock de cada venta de Wompi en GitHub y la anota
   en data/stock-applied.json. Si no pudo (GitHub caido, sin GITHUB_TOKEN en
   el hosting), la venta igual quedo guardada: al abrir el panel se descuenta
   aca lo que falte, una sola vez (mismo ledger). */
const ONLINE_STOCK_SINCE = "2026-10-15T00:00:00Z";
let reconcilingOnline = false;
async function reconcileOnlineStock() {
  if (reconcilingOnline || !session.pat || !salesLogOnline.length) return;
  reconcilingOnline = true;
  try {
    const ledgerFile = await ghGetFile("data/stock-applied.json");
    const ledger = new Set(ledgerFile ? JSON.parse(ledgerFile.text) : []);
    const byRef = new Map();
    salesLogOnline.forEach(s => {
      if (s.source !== "wompi" || !s.orderRef || s.slug === "pago-sin-pedido") return;
      // Ventas anteriores a esta conciliacion: su stock se manejaba a mano.
      if (s.ts < ONLINE_STOCK_SINCE) return;
      // Recien llegada: el servidor puede estar descontandola en este momento.
      if (Date.now() - Date.parse(s.ts) < 120000) return;
      const key = "wompi:" + s.orderRef;
      if (ledger.has(key)) return;
      if (!byRef.has(key)) byRef.set(key, []);
      byRef.get(key).push(s);
    });
    for (const [key, lines] of byRef) {
      showStatus([{ text: `Descontando stock de una venta online (${key.slice(6)})...`, cls: "now" }]);
      await commitStockDelta(lines.map(s => ({ slug: s.slug, name: s.name, size: s.size || null, color: s.color || null, qty: s.qty })), `[Panel] Stock: venta online ${key}`);
      for (let attempt = 1; attempt <= 4; attempt++) {
        const f = await ghGetFile("data/stock-applied.json");
        const arr = f ? JSON.parse(f.text) : [];
        if (arr.includes(key)) break;
        arr.push(key);
        try { await ghPutOnce("data/stock-applied.json", b64EncodeText(JSON.stringify(arr, null, 2) + "\n"), `[Panel] Stock aplicado: ${key}`, f ? f.sha : undefined); break; }
        catch (e) { if (e.conflict && attempt < 4) { await sleep(backoffMs(attempt)); continue; } throw e; }
      }
    }
    if (byRef.size) { renderProductGrid(); showStatus([{ text: `✔ Stock actualizado con ${byRef.size} venta(s) online.`, cls: "ok" }]); }
  } catch (e) {
    showStatus([{ text: "No se pudo descontar el stock de ventas online: " + e.message, cls: "bad" }]);
  } finally {
    reconcilingOnline = false;
  }
}

/* Entrada 1: formulario completo del panel Ventas. */
async function registrarVenta() {
  const p = workingCatalog.find(x => x.slug === $("#sale-product").value);
  if (!p) return;
  const customer = readCustomerFields("sale");
  const invWin = customer ? openInvoiceWindow() : null;
  const ok = await applySale(p, {
    size: p.sizes ? $("#sale-size").value : null,
    color: p.colors ? $("#sale-color").value : null,
    qty: $("#sale-qty").value,
    unitPrice: $("#sale-price").value,
    customer, invWin,
  });
  if (!ok && invWin) invWin.close();
}

/* ===================== Entrada 2: venta rapida desde la tarjeta ==============
   Un boton "Vender" en cada producto del inventario abre este modal chico con
   talla/color/cantidad/precio ya resueltos para ese producto: es el camino
   corto para el dia a dia del mostrador, sin pasar por el panel Ventas.
   ========================================================================= */
let quickSaleSlug = null;

function openQuickSale(slug) {
  if (!workingCatalog.find(x => x.slug === slug)) return;
  quickSaleSlug = slug;
  renderQuickSale();
  $("#sale-overlay").classList.add("open");
}
function closeQuickSale() {
  $("#sale-overlay").classList.remove("open");
  quickSaleSlug = null;
}

function renderQuickSale() {
  const p = workingCatalog.find(x => x.slug === quickSaleSlug);
  if (!p) return;
  const sizes = p.sizes || [], colors = p.colors || [];
  const img = (p.imgs && p.imgs[0]) ? previewSrcFor(p.imgs[0]) : stikeProductImage(p, 200);
  const opt = (row, agotadoTxt) =>
    `<option value="${escAttr(row.v)}" ${row.u <= 0 ? "disabled" : ""}>${row.v}${row.u <= 0 ? ` (${agotadoTxt})` : ` — ${row.u} disp.`}</option>`;

  $("#sale-modal").innerHTML = `
    <div class="qs-head">
      <img src="${img}" alt="">
      <div>
        <div style="font-size:11px;letter-spacing:1.3px;text-transform:uppercase;color:var(--accent)">${p.brand}</div>
        <h3>${p.n}</h3>
        <div class="mono muted" style="font-size:11.5px">${p.sku}</div>
      </div>
    </div>
    ${sizes.length ? `<div class="field"><label>Talla</label><select id="qs-size">${sizes.map(s => opt(s, "agotada")).join("")}</select></div>` : ""}
    ${colors.length ? `<div class="field"><label>Color</label><select id="qs-color">${colors.map(c => opt(c, "agotado")).join("")}</select></div>` : ""}
    <div class="grid-2">
      <div class="field"><label>Cantidad</label><input id="qs-qty" type="number" min="1" value="1"></div>
      <div class="field"><label>Precio unitario</label><input id="qs-price" type="number" min="0" step="1000" value="${p.price}"></div>
    </div>
    <p class="hint muted" id="qs-stock"></p>
    ${customerFieldsHtml("qs")}
    <div class="qs-total"><span class="muted">Total</span><b id="qs-total">${money(p.price)}</b></div>
    <div style="display:flex;gap:10px;margin-top:16px">
      <button class="btn ghost" id="qs-cancel" style="flex:1">Cancelar</button>
      <button class="btn cyan" id="qs-confirm" style="flex:2">Registrar venta</button>
    </div>`;

  ["#qs-size", "#qs-color", "#qs-qty", "#qs-price", "#qs-c-disc", "#qs-inv"].forEach(sel => {
    const el = $(sel);
    if (el) { el.addEventListener("change", refreshQuickSale); el.addEventListener("input", refreshQuickSale); }
  });
  wireCustomerFields("qs");
  $("#qs-cancel").addEventListener("click", closeQuickSale);
  $("#qs-confirm").addEventListener("click", confirmQuickSale);
  disableAutofill($("#sale-modal"));
  refreshQuickSale();
}

function refreshQuickSale() {
  const p = workingCatalog.find(x => x.slug === quickSaleSlug);
  if (!p) return;
  const size = $("#qs-size") ? $("#qs-size").value : null;
  const color = $("#qs-color") ? $("#qs-color").value : null;
  const stock = stikeStockFor(p, size, color);
  const qtyEl = $("#qs-qty");
  let qty = Math.max(1, parseInt(qtyEl.value) || 1);
  if (stock != null && qty > stock) { qty = Math.max(1, stock); qtyEl.value = qty; }  // nunca dejar pedir mas de lo que hay
  if (stock != null) qtyEl.max = Math.max(1, stock);

  const unitPrice = Math.max(0, parseInt($("#qs-price").value) || 0);
  const disc = ($("#qs-inv") && $("#qs-inv").checked) ? Math.max(0, parseInt(($("#qs-c-disc") || {}).value) || 0) : 0;
  $("#qs-total").textContent = money(Math.max(0, unitPrice * qty - disc));
  $("#qs-stock").textContent = stock == null ? "" :
    stock <= 0 ? "Sin stock para esa combinación." : `Stock disponible: ${stock}`;
  $("#qs-confirm").disabled = (stock != null && stock <= 0);
}

async function confirmQuickSale() {
  const p = workingCatalog.find(x => x.slug === quickSaleSlug);
  if (!p) return;
  $("#qs-confirm").disabled = true;
  const customer = readCustomerFields("qs");
  const invWin = customer ? openInvoiceWindow() : null;
  const ok = await applySale(p, {
    size: $("#qs-size") ? $("#qs-size").value : null,
    color: $("#qs-color") ? $("#qs-color").value : null,
    qty: $("#qs-qty").value,
    unitPrice: $("#qs-price").value,
    customer, invWin,
  });
  if (ok) closeQuickSale();
  else { if (invWin) invWin.close(); $("#qs-confirm").disabled = false; }
}

function renderOnlineSalesNote() {
  const el = $("#sales-online-note");
  if (!el) return;
  if (demoMode) { el.style.display = "none"; return; }
  el.style.display = "";
  const st = onlineSalesState;
  if (!st.configured) {
    el.style.color = "var(--muted)";
    el.textContent = "Ventas online (Wompi): sin conectar. Pega la clave del servidor en Configuración para verlas aquí.";
  } else if (!st.ok) {
    el.style.color = "var(--bad)";
    el.textContent = `No se pudieron leer las ventas online: ${st.error}. Se muestran solo las registradas a mano.`;
  } else {
    el.style.color = "var(--muted)";
    el.textContent = `Ventas online conectadas (${salesLogOnline.length} registro${salesLogOnline.length === 1 ? "" : "s"} en el servidor).`;
  }
}

function renderSalesTab() {
  renderOnlineSalesNote();
  populateSaleProductSelect();

  const now = Date.now();
  const monthAgo = now - 30 * 864e5;
  const thisMonth = salesLog.filter(s => new Date(s.ts).getTime() >= monthAgo);
  const revenue = thisMonth.reduce((a, s) => a + s.total, 0);
  const units = thisMonth.reduce((a, s) => a + s.qty, 0);
  const tickets = thisMonth.length;
  const avgTicket = tickets ? revenue / tickets : 0;
  $("#sales-kpis").innerHTML = `
    <div class="kpi"><div class="n">${money(revenue)}</div><div class="l">Ventas (30d)</div></div>
    <div class="kpi"><div class="n">${units}</div><div class="l">Unidades (30d)</div></div>
    <div class="kpi"><div class="n">${tickets}</div><div class="l">Transacciones (30d)</div></div>
    <div class="kpi"><div class="n">${money(avgTicket)}</div><div class="l">Ticket promedio</div></div>`;

  // Barras por mes (ultimos 6 meses)
  const months = [];
  const d0 = new Date(); d0.setDate(1);
  for (let i = 5; i >= 0; i--) {
    const d = new Date(d0.getFullYear(), d0.getMonth() - i, 1);
    months.push({ key: d.toISOString().slice(0, 7), label: d.toLocaleDateString("es-CO", { month: "short" }), total: 0 });
  }
  const idx = Object.fromEntries(months.map((m, i) => [m.key, i]));
  salesLog.forEach(s => { const k = s.ts.slice(0, 7); if (k in idx) months[idx[k]].total += s.total; });
  const maxM = Math.max(1, ...months.map(m => m.total));
  const W = 600, H = 170, padX = 10, padB = 26, padT = 10;
  const bw = (W - padX * 2) / months.length;
  $("#sales-month-chart").innerHTML = months.map((m, i) => {
    const h = (m.total / maxM) * (H - padB - padT);
    const x = padX + i * bw, y = H - padB - h;
    return `<rect x="${(x + bw * .18).toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * .64).toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="4" fill="#22d3ee" opacity="${i === months.length - 1 ? 1 : .55}"/>
      <text x="${(x + bw / 2).toFixed(1)}" y="${H - 9}" text-anchor="middle" font-size="11" fill="#93979f">${m.label}</text>`;
  }).join("") + `<line x1="${padX}" y1="${H - padB}" x2="${W - padX}" y2="${H - padB}" stroke="#33373f"/>`;

  const rows = salesLog.slice().reverse();
  $("#sales-count").textContent = rows.length
    ? `${rows.length} venta${rows.length === 1 ? "" : "s"} registrada${rows.length === 1 ? "" : "s"}${rows.length > 200 ? " — mostrando las 200 más recientes" : ""}`
    : "";
  $("#sales-tbody").innerHTML = rows.slice(0, 200).map((s, i) => `
    <tr data-sale-idx="${i}" style="cursor:pointer" title="Ver detalle">
      <td>${new Date(s.ts).toLocaleString("es-CO")}</td><td>${escHtml(s.name || s.slug)}</td>
      <td>${escHtml([s.size, s.color].filter(Boolean).join(" / ")) || "—"}</td><td>${s.qty}</td><td>${money(s.total)}</td><td>${escHtml(s.admin || "")}</td></tr>`).join("")
    || `<tr><td colspan="6" class="muted" style="padding:16px;text-align:center">Sin ventas registradas.</td></tr>`;
  $("#sales-tbody").querySelectorAll("tr[data-sale-idx]").forEach(tr => {
    tr.addEventListener("click", () => openSaleDetail(rows[Number(tr.getAttribute("data-sale-idx"))]));
  });
}

/* Detalle completo de una venta -- sobre todo para las de Wompi, que traen
   datos de envio y referencia de pago que la fila de la tabla no alcanza a
   mostrar. Reusa el mismo modal generico que el ajuste de precio en lote. */
function openSaleDetail(sale) {
  if (!sale) return;
  const fieldRows = arr => arr.filter(Boolean).map(([k, v]) => `
    <div style="display:flex;justify-content:space-between;gap:16px;padding:7px 0;border-bottom:1px solid var(--line-soft);font-size:13px">
      <span class="muted">${escHtml(k)}</span><span style="text-align:right">${escHtml(v)}</span>
    </div>`).join("");
  const sectionTitle = t => `<h4 style="margin:18px 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted)">${escHtml(t)}</h4>`;

  const variant = [sale.size, sale.color].filter(Boolean).join(" / ");
  const mainRows = [
    ["Fecha", new Date(sale.ts).toLocaleString("es-CO")],
    ["Producto", sale.name || sale.slug],
    variant && ["Variante", variant],
    ["Cantidad", sale.qty],
    ["Precio unitario", money(sale.unitPrice)],
    ["Total", money(sale.total)],
    sale.discount && ["Descuento", money(sale.discount)],
    sale.payment && ["Forma de pago", sale.payment],
    sale.invoice && ["Factura", "Nº " + sale.invoice],
    ["Vendedor", sale.admin || "—"],
  ];

  const isWompi = sale.source === "wompi";
  const wompiRows = isWompi ? [
    ["Referencia", sale.orderRef || "—"],
    ["ID transacción Wompi", sale.wompiId || "—"],
    ["Email del cliente", sale.customerEmail || "—"],
    sale.flag && ["⚠ Revisar", sale.flag === "amount_mismatch" ? "El monto cobrado no coincide con el pedido" : sale.flag === "no_pending_order" ? "Pago aprobado sin pedido guardado: contactar al cliente" : sale.flag],
  ] : [];

  const ship = sale.shipping;
  const shipRows = ship ? [
    ["Nombre", ship.name],
    ["Teléfono", ship.phone],
    ["Dirección", ship.address],
    ["Ciudad / Barrio", ship.city],
    ship.notes && ["Notas", ship.notes],
  ] : [];

  $("#confirm-modal").innerHTML = `
    <h3 style="margin-bottom:2px">${escHtml(sale.name || sale.slug)}</h3>
    <p class="muted" style="margin:0 0 4px;font-size:13px">Detalle de la venta</p>
    ${fieldRows(mainRows)}
    ${isWompi ? sectionTitle("Pago (Wompi)") + fieldRows(wompiRows) : ""}
    ${shipRows.length
      ? sectionTitle("Envío") + fieldRows(shipRows)
      : (isWompi ? `<p style="color:var(--bad);font-size:12.5px;margin-top:14px">Sin datos de envío -- venta anterior a que se pidieran en el carrito.</p>` : "")}
    ${sale.invoice ? `<button class="btn cyan block" id="sd-invoice" style="margin-top:20px">Ver / imprimir factura Nº ${escHtml(sale.invoice)}</button>` : ""}
    <button class="btn block" id="sd-close" style="margin-top:${sale.invoice ? "10px" : "20px"}">Cerrar</button>`;
  $("#sd-close").addEventListener("click", closeConfirmModal);
  if (sale.invoice) $("#sd-invoice").addEventListener("click", () => reprintInvoice(sale));
  $("#confirm-overlay").classList.add("open");
}

/* ============================== NOTIFICACIONES DE VENTAS ==================
   Avisa en el panel (campana + badge + notificacion del navegador) cuando
   aparece una venta nueva en el log -- sobre todo las que vienen solas del
   checkout real de Wompi, que nadie registro a mano. Revisa
   data/sales-log.json cada 45s; si hay entradas que no estaban antes, las
   muestra. Es una campana DE PANEL, no un push real: solo avisa mientras
   esta pestaña sigue abierta (aunque este de fondo/minimizada). Para que
   el dueño se entere aunque el panel este cerrado, ver el correo
   automatico (wompi-order.js, lado del backend). */
let lastSeenSaleTs = localStorage.getItem("stike_admin_last_seen_sale") || "";
let notifPollTimer = null;

/* ------------------------------ SONIDO DE ALERTA ---------------------------
   Sintetizado con Web Audio (sin archivo .mp3 que mantener): 3 pitidos tipo
   alarma de caja registradora, fuertes a proposito -- la idea es que quien
   esta en el local lo oiga desde el otro lado del mostrador y sepa que hay
   que alistar un pedido para enviar.

   Los navegadores bloquean sonido por JS hasta que la persona interactua
   con la pagina una vez (click, tecla) -- por eso se "desbloquea" el
   AudioContext en el primer click/tecla de toda la pestaña, y ademas hay
   un boton "Probar sonido" junto a la campana para confirmarlo a mano. */
let audioCtx = null;
function ensureAudioCtx() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { return null; }
  }
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  return audioCtx;
}
document.addEventListener("click", ensureAudioCtx, { once: true });
document.addEventListener("keydown", ensureAudioCtx, { once: true });

function playSaleAlertSound() {
  const ctx = ensureAudioCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  const beep = (start, freq, dur) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, now + start);
    gain.gain.linearRampToValueAtTime(0.9, now + start + 0.02);
    gain.gain.linearRampToValueAtTime(0, now + start + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + start);
    osc.stop(now + start + dur + 0.02);
  };
  beep(0, 880, 0.14);
  beep(0.18, 880, 0.14);
  beep(0.36, 1175, 0.26);
}

function unseenSales() { return salesLog.filter(s => s.ts > lastSeenSaleTs); }

function renderNotifBadge() {
  const n = unseenSales().length;
  const badge = $("#notif-badge");
  if (!badge) return;
  badge.textContent = n > 9 ? "9+" : String(n);
  badge.style.display = n > 0 ? "" : "none";
}

function renderNotifPanel() {
  const panel = $("#notif-panel");
  const rows = salesLog.slice().reverse().slice(0, 12);
  panel.innerHTML = `<h4>Ventas recientes</h4>` + (rows.length
    ? rows.map(s => `
      <div class="notif-row">
        <div class="nr-top"><span>${s.qty}x ${s.name || s.slug}</span><b>${money(s.total)}</b></div>
        <div class="nr-sub">${new Date(s.ts).toLocaleString("es-CO")} · ${s.admin || ""}</div>
      </div>`).join("")
    : `<div class="notif-empty">Sin ventas todavía.</div>`);
}

function toggleNotifPanel() {
  const panel = $("#notif-panel");
  const opening = panel.style.display === "none";
  panel.style.display = opening ? "" : "none";
  if (opening) {
    renderNotifPanel();
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
  } else {
    lastSeenSaleTs = new Date().toISOString();
    localStorage.setItem("stike_admin_last_seen_sale", lastSeenSaleTs);
    renderNotifBadge();
  }
}

function notifySaleEntries(entries) {
  if (!entries.length) return;
  playSaleAlertSound();
  const preview = entries.slice(0, 3).map(s => `${s.qty}x ${s.name || s.slug}`).join(", ") + (entries.length > 3 ? "…" : "");
  showStatus([{ text: `🔔 ${entries.length} venta${entries.length === 1 ? "" : "s"} nueva${entries.length === 1 ? "" : "s"}: ${preview}`, cls: "ok" }]);
  if ("Notification" in window && Notification.permission === "granted") {
    entries.slice(0, 3).forEach(s => {
      try { new Notification("Nueva venta Stike", { body: `${s.qty}x ${s.name || s.slug} — ${money(s.total)}` }); }
      catch (e) { /* algunos navegadores bloquean Notification fuera de un gesto del usuario */ }
    });
  }
}

async function pollSalesLog() {
  if (demoMode || !session.pat) return;
  const [fresh] = await Promise.all([ghGetFile(CONFIG.paths.salesLog), fetchOnlineSales()]);
  reconcileOnlineStock();
  const before = salesLog;
  salesLogGh = fresh ? JSON.parse(fresh.text) : [];
  rebuildSalesLog();
  const known = new Set(before.map(saleKey));
  const added = salesLog.filter(s => !known.has(saleKey(s)));
  if (!added.length && salesLog.length === before.length) { renderOnlineSalesNote(); return; }
  renderSalesTab();
  renderKpis();
  renderNotifBadge();
  if (added.length) notifySaleEntries(added);
}

function startSalesPolling() {
  if (notifPollTimer) return;
  notifPollTimer = setInterval(() => {
    if (document.visibilityState === "visible") pollSalesLog().catch(() => {});
  }, 45000);
}

/* ============================== KPIs ======================================== */
/* Icono de candado reutilizable para todo dato que session.role oculta
   (costo, margen). 1em de lado: hereda el tamano de texto de donde se
   ponga, asi se ve chico en una celda de tabla y grande en un numero de
   KPI sin necesitar una variante de CSS por contexto. */
const LOCKED_ICON = `<span class="locked" title="Solo dueño"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="9" width="11" height="8" rx="1.5"/><path d="M6.5 9V6.5a3.5 3.5 0 017 0V9"/></svg></span>`;

function renderKpis() {
  const isOwner = session.role === "owner";
  const now = Date.now();
  const inRange = (s, fromDaysAgo, toDaysAgo) => {
    const t = new Date(s.ts).getTime();
    return t > now - fromDaysAgo * 864e5 && t <= now - toDaysAgo * 864e5;
  };
  const last30 = salesLog.filter(s => inRange(s, 30, 0));
  const prev30 = salesLog.filter(s => inRange(s, 60, 30));

  const sum = arr => arr.reduce((a, s) => a + s.total, 0);
  const revenue = sum(last30), prevRevenue = sum(prev30);
  const units = last30.reduce((a, s) => a + s.qty, 0);
  const prevUnits = prev30.reduce((a, s) => a + s.qty, 0);
  const avgTicket = last30.length ? revenue / last30.length : 0;
  const prevAvg = prev30.length ? prevRevenue / prev30.length : 0;
  const lowStock = workingCatalog.filter(p => stikeTotalStock(p) <= STIKE_LOW_STOCK_ADMIN).length;
  const activos = workingCatalog.filter(p => p.published !== false).length;

  const costOf = slug => { const p = workingCatalog.find(x => x.slug === slug); return p ? (p.cost || costsMap[slug] || 0) : 0; };
  const cogs = last30.reduce((a, s) => a + costOf(s.slug) * s.qty, 0);
  const marginPct = revenue > 0 ? Math.round(((revenue - cogs) / revenue) * 100) : 0;

  const delta = (cur, prev) => {
    if (!prev) return `<div class="delta flat">sin base previa</div>`;
    const pct = Math.round(((cur - prev) / prev) * 100);
    const cls = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
    const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "=";
    return `<div class="delta ${cls}">${arrow} ${Math.abs(pct)}% vs 30d previos</div>`;
  };

  $("#kpi-cards").innerHTML = `
    <div class="kpi"><div class="n">${money(revenue)}</div><div class="l">Ingresos (30d)</div>${delta(revenue, prevRevenue)}</div>
    <div class="kpi"><div class="n">${units}</div><div class="l">Unidades vendidas (30d)</div>${delta(units, prevUnits)}</div>
    <div class="kpi"><div class="n">${money(avgTicket)}</div><div class="l">Ticket promedio</div>${delta(avgTicket, prevAvg)}</div>
    <div class="kpi"><div class="n">${isOwner ? marginPct + "%" : LOCKED_ICON}</div><div class="l">Margen bruto (30d)</div>
      <div class="delta flat">${isOwner ? "Costo: " + money(cogs) : "solo dueño"}</div></div>
    <div class="kpi"><div class="n">${lowStock}</div><div class="l">Bajo stock / agotados</div>
      <div class="delta ${lowStock ? "down" : "up"}">${lowStock ? "requieren reposición" : "todo cubierto"}</div></div>
    <div class="kpi"><div class="n">${activos}</div><div class="l">Productos publicados</div>
      <div class="delta flat">de ${workingCatalog.length} en catálogo</div></div>`;

  // Serie diaria 30d + sombra de los 30 previos
  const series = (from, to) => {
    const days = [];
    for (let i = from - 1; i >= to; i--) days.push(new Date(now - i * 864e5).toISOString().slice(0, 10));
    const byDay = Object.fromEntries(days.map(d => [d, 0]));
    salesLog.forEach(s => { const k = s.ts.slice(0, 10); if (k in byDay) byDay[k] += s.total; });
    return days.map(d => byDay[d]);
  };
  const cur = series(30, 0), old = series(60, 30);
  const max = Math.max(1, ...cur, ...old);
  const W = 600, H = 170, pad = 10;
  const toPts = vals => vals.map((v, i) => {
    const x = pad + (i / Math.max(1, vals.length - 1)) * (W - pad * 2);
    const y = H - pad - (v / max) * (H - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  $("#kpi-chart").innerHTML = `
    <polyline points="${toPts(old)}" fill="none" stroke="#4a4e58" stroke-width="1.5" stroke-dasharray="4 4"/>
    <polyline points="${pad},${H - pad} ${toPts(cur)} ${W - pad},${H - pad}" fill="#22d3ee22" stroke="none"/>
    <polyline points="${toPts(cur)}" fill="none" stroke="#22d3ee" stroke-width="2.5"/>
    <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="#33373f"/>`;

  // Desglose por categoria y por marca
  const breakdown = (keyFn) => {
    const map = {};
    last30.forEach(s => {
      const p = workingCatalog.find(x => x.slug === s.slug);
      const k = p ? keyFn(p) : "—";
      map[k] = (map[k] || 0) + s.total;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 6);
  };
  const renderBars = (el, rows) => {
    const top = Math.max(1, ...rows.map(r => r[1]));
    $(el).innerHTML = rows.map(([k, v]) => `
      <div class="barrow">
        <span>${k}</span>
        <span class="track"><span class="fill" style="width:${Math.max(3, (v / top) * 100).toFixed(1)}%"></span></span>
        <span class="val">${money(v)}</span>
      </div>`).join("") || `<p class="muted" style="margin:0">Sin ventas en el período.</p>`;
  };
  renderBars("#kpi-by-cat", breakdown(p => { const c = stikeCategory(p.cat); return c ? c.name : p.cat; }));
  renderBars("#kpi-by-brand", breakdown(p => p.brand || "—"));

  // Top productos con margen
  const bySlug = {};
  last30.forEach(s => {
    bySlug[s.slug] = bySlug[s.slug] || { name: s.name || s.slug, units: 0, revenue: 0, cost: 0 };
    bySlug[s.slug].units += s.qty;
    bySlug[s.slug].revenue += s.total;
    bySlug[s.slug].cost += costOf(s.slug) * s.qty;
  });
  const top = Object.values(bySlug).sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  $("#top-products-tbody").innerHTML = top.map(t => {
    const m = t.revenue > 0 ? Math.round(((t.revenue - t.cost) / t.revenue) * 100) + "%" : "—";
    return `<tr><td>${t.name}</td><td>${t.units}</td><td>${money(t.revenue)}</td><td>${isOwner ? m : LOCKED_ICON}</td></tr>`;
  }).join("")
    || `<tr><td colspan="4" class="muted" style="padding:16px;text-align:center">Sin ventas en los últimos 30 días.</td></tr>`;
}

/* ============================== AUDITORÍA =================================== */
function renderAudit() {
  $("#audit-tbody").innerHTML = auditLog.slice().reverse().slice(0, 100).map(a => `
    <tr><td>${new Date(a.ts).toLocaleString("es-CO")}</td><td>${a.admin}</td><td>${a.summary}</td></tr>`).join("")
    || `<tr><td colspan="3" class="muted" style="padding:16px;text-align:center">Sin publicaciones todavía.</td></tr>`;
}

/* ============================== BULK PRICE ================================== */
/* ============================== MODAL GENERICO (reemplaza prompt/confirm) ===
   Un solo overlay (#confirm-overlay/#confirm-modal, definido una vez en
   admin.html) reusado para dos flujos distintos -- el ajuste de precio en
   lote y la confirmacion de borrado en lote -- exactamente como
   #sale-overlay ya se reusa para la venta rapida de cualquier producto.
   Antes, ajustar precio en lote pedia el porcentaje con prompt() y
   confirmaba con confirm(): dos popups nativos seguidos, sin vista previa
   de a cuantos productos afecta hasta despues de contestar el primero. */
function closeConfirmModal() { $("#confirm-overlay").classList.remove("open"); }

function openBulkPriceModal(slugs, label) {
  const targets = () => workingCatalog.filter(p => slugs.includes(p.slug));
  $("#confirm-modal").innerHTML = `
    <h3 style="margin-bottom:4px">Ajustar precio</h3>
    <p class="muted" style="margin:0 0 16px;font-size:13px">${label}</p>
    <div class="field"><label>Porcentaje (ej. 10 para +10%, -5 para -5%)</label>
      <input id="bp-pct" type="number" step="0.5" value="0" autofocus>
    </div>
    <p class="hint muted" id="bp-preview" style="margin:0 0 16px"></p>
    <div style="display:flex;gap:10px">
      <button class="btn ghost" id="bp-cancel" style="flex:1">Cancelar</button>
      <button class="btn cyan" id="bp-apply" style="flex:2">Aplicar</button>
    </div>`;
  const preview = () => {
    const pct = parseFloat($("#bp-pct").value) || 0;
    const n = targets().length;
    $("#bp-preview").textContent = pct === 0
      ? `Se aplicará a ${n} producto${n === 1 ? "" : "s"} — 0% no cambia nada.`
      : `Se aplicará ${pct > 0 ? "+" : ""}${pct}% a ${n} producto${n === 1 ? "" : "s"}. Ejemplo: ${money(100000)} → ${money(Math.max(0, Math.round((100000 * (1 + pct / 100)) / 100) * 100))}.`;
  };
  $("#bp-pct").addEventListener("input", preview);
  $("#bp-cancel").addEventListener("click", closeConfirmModal);
  $("#bp-apply").addEventListener("click", () => {
    const factor = 1 + (parseFloat($("#bp-pct").value) / 100 || 0);
    targets().forEach(p => { p.price = Math.max(0, Math.round((p.price * factor) / 100) * 100); markDirty(p.slug); });
    closeConfirmModal();
    renderProductGrid();
  });
  preview();
  disableAutofill($("#confirm-modal"));
  $("#confirm-overlay").classList.add("open");
  $("#bp-pct").focus();
}

function openBulkDeleteConfirm(slugs) {
  $("#confirm-modal").innerHTML = `
    <h3 style="margin-bottom:4px">Eliminar productos</h3>
    <p class="muted" style="margin:0 0 20px;font-size:13px">¿Eliminar ${slugs.length} producto${slugs.length === 1 ? "" : "s"}? Se quitarán de la tienda al publicar.</p>
    <div style="display:flex;gap:10px">
      <button class="btn ghost" id="bd-cancel" style="flex:1">Cancelar</button>
      <button class="btn bad" id="bd-confirm" style="flex:2">Eliminar</button>
    </div>`;
  $("#bd-cancel").addEventListener("click", closeConfirmModal);
  $("#bd-confirm").addEventListener("click", () => {
    slugs.forEach(slug => {
      const d = workingCatalog.find(p => p.slug === slug);
      const ownSlug = findOwnBaselineSlug(slug);
      workingCatalog = workingCatalog.filter(p => p.slug !== slug);
      if (ownSlug) deletedSlugs.add(ownSlug);
      dirtySlugs.delete(slug);
      if (d) renamedFrom.delete(d.slug);
    });
    closeConfirmModal();
    updateDirtyUI();
    renderProductGrid();
  });
  $("#confirm-overlay").classList.add("open");
}

function bulkPublishSelected(slugs) {
  slugs.forEach(slug => {
    const p = workingCatalog.find(x => x.slug === slug);
    if (p) { p.published = true; markDirty(slug); }
  });
  renderProductGrid();
}

/* ============================== CSV / JSON =================================== */
function downloadFile(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function toCSV(rows) {
  const headers = ["slug", "sku", "n", "brand", "cat", "sub", "spec", "price", "cost", "units", "tag", "imgs", "sizes", "colors", "imgFit", "published"];
  const joinStock = arr => (arr || []).map(s => `${s.v}:${s.u}`).join("|");
  const val = (p, h) => {
    if (h === "spec") return (p.spec || []).join("\n");
    if (h === "imgs") return (p.imgs || []).join("|");
    if (h === "sizes") return joinStock(p.sizes);
    if (h === "colors") return joinStock(p.colors);
    return p[h];
  };
  const esc = v => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  return [headers.join(",")].concat(rows.map(p => headers.map(h => esc(val(p, h))).join(","))).join("\n");
}
function exportCSV() { downloadFile("stike-catalogo.csv", toCSV(workingCatalog), "text/csv"); }
function exportJSON() { downloadFile("stike-catalogo.json", JSON.stringify(workingCatalog.map(toSiteProduct), null, 2), "application/json"); }

function parseCSV(text) {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(",").map(h => h.replace(/^"|"$/g, ""));
  return lines.filter(Boolean).map(line => {
    const cells = line.match(/(".*?"|[^,]+)(?=,|$)/g) || [];
    const row = {};
    headers.forEach((h, i) => { row[h] = (cells[i] || "").replace(/^"|"$/g, "").replace(/""/g, '"'); });
    return row;
  });
}
/* "valor:unidades" separados por "|" -> [{v,u}]. Tolera un tercer campo
   vacio (p.ej. "Negro:2:") que algunos exports historicos incluian. */
function parseStockField(raw) {
  if (Array.isArray(raw)) return raw;
  const items = String(raw).split("|").map(s => s.trim()).filter(Boolean);
  if (!items.length) return null;
  return items.map(item => {
    const [v, u] = item.split(":");
    return { v: (v || "").trim(), u: parseInt(u) || 0 };
  });
}
async function importFile(file) {
  const text = await file.text();
  let rows;
  try { rows = file.name.endsWith(".json") ? JSON.parse(text) : parseCSV(text); }
  catch (e) { alert("No se pudo leer el archivo: " + e.message); return; }
  let created = 0, updated = 0;
  rows.forEach(row => {
    const slug = row.slug || uniqueSlug(slugify(row.n || row.slug || "producto"), null);
    const existing = workingCatalog.find(p => p.slug === slug);
    const merged = existing ? { ...existing } : blankProduct();
    ["n", "brand", "cat", "sub", "tag", "imgFit"].forEach(k => { if (row[k] !== undefined && row[k] !== "") merged[k] = row[k]; });
    ["price", "cost", "units"].forEach(k => { if (row[k] !== undefined && row[k] !== "") merged[k] = parseInt(row[k]) || 0; });
    if (row.sku) merged.sku = row.sku;
    if (row.spec !== undefined && row.spec !== "") {
      merged.spec = Array.isArray(row.spec) ? row.spec : String(row.spec).split("\n").map(s => s.trim()).filter(Boolean);
    }
    if (row.imgs !== undefined && row.imgs !== "") {
      merged.imgs = Array.isArray(row.imgs) ? row.imgs : String(row.imgs).split("|").map(s => s.trim()).filter(Boolean);
    }
    if (row.sizes !== undefined && row.sizes !== "") merged.sizes = parseStockField(row.sizes);
    if (row.colors !== undefined && row.colors !== "") merged.colors = parseStockField(row.colors);
    merged.slug = slug;
    if (row.published !== undefined) merged.published = String(row.published) !== "false" && row.published !== false;
    if (!merged.sku) merged.sku = generateSku(merged.cat, merged.brand);
    if (existing) { Object.assign(existing, merged); updated++; } else { workingCatalog.push(merged); created++; }
    markDirty(slug);
  });
  renderProductGrid();
  showStatus([{ text: `Importados: ${created} nuevos, ${updated} actualizados (sin publicar aún).`, cls: "ok" }]);
}

/* ============================== CONTENIDO DEL SITIO =========================== */
const CONTENT_FIELDS = [
  { key: "home.heroTitle", label: "Home · Título del hero" },
  { key: "home.heroSubtitle", label: "Home · Subtítulo del hero" },
  { key: "home.promoTitle", label: "Home · Título sección promo" },
  { key: "cat.repuestos.title", label: "Repuestos · Título de categoría" },
  { key: "cat.repuestos.subtitle", label: "Repuestos · Subtítulo" },
  { key: "cat.protecciones.title", label: "Protecciones · Título de categoría" },
  { key: "cat.protecciones.subtitle", label: "Protecciones · Subtítulo" },
  { key: "cat.ropa.title", label: "Ropa · Título de categoría" },
  { key: "cat.ropa.subtitle", label: "Ropa · Subtítulo" },
  { key: "cat.accesorios.title", label: "Accesorios · Título de categoría" },
  { key: "cat.accesorios.subtitle", label: "Accesorios · Subtítulo" },
];
function renderContentTab() {
  // "Personalizar" es la señal explícita de intención: si está destildado, la
  // clave NO se escribe (o se borra) y el sitio usa su texto por defecto. Si
  // está tildado, se escribe el valor tal cual (incluso vacío = a propósito
  // en blanco). Sin esto, guardar el formulario sin tocar nada terminaría
  // publicando las 12 claves en blanco y tapando todos los textos por defecto.
  $("#content-fields").innerHTML = CONTENT_FIELDS.map(f => {
    const present = Object.prototype.hasOwnProperty.call(siteContent, f.key);
    return `<div class="field">
      <label><input type="checkbox" class="content-toggle" data-toggle-key="${f.key}" ${present ? "checked" : ""}> ${f.label} <span class="hint">— personalizar</span></label>
      <input data-content-key="${f.key}" value="${escAttr(siteContent[f.key] || "")}" placeholder="(usa el texto por defecto del sitio)" ${present ? "" : "disabled"}>
    </div>`;
  }).join("");
  $$(".content-toggle").forEach(cb => cb.addEventListener("change", () => {
    const inp = document.querySelector(`[data-content-key="${cb.getAttribute("data-toggle-key")}"]`);
    inp.disabled = !cb.checked;
  }));
}
async function saveSiteContent() {
  const updates = {}; const deletions = [];
  $$(".content-toggle").forEach(cb => {
    const key = cb.getAttribute("data-toggle-key");
    const inp = document.querySelector(`[data-content-key="${key}"]`);
    if (cb.checked) updates[key] = inp.value; else deletions.push(key);
  });
  setPublishing(true);
  try {
    siteContent = await mergeFlatMap(CONFIG.paths.siteContent, updates, deletions, "Actualiza textos del sitio");
    showStatus([{ text: "Textos publicados.", cls: "ok" }]);
    auditLog = await appendJsonLog(CONFIG.paths.auditLog, [{ ts: new Date().toISOString(), admin: session.email, summary: "Actualizó textos del sitio (contenido editable)", created: 0, edited: 0, deleted: 0, photos: 0 }], "Actualiza textos del sitio");
    renderAudit();
  } catch (e) { showStatus([{ text: "Error: " + e.message, cls: "bad" }]); }
  setPublishing(false);
}

/* ============================== APP SHELL ==================================== */
function showApp() {
  $("#session-info").innerHTML = `<div style="display:flex;flex-direction:column;gap:6px;align-items:flex-start">
         <span class="pill ${session.role === "owner" ? "owner" : "editor"}">${session.role === "owner" ? "Dueño" : "Editor"}</span>
         <span class="pill dot">${escHtml(session.email)}</span>
         <button class="btn ghost sm" onclick="clearLogin()">Cerrar sesión</button>
       </div>`;
  loadAll().catch(e => handleLoadError(e));
  renderHealth();
}

/* Pestaña Configuracion: que esta listo para cobrar y que falta. El servidor
   nunca devuelve el valor de una llave, solo si existe y si funciona. */
async function renderHealth() {
  const el = $("#cfg-health");
  if (!el) return;
  el.innerHTML = `<p class="hint muted">Revisando...</p>`;
  try {
    const res = await fetch(new URL("api/admin-health", document.baseURI), { credentials: "same-origin", cache: "no-store" });
    const h = await res.json();
    if (!res.ok) throw new Error(h.error || res.status);
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <span class="pill ${h.ready ? "owner" : ""}" style="${h.ready ? "" : "background:var(--bad);color:#fff"}">${h.ready ? "Listo para cobrar" : "Falta configurar"}</span>
        <button class="btn ghost sm" id="cfg-health-refresh" type="button">Volver a revisar</button>
      </div>
      ${h.checks.map(c => `
        <div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--line-soft);font-size:13px">
          <span style="flex:none;width:18px;color:${c.ok ? "var(--good, #3ecf8e)" : "var(--bad)"}">${c.ok ? "✔" : "✕"}</span>
          <span style="flex:1"><b>${escHtml(c.label)}</b><br><span class="muted">${escHtml(c.detail)}</span></span>
        </div>`).join("")}
      <p class="hint muted" style="margin-top:12px">URL de eventos para el panel de Wompi: <span class="mono">${escHtml(h.eventsUrl)}</span></p>`;
    $("#cfg-health-refresh").addEventListener("click", renderHealth);
  } catch (e) {
    el.innerHTML = `<p class="hint" style="color:var(--bad)">No se pudo revisar la configuración: ${escHtml(e.message)}</p>`;
  }
}

function handleLoadError(e) {
  $("#cfg-status").innerHTML = `<span style="color:var(--bad)">${escHtml(patErrorMessage(e))}</span>`;
  switchPanel("config");
  showStatus([{ text: "Error cargando catálogo: " + e.message, cls: "bad" }]);
}
function patErrorMessage(e) {
  if (/-> 500/.test(e.message)) return "El servidor no tiene configurado GITHUB_TOKEN en api/config.local.php (o el token no sirve).";
  if (/-> 401/.test(e.message)) return "El GITHUB_TOKEN del servidor es inválido o expiró: genera uno nuevo y ponlo en api/config.local.php.";
  if (/-> 404/.test(e.message)) return `El GITHUB_TOKEN del servidor no tiene acceso a ${CONFIG.owner}/${CONFIG.repo}.`;
  if (/-> 403/.test(e.message)) return "El GITHUB_TOKEN del servidor no tiene permiso de escritura (Contents: Read and write) o se agotó el límite de la API.";
  return "No se pudo cargar el catálogo: " + e.message;
}

/* ============================== ANTI-AUTOFILL ===============================
   El panel es una herramienta interna: ningun campo debe autocompletarse ni
   conservar lo que se escribio antes. Chrome ignora autocomplete="off" en
   varios casos y ademas restaura valores al recargar (form restoration) y al
   volver con atras (bfcache), asi que no alcanza con el atributo en el HTML:
   1) se marcan todos los inputs (incluye los del drawer, que se generan por JS),
   2) al filtro se le pone un name aleatorio en cada carga, para que no haya
      historial guardado que el navegador pueda asociar a ese campo, y
   3) se limpia el filtro activamente en el arranque, en el siguiente frame y
      al volver desde bfcache.
   ========================================================================= */
function disableAutofill(root) {
  (root || document).querySelectorAll("input, textarea").forEach(el => {
    if (el.type === "file") return;
    el.setAttribute("autocomplete", "off");
    el.setAttribute("autocorrect", "off");
    el.setAttribute("autocapitalize", "off");
    el.setAttribute("spellcheck", "false");
    el.setAttribute("data-lpignore", "true");   // LastPass
    el.setAttribute("data-1p-ignore", "");      // 1Password
    el.setAttribute("data-bwignore", "");       // Bitwarden
    el.setAttribute("data-form-type", "other"); // Dashlane
  });
}

function resetSearchFilter(rerender) {
  const el = $("#p-search");
  if (!el) return;
  // name aleatorio: sin nombre estable, el navegador no tiene con que
  // emparejar lo que se escribio en cargas anteriores.
  el.setAttribute("name", "f" + Math.random().toString(36).slice(2, 10));
  if (el.value) {
    el.value = "";
    if (rerender && catalogLoaded) renderProductGrid();
  }
}

// bfcache / boton atras: el navegador reinyecta el valor viejo despues de load.
window.addEventListener("pageshow", () => resetSearchFilter(true));

/* ============================== NAV / PANELES ================================ */
function switchPanel(name) {
  $$(".navbtn").forEach(b => b.classList.toggle("active", b.getAttribute("data-panel") === name));
  $$(".panel").forEach(p => p.classList.toggle("active", p.id === "panel-" + name));
  const titles = { productos: "Productos", ventas: "Ventas", kpis: "KPIs", auditoria: "Auditoría", contenido: "Contenido del sitio", config: "Configuración" };
  $("#panel-title").textContent = titles[name] || name;
  if (name === "kpis") renderKpis();
  if (name === "auditoria") renderAudit();
}
$$(".navbtn").forEach(b => b.addEventListener("click", () => switchPanel(b.getAttribute("data-panel"))));

/* ============================== WIRING GENERAL ================================ */
$("#btn-refresh").addEventListener("click", () => loadAll().catch(e => showStatus([{ text: "Error: " + e.message, cls: "bad" }])));
$("#btn-publish").addEventListener("click", () => publishCatalog());
$("#btn-notif").addEventListener("click", e => { e.stopPropagation(); toggleNotifPanel(); });
$("#btn-test-sound").addEventListener("click", () => playSaleAlertSound());
document.addEventListener("click", e => {
  const panel = $("#notif-panel");
  if (panel && panel.style.display !== "none" && !e.target.closest(".notif-wrap")) toggleNotifPanel();
});
$("#btn-new-product").addEventListener("click", () => openEditor(null));
$("#p-search").addEventListener("input", renderProductGrid);
$("#p-filter-cat").addEventListener("change", () => { $("#p-filter-sub").value = ""; renderProductGrid(); });
$("#p-filter-sub").addEventListener("change", renderProductGrid);
$("#p-filter-brand").addEventListener("change", renderProductGrid);
$("#p-filter-status").addEventListener("change", renderProductGrid);
$("#btn-filters-clear").addEventListener("click", () => {
  $("#p-search").value = "";
  $("#p-filter-cat").value = "";
  $("#p-filter-sub").value = "";
  $("#p-filter-brand").value = "";
  $("#p-filter-status").value = "";
  renderProductGrid();
});
$("#btn-export-csv").addEventListener("click", exportCSV);
$("#btn-export-json").addEventListener("click", exportJSON);
$("#btn-bulk-price").addEventListener("click", () => {
  const catFilter = $("#p-filter-cat").value;
  const slugs = workingCatalog.filter(p => !catFilter || p.cat === catFilter).map(p => p.slug);
  openBulkPriceModal(slugs, catFilter ? `Categoría: ${catFilter}` : "Todo el catálogo (sin filtrar por categoría).");
});
$$("#view-toggle .viewtoggle-btn").forEach(b => b.addEventListener("click", () => setProductsView(b.getAttribute("data-view"))));
$$(".ptable th[data-sort]").forEach(th => th.addEventListener("click", () => {
  const key = th.getAttribute("data-sort");
  tableSort.dir = tableSort.key === key ? -tableSort.dir : 1;
  tableSort.key = key;
  renderProductGrid();
}));
$("#ptable-select-all").addEventListener("change", e => {
  $$("#product-table-body [data-pt-select]").forEach(cb => {
    cb.checked = e.target.checked;
    const slug = cb.getAttribute("data-pt-select");
    if (e.target.checked) selectedSlugs.add(slug); else selectedSlugs.delete(slug);
    cb.closest("tr").classList.toggle("selected", e.target.checked);
  });
  updateBulkBar();
});
$("#bulk-publish").addEventListener("click", () => bulkPublishSelected([...selectedSlugs]));
$("#bulk-price").addEventListener("click", () => openBulkPriceModal([...selectedSlugs], `${selectedSlugs.size} producto${selectedSlugs.size === 1 ? "" : "s"} seleccionado${selectedSlugs.size === 1 ? "" : "s"}.`));
$("#bulk-delete").addEventListener("click", () => openBulkDeleteConfirm([...selectedSlugs]));
$("#btn-import").addEventListener("click", () => $("#import-file").click());
$("#import-file").addEventListener("change", e => { const f = e.target.files[0]; if (f) importFile(f); e.target.value = ""; });
$("#sale-product").addEventListener("change", onSaleProductChange);
$("#sale-size").addEventListener("change", updateSaleStockHint);
$("#sale-color").addEventListener("change", updateSaleStockHint);
$("#btn-registrar-venta").addEventListener("click", registrarVenta);
$("#btn-save-content").addEventListener("click", saveSiteContent);
$("#editor-overlay").addEventListener("click", e => { if (e.target.id === "editor-overlay") closeEditor(); });
$("#sale-overlay").addEventListener("click", e => { if (e.target.id === "sale-overlay") closeQuickSale(); });
$("#confirm-overlay").addEventListener("click", e => { if (e.target.id === "confirm-overlay") closeConfirmModal(); });
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  // Antes solo la venta rapida cerraba con Escape; el editor de producto
  // -- la pantalla que mas se usa hoy, cargando inventario -- se quedaba
  // sin esa salida rapida.
  if (quickSaleSlug) closeQuickSale();
  else if (editorDraft) closeEditor();
  else if ($("#confirm-overlay").classList.contains("open")) closeConfirmModal();
});
$$("#view-toggle .viewtoggle-btn").forEach(b => b.classList.toggle("active", b.getAttribute("data-view") === productsView));

/* ============================== SESION ===================================
   La sesion la valida el SERVIDOR (api/_admin.php): admin.php ni siquiera
   entrega este archivo sin una cookie valida. Aca solo se pregunta quien
   es (correo y rol) para mostrarlo; nada de lo que haga el navegador puede
   "fingir" una sesion.
   ========================================================================= */
async function fetchSession() {
  const res = await fetch(new URL("api/admin-login", document.baseURI), { credentials: "same-origin", cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}
async function clearLogin() {
  try { await fetch(new URL("api/admin-login", document.baseURI), { method: "DELETE", credentials: "same-origin" }); } catch (e) {}
  location.reload();
}

/* ============================== INIT =========================================== */
function bootApp() {
  disableAutofill();
  resetSearchFilter(false);          // antes del primer render: filtro siempre vacio
  populateCategoryFilter();
  renderProductGrid();
  session.pat = "server";   // el token vive en el servidor (api/gh.php)
  // Limpieza: borra las llaves que versiones anteriores guardaban en el navegador.
  try { ["stike_admin_pat", "stike_admin_sales_key"].forEach(k => localStorage.removeItem(k)); sessionStorage.removeItem("stike_admin_login_v1"); } catch (e) {}
  showApp();
  // Chrome restaura valores DESPUES del load: se vuelve a limpiar en el
  // siguiente frame y un instante despues, por si llega tarde.
  requestAnimationFrame(() => resetSearchFilter(true));
  setTimeout(() => resetSearchFilter(true), 250);
}

(function init() {
  fetchSession().then(me => {
    if (!me) { location.reload(); return; }   // la cookie vencio: admin.php muestra el login
    session.email = me.email;
    session.role = me.role;
    bootApp();
  }).catch(() => { $("#status-box") && showStatus([{ text: "Sin conexión con el servidor.", cls: "bad" }]); });

  // El detector de fallas del <head> revisa STIKE_ADMIN_BOOTED 4s despues
  // de window.load y, si sigue en false, muestra la alarma roja de "el
  // panel no cargo". Eso estaba bien mientras bootApp() corria solo, sin
  // esperar a nadie -- pero con el login de por medio, bootApp() no corre
  // hasta que la PERSONA hace clic en el boton de Google y termina el
  // handshake, y eso casi nunca pasa en 4 segundos. Se disparaba la alarma
  // en logins perfectamente exitosos.
  //
  // La bandera marca otra cosa: "admin.js corrio de punta a punta sin
  // tirar una excepcion", no "ya hay una sesion adentro". Eso se sabe apenas
  // termina esta IIFE (requireGoogleLogin no bloquea: monta el gate y
  // vuelve enseguida). Si algo revienta ANTES de llegar aca, la excepcion
  // sigue subiendo y la bandera nunca se pone -- la alarma real sigue
  // funcionando igual.
  window.STIKE_ADMIN_BOOTED = true;
})();

/* ============================== FACTURA DE VENTA ==========================
   Version digital de la factura fisica de Stike (talonario Nº 3781), en
   formato vertical para imprimir o guardar como PDF. Se genera al registrar
   una venta desde cualquiera de las dos entradas.

   Privacidad: el repo es publico, asi que los datos del cliente (nombre,
   documento, telefono, direccion) NO van a data/sales-log.json. En el log
   solo queda el numero de factura; los datos del cliente se guardan en este
   navegador (localStorage) para poder reimprimir desde el historial.
   ========================================================================= */
const INVOICE_SELLER = {
  name: "Jefersson Parra",
  nit: "1.013.643.302-7",
  regime: "Régimen Simplificado",
  address: "Cra. 52 A No. 45A-29 Sur",
  phone: "741 5998",
  cell: "311 810 8848",
  email: "stikebikeshop@gmail.com",
  city: "Bogotá D.C.",
};
const INVOICE_FIRST_NUMBER = 3782;   // la ultima del talonario fisico es la 3781
const INVOICE_CUSTOMERS_KEY = "stike_invoice_customers";
const PAYMENT_METHODS = ["Efectivo", "Transferencia", "Nequi", "Daviplata", "Tarjeta", "Wompi"];

function nextInvoiceNumber() {
  const used = (salesLog || []).map(s => Number(s.invoice) || 0);
  return Math.max(INVOICE_FIRST_NUMBER - 1, ...used) + 1;
}
function loadInvoiceCustomers() {
  try { return JSON.parse(localStorage.getItem(INVOICE_CUSTOMERS_KEY) || "{}"); } catch { return {}; }
}
function saveInvoiceCustomer(num, customer) {
  try { const all = loadInvoiceCustomers(); all[num] = customer; localStorage.setItem(INVOICE_CUSTOMERS_KEY, JSON.stringify(all)); } catch {}
}

function customerFieldsHtml(prefix) {
  return `
    <div class="inv-fields">
      <label style="display:flex;align-items:center;gap:8px;margin:14px 0 8px"><input type="checkbox" id="${prefix}-inv" checked> Generar factura</label>
      <div id="${prefix}-inv-box">
        <div class="grid-2">
          <div class="field"><label>Cliente</label><input id="${prefix}-c-name" placeholder="Nombre completo"></div>
          <div class="field"><label>CC / NIT</label><input id="${prefix}-c-doc"></div>
        </div>
        <div class="grid-2">
          <div class="field"><label>Teléfono</label><input id="${prefix}-c-tel" type="tel"></div>
          <div class="field"><label>Ciudad</label><input id="${prefix}-c-city" value="Bogotá"></div>
        </div>
        <div class="field"><label>Dirección</label><input id="${prefix}-c-addr"></div>
        <div class="grid-2">
          <div class="field"><label>Forma de pago</label><select id="${prefix}-c-pay">${PAYMENT_METHODS.map(m => `<option>${m}</option>`).join("")}</select></div>
          <div class="field"><label>Descuento (COP)</label><input id="${prefix}-c-disc" type="number" min="0" step="1000" value="0"></div>
        </div>
        <div class="field"><label>Observaciones</label><input id="${prefix}-c-notes" placeholder="Opcional"></div>
      </div>
    </div>`;
}
function wireCustomerFields(prefix) {
  const cb = $(`#${prefix}-inv`);
  if (cb) cb.addEventListener("change", () => { $(`#${prefix}-inv-box`).style.display = cb.checked ? "" : "none"; });
}
function readCustomerFields(prefix) {
  const cb = $(`#${prefix}-inv`);
  if (!cb || !cb.checked) return null;
  const v = id => ($(`#${prefix}-c-${id}`) || {}).value || "";
  return { name: v("name").trim(), doc: v("doc").trim(), tel: v("tel").trim(), city: v("city").trim(),
           addr: v("addr").trim(), pay: v("pay"), discount: Math.max(0, parseInt(v("disc")) || 0), notes: v("notes").trim() };
}

function invoiceHtml(sale, customer) {
  const c = customer || {};
  const d = new Date(sale.ts);
  const p = workingCatalog.find(x => x.slug === sale.slug) || {};
  const code = p.sku || sale.slug || "";
  const desc = [sale.name || p.n || sale.slug, [sale.size && `Talla ${sale.size}`, sale.color].filter(Boolean).join(" · ")].filter(Boolean).join(" — ");
  const subtotal = sale.unitPrice * sale.qty;
  const discount = Math.min(subtotal, c.discount || 0);
  const total = subtotal - discount;
  const e = escHtml;
  const logo = new URL("assets/img/logo-stike.png", document.baseURI).href;
  const blankRows = Array.from({ length: 9 }, () => `<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr>`).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Factura ${sale.invoice}</title>
<style>
@page{size:letter portrait;margin:12mm}
*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;background:#eee}
.sheet{width:190mm;min-height:250mm;margin:10px auto;background:#fff;padding:12mm;display:flex;flex-direction:column}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
.brand img{height:70px}.brand small{display:block;letter-spacing:6px;font-weight:700;font-size:11px;margin-top:2px}
.seller{text-align:center;font-weight:700;line-height:1.35;font-size:14px;padding-top:6px}
.num{border:2px solid #111;border-radius:10px;text-align:center;min-width:52mm}
.num h1{font-size:15px;margin:0;padding:6px;border-bottom:2px solid #111}
.num .n{font-size:22px;color:#c0161c;font-weight:700;padding:6px}
.date{display:grid;grid-template-columns:repeat(3,1fr);border-top:2px solid #111}
.date div{border-left:1px solid #111;padding:3px 0;font-size:11px;font-weight:700}.date div:first-child{border-left:0}
.date span{display:block;font-weight:400;font-size:13px}
.cli{border:2px solid #111;border-radius:10px;margin-top:12px;font-size:12.5px}
.cli .r{display:flex;border-bottom:1px solid #111}.cli .r:last-child{border-bottom:0}
.cli .r>div{flex:1;padding:6px 8px}.cli .r>div+div{border-left:1px solid #111}
.cli b{margin-right:6px}
table{width:100%;border-collapse:collapse;margin-top:12px;font-size:12.5px;border:2px solid #111}
th{background:#111;color:#fff;padding:6px;font-size:11.5px}td{border:1px solid #111;padding:6px;height:24px}
td.n,th.n{text-align:right;white-space:nowrap}td.c{text-align:center}
.tot{display:flex;justify-content:space-between;gap:16px;margin-top:10px;align-items:flex-start}
.note{font-size:10px;max-width:105mm;line-height:1.35}
.sum{border:2px solid #111;border-radius:10px;min-width:70mm;font-size:13px}
.sum div{display:flex;justify-content:space-between;padding:6px 10px;border-bottom:1px solid #111}.sum div:last-child{border-bottom:0;font-weight:700;font-size:15px}
.warn{font-weight:700;font-size:12px;margin-top:14px}
.signs{display:flex;gap:30px;margin-top:auto;padding-top:40px}.signs div{flex:1;border-top:1px solid #111;text-align:center;font-weight:700;font-size:11px;padding-top:4px}
.foot{text-align:center;font-weight:700;font-size:11.5px;margin-top:14px;border-top:2px solid #111;padding-top:6px}
.bar{text-align:center;margin:12px}.bar button{font-size:15px;padding:10px 22px;border:0;border-radius:8px;background:#111;color:#fff;cursor:pointer;margin:0 4px}
@media print{body{background:#fff}.sheet{margin:0;width:auto;min-height:auto;padding:0}.bar{display:none}}
</style></head><body>
<div class="bar"><button onclick="window.print()">Imprimir / Guardar PDF</button><button onclick="window.close()">Cerrar</button></div>
<div class="sheet">
  <div class="top">
    <div class="brand"><img src="${logo}" alt="Stike Bike Shop"></div>
    <div class="seller">${e(INVOICE_SELLER.name)}<br>Nit: ${e(INVOICE_SELLER.nit)}<br>${e(INVOICE_SELLER.regime)}</div>
    <div class="num"><h1>FACTURA DE VENTA</h1><div class="n">Nº ${e(sale.invoice)}</div>
      <div class="date"><div>DÍA<span>${d.getDate()}</span></div><div>MES<span>${d.getMonth() + 1}</span></div><div>AÑO<span>${d.getFullYear()}</span></div></div></div>
  </div>
  <div class="cli">
    <div class="r"><div><b>CLIENTE:</b>${e(c.name || "")}</div><div style="flex:.6"><b>CC/NIT:</b>${e(c.doc || "")}</div></div>
    <div class="r"><div><b>DIRECCIÓN:</b>${e(c.addr || "")}</div><div style="flex:.6"><b>TEL:</b>${e(c.tel || "")}</div></div>
    <div class="r"><div><b>CIUDAD:</b>${e(c.city || "")}</div><div style="flex:.6"><b>PAGO:</b>${e(c.pay || "")}</div></div>
  </div>
  <table><thead><tr><th style="width:22%">CÓDIGO</th><th>DESCRIPCIÓN</th><th style="width:10%">CANTIDAD</th><th class="n" style="width:16%">VR. UNITARIO</th><th class="n" style="width:16%">VR. TOTAL</th></tr></thead>
  <tbody><tr><td>${e(code)}</td><td>${e(desc)}</td><td class="c">${sale.qty}</td><td class="n">${money(sale.unitPrice)}</td><td class="n">${money(subtotal)}</td></tr>${blankRows}</tbody></table>
  <div class="tot">
    <div class="note">${c.notes ? `<b>Observaciones:</b> ${e(c.notes)}<br><br>` : ""}Nota: No se aceptan devoluciones, ni descuentos que no hayan sido autorizadas por nosotros. Esta factura de venta se asimila en todo a una letra de cambio según Art. 774 del código de comercio.
      <div class="warn">MERCANCÍAS SEPARADAS DESPUÉS DE MES LA EMPRESA NO RESPONDE</div></div>
    <div class="sum"><div><span>SUB-TOTAL</span><span>${money(subtotal)}</span></div>${discount ? `<div><span>DESCUENTO</span><span>-${money(discount)}</span></div>` : ""}<div><span>TOTAL</span><span>${money(total)}</span></div></div>
  </div>
  <div class="signs"><div>FIRMAS Y SELLO</div><div>FIRMAS Y SELLO</div></div>
  <div class="foot">${e(INVOICE_SELLER.address)} - Tel: ${e(INVOICE_SELLER.phone)} - Cel: ${e(INVOICE_SELLER.cell)} - Correo: ${e(INVOICE_SELLER.email)} - ${e(INVOICE_SELLER.city)}</div>
</div></body></html>`;
}

/* La ventana se abre en el clic (antes de cualquier await) para que el
   bloqueador de popups no la frene; se llena cuando la venta ya quedo. */
function openInvoiceWindow() {
  const w = window.open("", "_blank");
  if (w) w.document.write("<p style='font-family:sans-serif;padding:20px'>Generando factura...</p>");
  return w;
}
function writeInvoice(w, sale, customer) {
  const html = invoiceHtml(sale, customer);
  if (w && !w.closed) { w.document.open(); w.document.write(html); w.document.close(); return; }
  const blob = new Blob([html], { type: "text/html" });
  window.open(URL.createObjectURL(blob), "_blank");
}
function reprintInvoice(sale) {
  writeInvoice(null, sale, loadInvoiceCustomers()[sale.invoice] || null);
}

$("#sale-customer").innerHTML = customerFieldsHtml("sale");
wireCustomerFields("sale");
