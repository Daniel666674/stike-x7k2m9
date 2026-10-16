/* =========================================================================
   STIKE BIKE SHOP: generador de fichas de producto estaticas.
   Funcion PURA de string-replacement: toma un producto + el texto de
   _template.html y devuelve el HTML final de producto/<slug>.html.

   Se usa en DOS lugares que NUNCA deben divergir:
     1) El build inicial (Node, una sola vez) que genero /producto/*.html.
     2) admin.html, en el navegador, que regenera la pagina de un producto
        cada vez que se publica un cambio (ver publishCatalog en admin.html).
   Por eso vive en su propio archivo con doble export (browser + Node) en
   vez de estar copiada/pegada en los dos sitios.
   ========================================================================= */
(function (root) {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }
  function money(n) { return "$" + Number(n).toLocaleString("es-CO"); }

  /* La identidad del sitio (dominio, base path, WhatsApp) vive en
     assets/js/site.js, no aca: este archivo se usa igual desde el navegador
     (admin.html) y desde Node (tools/build-pages.mjs), y las dos rutas
     tienen que producir EXACTAMENTE la misma URL o las fichas quedan
     apuntando a otro lado. Se resuelve en este orden: lo que pasa el
     caller por ctx, el global del navegador, y en Node el require. */
  function resolveSite(ctx) {
    if (ctx && ctx.site) return ctx.site;
    if (typeof root !== "undefined" && root.STIKE_SITE) return root.STIKE_SITE;
    if (typeof require === "function") { try { return require("./site.js"); } catch (e) {} }
    throw new Error("pdp-render: falta la config del sitio (assets/js/site.js)");
  }

  /* El motor de stock vive en assets/js/data.js y es el mismo que usa el
     sitio. Este archivo tenia su propia copia de totalStock: dos copias de
     la misma regla, que tarde o temprano dicen cosas distintas. Ahora se
     resuelve igual que la config del sitio: global en el navegador, require
     en Node. */
  function resolveStock(ctx) {
    if (ctx && ctx.stock) return ctx.stock;
    if (typeof root !== "undefined" && root.stikeSellable) return root;
    if (typeof require === "function") { try { return require("./data.js"); } catch (e) {} }
    throw new Error("pdp-render: falta el motor de stock (assets/js/data.js)");
  }

  /* Precio por variante: el rango sale del motor de data.js (stikePriceRange).
     Si no hay motor/rango, cae al precio base. */
  function priceRange(p, stock) {
    return stock && stock.stikePriceRange ? stock.stikePriceRange(p) : { min: p.price, max: p.price, varies: false };
  }
  function priceFrom(p, stock) {
    var r = priceRange(p, stock);
    return (r.varies ? "Desde " : "") + money(r.min);
  }
  /* El monto va en #pdp-price para que pdp.js lo cambie al elegir una opcion. */
  function priceBlock(p, stock, oldPrice, discount) {
    var r = priceRange(p, stock);
    if (r.varies) return `<span id="pdp-price">Desde ${money(r.min)}</span>`;
    return `<span id="pdp-price">${money(p.price)}</span> ${oldPrice}${discount}`;
  }

  function renderGallery(p, coverUrl) {
    var imgs = (p.imgs && p.imgs.length) ? p.imgs : [coverUrl];
    var main = `<div class="main"><img id="main-img" src="${esc(imgs[0])}" alt="${esc(nameBrand(p))}: foto principal" width="900" height="900" fetchpriority="high" decoding="async"></div>`;
    var thumbs = imgs.map((src, i) =>
      `<button class="${i === 0 ? "active" : ""}" data-thumb data-src="${esc(src)}" aria-label="Vista ${i + 1}"><img src="${esc(src)}" alt="${esc(p.n)}: vista ${i + 1}" width="86" height="86" loading="lazy" decoding="async"></button>`
    ).join("");
    return `<div class="pdp-gallery">${main}<div class="pdp-thumbs">${thumbs}</div></div>`;
  }

  function renderSizeBlock(p) {
    if (!p.sizes) return "";
    var opts = p.sizes.map(s =>
      `<button type="button" class="size-opt${s.u <= 0 ? " out" : ""}" data-size="${esc(s.v)}" data-stock="${s.u}" ${s.u <= 0 ? "disabled" : ""}>${esc(s.v)}</button>`
    ).join("");
    return `<div class="size-select" data-variant="size">
      <div class="size-label">${esc(p.sizeLabel || "Talla")} <span class="size-req" id="size-req"></span></div>
      <div class="size-options" id="size-options">${opts}</div>
    </div>`;
  }
  /* Colores: circulos tintados, SIN texto (el nombre queda en aria-label
     para lectores de pantalla). El tono sale de stikeColorStyle (data.js). */
  function renderColorBlock(p, stock) {
    if (!p.colors) return "";
    var opts = p.colors.map(c =>
      `<button type="button" class="color-opt${c.u <= 0 ? " out" : ""}" data-color="${esc(c.v)}" data-stock="${c.u}" aria-label="${esc(c.v)}" style="--dot:${esc(stock.stikeColorStyle(c.v))}" ${c.u <= 0 ? "disabled" : ""}><span class="dot-fill"></span></button>`
    ).join("");
    return `<div class="size-select" data-variant="color">
      <div class="size-label">Color <span class="size-req" id="color-req"></span></div>
      <div class="size-options color-options" id="color-options">${opts}</div>
    </div>`;
  }

  function renderSpecs(p) {
    return (p.spec || []).map(s => {
      var idx = s.indexOf(":");
      if (idx === -1) return `<div class="spec-row plain"><span class="v">${esc(s)}</span></div>`;
      return `<div class="spec-row"><span class="k">${esc(s.slice(0, idx))}</span><span class="v">${esc(s.slice(idx + 1).trim())}</span></div>`;
    }).join("");
  }

  /* ============================ SEO / GEO ============================
     Todo lo que lee un buscador o un asistente de IA sale de AQUI y del
     catalogo, no se escribe a mano: cada vez que el panel publica, la ficha
     se regenera con el precio, el stock y las variantes de ese momento. */
  function plain(str) { return String(str == null ? "" : str).replace(/\s+/g, " ").trim(); }
  function cut(str, max) {
    str = plain(str);
    if (str.length <= max) return str;
    var t = str.slice(0, max - 1), i = t.lastIndexOf(" ");
    return (i > max * 0.6 ? t.slice(0, i) : t).replace(/[,;:\-–—\s]+$/, "") + "…";
  }
  function slugPart(v) {
    return String(v).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
  function norm(v) { return String(v == null ? "" : v).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
  /* "Timón Fiend Reynolds" ya trae la marca: solo se añade " de <marca>" si falta. */
  function nameBrand(p) {
    if (!p.brand || norm(p.n).indexOf(norm(p.brand)) !== -1) return p.n;
    return p.n + " de " + p.brand;
  }
  function isUsed(p) { return /\b(usad[oa]s?|segunda)\b/i.test(p.n || ""); }
  function specPairs(p) {
    return (p.spec || []).map(function (sx) {
      var i = sx.indexOf(":");
      return i === -1 ? plain(sx) : plain(sx.slice(0, i)) + " " + plain(sx.slice(i + 1));
    }).filter(Boolean);
  }
  function variantWords(p) {
    var bits = [];
    if (p.colors && p.colors.length > 1) bits.push("colores " + p.colors.map(function (c) { return c.v; }).join(", "));
    if (p.sizes && p.sizes.length > 1) bits.push(String(p.sizeLabel || "tallas").toLowerCase() + " " + p.sizes.map(function (z) { return z.v; }).join(", "));
    return bits.join("; ");
  }
  /* Texto visible de la ficha: unico por producto (nombre, marca, specs,
     variantes), sin relleno generico. */
  function describe(p, site) {
    if (p.desc) return plain(p.desc);
    var out = nameBrand(p) + (isUsed(p) ? " (usado)" : "") + ".";
    var sp = specPairs(p).slice(0, 5);
    if (sp.length) out += " " + sp.join(". ") + ".";
    var vw = variantWords(p);
    if (vw) out += " Disponible en " + vw + ".";
    out += " Lo encuentras en " + site.name + ", tu tienda BMX en Bogotá, con envíos a toda Colombia y asesoría de riders.";
    return out;
  }
  function metaDescription(p, site, stock) {
    var r = priceRange(p, stock);
    var price = (r.varies ? "Desde " : "") + money(r.min);
    var sp = specPairs(p).slice(0, 2).join(", ");
    var base = nameBrand(p) + (sp ? " (" + sp + ")" : "") + ". " + price + ". Compra en " + site.name + ", Bogotá: envíos a toda Colombia.";
    return cut(base, 158);
  }
  function pageTitle(p, site, categoryName) {
    var a = p.n + " | " + (p.sub || categoryName) + " BMX | " + site.name;
    return a.length <= 68 ? a : cut(p.n + " | " + site.name, 68);
  }
  function absoluteUrl(site, u) { return u && u.indexOf("http") === 0 ? u : site.url(u); }

  /* Variantes reales (color / talla / combinacion) con su precio y stock. */
  function variantList(p, stock) {
    var out = [];
    var has = stock && stock.stikeHasCombos && stock.stikeHasCombos(p);
    var priceFor = function (sz, co) { return stock && stock.stikePriceFor ? stock.stikePriceFor(p, sz, co) : p.price; };
    if (has) {
      p.combos.forEach(function (r) { out.push({ size: r.s, color: r.c, units: r.u }); });
    } else if (p.sizes && p.colors) {
      p.colors.forEach(function (c) { p.sizes.forEach(function (z) { out.push({ size: z.v, color: c.v, units: Math.min(c.u, z.u) }); }); });
    } else if (p.colors) {
      p.colors.forEach(function (c) { out.push({ color: c.v, units: c.u }); });
    } else if (p.sizes) {
      p.sizes.forEach(function (z) { out.push({ size: z.v, units: z.u }); });
    }
    out.forEach(function (v) { v.price = priceFor(v.size == null ? null : v.size, v.color == null ? null : v.color); });
    return out.slice(0, 80);
  }

  function shippingDetails(site) {
    var sh = site.shipping;
    if (!sh) return null;
    return {
      "@type": "OfferShippingDetails",
      "shippingRate": { "@type": "MonetaryAmount", "value": sh.cost, "currency": "COP" },
      "shippingDestination": { "@type": "DefinedRegion", "addressCountry": "CO" },
      "deliveryTime": { "@type": "ShippingDeliveryTime", "transitTime": { "@type": "QuantitativeValue", "minValue": 1, "maxValue": 5, "unitCode": "DAY" } }
    };
  }

  /* @graph: Product (o ProductGroup con una variante por color/talla) +
     BreadcrumbList. Un producto agrupado le dice a Google y a los
     asistentes de IA que ES UN producto con varias opciones, cada una con
     su precio y disponibilidad. */
  function buildJsonLd(p, site, stock, canonical, categoryName, ogImage, subPage) {
    var imgs = (p.imgs && p.imgs.length ? p.imgs : []).map(function (u) { return absoluteUrl(site, u); });
    if (!imgs.length) imgs = [ogImage];
    var itemCond = isUsed(p) ? "https://schema.org/UsedCondition" : "https://schema.org/NewCondition";
    var seller = { "@type": "Organization", "@id": site.url("") + "#organization", "name": site.name };
    var ship = shippingDetails(site);
    var mkOffer = function (price, units, url) {
      var o = {
        "@type": "Offer", "url": url, "priceCurrency": "COP", "price": String(price),
        "availability": (typeof units === "number" && units <= 0) ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
        "itemCondition": itemCond, "seller": seller
      };
      if (ship) o.shippingDetails = ship;
      return o;
    };
    var desc = describe(p, site);
    var node;
    var variants = variantList(p, stock);
    if (variants.length > 1) {
      node = {
        "@type": "ProductGroup", "@id": canonical + "#product", "name": p.n, "description": desc,
        "productGroupID": p.sku, "url": canonical, "image": imgs,
        "brand": { "@type": "Brand", "name": p.brand }, "category": p.sub || categoryName,
        "variesBy": [].concat(variants.some(function (v) { return v.color != null; }) ? ["https://schema.org/color"] : [],
                             variants.some(function (v) { return v.size != null; }) ? ["https://schema.org/size"] : []),
        "hasVariant": variants.map(function (v) {
          var qs = [], nm = [p.n];
          if (v.color != null) { qs.push("color=" + encodeURIComponent(v.color)); nm.push(v.color); }
          if (v.size != null) { qs.push("size=" + encodeURIComponent(v.size)); nm.push(v.size); }
          var url = canonical + (qs.length ? "?" + qs.join("&") : "");
          var img = (v.color != null && p.imgColorMap) ? Object.keys(p.imgColorMap).filter(function (u) { return p.imgColorMap[u] === v.color; })[0] : null;
          var item = {
            "@type": "Product", "name": nm.join(" · "),
            "sku": p.sku + "-" + [v.color, v.size].filter(function (x) { return x != null; }).map(slugPart).join("-"),
            "url": url, "image": absoluteUrl(site, img || (p.imgs && p.imgs[0]) || ogImage),
            "brand": { "@type": "Brand", "name": p.brand },
            "offers": mkOffer(v.price, v.units, url)
          };
          if (v.color != null) item.color = v.color;
          if (v.size != null) item.size = v.size;
          return item;
        })
      };
    } else {
      var one = variants[0] || {};
      var total = stock && stock.stikeSellable ? stock.stikeSellable(p) : null;
      node = {
        "@type": "Product", "@id": canonical + "#product", "name": p.n, "description": desc, "sku": p.sku,
        "url": canonical, "image": imgs, "brand": { "@type": "Brand", "name": p.brand }, "category": p.sub || categoryName,
        "offers": mkOffer(one.price != null ? one.price : p.price, total, canonical)
      };
      if (one.color != null) node.color = one.color;
      if (one.size != null) node.size = one.size;
    }
    var crumbs = [["Inicio", site.url("")], [categoryName, site.url("tienda.html?cat=" + p.cat)]];
    if (p.sub) crumbs.push([p.sub, site.url(subPage || ("tienda.html?cat=" + p.cat + "&sub=" + encodeURIComponent(p.sub)))]);
    crumbs.push([p.n, canonical]);
    var breadcrumb = {
      "@type": "BreadcrumbList",
      "itemListElement": crumbs.map(function (c, i) { return { "@type": "ListItem", "position": i + 1, "name": c[0], "item": c[1] }; })
    };
    return JSON.stringify({ "@context": "https://schema.org", "@graph": [node, breadcrumb] }).replace(/</g, "\\u003c");
  }

  /* Etiquetas <meta> extra de la ficha: robots, idioma, Open Graph de producto. */
  function extraMeta(p, site, stock, canonical, ogImage, title, metaDesc) {
    var r = priceRange(p, stock);
    var sold = stock && stock.stikeIsOut ? stock.stikeIsOut(p) : false;
    return [
      '<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">',
      '<link rel="alternate" hreflang="es-CO" href="' + esc(canonical) + '">',
      '<link rel="alternate" hreflang="x-default" href="' + esc(canonical) + '">',
      '<meta property="og:image:alt" content="' + esc(nameBrand(p)) + '">',
      '<meta property="product:brand" content="' + esc(p.brand) + '">',
      '<meta property="product:price:amount" content="' + esc(r.min) + '">',
      '<meta property="product:price:currency" content="COP">',
      '<meta property="product:availability" content="' + (sold ? "out of stock" : "in stock") + '">',
      '<meta name="twitter:title" content="' + esc(title) + '">',
      '<meta name="twitter:description" content="' + esc(metaDesc) + '">'
    ].join("\n  ");
  }

  /* Productos relacionados como enlaces de verdad (los asistentes de IA y
     muchos rastreadores no ejecutan JavaScript; sin esto la ficha queda sin
     enlaces internos). Solo si quien llama pasa el catalogo en ctx.catalog. */
  function relatedNoscript(p, site, ctx) {
    if (!ctx.catalog) return "";
    var list = ctx.catalog.filter(function (q) { return q.slug !== p.slug && q.published !== false && q.sub === p.sub; });
    list.sort(function (a, b) { return (b.brand === p.brand) - (a.brand === p.brand); });
    list = list.slice(0, 6);
    if (!list.length) return "";
    return "<noscript><ul>" + list.map(function (q) {
      return '<li><a href="producto/' + esc(q.slug) + '.html">' + esc(q.n) + "</a> — " + money(q.price) + "</li>";
    }).join("") + "</ul></noscript>";
  }

  function replaceAll(template, tokens) {
    var out = template;
    Object.keys(tokens).forEach(function (key) {
      out = out.split("__" + key + "__").join(tokens[key]);
    });
    return out;
  }

  /* categoryName/subLink son resueltos por el caller (que tiene STIKE_CATEGORIES
     disponible); esta funcion no depende de otros globals para poder correr
     igual en Node (build) y en el navegador (admin.html).                    */
  function renderProductPage(p, template, ctx) {
    ctx = ctx || {};
    var site = resolveSite(ctx);
    var categoryName = ctx.categoryName || p.cat;
    var coverUrl = (p.imgs && p.imgs[0]) || ctx.placeholderImg || "";
    var stock = resolveStock(ctx);
    /* Dos numeros distintos, a proposito:
         crudo     lo que hay guardado -> el conteo que se muestra
         agotado   si NO queda nada vendible -> apaga la compra
       No son lo mismo: un producto sin unidades registradas tiene crudo 0
       pero no esta agotado (no sabemos cuanto hay), y marcarlo agotado
       esconderia mercancia que esta en la vitrina fisica. */
    var out = stock.stikeTotalStock(p);
    var isOut = stock.stikeIsOut(p);
    var low = !isOut && out > 0 && out <= 5;
    /* Este texto es el que ya viven las fichas publicadas. Antes el generador
       escribia una version mas pobre ("En stock", sin el conteo), asi que
       cualquier producto que el dueno editara en el panel perdia el texto al
       regenerarse. Una sola fuente, y es esta. */
    var stockHtml = isOut
      ? `<span class="stock out">● Agotado por ahora — te avisamos cuando vuelva</span>`
      : out > 0
        ? `<span class="stock${low ? " low" : ""}">${low ? `● ¡Solo ${out} disponible${out === 1 ? "" : "s"}!` : `● En stock (${out} disponible${out === 1 ? "" : "s"})`}</span>`
        : `<span class="stock">● Disponible — consúltanos por WhatsApp</span>`;
    var oldPrice = p.old ? `<span class="old">${money(p.old)}</span>` : "";
    var discount = p.old ? `<span class="tag-pill" style="background:#18181b;color:#fff;margin-left:10px;font-size:11px;padding:4px 10px">-${Math.round((1 - p.price / p.old) * 100)}%</span>` : "";
    var waMsg = encodeURIComponent(stock.stikeWaText(p, { shortName: site.shortName || site.name }));
    var canonical = site.url(`producto/${p.slug}.html`);
    var shareMsg = encodeURIComponent(`Mira este producto de ${site.name}: ${p.n}, ${priceFrom(p, stock)}\n${canonical}`);
    /* site.url() pone la barra; concatenar a mano fue exactamente el bug que
       dejo las 52 fichas con el og:image en 404. */
    var ogImage = coverUrl
      ? (coverUrl.indexOf("http") === 0 ? coverUrl : site.url(coverUrl))
      : site.url(site.ogFallback);
    var catLink = `tienda.html?cat=${esc(p.cat)}`;
    /* El tipo y la marca llevan a su pagina propia (categoria/, marca/) cuando
       el build la creo; si no, al filtro de la tienda. */
    var subPage = p.sub && (ctx.subPages || []).indexOf(slugPart(p.sub)) !== -1 ? `categoria/${slugPart(p.sub)}.html` : null;
    var subLink = p.sub ? (subPage || `tienda.html?cat=${esc(p.cat)}&sub=${encodeURIComponent(p.sub)}`) : null;
    var brandPage = p.brand && ctx.brandPages ? ctx.brandPages[p.brand] : null;
    var subCrumb = subLink ? `<span class="sep">/</span><a href="${subLink}" style="color:inherit">${esc(p.sub)}</a>` : "";

    var title = pageTitle(p, site, categoryName);
    var metaDesc = ctx.metaDesc || metaDescription(p, site, stock);
    var jsonLd = buildJsonLd(p, site, stock, canonical, categoryName, ogImage, subPage);

    return replaceAll(template, {
      TITLE: esc(title),
      META_DESC: esc(metaDesc),
      JSONLD: jsonLd,
      EXTRA_META: extraMeta(p, site, stock, canonical, ogImage, title, metaDesc),
      RELATED_STATIC: relatedNoscript(p, site, ctx),
      NAV_NOSCRIPT: ctx.navHtml || "",
      CANONICAL: canonical,
      OG_IMAGE: ogImage,
      BREADCRUMB: `<a href="index.html">Inicio</a><span class="sep">/</span><a href="${catLink}">${esc(categoryName)}</a>${subCrumb}<span class="sep">/</span><span>${esc(p.n)}</span>`,
      GALLERY: renderGallery(p, coverUrl),
      BRAND: brandPage ? `<a href="${esc(brandPage)}" style="color:var(--ink)">${esc(p.brand)}</a>` : esc(p.brand),
      NAME: esc(p.n),
      PRICE_BLOCK: priceBlock(p, stock, oldPrice, discount),
      STOCK_BLOCK: stockHtml,
      SIZE_BLOCK: renderSizeBlock(p),
      COLOR_BLOCK: renderColorBlock(p, stock),
      ADD_DISABLED: isOut ? "disabled style=opacity:.5" : "",
      WA_LABEL: stock.stikeWaLabel(p),
      /* Datos estructurados: precio sin formato y disponibilidad. Un agotado
         se marca OutOfStock y se QUEDA en el indice, con su posicionamiento
         intacto para cuando vuelva la mercancia. Sacarlo obliga a
         reconstruir ese posicionamiento en cada reposicion. */
      PRICE_PLAIN: String(priceRange(p, stock).min),
      AVAILABILITY: isOut ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
      WA_HREF: `https://wa.me/${(ctx.whatsapp || site.whatsapp)}?text=${waMsg}`,
      SHARE_WA_HREF: `https://wa.me/?text=${shareMsg}`,
      DESC: esc(ctx.desc || describe(p, site)),
      SPECS: renderSpecs(p),
      CATEGORY_NAME: esc(categoryName),
      CATEGORY_LINK: catLink,
      SUB_BLOCK: subLink ? ` · <a href="${subLink}" style="color:var(--ink)">${esc(p.sub)}</a>` : "",
      SKU: esc(p.sku),
      SLUG: esc(p.slug),
    });
  }

  /* Lo que reusan los generadores de tools/ (feed de Google, llms.txt): el mismo
     texto y las mismas variantes que ve el visitante, no una copia. */
  var api = {
    renderProductPage: renderProductPage,
    describe: describe, metaDescription: metaDescription, nameBrand: nameBrand,
    variantList: variantList, isUsed: isUsed, slugPart: slugPart, specPairs: specPairs
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PdpRender = api;
})(typeof window !== "undefined" ? window : globalThis);
