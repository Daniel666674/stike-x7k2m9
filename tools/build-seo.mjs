#!/usr/bin/env node
/* =========================================================================
   STIKE BIKE SHOP: SEO + GEO (buscadores y asistentes de IA), de una vez
   y que se mantenga solo.

     node tools/build-seo.mjs            escribe los cambios
     node tools/build-seo.mjs --check    no escribe nada, solo reporta

   Todo sale del catalogo (assets/js/products-data.js) y de los datos del
   negocio (assets/js/site.js). Nadie lo mantiene a mano: tools/stage-hostinger.sh
   lo corre en CADA deploy, asi que un producto nuevo, un precio o un stock
   que cambie en el panel llega ya reflejado a Google y a los asistentes.

   Genera:
     · robots.txt                      buscadores + rastreadores de IA permitidos
     · llms.txt / llms-full.txt        resumen del negocio y catalogo para asistentes de IA
     · feed/google-merchant.xml        productos gratis en Google (Merchant Center)
     · categoria/<tipo>.html           una pagina por tipo de producto con stock
     · marca/<marca>.html              una pagina por marca (2+ productos)
     · <head> de las paginas fijas     titulo, descripcion, canonical, Open Graph, JSON-LD
     · 404.html                        pagina de error con enlaces (no un 404 mudo)
     · .htaccess                       301 reales para las fichas que se fusionaron
     · <clave>.txt                     llave de IndexNow (Bing/ChatGPT/Copilot)
     · data.js                         la lista de paginas de tipo/marca que usa el menu

   Despues corre tools/build-pages.mjs (fichas de producto y sitemap).
   ========================================================================= */
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import {
  ROOT, read, exists, SITE, PdpRender, browser, PRODUCTS, VISIBLE, CATEGORIES, catName,
  esc, money, slugify, productUrl, absImg, priceInfo, makeWriter, listingPages, navNoscript, indexNowKey,
} from "./lib-catalog.mjs";

const CHECK_ONLY = process.argv.includes("--check");
const W = makeWriter({ checkOnly: CHECK_ONLY });
const write = W.write;
const warnings = [];

const B = SITE.business;
const ORG_ID = SITE.url("") + "#organization";
const SITE_ID = SITE.url("") + "#website";
const ROBOTS_INDEX = "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1";
const ROBOTS_NOINDEX = "noindex, follow";
const LISTINGS = listingPages();
const CONTENT = exists("data/seo-content.json") ? JSON.parse(read("data/seo-content.json")) : {};

const plain = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
function cut(str, max) {
  str = plain(str);
  if (str.length <= max) return str;
  const t = str.slice(0, max - 1), i = t.lastIndexOf(" ");
  return (i > max * 0.6 ? t.slice(0, i) : t).replace(/[,;:\-–—\s]+$/, "") + "…";
}
const decode = (s) => String(s).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const firstSentence = (t) => { const m = plain(t).match(/^.*?[.!?](?=\s|$)/); return m ? m[0] : plain(t); };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const jsonLd = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`;

/* Datos del catalogo que se repiten en varios textos. */
const priceMin = (items) => Math.min(...items.map((p) => priceInfo(p).min));
const brandsByCount = () => {
  const c = new Map();
  for (const p of VISIBLE) if (p.brand && !/fate/i.test(p.brand)) c.set(p.brand, (c.get(p.brand) || 0) + 1);
  return [...c].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es"));
};

/* ===================== <head>: bloque SEO idempotente ===================== */
const START = "<!--seo:start-->", END = "<!--seo:end-->";

function existingHead(html) {
  const grab = (re) => { const m = html.match(re); return m ? decode(m[1]) : ""; };
  return {
    title: grab(/<title>([\s\S]*?)<\/title>/),
    description: grab(/<meta\s+name="description"\s+content="([^"]*)"/),
    robots: grab(/<meta\s+name="robots"\s+content="([^"]*)"/),
    ogImage: grab(/<meta\s+property="og:image"\s+content="([^"]*)"/),
  };
}

function headBlock(d) {
  const img = d.ogImage || SITE.url(SITE.ogFallback);
  const lines = [
    START,
    `<title>${esc(d.title)}</title>`,
    `<meta name="description" content="${esc(d.description)}">`,
    `<meta name="robots" content="${esc(d.robots || ROBOTS_INDEX)}">`,
    `<link rel="canonical" href="${esc(d.canonical)}">`,
  ];
  const indexable = !/noindex/.test(d.robots || "");
  if (indexable) {
    lines.push(`<link rel="alternate" hreflang="es-CO" href="${esc(d.canonical)}">`,
               `<link rel="alternate" hreflang="x-default" href="${esc(d.canonical)}">`);
  }
  if (d.home && SITE.googleSiteVerification) lines.push(`<meta name="google-site-verification" content="${esc(SITE.googleSiteVerification)}">`);
  if (d.home && SITE.bingSiteVerification) lines.push(`<meta name="msvalidate.01" content="${esc(SITE.bingSiteVerification)}">`);
  if (indexable) {
    lines.push(
      `<meta property="og:type" content="website">`,
      `<meta property="og:site_name" content="${esc(SITE.name)}">`,
      `<meta property="og:locale" content="es_CO">`,
      `<meta property="og:title" content="${esc(d.title)}">`,
      `<meta property="og:description" content="${esc(d.description)}">`,
      `<meta property="og:url" content="${esc(d.canonical)}">`,
      `<meta property="og:image" content="${esc(img)}">`,
      `<meta name="twitter:card" content="summary_large_image">`,
      `<meta name="twitter:title" content="${esc(d.title)}">`,
      `<meta name="twitter:description" content="${esc(d.description)}">`,
      `<meta name="twitter:image" content="${esc(img)}">`,
    );
  }
  for (const node of d.jsonld || []) lines.push(jsonLd(node));
  lines.push(END);
  return lines.join("\n  ");
}

/* Quita, UNA etiqueta a la vez y por su nombre, lo que el bloque va a
   reemplazar. Nunca borra por patron de varias lineas (una edicion masiva
   anclada mal ya borro codigo ajeno en produccion). */
function removeOldSeoTags(head) {
  return head
    .replace(/<title>[\s\S]*?<\/title>/g, "")
    .replace(/<meta\s+name="(?:description|robots|twitter:[^"]*|google-site-verification|msvalidate\.01)"[^>]*>/g, "")
    .replace(/<meta\s+property="(?:og:[^"]*|product:[^"]*)"[^>]*>/g, "")
    .replace(/<link\s+rel="(?:canonical|alternate)"[^>]*>/g, "")
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, "")
    .replace(/\n[ \t]*(?=\n)/g, "");
}

function applyHead(html, d) {
  const m = html.match(/<head>([\s\S]*?)<\/head>/);
  if (!m) { warnings.push(`${d.file}: no tiene <head>`); return html; }
  const block = headBlock(d);
  let head = m[1];
  if (head.includes(START)) {
    head = head.replace(new RegExp(reEsc(START) + "[\\s\\S]*?" + reEsc(END)), () => block);
  } else {
    head = removeOldSeoTags(head);
    if (/<meta\s+name="viewport"[^>]*>/.test(head)) head = head.replace(/(<meta\s+name="viewport"[^>]*>)/, (x) => x + "\n  " + block);
    else head = "\n  " + block + head;
  }
  return html.replace(/<head>[\s\S]*?<\/head>/, () => "<head>" + head + "</head>");
}

/* Bloques en <body> con marcadores: se reemplazan en su sitio o se insertan
   despues de un ancla conocida. */
function applyBlock(html, start, end, content, anchorRe) {
  const wrapped = `${start}${content}${end}`;
  const re = new RegExp(reEsc(start) + "[\\s\\S]*?" + reEsc(end));
  if (re.test(html)) return html.replace(re, () => wrapped);
  if (!anchorRe) return html;
  if (!anchorRe.test(html)) return html;
  return html.replace(anchorRe, (a) => a + "\n  " + wrapped);
}
const NAV_START = "<!--seo-nav:start-->", NAV_END = "<!--seo-nav:end-->";
const LIST_START = "<!--seo-list:start-->", LIST_END = "<!--seo-list:end-->";
const applyNav = (html) => applyBlock(html, NAV_START, NAV_END, navNoscript(), /<div id="site-header"><\/div>/);

function productListNoscript(items) {
  if (!items.length) return "";
  return "<noscript><ul>" + items.map((p) => {
    const pi = priceInfo(p);
    return `<li><a href="producto/${esc(p.slug)}.html">${esc(p.n)}</a> — ${esc(p.brand || "")} — ${pi.varies ? "desde " : ""}${money(pi.min)}${pi.soldOut ? " (agotado)" : ""}</li>`;
  }).join("") + "</ul></noscript>";
}

/* ============================ JSON-LD: nodos ============================= */
function orgNode() {
  const sameAs = B.sameAs || [];
  const node = {
    "@type": B.type || "BicycleStore", "@id": ORG_ID, "name": B.legalName, "alternateName": ["Stike", "Stike BMX"],
    "description": B.description, "url": SITE.url(""),
    "logo": { "@type": "ImageObject", "url": SITE.url(SITE.ogFallback) },
    "image": SITE.url(SITE.ogFallback),
    "telephone": B.telephone, "email": B.email, "priceRange": "$$", "currenciesAccepted": "COP",
    "address": { "@type": "PostalAddress", "streetAddress": B.street, "addressLocality": B.locality, "addressRegion": B.region, "addressCountry": B.country },
    "geo": { "@type": "GeoCoordinates", "latitude": B.geo.lat, "longitude": B.geo.lng },
    "hasMap": `https://www.google.com/maps/search/?api=1&query=${B.geo.lat},${B.geo.lng}`,
    "openingHoursSpecification": [{ "@type": "OpeningHoursSpecification", "dayOfWeek": B.hours.days, "opens": B.hours.opens, "closes": B.hours.closes }],
    "areaServed": [{ "@type": "Country", "name": "Colombia" }, { "@type": "City", "name": "Bogotá" }],
    "knowsAbout": ["BMX", "Repuestos BMX", "Armado de BMX", "Protecciones BMX", "Ropa BMX"],
    "contactPoint": [{ "@type": "ContactPoint", "contactType": "customer service", "telephone": B.telephone, "email": B.email, "areaServed": "CO", "availableLanguage": "es" }],
  };
  if (sameAs.length) node.sameAs = sameAs;
  if (B.payments && B.payments.length) node.paymentAccepted = B.payments.join(", ");
  const subs = LISTINGS.subs.filter((s) => exists(s.path));
  if (subs.length) {
    node.hasOfferCatalog = {
      "@type": "OfferCatalog", "name": `Catálogo ${SITE.name}`, "url": SITE.url("tienda.html"),
      "itemListElement": CATEGORIES.map((c) => ({
        "@type": "OfferCatalog", "name": c.name,
        "itemListElement": subs.filter((s) => s.cat === c.slug).map((s) => ({ "@type": "OfferCatalog", "name": s.sub, "url": SITE.url(s.path) })),
      })).filter((c) => c.itemListElement.length),
    };
  }
  return node;
}
const orgRef = () => ({ "@type": "Organization", "@id": ORG_ID, "name": SITE.name, "url": SITE.url("") });
function websiteNode() {
  return {
    "@type": "WebSite", "@id": SITE_ID, "url": SITE.url(""), "name": SITE.name, "inLanguage": "es-CO",
    "publisher": { "@id": ORG_ID },
    "potentialAction": { "@type": "SearchAction", "target": { "@type": "EntryPoint", "urlTemplate": SITE.url("tienda.html?q={search_term_string}") }, "query-input": "required name=search_term_string" },
  };
}
function breadcrumbNode(crumbs, canonical) {
  return {
    "@type": "BreadcrumbList", "@id": canonical + "#breadcrumb",
    "itemListElement": crumbs.map((c, i) => ({ "@type": "ListItem", "position": i + 1, "name": c[0], "item": c[1] })),
  };
}
function pageNode(d, type) {
  return {
    "@type": type || "WebPage", "@id": d.canonical + "#webpage", "url": d.canonical, "name": d.title, "description": d.description,
    "inLanguage": "es-CO", "isPartOf": { "@id": SITE_ID }, "about": { "@id": ORG_ID },
    ...(d.crumbs && d.crumbs.length ? { "breadcrumb": { "@id": d.canonical + "#breadcrumb" } } : {}),
  };
}
function itemListNode(items, canonical, max) {
  const list = items.slice(0, max || 100);
  return {
    "@type": "ItemList", "@id": canonical + "#list", "numberOfItems": items.length,
    "itemListElement": list.map((p, i) => ({ "@type": "ListItem", "position": i + 1, "url": productUrl(p), "name": p.n })),
  };
}

/* Arma el descriptor completo de una pagina. */
function describePage(o) {
  const canonical = SITE.url(o.path === "index.html" ? "" : o.path);
  const crumbs = o.crumbs ? [["Inicio", SITE.url("")], ...o.crumbs.map(([n, p]) => [n, SITE.url(p)])] : null;
  const d = { file: o.path, title: o.title, description: o.description, canonical, robots: o.robots, ogImage: o.ogImage, home: !!o.home, crumbs };
  const graph = [];
  if (o.home) graph.push(orgNode(), websiteNode());
  else if (o.org) graph.push(orgNode());
  const pg = pageNode(d, o.type);
  if (o.org && !o.home) pg.mainEntity = { "@id": ORG_ID };
  if (o.itemList) pg.mainEntity = { "@id": canonical + "#list" };
  graph.push(pg);
  if (crumbs) graph.push(breadcrumbNode(crumbs, canonical));
  if (o.itemList) graph.push(itemListNode(o.itemList, canonical, o.itemMax));
  if (o.extraNodes) graph.push(...o.extraNodes);
  d.jsonld = (d.robots || "").includes("noindex") ? [] : [{ "@context": "https://schema.org", "@graph": graph }];
  return d;
}

/* ===================== paginas de tipo y de marca ===================== */
const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@75..125,400..900&family=Barlow+Condensed:ital,wght@0,400;0,500;0,600;0,700;1,300;1,400;1,500;1,600&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">`;

const sibLinks = (items) => items.map((i) => `<a class="sib" href="${i.path}">${esc(i.label)} <b>${i.count}</b></a>`).join("");

function newListingHtml(o) {
  /* o: {h1, kicker, intro, crumbHtml, activeNav, filterJs, emptyHref, emptyLabel, sibKicker, sibTitle, sibMoreHref, sibItems} */
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
<base href="${SITE.basePath}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${START}${END}
  ${FONTS}
  <link rel="stylesheet" href="assets/css/styles.css">
  <link rel="icon" href="assets/img/favicon.png">
</head>
<body>
  <div id="site-header"></div>
  ${NAV_START}${NAV_END}

  <div class="wrap page-head">
    <nav class="breadcrumb">${o.crumbHtml}</nav>
    <span class="kicker">${esc(o.kicker)}</span>
    <h1>${esc(o.h1)}</h1>
    <p class="cat-intro">${esc(o.intro)}</p>
    <div class="count" id="result-count"></div>
  </div>

  <section class="section" style="padding-top:10px">
    <div class="wrap">
      <div class="product-grid" id="grid"></div>
      ${LIST_START}${LIST_END}
      <div class="empty" id="empty" style="display:none">
        <h3 style="font-size:26px">Sin stock por ahora</h3>
        <p>Escríbenos por WhatsApp y te avisamos cuando entre, o mira el resto del catálogo.</p>
        <a class="btn cyan" href="${o.emptyHref}">${esc(o.emptyLabel)}</a>
      </div>
    </div>
  </section>

  <section class="section" style="padding-top:0">
    <div class="wrap">
      <div class="section-head"><div><span class="kicker">Seguir explorando</span><h2>${esc(o.sibTitle)}</h2></div><a class="link-more" href="${o.sibMoreHref}">Ver todo →</a></div>
      <div class="sibling-links"></div>
    </div>
  </section>

  <div id="site-footer"></div>

  <script src="assets/js/products-data.js"></script>
  <script src="assets/js/data.js"></script>
  <script src="assets/js/app.js"></script>
  <script>
    stikeInit(${JSON.stringify(o.activeNav)});
    var list = STIKE_PRODUCTS.filter(function (p) { return ${o.filterJs}; });
    var grid = document.getElementById("grid");
    var empty = document.getElementById("empty");
    grid.innerHTML = list.map(stikeProductCard).join("");
    grid.style.display = list.length ? "grid" : "none";
    empty.style.display = list.length ? "none" : "block";
    document.getElementById("result-count").textContent = list.length + " producto" + (list.length === 1 ? "" : "s");
  </script>
  <script src="assets/js/animations.js"></script>
</body>
</html>
`;
}

function setSiblings(html, items) {
  return html.replace(/<div class="sibling-links">[\s\S]*?<\/div>/, () => `<div class="sibling-links">${sibLinks(items)}</div>`);
}

const pageH1 = (html) => decode((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || "").replace(/<[^>]+>/g, "").trim();
const pageIntro = (html) => decode((html.match(/<p class="cat-intro">([\s\S]*?)<\/p>/) || [])[1] || "").replace(/<[^>]+>/g, "").trim();

const generatedPaths = new Set();

/* ---- tipos de producto: categoria/<slug>.html ---- */
function buildSubPages() {
  const dirPages = exists("categoria") ? fs.readdirSync(path.join(ROOT, "categoria")).filter((f) => f.endsWith(".html")).map((f) => f.replace(/\.html$/, "")) : [];
  const slugs = new Set([...dirPages, ...LISTINGS.subs.map((s) => s.slug)]);
  const pageList = [];
  for (const slug of [...slugs].sort()) {
    const p = `categoria/${slug}.html`;
    const live = LISTINGS.subs.find((s) => s.slug === slug);
    let html = exists(p) ? read(p) : null;
    const items = live ? live.items : [];
    let sub = live ? live.sub : ((html || "").match(/var SUB = "([^"]+)"/) || [])[1];
    let cat = live ? live.cat : ((html || "").match(/stikeInit\("([^"]+)"\)/) || [])[1];
    if (!sub) { warnings.push(`${p}: no se pudo saber de que tipo es`); continue; }
    if (!cat) cat = (CATEGORIES.find((c) => (c.subs || []).includes(sub)) || {}).slug || "repuestos";
    const copy = (CONTENT.subs || {})[slug] || {};
    const cname = catName(cat);
    const h1 = html ? pageH1(html) : (copy.h1 || `${sub} BMX`);
    const intro = copy.intro || (html ? pageIntro(html) : "") || `${sub} para BMX en Bogotá, con envíos a toda Colombia.`;
    const sibs = LISTINGS.subs.filter((s) => s.cat === cat && s.slug !== slug)
      .map((s) => ({ path: s.path, label: s.sub, count: s.items.length }));
    if (!html) {
      html = newListingHtml({
        h1, kicker: `${cname} BMX`, intro,
        crumbHtml: `<a href="index.html">Inicio</a><span class="sep">/</span><a href="tienda.html">Tienda</a><span class="sep">/</span><a href="tienda.html?cat=${cat}">${esc(cname)}</a><span class="sep">/</span><span>${esc(sub)}</span>`,
        activeNav: cat, filterJs: `p.sub === ${JSON.stringify(sub)}`,
        emptyHref: `tienda.html?cat=${cat}`, emptyLabel: `Ver ${cname}`,
        sibTitle: `Más ${cname}`, sibMoreHref: `tienda.html?cat=${cat}`,
      });
    }
    if (live) {
      html = setSiblings(html, sibs);
      html = applyBlock(html, LIST_START, LIST_END, productListNoscript(items), /<div class="product-grid" id="grid"><\/div>/);
    }
    html = applyNav(html);
    const empty = !items.length;
    const base = /BMX/i.test(h1) ? h1 : `${h1} BMX`;
    const title = `${base} en Bogotá | ${SITE.name}`;
    const desc = empty
      ? cut(`${base} en Bogotá. ${intro}`, 158)
      : cut(`${base} en Bogotá: ${plural(items.length, "producto", "productos")} desde ${money(priceMin(items))}. ${firstSentence(intro)}`, 158);
    const d = describePage({
      path: p, title: cut(title, 70), description: desc, robots: empty ? ROBOTS_NOINDEX : ROBOTS_INDEX,
      type: "CollectionPage", crumbs: [["Tienda", "tienda.html"], [cname, `tienda.html?cat=${cat}`], [sub, p]],
      itemList: empty ? null : items, itemMax: 100,
    });
    html = applyHead(html, d);
    write(p, html);
    generatedPaths.add(p);
    pageList.push({ slug, path: p, sub, empty });
  }
  return pageList;
}

/* ---- marcas: marca/<slug>.html ---- */
function buildBrandPages() {
  const dirPages = exists("marca") ? fs.readdirSync(path.join(ROOT, "marca")).filter((f) => f.endsWith(".html")).map((f) => f.replace(/\.html$/, "")) : [];
  const slugs = new Set([...dirPages, ...LISTINGS.brands.map((b) => b.slug)]);
  const out = [];
  for (const slug of [...slugs].sort()) {
    const p = `marca/${slug}.html`;
    const live = LISTINGS.brands.find((b) => b.slug === slug);
    let html = exists(p) ? read(p) : null;
    const brand = live ? live.brand : ((html || "").match(/var BRAND = ("[^"]+")/) ? JSON.parse(html.match(/var BRAND = ("[^"]+")/)[1]) : null);
    if (!brand) { warnings.push(`${p}: no se pudo saber de que marca es`); continue; }
    const items = live ? live.items : [];
    const subsOf = [...new Set(items.map((i) => i.sub).filter(Boolean))];
    const lowerSubs = subsOf.map((s) => s.toLowerCase());
    const intro = (CONTENT.brands || {})[slug] ||
      (items.length
        ? `${brand} en ${SITE.name}, tu tienda BMX en Bogotá: ${plural(items.length, "producto", "productos")}${lowerSubs.length ? ` (${lowerSubs.slice(0, 6).join(", ")})` : ""} desde ${money(priceMin(items))}, con envíos a toda Colombia.`
        : `${brand} en ${SITE.name}, tu tienda BMX en Bogotá.`);
    if (!html) {
      html = newListingHtml({
        h1: `${brand} en Bogotá`, kicker: "Marca", intro,
        crumbHtml: `<a href="index.html">Inicio</a><span class="sep">/</span><a href="marcas.html">Marcas</a><span class="sep">/</span><span>${esc(brand)}</span>`,
        activeNav: "marcas", filterJs: `p.brand === BRAND`,
        emptyHref: "tienda.html", emptyLabel: "Ver la tienda",
        sibTitle: "Más marcas", sibMoreHref: "marcas.html",
      }).replace("<script>\n    stikeInit(", `<script>\n    var BRAND = ${JSON.stringify(brand)};\n    stikeInit(`);
    }
    if (live) {
      html = html.replace(/<p class="cat-intro">[\s\S]*?<\/p>/, () => `<p class="cat-intro">${esc(intro)}</p>`);
      const sibs = [
        ...subsOf.map((s) => LISTINGS.subs.find((x) => x.sub === s)).filter(Boolean)
          .map((s) => ({ path: s.path, label: s.sub, count: s.items.filter((i) => i.brand === brand).length })),
        ...LISTINGS.brands.filter((b) => b.slug !== slug).slice(0, 10).map((b) => ({ path: b.path, label: b.brand, count: b.items.length })),
      ];
      html = setSiblings(html, sibs);
      html = applyBlock(html, LIST_START, LIST_END, productListNoscript(items), /<div class="product-grid" id="grid"><\/div>/);
    }
    html = applyNav(html);
    const empty = !items.length;
    const d = describePage({
      path: p, title: cut(`${brand} en Bogotá: productos BMX | ${SITE.name}`, 70),
      description: cut(items.length ? `${brand} en Bogotá: ${plural(items.length, "producto", "productos")} BMX${lowerSubs.length ? ` (${lowerSubs.slice(0, 3).join(", ")}${lowerSubs.length > 3 ? " y más" : ""})` : ""} desde ${money(priceMin(items))}. Envíos a toda Colombia.` : firstSentence(intro), 158),
      robots: empty ? ROBOTS_NOINDEX : ROBOTS_INDEX,
      type: "CollectionPage", crumbs: [["Marcas", "marcas.html"], [brand, p]],
      itemList: empty ? null : items, itemMax: 100,
    });
    html = applyHead(html, d);
    write(p, html);
    generatedPaths.add(p);
    out.push({ slug, path: p, brand, empty });
  }
  return out;
}

const SUB_PAGES = buildSubPages();
const BRAND_PAGES = buildBrandPages();

/* ===================== paginas fijas ===================== */
const nProducts = VISIBLE.length;
const topBrands = brandsByCount().slice(0, 3).map(([b]) => b);

function faqFromHtml(html) {
  const out = [];
  for (const m of html.matchAll(/<details class="faq-item"[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g)) {
    const q = plain(decode(m[1].replace(/<[^>]+>/g, " ")));
    const a = plain(decode(m[2].replace(/<[^>]+>/g, " ")));
    if (q && a) out.push({ "@type": "Question", "name": q, "acceptedAnswer": { "@type": "Answer", "text": a } });
  }
  return out;
}

/* ---- preguntas-frecuentes.html: el contenido sale de data/seo-content.json y
   de site.js (precios de envio, telefono, horario), asi que no se desactualiza. ---- */
const FAQ_START = "<!--faq:start-->", FAQ_END = "<!--faq:end-->";
function faqTokens() {
  return {
    shipCost: money(SITE.shipping.cost), freeFrom: money(SITE.shipping.freeFrom),
    phone: B.telephone.replace(/^\+57(\d{3})(\d{3})(\d{4})$/, "+57 $1 $2 $3"), email: B.email,
    address: `${B.street}, ${B.locality}, ${B.region}`, hours: B.hours.text,
    payments: (B.payments || []).join(", "), topBrands: brandsByCount().slice(0, 6).map(([b]) => b).join(", "),
  };
}
function faqBlock() {
  const tok = faqTokens();
  const fill = (t) => String(t).replace(/\{\{(\w+)\}\}/g, (m, k) => (k in tok ? tok[k] : m));
  const link = (t) => esc(t).replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, label, href) => `<a href="${href}">${label}</a>`);
  return (CONTENT.faq || []).map((sec) =>
    `<h2>${esc(sec.section)}</h2>\n` + sec.items.map((it) =>
      `<details class="faq-item"><summary>${esc(fill(it.q))}</summary><div class="faq-a"><p>${link(fill(it.a))}</p></div></details>`).join("\n")
  ).join("\n");
}
{
  const p = "preguntas-frecuentes.html";
  if (!exists(p) && (CONTENT.faq || []).length) {
    write(p, `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
<base href="${SITE.basePath}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${START}${END}
  ${FONTS}
  <link rel="stylesheet" href="assets/css/styles.css">
  <link rel="icon" href="assets/img/favicon.png">
</head>
<body>
  <div id="site-header"></div>
  ${NAV_START}${NAV_END}

  <div class="wrap page-head">
    <nav class="breadcrumb"><a href="index.html">Inicio</a><span class="sep">/</span><span>Preguntas frecuentes</span></nav>
    <span class="kicker">Ayuda</span>
    <h1>Preguntas frecuentes</h1>
    <p class="cat-intro">Envíos, pagos, cambios, armado de BMX y todo lo que nos preguntan en la tienda. Si no encuentras tu respuesta, escríbenos por WhatsApp.</p>
  </div>

  <section class="section" style="padding-top:10px">
    <div class="wrap faq-wrap">
      ${FAQ_START}${FAQ_END}
    </div>
  </section>

  <div id="site-footer"></div>

  <script src="assets/js/products-data.js"></script>
  <script src="assets/js/data.js"></script>
  <script src="assets/js/app.js"></script>
  <script>stikeInit("");</script>
  <script src="assets/js/animations.js"></script>
</body>
</html>
`);
    if (!CHECK_ONLY) W.generated.delete(p);
  }
  if (exists(p)) write(p, applyBlock(read(p), FAQ_START, FAQ_END, "\n" + faqBlock() + "\n      "));
}

const STATIC_PAGES = [
  { path: "index.html", home: true, type: "WebPage",
    title: `${SITE.name} | Tienda de BMX en Bogotá: repuestos y ropa`,
    description: "Tienda de BMX en Venecia, Bogotá: repuestos, protecciones, ropa y armado de BMX a tu medida, con asesoría de riders y envíos a toda Colombia." },
  { path: "tienda.html", type: "CollectionPage", crumbs: [["Tienda", "tienda.html"]], itemList: VISIBLE, itemMax: 100,
    title: `Catálogo BMX: repuestos, ropa y protecciones | ${SITE.name}`,
    description: `Compra repuestos, protecciones, ropa y accesorios BMX en Bogotá: ${nProducts} productos con precio y disponibilidad al día. Envíos a toda Colombia.` },
  { path: "armar.html", type: "WebPage", crumbs: [["Arma tu BMX", "armar.html"]], keep: true },
  { path: "marcas.html", type: "CollectionPage", crumbs: [["Marcas", "marcas.html"]],
    title: `Marcas BMX en Bogotá${topBrands.length ? `: ${topBrands.join(", ")} y más` : ""} | ${SITE.name}`,
    description: `Las marcas BMX que vendemos en Bogotá${topBrands.length ? `, como ${topBrands.join(", ")}` : ""}: repuestos, ropa y protecciones originales con envío a toda Colombia.` },
  { path: "nosotros.html", type: "AboutPage", org: true, crumbs: [["Nosotros", "nosotros.html"]],
    title: `Nosotros: riders de Bogotá detrás de ${SITE.name}`,
    description: `${SITE.name} nació en 2019 entre riders de Bogotá. Hoy tenemos tienda física en Venecia, tienda online y envíos a toda Colombia.` },
  { path: "contacto.html", type: "ContactPage", org: true, crumbs: [["Contacto", "contacto.html"]],
    title: `Contacto y ubicación | ${SITE.name}, Venecia, Bogotá`,
    description: `Escríbenos por WhatsApp (${B.telephone.replace(/^\+57/, "+57 ")}) o visítanos en ${B.street}, ${B.locality}. ${B.hours.text}.` },
  { path: "carrito.html", robots: ROBOTS_NOINDEX, title: `Carrito | ${SITE.name}`, description: "Revisa tu pedido y paga de forma segura." },
  { path: "preguntas-frecuentes.html", type: "FAQPage", crumbs: [["Preguntas frecuentes", "preguntas-frecuentes.html"]],
    title: `Preguntas frecuentes: envíos, pagos, cambios y armado | ${SITE.name}`,
    description: `Respuestas sobre envíos a toda Colombia, medios de pago, cambios y devoluciones, armado de BMX y ubicación de ${SITE.name} en Bogotá.`,
    faq: true },
];

for (const o of STATIC_PAGES) {
  if (!exists(o.path)) { warnings.push(`${o.path}: no existe, se salta`); continue; }
  let html = read(o.path);
  const cur = existingHead(html);
  const spec = { ...o };
  if (o.keep) { spec.title = cur.title; spec.description = cur.description; }
  if (!spec.title || !spec.description) { warnings.push(`${o.path}: sin titulo o descripcion`); continue; }
  spec.title = cut(spec.title, 70);
  spec.description = cut(spec.description, 160);
  if (cur.ogImage && /\/og-/.test(cur.ogImage)) spec.ogImage = cur.ogImage;
  if (o.faq) spec.extraNodes = [];
  const d = describePage(spec);
  if (o.faq) {
    const qa = faqFromHtml(html);
    if (qa.length && d.jsonld[0]) {
      const g = d.jsonld[0]["@graph"];
      const pg = g.find((n) => n["@id"] === d.canonical + "#webpage");
      pg.mainEntity = { "@type": "FAQPage", "@id": d.canonical + "#faq", "mainEntity": qa };
    } else warnings.push(`${o.path}: no se encontraron <details class="faq-item"> para armar el FAQPage`);
  }
  html = applyHead(html, d);
  html = applyNav(html);
  if (o.path === "tienda.html") html = applyBlock(html, LIST_START, LIST_END, productListNoscript(VISIBLE), /<div class="product-grid" id="grid"><\/div>/);
  if (o.path === "marcas.html") {
    const chips = LISTINGS.brands.map((b) => `<li><a href="${b.path}">${esc(b.brand)}</a> (${b.items.length})</li>`).join("");
    html = applyBlock(html, LIST_START, LIST_END, chips ? `<noscript><ul>${chips}</ul></noscript>` : "", /<div class="brand-grid" id="brand-grid"[^>]*><\/div>/);
  }
  write(o.path, html);
}

/* ===================== 404 ===================== */
{
  const links = sibLinks([
    { path: "tienda.html", label: "Tienda", count: nProducts },
    ...LISTINGS.subs.slice(0, 12).map((s) => ({ path: s.path, label: s.sub, count: s.items.length })),
  ]);
  const body = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
<base href="${SITE.basePath}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${START}${END}
  ${FONTS}
  <link rel="stylesheet" href="assets/css/styles.css">
  <link rel="icon" href="assets/img/favicon.png">
</head>
<body>
  <div id="site-header"></div>
  ${NAV_START}${NAV_END}

  <div class="wrap page-head">
    <span class="kicker">Error 404</span>
    <h1>No encontramos esa página</h1>
    <p class="cat-intro">Puede que el enlace esté desactualizado o que el producto ya no esté publicado. Busca en la tienda o escríbenos por WhatsApp.</p>
  </div>

  <section class="section" style="padding-top:10px">
    <div class="wrap">
      <a class="btn cyan" href="tienda.html">Ir a la tienda</a>
    </div>
  </section>

  <section class="section" style="padding-top:0">
    <div class="wrap">
      <div class="section-head"><div><span class="kicker">Mira por aquí</span><h2>Lo más buscado</h2></div></div>
      <div class="sibling-links">${links}</div>
    </div>
  </section>

  <div id="site-footer"></div>

  <script src="assets/js/products-data.js"></script>
  <script src="assets/js/data.js"></script>
  <script src="assets/js/app.js"></script>
  <script>stikeInit("");</script>
  <script src="assets/js/animations.js"></script>
</body>
</html>
`;
  let html = exists("404.html") ? read("404.html") : body;
  html = html.replace(/<div class="sibling-links">[\s\S]*?<\/div>/, () => `<div class="sibling-links">${links}</div>`);
  html = applyNav(html);
  html = applyHead(html, describePage({ path: "404.html", robots: "noindex, follow", title: `Página no encontrada | ${SITE.name}`, description: "La página que buscas no existe." }));
  write("404.html", html);
}

/* ===================== robots.txt ===================== */
const AI_BOTS = [
  "GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User", "Claude-SearchBot", "anthropic-ai",
  "PerplexityBot", "Perplexity-User", "Google-Extended", "Applebot", "Applebot-Extended", "Bingbot", "Googlebot",
  "Amazonbot", "DuckAssistBot", "CCBot", "meta-externalagent", "cohere-ai", "MistralAI-User",
];
const ROBOTS_DISALLOW = [
  "/admin.html", "/admin.php", "/admin.js", "/admin-sw.js", "/data/", "/api/",
  "/carrito.html", "/pago-resultado.html", "/tienda.html?q=", "/propuesta.html",
];
{
  const dis = ROBOTS_DISALLOW.map((x) => `Disallow: ${x}`).join("\n");
  const txt = [
    `# ${SITE.name} — ${SITE.url("")}`,
    `# Generado por tools/build-seo.mjs: no editar a mano (ver SEO.md).`,
    `#`,
    `# Buscadores y asistentes de IA son bienvenidos: queremos que nos encuentren y que`,
    `# ChatGPT, Claude, Gemini, Perplexity y Copilot puedan citar la tienda.`,
    `# Resumen para modelos de lenguaje: ${SITE.url("llms.txt")}`,
    ``,
    `User-agent: *`, `Allow: /`, dis, ``,
    ...AI_BOTS.flatMap((b) => [`User-agent: ${b}`, `Allow: /`, dis, ``]),
    `Sitemap: ${SITE.url("sitemap.xml")}`, ``,
  ].join("\n");
  write("robots.txt", txt);
}

/* ===================== llms.txt / llms-full.txt ===================== */
const availabilityWord = (pi) => (pi.soldOut ? "agotado por ahora" : "disponible");
function variantSummary(p) {
  const bits = [];
  if (p.colors && p.colors.length > 1) bits.push("colores: " + p.colors.map((c) => c.v).join(", "));
  if (p.sizes && p.sizes.length > 1) bits.push(`${String(p.sizeLabel || "tallas").toLowerCase()}: ${p.sizes.map((z) => z.v).join(", ")}`);
  return bits.join("; ");
}
const policyLine = `Envío dentro de Colombia: ${money(SITE.shipping.cost)}; gratis en compras desde ${money(SITE.shipping.freeFrom)}. Bogotá: entrega en 24 a 48 horas hábiles o recoge en tienda sin costo.`;

function businessFacts() {
  return [
    `- Nombre: ${B.legalName} (también "Stike")`,
    `- Qué es: ${B.description}`,
    `- Dirección: ${B.street}, ${B.locality}, ${B.region}, Colombia`,
    `- Horario: ${B.hours.text}`,
    `- WhatsApp y teléfono: ${B.telephone}`,
    `- Correo: ${B.email}`,
    `- Envíos: toda Colombia. ${policyLine}`,
    `- Medios de pago: ${(B.payments || []).join(", ")}`,
    `- Idioma y moneda: español; precios en pesos colombianos (COP)`,
    `- Redes: ${(B.sameAs || []).join(" · ")}`,
  ];
}

{
  const L = [
    `# ${SITE.name}`, ``,
    `> ${B.description} Vendemos ${nProducts} productos de marcas como ${brandsByCount().slice(0, 6).map(([b]) => b).join(", ")}, con envíos a toda Colombia y tienda física en ${B.locality}.`, ``,
    `## Datos del negocio`, ...businessFacts(), ``,
    `## Páginas principales`,
    `- [Tienda](${SITE.url("tienda.html")}): catálogo completo con precios y disponibilidad`,
    `- [Arma tu BMX](${SITE.url("armar.html")}): armado de BMX a la medida, entregada montada y ajustada`,
    `- [Marcas](${SITE.url("marcas.html")}): marcas que vendemos`,
    `- [Preguntas frecuentes](${SITE.url("preguntas-frecuentes.html")}): envíos, pagos, cambios, armado y ubicación`,
    `- [Nosotros](${SITE.url("nosotros.html")}): quiénes somos`,
    `- [Contacto](${SITE.url("contacto.html")}): dirección, horario y WhatsApp`,
    `- [Blog](${SITE.url("blog.html")}): guías y historia del BMX`,
    ``,
    `## Categorías`,
    ...CATEGORIES.flatMap((c) => {
      const mine = LISTINGS.subs.filter((s) => s.cat === c.slug && exists(s.path));
      return mine.length ? [`### ${c.name}`, ...mine.map((s) => `- [${s.sub}](${SITE.url(s.path)}): ${plural(s.items.length, "producto", "productos")} desde ${money(priceMin(s.items))}`)] : [];
    }),
    ``,
    `## Marcas`,
    ...LISTINGS.brands.filter((b) => exists(b.path)).map((b) => `- [${b.brand}](${SITE.url(b.path)}): ${plural(b.items.length, "producto", "productos")}`),
    `- [Fate BMX Colombia](${SITE.url("fate/")}): marca aliada 100% bogotana`,
    ``,
    `## Políticas`,
    `- [Envíos y entregas](${SITE.url("envios.html")})`,
    `- [Cambios, devoluciones y reembolsos](${SITE.url("devoluciones.html")})`,
    `- [Términos y condiciones](${SITE.url("terminos.html")})`,
    `- [Privacidad](${SITE.url("privacidad.html")})`,
    ``,
    `## Opcional`,
    `- [Catálogo completo en texto (llms-full.txt)](${SITE.url("llms-full.txt")}): todos los productos con precio, marca y variantes`,
    `- [Mapa del sitio](${SITE.url("sitemap.xml")})`,
    ``,
  ];
  write("llms.txt", L.join("\n"));

  const F = [
    `# ${SITE.name}: catálogo completo`, ``,
    `> ${B.description} Datos al día en cada publicación. Precios en COP.`, ``,
    `## Datos del negocio`, ...businessFacts(), ``,
    `## Cómo comprar`,
    `1. Elige el producto, su talla/medida y color en la ficha y agrégalo al carrito.`,
    `2. Paga en línea (${(B.payments || []).slice(0, 5).join(", ")}) o escribe por WhatsApp al ${B.telephone}.`,
    `3. ${policyLine}`,
    ``,
  ];
  for (const c of CATEGORIES) {
    const items = VISIBLE.filter((p) => p.cat === c.slug);
    if (!items.length) continue;
    F.push(`## ${c.name}`, ``);
    const subs = [...new Set(items.map((p) => p.sub || "Otros"))];
    for (const s of subs) {
      F.push(`### ${s}`);
      for (const p of items.filter((x) => (x.sub || "Otros") === s)) {
        const pi = priceInfo(p);
        const vs = variantSummary(p);
        F.push(`- [${p.n}](${productUrl(p)}) — ${p.brand || "sin marca"}; ${pi.varies ? "desde " : ""}${money(pi.min)}; ${availabilityWord(pi)}${vs ? `; ${vs}` : ""}`);
      }
      F.push(``);
    }
  }
  write("llms-full.txt", F.join("\n"));
}

/* ===================== feed de Google Merchant ===================== */
const GOOGLE_CAT = {
  repuestos: "Sporting Goods > Outdoor Recreation > Cycling > Bicycle Parts",
  protecciones: "Sporting Goods > Outdoor Recreation > Cycling > Bicycle Accessories",
  ropa: "Apparel & Accessories > Clothing",
  accesorios: "Sporting Goods > Outdoor Recreation > Cycling > Bicycle Accessories",
};
const GOOGLE_CAT_SUB = { Tenis: "Apparel & Accessories > Shoes", Gorras: "Apparel & Accessories > Clothing Accessories > Hats", Gafas: "Apparel & Accessories > Clothing Accessories > Sunglasses" };
const x = (s) => String(s == null ? "" : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
{
  const items = [];
  for (const p of VISIBLE) {
    const variants = PdpRender.variantList(p, browser);
    const group = variants.length > 1;
    const list = variants.length ? variants : [{ price: priceInfo(p).min, units: browser.stikeSellable ? browser.stikeSellable(p) : null }];
    const canonical = productUrl(p);
    const imgs = (p.imgs || []).map(absImg);
    const desc = cut(PdpRender.describe(p, SITE), 4900);
    for (const v of list) {
      const qs = [];
      if (v.color != null) qs.push("color=" + encodeURIComponent(v.color));
      if (v.size != null) qs.push("size=" + encodeURIComponent(v.size));
      const id = group ? `${p.sku}-${[v.color, v.size].filter((a) => a != null).map(PdpRender.slugPart).join("-")}` : p.sku;
      const colorImg = v.color != null && p.imgColorMap ? Object.keys(p.imgColorMap).find((u) => p.imgColorMap[u] === v.color) : null;
      const main = colorImg ? absImg(colorImg) : imgs[0] || SITE.url(SITE.ogFallback);
      const extra = imgs.filter((u) => u !== main).slice(0, 10);
      const out = typeof v.units === "number" && v.units <= 0;
      const ptype = [catName(p.cat), p.sub].filter(Boolean).join(" > ");
      const lines = [
        `<g:id>${x(id)}</g:id>`,
        `<g:title>${x(cut([p.n, v.color, v.size].filter((a) => a != null && a !== "").join(" - "), 150))}</g:title>`,
        `<g:description>${x(desc)}</g:description>`,
        `<g:link>${x(canonical + (group && qs.length ? "?" + qs.join("&") : ""))}</g:link>`,
        `<g:image_link>${x(main)}</g:image_link>`,
        ...extra.map((u) => `<g:additional_image_link>${x(u)}</g:additional_image_link>`),
        `<g:availability>${out ? "out_of_stock" : "in_stock"}</g:availability>`,
        `<g:price>${Math.round(v.price)}.00 COP</g:price>`,
        `<g:condition>${PdpRender.isUsed(p) ? "used" : "new"}</g:condition>`,
        p.brand ? `<g:brand>${x(p.brand)}</g:brand>` : "",
        `<g:identifier_exists>no</g:identifier_exists>`,
        `<g:product_type>${x(ptype)}</g:product_type>`,
        `<g:google_product_category>${x(GOOGLE_CAT_SUB[p.sub] || GOOGLE_CAT[p.cat] || GOOGLE_CAT.repuestos)}</g:google_product_category>`,
        group ? `<g:item_group_id>${x(p.sku)}</g:item_group_id>` : "",
        v.color != null ? `<g:color>${x(v.color)}</g:color>` : "",
        v.size != null ? `<g:size>${x(v.size)}</g:size>` : "",
        `<g:shipping><g:country>CO</g:country><g:service>Estándar</g:service><g:price>${SITE.shipping.cost}.00 COP</g:price></g:shipping>`,
      ].filter(Boolean);
      items.push(`    <item>\n      ${lines.join("\n      ")}\n    </item>`);
    }
  }
  write("feed/google-merchant.xml", `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${x(SITE.name)}</title>
    <link>${x(SITE.url(""))}</link>
    <description>${x(B.description)}</description>
${items.join("\n")}
  </channel>
</rss>
`);
}

/* ===================== .htaccess: 301 reales ===================== */
{
  const REDIRECTS = exists("data/redirects.json") ? JSON.parse(read("data/redirects.json")) : {};
  const live = new Set(VISIBLE.map((p) => p.slug));
  const final = (slug) => { const seen = new Set(); while (REDIRECTS[slug] && !seen.has(slug)) { seen.add(slug); slug = REDIRECTS[slug]; } return slug; };
  const rules = [];
  for (const old of Object.keys(REDIRECTS).sort()) {
    if (live.has(old)) continue;
    const to = final(old);
    if (!live.has(to) || to === old) continue;
    rules.push(`  RewriteRule ^producto/${reEsc(old)}\\.html$ /producto/${to}.html [R=301,L]`);
  }
  /* Tipos y marcas que se quedaron sin productos NO se redirigen: siguen con
     su pagina (noindex) para que el enlace no se rompa. */
  const S = "  # >>> seo-redirects (generado por tools/build-seo.mjs; no editar)", E = "  # <<< seo-redirects";
  const block = `${S}\n${rules.join("\n")}${rules.length ? "\n" : ""}${E}`;
  let ht = read(".htaccess");
  if (ht.includes(S)) ht = ht.replace(new RegExp(reEsc(S) + "[\\s\\S]*?" + reEsc(E)), () => block);
  else if (ht.includes("  # Algunos hostings PHP descartan")) ht = ht.replace("  # Algunos hostings PHP descartan", () => `  # Fichas que se fusionaron en otra: 301 real (Google transfiere la autoridad).\n${block}\n\n  # Algunos hostings PHP descartan`);
  else warnings.push(".htaccess: no se encontro donde insertar las redirecciones 301");
  write(".htaccess", ht);
}

/* ===================== IndexNow ===================== */
write(`${indexNowKey()}.txt`, indexNowKey() + "\n");

/* ===================== data.js: paginas de tipo y marca ===================== */
{
  let js = read("assets/js/data.js");
  const partSlugs = [...new Set([...SUB_PAGES.map((s) => s.slug)])].sort();
  const brandMap = Object.fromEntries(BRAND_PAGES.filter((b) => !b.empty).map((b) => [b.brand, b.path]));
  const partLine = `STIKE_GLOBAL.STIKE_PART_PAGES = ${JSON.stringify(partSlugs)};`;
  const brandLine = `STIKE_GLOBAL.STIKE_BRAND_PAGES = ${JSON.stringify(brandMap)};`;
  if (/^STIKE_GLOBAL\.STIKE_PART_PAGES = .*;$/m.test(js)) {
    js = js.replace(/^STIKE_GLOBAL\.STIKE_PART_PAGES = .*;$/m, () => partLine);
    if (/^STIKE_GLOBAL\.STIKE_BRAND_PAGES = .*;$/m.test(js)) js = js.replace(/^STIKE_GLOBAL\.STIKE_BRAND_PAGES = .*;$/m, () => brandLine);
    else js = js.replace(partLine, () => `${partLine}\n/* Marcas con pagina propia (marca/<slug>.html): lo escribe tools/build-seo.mjs. */\n${brandLine}`);
    write("assets/js/data.js", js);
  } else warnings.push("data.js: no se encontro STIKE_PART_PAGES");
}

/* ===================== resumen ===================== */
console.log(`\nStike — build SEO/GEO${CHECK_ONLY ? " (--check, no escribe)" : ""}`);
console.log(`  productos    ${VISIBLE.length} publicados`);
console.log(`  tipos        ${SUB_PAGES.filter((s) => !s.empty).length} con pagina (${SUB_PAGES.filter((s) => s.empty).length} sin stock, noindex)`);
console.log(`  marcas       ${BRAND_PAGES.filter((b) => !b.empty).length} con pagina`);
console.log(`  archivos     ${W.written} ${CHECK_ONLY ? "cambiarian" : "escritos"}, ${W.unchanged} sin cambios`);
if (warnings.length) { console.warn("\n  Avisos:"); warnings.forEach((w) => console.warn("   · " + w)); }
if (CHECK_ONLY && W.written) { console.log("\n  Hay archivos desactualizados:\n" + W.changed.slice(0, 15).map((f) => "   · " + f).join("\n")); process.exit(1); }
console.log("");
