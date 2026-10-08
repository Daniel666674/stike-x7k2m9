#!/usr/bin/env node
/* =========================================================================
   STIKE BIKE SHOP: regenera todo lo que depende del dominio.

     node tools/build-pages.mjs            escribe los cambios
     node tools/build-pages.mjs --check    no escribe nada, solo reporta

   Que reescribe:
     · producto/<slug>.html   una ficha por producto publicado
     · sitemap.xml            reconciliado contra el catalogo completo
     · robots.txt             la linea del Sitemap
     · <base href> + canonical/og:url/og:image de TODAS las paginas

   Por que existe: el dominio estaba escrito a mano en cinco archivos y en
   101 <head>. Mudar el sitio era un find/replace a ciegas por todo el repo.
   Ahora se cambia assets/js/site.js y se corre esto.

   Usa la MISMA funcion que el panel admin usa al publicar
   (assets/js/pdp-render.js), no una copia: si las dos divergen, la ficha
   que genera el build y la que genera el panel dejan de ser iguales.
   ========================================================================= */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHECK_ONLY = process.argv.includes("--check");

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const rel = (p) => path.relative(ROOT, p) || p;

/* --------------------------------------------------------------------------
   Cargar los archivos del navegador en Node.
   products-data.js y data.js son scripts de navegador (declaran globals y
   cuelgan cosas de window), no modulos. Se corren en un sandbox con un
   window falso en vez de mantener una segunda copia del catalogo para el
   build, que es justo como los dos se desincronizan.
   -------------------------------------------------------------------------- */
function loadBrowserScripts(files, exportNames) {
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
  /* Ojo: data.js declara sus tablas con `const` a nivel de script, y un
     `const` NO queda colgado del objeto sandbox como lo haria un `var` ni
     como lo que se asigna a window. Hay que pedirlo por nombre, evaluando
     en el MISMO contexto. Sin esto, STIKE_CATEGORIES llega undefined y las
     fichas salen con la categoria en minuscula ("repuestos" en vez de
     "Repuestos") sin que nada falle: el peor tipo de error. */
  const out = Object.create(null);
  for (const name of exportNames) {
    try { out[name] = vm.runInContext(`typeof ${name} !== "undefined" ? ${name} : undefined`, ctx); }
    catch { out[name] = undefined; }
  }
  return out;
}

const SITE = require(path.join(ROOT, "assets/js/site.js"));
const PdpRender = require(path.join(ROOT, "assets/js/pdp-render.js"));
const browser = loadBrowserScripts(
  ["assets/js/products-data.js", "assets/js/data.js"],
  ["STIKE_ALL_PRODUCTS", "STIKE_PRODUCTS", "STIKE_CATEGORIES", "STIKE_PART_PAGES",
   "stikeIsVisible", "stikeIsOut", "stikeTotalStock", "stikeSellable", "stikeWaText", "stikeWaLabel", "stikePrice"]
);

/* El catalogo COMPLETO, borradores incluidos: hay que saber que un borrador
   existe para no dejar su ficha vieja publicada. data.js ya filtro
   STIKE_PRODUCTS para el sitio. */
const PRODUCTS = browser.STIKE_ALL_PRODUCTS || [];
const VISIBLE = PRODUCTS.filter((p) => p.published !== false);
const CATEGORIES = browser.STIKE_CATEGORIES || [];

/* --------------------------------------------------------------------------
   Guardas antes de escribir nada
   -------------------------------------------------------------------------- */
const problems = [];

if (!PRODUCTS.length) problems.push("El catalogo llego vacio: no se generan fichas (revisa products-data.js).");
if (!CATEGORIES.length) problems.push("No se cargaron las categorias de data.js: las fichas saldrian con la categoria en minuscula.");

/* Todo producto tiene que caer en una categoria conocida, o su ficha queda
   con la migaja de pan apuntando a una vitrina que no existe. */
for (const p of PRODUCTS) {
  if (!CATEGORIES.some((c) => c.slug === p.cat)) {
    problems.push(`"${p.n || p.slug}" tiene la categoria "${p.cat}", que no existe en STIKE_CATEGORIES.`);
  }
}

/* El numero de WhatsApp vive en dos lados por ahora: site.js (lo usan las
   fichas generadas) y STIKE_CONFIG en app.js (lo usa el resto del sitio).
   Si no coinciden, la mitad del sitio escribe a un numero y la otra mitad a
   otro, y nadie lo nota hasta que un cliente no recibe respuesta. */
const appWa = (read("assets/js/app.js").match(/whatsapp:\s*"(\d+)"/) || [])[1];
if (appWa && appWa !== SITE.whatsapp) {
  problems.push(`El WhatsApp no coincide: site.js dice ${SITE.whatsapp} y app.js dice ${appWa}. Igualalos antes de generar.`);
}

if (problems.length) {
  console.error("\nNo se genero nada:\n" + problems.map((p) => "  · " + p).join("\n") + "\n");
  process.exit(1);
}

/* --------------------------------------------------------------------------
   Escritura: solo si el contenido cambio, para que el diff muestre unicamente
   lo que de verdad se movio.
   -------------------------------------------------------------------------- */
let written = 0, unchanged = 0;
const changedFiles = [];
/* Lo generado se guarda en memoria para poder verificarlo igual con --check,
   cuando nada se escribio a disco. */
const generated = new Map();

function write(relPath, content) {
  generated.set(relPath, content);
  const abs = path.join(ROOT, relPath);
  const before = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
  if (before === content) { unchanged++; return false; }
  changedFiles.push(relPath);
  if (!CHECK_ONLY) {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  written++;
  return true;
}

/* --------------------------------------------------------------------------
   1. Fichas de producto
   -------------------------------------------------------------------------- */
const template = read("_template.html");
const catName = (slug) => (CATEGORIES.find((c) => c.slug === slug) || {}).name || slug;

for (const p of VISIBLE) {
  const html = PdpRender.renderProductPage(p, template, {
    site: SITE,
    stock: browser,          // el motor de stock de data.js, el mismo del sitio
    categoryName: catName(p.cat),
    whatsapp: SITE.whatsapp,
    placeholderImg: SITE.ogFallback,
  });
  write(`producto/${p.slug}.html`, withBaseHref(html));
}

/* Fichas en disco que ya no corresponden a ningun producto publicado: un
   borrador que antes estuvo publicado, o un producto borrado. El panel las
   borra al publicar; aca solo se avisan, porque borrar archivos sin que
   nadie lo pida es peor que dejar una pagina colgada. El script de la ficha
   ya maneja el caso "este archivo no es ningun producto" sin inventar nada.
   -------------------------------------------------------------------------- */
const vivos = new Set(VISIBLE.map((p) => p.slug));
const huerfanas = fs.existsSync(path.join(ROOT, "producto"))
  ? fs.readdirSync(path.join(ROOT, "producto"))
      .filter((f) => f.endsWith(".html") && !vivos.has(f.replace(/\.html$/, "")))
  : [];

/* --------------------------------------------------------------------------
   2. <base href> y URLs absolutas en todas las paginas
   Sustitucion puntual sobre los valores, nunca borrado por patron: se
   reemplaza el contenido del atributo y nada mas. El spec es explicito
   sobre esto porque una edicion masiva por regex anclada mal ya borro 42
   lineas de codigo ajeno en produccion.
   -------------------------------------------------------------------------- */
function withBaseHref(html) {
  return html.replace(/<base href="[^"]*">/g, `<base href="${SITE.basePath}">`);
}

/* Cualquier URL absoluta que apunte al sitio (el dominio viejo o el nuevo)
   se reapunta al actual, conservando la ruta. */
const SITE_URL_RE = /https:\/\/(?:daniel666674\.github\.io\/bmxstore|daniel666674\.github\.io|stikebikeshop\.com)((?:\/[^"'\s)]*)?)/g;

// basePath actual sin barra final ("/stike-x7k2m9"), para no duplicarlo
// cuando la URL que se esta retargeteando ya lo trae puesto -- sin esto,
// correr el script sobre paginas que ya estan en el dominio actual pega el
// basePath una segunda vez ("/stike-x7k2m9/stike-x7k2m9/").
const CURRENT_PREFIX_RE = new RegExp("^" + SITE.basePath.replace(/\/$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?=/|$)");

function retargetUrls(html) {
  return html.replace(SITE_URL_RE, (match, tail) => {
    // "/bmxstore" ya viene consumido por el patron; el resto es la ruta real.
    let cleaned = String(tail || "").replace(/^\/bmxstore(?=\/|$)/, "");
    if (SITE.basePath !== "/") cleaned = cleaned.replace(CURRENT_PREFIX_RE, "");
    return cleaned && cleaned !== "/" ? SITE.url(cleaned) : SITE.url("");
  });
}

const htmlFiles = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "tools") continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs);
    else if (entry.name.endsWith(".html")) htmlFiles.push(rel(abs));
  }
})(ROOT);

for (const f of htmlFiles) {
  if (f.startsWith("producto/")) continue;          // ya regeneradas arriba
  if (f.startsWith("bmx-builder/")) continue;        // sub-app aparte, no comparte head
  const before = read(f);
  const after = retargetUrls(withBaseHref(before));
  if (after !== before) write(f, after);
}

/* --------------------------------------------------------------------------
   3. sitemap.xml — reconciliado contra el catalogo completo, no contra lo
   que se toco en esta corrida. Asi se autocorrige si quedo algo colgado.
   -------------------------------------------------------------------------- */
const STATIC_PAGES = SITE.staticPages;

/* Guarda barata contra el error inverso: una ruta en la lista que ya no
   existe como archivo es una URL que le pedimos indexar a Google y le
   devuelve 404. */
for (const [p] of STATIC_PAGES) {
  const file = p === "" ? "index.html" : p.endsWith("/") ? p + "index.html" : p;
  if (!fs.existsSync(path.join(ROOT, file))) {
    problems.push(`El sitemap lista "${p}" pero ${file} no existe en el repo.`);
  }
}
if (problems.length) {
  console.error("\nNo se genero nada:\n" + problems.map((x) => "  · " + x).join("\n") + "\n");
  process.exit(1);
}

const partPages = (browser.STIKE_PART_PAGES || []).map((s) => [`categoria/${s}.html`, "0.7", "weekly"]);

let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
for (const [p, pr, cf] of [...STATIC_PAGES, ...partPages]) {
  xml += `  <url><loc>${SITE.url(p)}</loc><changefreq>${cf}</changefreq><priority>${pr}</priority></url>\n`;
}
/* Un borrador no va al sitemap: pedirle a Google que indexe una pagina que
   el sitio no enlaza es pedir un error de cobertura en Search Console. */
for (const p of PRODUCTS.filter((p) => p.published !== false)) {
  xml += `  <url><loc>${SITE.url(`producto/${p.slug}.html`)}</loc><changefreq>weekly</changefreq><priority>0.5</priority></url>\n`;
}
xml += `</urlset>\n`;
write("sitemap.xml", xml);

/* --------------------------------------------------------------------------
   4. robots.txt — solo la linea del Sitemap
   -------------------------------------------------------------------------- */
write("robots.txt", read("robots.txt").replace(/^Sitemap:.*$/m, `Sitemap: ${SITE.url("sitemap.xml")}`));

/* --------------------------------------------------------------------------
   Verificacion de salida: las URL generadas tienen que ser URL validas.
   Esto es lo que habria atrapado el og:image roto de las 52 fichas.
   -------------------------------------------------------------------------- */
/* Un marcador sin reemplazar sale como "__PRICE_PLAIN__" en medio del HTML:
   no revienta nada, solo deja la ficha mal y los datos estructurados
   invalidos, que Google descarta en silencio. */
const leftovers = [];
for (const [f, body] of generated) {
  if (!f.endsWith(".html")) continue;
  for (const m of new Set([...body.matchAll(/__[A-Z][A-Z_]*__/g)].map((x) => x[0]))) {
    leftovers.push(`${f}: ${m}`);
  }
}

/* Los datos estructurados tienen que ser JSON valido o Google los tira. */
const badJson = [];
for (const [f, body] of generated) {
  if (!f.endsWith(".html")) continue;
  for (const m of body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { JSON.parse(m[1]); } catch (e) { badJson.push(`${f}: ${e.message}`); }
  }
}

const badUrls = [];
for (const [f, body] of generated) {
  if (!f.endsWith(".html")) continue;
  for (const m of body.matchAll(/(?:href|content|src)="(https:\/\/[^"]+)"/g)) {
    let u;
    try { u = new URL(m[1]); } catch { badUrls.push(`${f}: ${m[1]} (no es una URL valida)`); continue; }
    /* Solo las URL que apuntan a ESTE sitio. Un enlace de wa.me lleva la URL
       del producto dentro del ?text= y no es una ruta del sitio. */
    if (u.hostname !== SITE.domain) continue;
    // "/bmxstoreassets/..." : la ruta pegada al dominio sin barra en medio.
    // Este es el bug que dejo el og:image de las 52 fichas en 404.
    if (SITE.basePath !== "/" && !u.pathname.startsWith(SITE.basePath)) {
      badUrls.push(`${f}: ${u.href} (la ruta no arranca en ${SITE.basePath})`);
    }
  }
}

console.log(`\nStike — build de paginas${CHECK_ONLY ? " (--check, no escribe)" : ""}`);
console.log(`  sitio        ${SITE.siteUrl}`);
console.log(`  base href    ${SITE.basePath}`);
console.log(`  productos    ${PRODUCTS.length} (${PRODUCTS.filter((p) => p.published === false).length} en borrador, fuera del sitemap)`);
console.log(`  archivos     ${written} ${CHECK_ONLY ? "cambiarian" : "escritos"}, ${unchanged} sin cambios`);
if (huerfanas.length) {
  console.log(`\n  ${huerfanas.length} ficha(s) en producto/ que no son de ningun producto publicado:`);
  huerfanas.slice(0, 10).forEach((f) => console.log("   · producto/" + f));
  console.log("   (el panel las borra al publicar; revisalas si no esperabas ninguna)");
}

for (const [label, list] of [["marcador(es) sin reemplazar", leftovers], ["bloque(s) de datos estructurados invalidos", badJson]]) {
  if (!list.length) continue;
  console.error(`\n  ${list.length} ${label}:`);
  list.slice(0, 10).forEach((x) => console.error("   · " + x));
  process.exitCode = 1;
}

if (badUrls.length) {
  console.error(`\n  ${badUrls.length} URL sospechosa(s):`);
  badUrls.slice(0, 10).forEach((b) => console.error("   · " + b));
  process.exit(1);
}

if (CHECK_ONLY && written) {
  console.log("\n  Hay paginas desactualizadas. Corre el script sin --check.");
  process.exit(1);
}
console.log("");
