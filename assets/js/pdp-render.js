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

  function renderGallery(p, coverUrl) {
    var imgs = (p.imgs && p.imgs.length) ? p.imgs : [coverUrl];
    var main = `<div class="main"><img id="main-img" src="${esc(imgs[0])}" alt="${esc(p.n)}"></div>`;
    var thumbs = imgs.map((src, i) =>
      `<button class="${i === 0 ? "active" : ""}" data-thumb data-src="${esc(src)}" aria-label="Vista ${i + 1}"><img src="${esc(src)}" alt="${esc(p.n)} vista ${i + 1}"></button>`
    ).join("");
    return `<div class="pdp-gallery">${main}<div class="pdp-thumbs">${thumbs}</div></div>`;
  }

  function renderSizeBlock(p) {
    if (!p.sizes) return "";
    var opts = p.sizes.map(s =>
      `<button type="button" class="size-opt${s.u <= 0 ? " out" : ""}" data-size="${esc(s.v)}" data-stock="${s.u}" ${s.u <= 0 ? "disabled" : ""}>${esc(s.v)}</button>`
    ).join("");
    return `<div class="size-select" data-variant="size">
      <div class="size-label">Talla <span class="size-req" id="size-req"></span></div>
      <div class="size-options" id="size-options">${opts}</div>
    </div>`;
  }
  function renderColorBlock(p) {
    if (!p.colors) return "";
    var opts = p.colors.map(c =>
      `<button type="button" class="size-opt${c.u <= 0 ? " out" : ""}" data-color="${esc(c.v)}" data-stock="${c.u}" ${c.u <= 0 ? "disabled" : ""}>${esc(c.v)}</button>`
    ).join("");
    return `<div class="size-select" data-variant="color">
      <div class="size-label">Color <span class="size-req" id="color-req"></span></div>
      <div class="size-options" id="color-options">${opts}</div>
    </div>`;
  }

  function renderSpecs(p) {
    return (p.spec || []).map(s => {
      var idx = s.indexOf(":");
      if (idx === -1) return `<div class="spec-row plain"><span class="v">${esc(s)}</span></div>`;
      return `<div class="spec-row"><span class="k">${esc(s.slice(0, idx))}</span><span class="v">${esc(s.slice(idx + 1).trim())}</span></div>`;
    }).join("");
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
    var shareMsg = encodeURIComponent(`Mira este producto de ${site.name}: ${p.n}, ${money(p.price)}\n${canonical}`);
    /* site.url() pone la barra; concatenar a mano fue exactamente el bug que
       dejo las 52 fichas con el og:image en 404. */
    var ogImage = coverUrl
      ? (coverUrl.indexOf("http") === 0 ? coverUrl : site.url(coverUrl))
      : site.url(site.ogFallback);
    var catLink = `tienda.html?cat=${esc(p.cat)}`;
    var subLink = p.sub ? `tienda.html?cat=${esc(p.cat)}&sub=${encodeURIComponent(p.sub)}` : null;
    var subCrumb = subLink ? `<span class="sep">/</span><a href="${subLink}" style="color:inherit">${esc(p.sub)}</a>` : "";

    return replaceAll(template, {
      TITLE: esc(p.n) + ": " + site.name,
      META_DESC: esc(ctx.metaDesc || `${p.n} de ${p.brand} en Stike Bike Shop, tu tienda BMX en Bogotá.`),
      CANONICAL: canonical,
      OG_IMAGE: ogImage,
      BREADCRUMB: `<a href="index.html">Inicio</a><span class="sep">/</span><a href="${catLink}">${esc(categoryName)}</a>${subCrumb}<span class="sep">/</span><span>${esc(p.n)}</span>`,
      GALLERY: renderGallery(p, coverUrl),
      BRAND: esc(p.brand),
      NAME: esc(p.n),
      PRICE_BLOCK: `${money(p.price)} ${oldPrice}${discount}`,
      STOCK_BLOCK: stockHtml,
      SIZE_BLOCK: renderSizeBlock(p),
      COLOR_BLOCK: renderColorBlock(p),
      ADD_DISABLED: isOut ? "disabled style=opacity:.5" : "",
      WA_LABEL: stock.stikeWaLabel(p),
      /* Datos estructurados: precio sin formato y disponibilidad. Un agotado
         se marca OutOfStock y se QUEDA en el indice, con su posicionamiento
         intacto para cuando vuelva la mercancia. Sacarlo obliga a
         reconstruir ese posicionamiento en cada reposicion. */
      PRICE_PLAIN: String(p.price),
      AVAILABILITY: isOut ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
      WA_HREF: `https://wa.me/${(ctx.whatsapp || site.whatsapp)}?text=${waMsg}`,
      SHARE_WA_HREF: `https://wa.me/?text=${shareMsg}`,
      DESC: esc(ctx.desc || p.desc || `${p.n} de ${p.brand}, disponible en Stike Bike Shop.`),
      SPECS: renderSpecs(p),
      CATEGORY_NAME: esc(categoryName),
      CATEGORY_LINK: catLink,
      SUB_BLOCK: subLink ? ` · <a href="${subLink}" style="color:var(--ink)">${esc(p.sub)}</a>` : "",
      SKU: esc(p.sku),
      SLUG: esc(p.slug),
    });
  }

  var api = { renderProductPage: renderProductPage };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PdpRender = api;
})(typeof window !== "undefined" ? window : globalThis);
