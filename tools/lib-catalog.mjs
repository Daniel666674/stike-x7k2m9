/* =========================================================================
   STIKE BIKE SHOP: lo comun de los generadores (build-pages, build-seo).

   Carga el catalogo y el motor de data.js en Node, igual que el navegador,
   y trae los ayudantes de escritura. STIKE_ROOT apunta los generadores a
   otra carpeta (la copia limpia que arma tools/stage-hostinger.sh): asi el
   deploy regenera todo desde el catalogo vigente sin tocar el repo.
   ========================================================================= */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = process.env.STIKE_ROOT ? path.resolve(process.env.STIKE_ROOT) : path.resolve(TOOLS_DIR, "..");

export const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
export const exists = (p) => fs.existsSync(path.join(ROOT, p));
export const rel = (p) => path.relative(ROOT, p) || p;

/* products-data.js y data.js son scripts de navegador (declaran globals y
   cuelgan cosas de window), no modulos. Se corren en un sandbox con un
   window falso en vez de mantener una segunda copia del catalogo para el
   build, que es justo como los dos se desincronizan.
   Ojo: data.js declara sus tablas con `const`, que NO queda colgado del
   objeto sandbox: hay que pedirlo por nombre, en el MISMO contexto. */
export function loadBrowserScripts(files, exportNames) {
  const sandbox = { console };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  for (const f of files) {
    try {
      new vm.Script(read(f), { filename: f }).runInContext(ctx);
    } catch (e) {
      throw new Error(`No se pudo cargar ${f}: ${e.message}`);
    }
  }
  const out = Object.create(null);
  for (const name of exportNames) {
    try { out[name] = vm.runInContext(`typeof ${name} !== "undefined" ? ${name} : undefined`, ctx); }
    catch { out[name] = undefined; }
  }
  return out;
}

export const SITE = require(path.join(ROOT, "assets/js/site.js"));
export const PdpRender = require(path.join(ROOT, "assets/js/pdp-render.js"));
export const browser = loadBrowserScripts(
  ["assets/js/products-data.js", "assets/js/data.js"],
  ["STIKE_ALL_PRODUCTS", "STIKE_PRODUCTS", "STIKE_CATEGORIES", "STIKE_PART_PAGES",
   "stikeIsVisible", "stikeIsOut", "stikeTotalStock", "stikeSellable", "stikeWaText", "stikeWaLabel", "stikePrice",
   "stikeColorStyle", "stikeHasCombos", "stikeComboUnits", "stikePriceFor", "stikePriceRange", "stikePriceLabel", "stikeLowStockLabel", "STIKE_SHOW_STOCK_BELOW"]
);

/* El catalogo COMPLETO, borradores incluidos. */
export const PRODUCTS = browser.STIKE_ALL_PRODUCTS || [];
export const VISIBLE = PRODUCTS.filter((p) => p.published !== false);
export const CATEGORIES = browser.STIKE_CATEGORIES || [];
export const catName = (slug) => (CATEGORIES.find((c) => c.slug === slug) || {}).name || slug;

/* ------------------------------ ayudantes ------------------------------ */
export const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const money = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("es-CO");

/* Mismo slug que stikeSubSlug en app.js (la ruta de categoria/<slug>.html). */
export function slugify(s) {
  return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

export const productUrl = (p) => SITE.url(`producto/${p.slug}.html`);
export const absImg = (u) => (!u ? SITE.url(SITE.ogFallback) : /^https?:/.test(u) ? u : SITE.url(u));

/* Precio minimo y si hay con que vender, con el MISMO motor del sitio. */
export function priceInfo(p) {
  const r = browser.stikePriceRange ? browser.stikePriceRange(p) : { min: p.price, max: p.price, varies: false };
  const total = browser.stikeSellable ? browser.stikeSellable(p) : null;
  const out = browser.stikeIsOut ? browser.stikeIsOut(p) : (typeof total === "number" && total <= 0);
  return { min: r.min, max: r.max, varies: !!r.varies, soldOut: !!out };
}

/* Escritor que solo toca el disco cuando el contenido cambia. */
export function makeWriter({ checkOnly = false } = {}) {
  const state = { written: 0, unchanged: 0, changed: [], generated: new Map() };
  state.write = (relPath, content) => {
    state.generated.set(relPath, content);
    const abs = path.join(ROOT, relPath);
    const before = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
    if (before === content) { state.unchanged++; return false; }
    state.changed.push(relPath);
    if (!checkOnly) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
    state.written++;
    return true;
  };
  return state;
}

/* ------------------- paginas de listado derivadas del catalogo -------------------
   Una pagina por tipo de producto (categoria/<slug>.html) y una por marca
   (marca/<slug>.html), solo si hay producto publicado. Asi el sitio crece
   solo: cuando entra mercancia nueva, el proximo deploy crea la pagina. */
export const MIN_BRAND_PAGE = 2;                 // una marca con 1 solo producto no merece pagina propia
const BRAND_HAS_OWN_SITE = /fate/i;              // Fate tiene su micro-sitio en fate/

export function listingPages() {
  const subs = [];
  const seen = new Set();
  const add = (cat, sub) => {
    const slug = slugify(sub);
    if (!sub || seen.has(slug)) return;
    const items = VISIBLE.filter((p) => p.sub === sub);
    if (!items.length) return;
    seen.add(slug);
    const c = CATEGORIES.find((x) => x.slug === cat) || {};
    subs.push({ kind: "sub", cat, catName: c.name || cat, sub, slug, path: `categoria/${slug}.html`, items });
  };
  for (const c of CATEGORIES) for (const s of c.subs || []) add(c.slug, s);
  for (const p of VISIBLE) add(p.cat, p.sub);          // un sub que no esta en la taxonomia tambien cuenta

  const brands = [];
  const byBrand = new Map();
  for (const p of VISIBLE) {
    if (!p.brand || BRAND_HAS_OWN_SITE.test(p.brand)) continue;
    if (!byBrand.has(p.brand)) byBrand.set(p.brand, []);
    byBrand.get(p.brand).push(p);
  }
  const usedSlugs = new Set();
  for (const [brand, items] of [...byBrand].sort((a, b) => a[0].localeCompare(b[0], "es"))) {
    if (items.length < MIN_BRAND_PAGE) continue;
    let slug = slugify(brand);
    if (!slug || usedSlugs.has(slug)) continue;
    usedSlugs.add(slug);
    brands.push({ kind: "brand", brand, slug, path: `marca/${slug}.html`, items });
  }
  return { subs, brands };
}

/* Navegacion en HTML plano para quien no ejecuta JavaScript (asistentes de IA,
   muchos rastreadores): el menu del sitio lo dibuja app.js, asi que sin esto
   las paginas no tendrian ningun enlace hacia el resto del sitio. */
export function navNoscript() {
  const { subs, brands } = listingPages();
  const cats = CATEGORIES.map((c) => {
    const mine = subs.filter((s) => s.cat === c.slug);
    const inner = mine.map((s) => `<li><a href="${s.path}">${esc(s.sub)}</a> (${s.items.length})</li>`).join("");
    return `<li><a href="tienda.html?cat=${esc(c.slug)}">${esc(c.name)}</a>${inner ? `<ul>${inner}</ul>` : ""}</li>`;
  }).join("");
  const top = [
    ["index.html", "Inicio"], ["tienda.html", "Tienda"], ["armar.html", "Arma tu BMX"], ["marcas.html", "Marcas"],
    ["fate/", "Fate BMX Colombia"], ["blog.html", "Blog"], ["nosotros.html", "Nosotros"], ["contacto.html", "Contacto"],
    ["preguntas-frecuentes.html", "Preguntas frecuentes"], ["envios.html", "Envíos y entregas"], ["devoluciones.html", "Cambios y devoluciones"],
  ].map(([h, t]) => `<li><a href="${h}">${t}</a></li>`).join("");
  const br = brands.map((b) => `<a href="${b.path}">${esc(b.brand)}</a>`).join(" · ");
  return `<noscript><nav aria-label="Navegación principal"><ul>${top}</ul><ul>${cats}</ul>${br ? `<p>Marcas: ${br}</p>` : ""}</nav></noscript>`;
}

export function sitemapXml() {
  const { subs, brands } = listingPages();
  const pages = [
    ...SITE.staticPages,
    ...subs.filter((s) => exists(s.path)).map((s) => [s.path, "0.7", "weekly"]),
    ...brands.filter((b) => exists(b.path)).map((b) => [b.path, "0.6", "weekly"]),
  ];
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n`;
  const seen = new Set();
  for (const [p, pr, cf] of pages) {
    const loc = SITE.url(p);
    if (seen.has(loc)) continue;
    seen.add(loc);
    xml += `  <url><loc>${loc}</loc><changefreq>${cf}</changefreq><priority>${pr}</priority></url>\n`;
  }
  /* Un borrador no va al sitemap: pedirle a Google que indexe una pagina que
     el sitio no enlaza es pedir un error de cobertura en Search Console. */
  for (const p of VISIBLE) {
    const imgs = (p.imgs || []).filter(Boolean).slice(0, 5)
      .map((u) => `<image:image><image:loc>${esc(absImg(u))}</image:loc></image:image>`).join("");
    xml += `  <url><loc>${productUrl(p)}</loc><changefreq>weekly</changefreq><priority>0.5</priority>${imgs}</url>\n`;
  }
  return xml + `</urlset>\n`;
}

/* Llave de IndexNow: se deriva del dominio, asi no hay nada que guardar ni
   rotar. El archivo <llave>.txt en la raiz es la prueba de que el sitio es nuestro. */
export const indexNowKey = () => crypto.createHash("sha256").update("stike-indexnow:" + SITE.domain).digest("hex").slice(0, 32);
