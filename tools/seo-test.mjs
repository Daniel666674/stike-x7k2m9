#!/usr/bin/env node
/* =========================================================================
   STIKE BIKE SHOP: auditoria SEO + GEO de punta a punta.

     node tools/seo-test.mjs            audita el repo (o STIKE_ROOT)

   Comprueba lo que de verdad lee un buscador o un asistente de IA: titulo,
   descripcion, canonical, h1, datos estructurados validos, sitemap sin
   paginas rotas, robots.txt, llms.txt, el feed de Google, las redirecciones
   301 y que los generadores no tengan nada pendiente (el repo ya trae lo
   que ellos escribirian). Sale con codigo 1 si algo falla.
   ========================================================================= */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ROOT, SITE, read, exists, VISIBLE, PdpRender, browser, indexNowKey, listingPages } from "./lib-catalog.mjs";

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const fails = [], warns = [];
let checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) fails.push(msg); };
const warn = (msg) => warns.push(msg);

const decode = (s) => String(s).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const fileOfUrl = (u) => {
  if (!u.startsWith(SITE.siteUrl)) return null;
  let p = u.slice(SITE.siteUrl.length).split("#")[0].split("?")[0].replace(/^\//, "");
  if (p === "" || p.endsWith("/")) p += "index.html";
  return p;
};

/* ------------------------------ sitemap ------------------------------ */
const sitemap = read("sitemap.xml");
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
ok(locs.length === new Set(locs).size, "sitemap.xml tiene URLs repetidas");
ok(sitemap.includes("xmlns:image="), "sitemap.xml no declara el espacio de nombres de imagenes");
for (const p of VISIBLE) ok(locs.includes(SITE.url(`producto/${p.slug}.html`)), `sitemap.xml no incluye ${p.slug}`);
{
  const L = listingPages();
  for (const x of [...L.subs, ...L.brands]) ok(locs.includes(SITE.url(x.path)), `sitemap.xml no incluye ${x.path}`);
  ok(locs.includes(SITE.url("preguntas-frecuentes.html")), "sitemap.xml no incluye preguntas-frecuentes.html");
}

const pages = [];
for (const u of locs) {
  const f = fileOfUrl(u);
  if (!f || !exists(f)) { ok(false, `sitemap.xml lista ${u} pero el archivo no existe`); continue; }
  pages.push({ url: u, file: f, html: read(f) });
}

/* ----------------------- cada pagina indexable ----------------------- */
const titles = new Map(), descs = new Map();
const PLACEHOLDER = /\[(?:indicar|[0-9]+ a [0-9]+)[^\]]*\]/;
for (const pg of pages) {
  const { html, file } = pg;
  const head = (html.match(/<head>([\s\S]*?)<\/head>/) || [])[1] || "";
  const tag = (re) => [...head.matchAll(re)].map((m) => decode(m[1]));
  const t = tag(/<title>([\s\S]*?)<\/title>/g);
  const d = tag(/<meta\s+name="description"\s+content="([^"]*)"/g);
  const c = tag(/<link\s+rel="canonical"\s+href="([^"]*)"/g);
  const r = tag(/<meta\s+name="robots"\s+content="([^"]*)"/g);
  ok(t.length === 1, `${file}: debe tener exactamente un <title> (tiene ${t.length})`);
  ok(d.length === 1, `${file}: debe tener exactamente una meta description (tiene ${d.length})`);
  ok(c.length === 1, `${file}: debe tener exactamente un canonical (tiene ${c.length})`);
  if (t[0]) { ok(t[0].length >= 10 && t[0].length <= 72, `${file}: titulo de ${t[0].length} caracteres (10-72): "${t[0]}"`); titles.set(t[0], [...(titles.get(t[0]) || []), file]); }
  if (d[0]) { ok(d[0].length >= 50 && d[0].length <= 165, `${file}: descripcion de ${d[0].length} caracteres (50-165)`); descs.set(d[0], [...(descs.get(d[0]) || []), file]); }
  if (c[0]) ok(c[0] === pg.url, `${file}: canonical ${c[0]} no es la URL del sitemap ${pg.url}`);
  ok(!r.some((x) => /noindex/.test(x)), `${file}: esta en el sitemap pero es noindex`);
  ok(/<html lang="es/.test(html), `${file}: falta <html lang="es...">`);
  ok(/<meta\s+property="og:image"\s+content="https:\/\//.test(head), `${file}: og:image ausente o no absoluta`);
  if (!/^fate\//.test(file)) ok((html.match(/<h1[\s>]/g) || []).length === 1, `${file}: debe tener exactamente un <h1> (tiene ${(html.match(/<h1[\s>]/g) || []).length})`);
  for (const m of head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { JSON.parse(m[1]); checks++; } catch (e) { ok(false, `${file}: JSON-LD invalido (${e.message})`); }
  }
  ok(!/undefined|NaN|__[A-Z_]{3,}__/.test(html.replace(/<script[\s\S]*?<\/script>/g, "")), `${file}: texto roto (undefined / NaN / marcador sin reemplazar)`);
  if (PLACEHOLDER.test(html.replace(/<script[\s\S]*?<\/script>/g, ""))) warn(`${file}: tiene un texto pendiente entre corchetes (${html.match(PLACEHOLDER)[0]}); lo tiene que definir el dueno`);
}
for (const [t, files] of titles) ok(files.length === 1, `titulo repetido en ${files.length} paginas: "${t}" (${files.slice(0, 3).join(", ")})`);
for (const [d, files] of descs) ok(files.length === 1, `descripcion repetida en ${files.length} paginas (${files.slice(0, 3).join(", ")})`);

/* -------------------------- fichas de producto -------------------------- */
const graphOf = (html) => {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  try { return JSON.parse(m[1])["@graph"] || []; } catch { return []; }
};
for (const p of VISIBLE) {
  const f = `producto/${p.slug}.html`;
  if (!exists(f)) { ok(false, `falta ${f}`); continue; }
  const html = read(f);
  const g = graphOf(html);
  const node = g.find((n) => n["@type"] === "Product" || n["@type"] === "ProductGroup");
  ok(!!node, `${f}: sin Product/ProductGroup en JSON-LD`);
  ok(g.some((n) => n["@type"] === "BreadcrumbList"), `${f}: sin BreadcrumbList`);
  if (node) {
    const variants = PdpRender.variantList(p, browser);
    if (variants.length > 1) {
      ok(node["@type"] === "ProductGroup", `${f}: tiene ${variants.length} variantes y no es ProductGroup`);
      ok((node.hasVariant || []).length === variants.length, `${f}: hasVariant tiene ${(node.hasVariant || []).length} y el catalogo ${variants.length}`);
      for (const v of node.hasVariant || []) ok(v.offers && /^\d+$/.test(v.offers.price) && v.offers.priceCurrency === "COP" && /schema\.org\/(InStock|OutOfStock)/.test(v.offers.availability), `${f}: oferta de variante incompleta`);
    } else {
      ok(node.offers && /^\d+$/.test(node.offers.price) && node.offers.priceCurrency === "COP", `${f}: oferta sin precio numerico en COP`);
    }
    ok(node.brand && node.brand.name, `${f}: sin marca`);
    const imgs = [].concat(node.image || []);
    ok(imgs.length > 0, `${f}: sin imagen en JSON-LD`);
  }
  for (const u of p.imgs || []) if (!/^https?:/.test(u)) ok(exists(u.split("?")[0]), `${f}: la imagen ${u} no existe en el repo`);
  ok(/<noscript><nav/.test(html), `${f}: sin menu en HTML plano (noscript)`);
}

/* ---------------------------- robots.txt ---------------------------- */
{
  const robots = read("robots.txt");
  ok(/^Sitemap: https:\/\/[^\s]+\/sitemap\.xml$/m.test(robots), "robots.txt sin linea Sitemap valida");
  for (const bot of ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "PerplexityBot", "Google-Extended", "Bingbot", "Googlebot"]) {
    ok(new RegExp(`User-agent: ${bot}\\s+Allow: /`).test(robots), `robots.txt no permite a ${bot}`);
  }
  ok(!/^Disallow: \/\s*$/m.test(robots), "robots.txt bloquea TODO el sitio");
  ok(!/Disallow: \/assets/.test(robots), "robots.txt bloquea /assets/ (Google necesita el CSS y el JS)");
  for (const x of ["/admin.html", "/api/", "/data/", "/carrito.html"]) ok(robots.includes(`Disallow: ${x}`), `robots.txt no bloquea ${x}`);
  ok(robots.includes("llms.txt"), "robots.txt no menciona llms.txt");
}

/* ---------------------------- llms.txt ---------------------------- */
for (const f of ["llms.txt", "llms-full.txt"]) {
  ok(exists(f), `falta ${f}`);
  if (!exists(f)) continue;
  const txt = read(f);
  ok(/^# /.test(txt), `${f}: debe empezar con "# Nombre"`);
  ok(/^> /m.test(txt), `${f}: falta el resumen (> ...)`);
  ok(txt.includes(SITE.business.telephone) && txt.includes(SITE.business.street), `${f}: faltan telefono o direccion`);
  const links = [...txt.matchAll(/\]\((https?:[^)]+)\)/g)].map((m) => m[1]);
  ok(links.length > 5, `${f}: casi sin enlaces`);
  for (const u of links) { const file = fileOfUrl(u); if (file) ok(exists(file), `${f}: enlace roto ${u}`); }
}
{
  const full = read("llms-full.txt");
  const missing = VISIBLE.filter((p) => !full.includes(`/producto/${p.slug}.html`));
  ok(!missing.length, `llms-full.txt no incluye ${missing.length} producto(s): ${missing.slice(0, 3).map((p) => p.slug).join(", ")}`);
}

/* ------------------------- feed de Google Merchant ------------------------- */
{
  const feed = read("feed/google-merchant.xml");
  const items = [...feed.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  const expected = VISIBLE.reduce((n, p) => n + Math.max(1, PdpRender.variantList(p, browser).length), 0);
  ok(items.length === expected, `feed: ${items.length} items y el catalogo tiene ${expected} variantes`);
  const ids = new Set();
  for (const it of items) {
    const g = (k) => (it.match(new RegExp(`<g:${k}>([\\s\\S]*?)</g:${k}>`)) || [])[1];
    const id = g("id");
    ok(id && !ids.has(id), `feed: id vacio o repetido (${id})`); ids.add(id);
    ok(g("title") && g("description") && g("link") && g("image_link"), `feed: ${id} sin titulo, descripcion, enlace o imagen`);
    ok(/^\d+\.00 COP$/.test(g("price") || ""), `feed: ${id} con precio mal formado (${g("price")})`);
    ok(/^(in_stock|out_of_stock)$/.test(g("availability") || ""), `feed: ${id} con disponibilidad invalida`);
    ok((g("link") || "").startsWith(SITE.siteUrl), `feed: ${id} con enlace fuera del sitio`);
    ok(/^https:\/\//.test(g("image_link") || ""), `feed: ${id} con imagen no absoluta`);
  }
}

/* ---------------------- 404, redirecciones 301, IndexNow ---------------------- */
{
  ok(exists("404.html") && /noindex/.test(read("404.html")), "404.html no existe o no es noindex");
  const ht = read(".htaccess");
  ok(/ErrorDocument 404 \/404\.html/.test(ht), ".htaccess sin ErrorDocument 404");
  const rules = [...ht.matchAll(/RewriteRule \^producto\/([^$]+)\\\.html\$ \/producto\/([^ ]+)\.html \[R=301,L\]/g)];
  const live = new Set(VISIBLE.map((p) => p.slug));
  const redirects = exists("data/redirects.json") ? Object.keys(JSON.parse(read("data/redirects.json"))).length : 0;
  ok(rules.length > 0 && rules.length <= redirects, `.htaccess: ${rules.length} reglas 301 para ${redirects} redirecciones`);
  for (const [, from, to] of rules) {
    ok(live.has(to), `301 ${from} -> ${to}: el destino no es un producto publicado`);
    ok(!live.has(from.replace(/\\/g, "")), `301 ${from}: el origen es un producto publicado`);
  }
  const key = indexNowKey();
  ok(exists(`${key}.txt`) && read(`${key}.txt`).trim() === key, "falta el archivo de la llave de IndexNow");
}

/* ----------------- enlaces internos de las paginas generadas ----------------- */
{
  const L = listingPages();
  const generated = ["404.html", "preguntas-frecuentes.html", ...L.subs.map((s) => s.path), ...L.brands.map((b) => b.path)];
  for (const f of generated) {
    ok(exists(f), `falta la pagina generada ${f}`);
    if (!exists(f)) continue;
    for (const m of read(f).matchAll(/href="([^"#]+)(?:#[^"]*)?"/g)) {
      const h = m[1];
      if (/^(https?:|mailto:|tel:|javascript:)/.test(h)) continue;
      const file = h.split("?")[0];
      if (file && !file.startsWith("data:")) ok(exists(file) || exists(file + "index.html"), `${f}: enlace roto "${h}"`);
    }
  }
}

/* ---- los generadores no tienen nada pendiente (el repo trae su salida) ---- */
for (const script of ["build-seo.mjs", "build-pages.mjs"]) {
  const r = spawnSync(process.execPath, [path.join(TOOLS, script), "--check"], { env: process.env, encoding: "utf8" });
  checks++;
  if (r.status !== 0) fails.push(`${script} --check: hay archivos desactualizados. Corre "node tools/${script}" y revisa el diff.\n${(r.stdout + r.stderr).split("\n").slice(-8).join("\n")}`);
}

console.log(`\nStike — auditoria SEO/GEO: ${checks} comprobaciones, ${fails.length} fallas, ${warns.length} avisos`);
if (warns.length) { console.log("\nPendiente del dueno:"); [...new Set(warns)].forEach((w) => console.log("  ~ " + w)); }
if (fails.length) { console.error("\nFALLAS:"); fails.slice(0, 40).forEach((f) => console.error("  ✗ " + f)); if (fails.length > 40) console.error(`  … y ${fails.length - 40} más`); process.exit(1); }
console.log("\n  Todo bien.\n");
