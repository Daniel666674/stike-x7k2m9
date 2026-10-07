/* =========================================================================
   STIKE BIKE SHOP: App / UI compartida
   ========================================================================= */

const STIKE_CONFIG = {
  name: "Stike",
  full: "Stike Bike Shop",
  tagline: "BMX · BOGOTÁ",
  whatsapp: "573118108848",
  whatsappPretty: "+57 311 810 8848",
  phone: "+57 311 810 8848",
  email: "hola@stikebikeshop.com",
  address: "Bogotá D.C., Colombia",
  hours: "Lun a Sáb · 10:00 a.m. – 7:00 p.m.",
  ig: "https://www.instagram.com/stikebikeshop?igsh=emVzZXc0NWVlNmcy",
  fb: "https://www.facebook.com/share/1Cz3ezfUvL/?mibextid=wwXIfr",
  tiktok: "https://tiktok.com/@stikebikeshop",
  igHandle: "@stikebikeshop",
  /* --- Datos legales: COMPLETAR con la información real de la empresa --- */
  legalName: "[Razón social — completar]",   // p. ej. "Stike Bike Shop S.A.S."
  nit: "[NIT — completar]",
  legalUpdated: "21 de junio de 2026",
  /* Envío de formularios (contacto + boletín) por correo real al dueño.
     Para activarlo (gratis, sin tarjeta, sin contraseña):
       1. Entra a https://web3forms.com
       2. Escribe el correo donde quieres recibir los mensajes (hola@stikebikeshop.com)
       3. Click en "Create Access Key" -- te llega una llave (access key) al correo
       4. Pega esa llave abajo en formAccessKey
     Mientras formAccessKey esté vacío, el contacto y el boletín se envían por
     WhatsApp en su lugar (nada se pierde, solo no llega como correo). */
  formEndpoint: "https://api.web3forms.com/submit",
  formAccessKey: ""
};

const STIKE_BASE = "";

/* ----------------------------- SOCIAL ICONS ----------------------------- */
const SOCICO_IG = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><rect x="2" y="2" width="20" height="20" rx="5" stroke="white" stroke-width="2"/><circle cx="12" cy="12" r="5" stroke="white" stroke-width="2"/><circle cx="17.5" cy="6.5" r="1.5" fill="white"/></svg>`;
const SOCICO_FB = `<svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path d="M16 4h-2.5C11.6 4 10 5.6 10 7.5V10H8v3h2v9h3v-9h2.5l.5-3H13V7.5c0-.3.2-.5.5-.5H16V4z"/></svg>`;
const SOCICO_TT = `<svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V9.41a8.16 8.16 0 004.77 1.52V7.49a4.85 4.85 0 01-1-.8z"/></svg>`;
const SOCICO_WA = `<svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path d="M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.36 5.08L2 22l4.92-1.36A9.96 9.96 0 0012 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm4.97 13.47c-.21.59-.96 1.07-1.62 1.21-.43.09-.99.16-2.88-.62-2.43-1-3.96-3.47-4.08-3.63-.12-.17-.99-1.32-.99-2.51 0-1.2.63-1.78.85-2.03.22-.24.48-.3.64-.3h.46c.14 0 .33-.05.51.39.19.46.64 1.57.7 1.68.06.11.1.24.02.39l-.24.37c-.12.13-.25.29-.36.39-.12.1-.24.21-.1.41.14.2.62.91 1.33 1.47.92.73 1.69.96 1.93 1.07.24.1.38.09.52-.06.14-.14.6-.7.76-.94.16-.24.32-.2.54-.12.22.08 1.38.65 1.62.77.24.12.4.18.46.28.06.1.06.57-.15 1.17z"/></svg>`;

/* ------------------------------ LOGO ----------------------------------- */
/* Logo oficial Stike (script blanco + "BIKE SHOP" en menta), recortado del
   arte de marca a PNG/WebP transparente. Se ve bien sobre claro y oscuro
   porque el propio sticker trae su contorno. */
function stikeLogoSVG(size) {
  size = size || 46;
  return `<picture><source srcset="assets/img/logo-stike.webp" type="image/webp"><img class="logo" src="assets/img/logo-stike.png" alt="Stike Bike Shop" style="height:${size}px;width:auto" /></picture>`;
}

/* ----------------------------- CARRITO --------------------------------- */
const CART_KEY = "stike_cart_v1";

function stikeGetCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; }
  catch { return []; }
}
function stikeSaveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  stikeUpdateCartBadge();
}

/* Datos de envío del pedido en curso. Se guardan al dar "Pagar ahora" y
   sobreviven el viaje de ida y vuelta a checkout.wompi.co (localStorage es
   por origen, no se borra al navegar a otro sitio y volver) -- es la unica
   forma de que pago-resultado.html sepa a donde entregar el pedido, ya que
   Wompi nunca recibe ni devuelve esta informacion. */
const SHIPPING_KEY = "stike_shipping_v1";
function stikeGetShipping() {
  try { return JSON.parse(localStorage.getItem(SHIPPING_KEY)) || null; }
  catch { return null; }
}
function stikeSaveShipping(info) {
  localStorage.setItem(SHIPPING_KEY, JSON.stringify(info));
}
function stikeClearShipping() {
  localStorage.removeItem(SHIPPING_KEY);
}
/* Clave única de línea: mismo producto en distinta talla/color = línea distinta */
function stikeLineKey(item) {
  return item.slug + (item.size ? "::s:" + item.size : "") + (item.color ? "::c:" + item.color : "");
}
function stikeAddToCart(slug, qty, size, color) {
  qty = qty || 1;
  size = size || null;
  color = color || null;
  const cart = stikeGetCart();
  const row = cart.find(r => r.slug === slug && (r.size || null) === size && (r.color || null) === color);
  if (row) row.qty += qty;
  else {
    const item = { slug, qty };
    if (size) item.size = size;
    if (color) item.color = color;
    cart.push(item);
  }
  stikeSaveCart(cart);
  const p = stikeFindProduct(slug);
  const variant = [size, color].filter(Boolean).join(" / ");
  stikeToast((p ? p.n : "Producto") + (variant ? " (" + variant + ")" : "") + " agregado al carrito");
}
/* Actualizar / quitar operan por clave de línea (slug + talla + color) */
function stikeUpdateQty(key, qty) {
  const cart = stikeGetCart();
  const row = cart.find(r => stikeLineKey(r) === key);
  if (!row) return;
  row.qty = Math.max(1, qty);
  stikeSaveCart(cart);
}
function stikeRemoveFromCart(key) {
  stikeSaveCart(stikeGetCart().filter(r => stikeLineKey(r) !== key));
}
function stikeCartCount() {
  return stikeGetCart().reduce((n, r) => n + r.qty, 0);
}
function stikeCartTotal() {
  return stikeGetCart().reduce((sum, r) => {
    const p = stikeFindProduct(r.slug);
    return sum + (p ? p.price * r.qty : 0);
  }, 0);
}
function stikeUpdateCartBadge() {
  const n = stikeCartCount();
  document.querySelectorAll(".cart-count").forEach(el => {
    el.textContent = n;
    el.style.display = n > 0 ? "grid" : "none";
  });
}

/* ------------------------------ TOAST ---------------------------------- */
let stikeToastTimer;
function stikeToast(msg) {
  let t = document.querySelector(".toast");
  if (!t) {
    t = document.createElement("div");
    t.className = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  requestAnimationFrame(() => t.classList.add("show"));
  clearTimeout(stikeToastTimer);
  stikeToastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

/* ------------------------- TARJETA DE PRODUCTO ------------------------- */
const STIKE_LOW_STOCK = 5;
function stikeProductUrl(p) { return `producto/${p.slug}.html`; }
function stikeProductCard(p) {
  const out = stikeIsOutOfStock(p);
  const badge = out ? `<span class="badge sold">Agotado</span>`
              : p.promo ? `<span class="badge promo">Oferta</span>`
              : p.tag === "new" ? `<span class="badge new">Nuevo</span>` : "";
  const oldPrice = p.old ? `<span class="old">${stikePrice(p.old)}</span>` : "";
  const hasVariants = !!(p.sizes || p.colors);
  const url = stikeProductUrl(p);
  /* Jerarquia de ficha: marca (micro) > nombre > precio. El CTA se desliza
     sobre la foto en hover en vez de ocupar sitio debajo, para que la
     grilla en reposo sea una pared limpia de fotos sin huecos muertos. */
  const cta = out
    ? `<a class="btn cyan sm block" href="${url}">Ver producto</a>`
    : hasVariants
      ? `<a class="btn cyan sm block" href="${url}">${p.sizes ? "Elegir talla" : "Elegir color"}</a>`
      : `<button class="btn cyan sm add block" data-add="${p.slug}">Agregar al carrito</button>`;
  /* Kicker carries the brand on the multi-brand storefront. On a
     single-brand catalogue (Fate) the brand repeats on every card and stops
     being information, so CSS swaps it for the subcategory there instead. */
  const brandLine = (p.brand || p.sub || p.cat)
    ? `<div class="brand-line"><span class="bl-brand">${p.brand || ""}</span><span class="bl-sub">${p.sub || p.cat || ""}</span></div>`
    : "";
  return `
  <article class="card">
    <div class="thumb">
      ${badge}
      <button class="fav" title="Guardar" aria-label="Guardar"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg></button>
      <a href="${url}" class="thumb-link" tabindex="-1" aria-hidden="true">
        <img src="${stikeProductImage(p, 600)}" alt="${p.n}" loading="lazy">
      </a>
      <div class="quick">${cta}</div>
    </div>
    <div class="body">
      ${brandLine}
      <div class="title"><a href="${url}">${p.n}</a></div>
      <div class="price">${stikePrice(p.price)}${oldPrice}</div>
    </div>
  </article>`;
}

/* ----------------------- NAV: dropdown de categoría -------------------- */
/* Each part type has its own page (categoria/<slug>.html) rather than only a
   ?sub= filter, so the nav links straight to it. Falls back to the filtered
   storefront for any sub that doesn't have a page yet. */
function stikeSubSlug(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "")
          .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}
function stikeSubUrl(cat, sub) {
  const known = (window.STIKE_PART_PAGES || []).indexOf(stikeSubSlug(sub)) !== -1;
  return known ? `categoria/${stikeSubSlug(sub)}.html`
               : `tienda.html?cat=${cat}&sub=${encodeURIComponent(sub)}`;
}
/* Subcategorias con stock real. La taxonomia en data.js incluye tipos que la
   tienda todavia no surte; ofrecerlos en el menu o en los filtros manda al
   visitante a una pagina vacia, asi que la navegacion se deriva del catalogo. */
function stikeSubCounts(catSlug) {
  const counts = {};
  (window.STIKE_PRODUCTS || []).forEach(p => {
    if (p.cat === catSlug && p.sub) counts[p.sub] = (counts[p.sub] || 0) + 1;
  });
  return counts;
}
function stikeStockedSubs(cat) {
  if (!cat || !cat.subs) return [];
  const counts = stikeSubCounts(cat.slug);
  return cat.subs.filter(s => counts[s]);
}

function stikeNavDropdown(cat) {
  const subs = stikeStockedSubs(cat);
  if (!subs.length) return "";
  const counts = stikeSubCounts(cat.slug);
  const items = subs.map(s =>
    `<a href="${stikeSubUrl(cat.slug, s)}">${s}<i>${counts[s]}</i></a>`).join("");
  if (cat.slug === "repuestos") {
    return `<div class="dropdown mega">
      <a href="tienda.html?cat=${cat.slug}" style="grid-column:1/-1" class="col-title">Ver todos los repuestos →</a>
      ${items}
    </div>`;
  }
  return `<div class="dropdown">${items}</div>`;
}

/* ------------------------------ HEADER --------------------------------- */
/* Diseño "Rueda Duro": logo centrado sobre dos franjas -- arriba redes +
   promesas de servicio, abajo el menu partido en dos mitades a cada lado del
   logo -- y el buscador como pildora centrada entre dos rieles. En movil se
   colapsa a logo + iconos y el menu vive en el panel flotante de siempre. */
const HDR_ICO_USER = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>`;
const HDR_ICO_PHONE = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>`;
const HDR_ICO_BAG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h14l-1 12H6z"/><path d="M9 8a3 3 0 0 1 6 0"/></svg>`;
const HDR_ICO_SEARCH = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6"/><path d="M15.5 15.5 21 21"/></svg>`;

function stikeRenderHeader(active) {
  const C = STIKE_CONFIG;
  const caret = `<span class="caret"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg></span>`;
  const li = (href, label, key, extra) =>
    `<li class="${active === key ? "active" : ""}${extra || ""}"><a href="${href}">${label}</a></li>`;
  const catLi = cat => {
    const stocked = stikeStockedSubs(cat).length;
    return `<li class="${active === cat.slug ? "active" : ""}${stocked ? " has-mega" : ""}">
      <a href="tienda.html?cat=${cat.slug}"${cat.slug === "promo" ? ` data-accent="promo"` : ""}>${cat.name}${stocked ? caret : ""}</a>
      ${stikeNavDropdown(cat)}
    </li>`;
  };
  const cats = STIKE_CATEGORIES.slice();
  const left = [li("index.html", "Inicio", "home"), li("fate/", "Fate", "fate")]
    .concat(cats.slice(0, 3).map(catLi)).join("");
  const right = cats.slice(3).map(catLi)
    .concat([li("marcas.html", "Marcas", "marcas"), li("blog.html", "Blog", "blog"),
             li("armar.html", "Arma tu BMX", "armar", " nav-build-item")]).join("");

  const header = `
  <header class="site-header">
    <div class="hdr-rail wrap">
      <div class="hdr-side hdr-left">
        <div class="hdr-soc">
          <a href="${C.ig}" target="_blank" rel="noopener" aria-label="Instagram">${SOCICO_IG}</a>
          <a href="${C.fb}" target="_blank" rel="noopener" aria-label="Facebook">${SOCICO_FB}</a>
          <a href="${C.tiktok}" target="_blank" rel="noopener" aria-label="TikTok">${SOCICO_TT}</a>
        </div>
        <p class="hdr-promo">Envíos a toda Colombia <i></i> Ensamble BMX gratis</p>
      </div>
      <a class="brand" href="index.html" aria-label="Stike Bike Shop, inicio">${stikeLogoSVG(96)}</a>
      <div class="hdr-side hdr-right">
        <p class="hdr-promo">3 cuotas sin interés <i></i> <span>Comunidad <b>Stike</b> Bogotá</span></p>
        <div class="header-actions">
          <button class="icon-btn search-trigger" onclick="stikeOpenSearch()" title="Buscar" aria-label="Buscar">${HDR_ICO_SEARCH}</button>
          <a class="icon-btn hdr-contact" href="contacto.html" title="Contacto" aria-label="Contacto">${HDR_ICO_USER}</a>
          <a class="icon-btn" href="https://wa.me/${C.whatsapp}" target="_blank" rel="noopener" title="WhatsApp" aria-label="WhatsApp">${HDR_ICO_PHONE}</a>
          <a class="icon-btn" href="carrito.html" title="Carrito" aria-label="Carrito">${HDR_ICO_BAG}<span class="cart-count">0</span></a>
          <button class="icon-btn menu-toggle" id="menu-toggle" aria-label="Menú"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg></button>
        </div>
      </div>
    </div>
    <nav class="site-nav wrap" id="site-nav" aria-label="Principal">
      <ul class="nav-list nav-half nav-l">${left}</ul>
      <span class="nav-gap" aria-hidden="true"></span>
      <ul class="nav-list nav-half nav-r">${right}</ul>
    </nav>
    <div class="hdr-search wrap">
      <button type="button" class="search-pill" onclick="stikeOpenSearch()" aria-label="Buscar productos, marcas, categorías">
        <span class="sp-text">Buscar repuestos, marcas…</span>
        <span class="sp-ico">${HDR_ICO_SEARCH}</span>
      </button>
    </div>
  </header>
  <div class="nav-backdrop" id="nav-backdrop"></div>`;

  const mount = document.getElementById("site-header");
  if (mount) mount.innerHTML = header;
  stikeBindHeader();
  stikeUpdateCartBadge();
  /* Al bajar, el header se compacta a una sola franja (logo chico + menu). */
  const hdr = document.querySelector(".site-header");
  if (hdr) {
    let tick = false;
    const onScroll = () => {
      if (tick) return; tick = true;
      requestAnimationFrame(() => { hdr.classList.toggle("is-compact", window.scrollY > 140); tick = false; });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }
}

function stikeFloatNavPosition() {
  const nav = document.getElementById("site-nav");
  const header = document.querySelector(".site-header");
  if (!nav || !header) return;
  const bottom = header.getBoundingClientRect().bottom;
  nav.style.top = (bottom + 10) + "px";
  nav.style.maxHeight = Math.min(560, window.innerHeight - bottom - 24) + "px";
}

function stikeCloseNav() {
  const nav = document.getElementById("site-nav");
  const backdrop = document.getElementById("nav-backdrop");
  if (nav) nav.classList.remove("open");
  if (backdrop) backdrop.classList.remove("show");
  document.body.style.overflow = "";
}

function stikeBindHeader() {
  const toggle = document.getElementById("menu-toggle");
  const nav = document.getElementById("site-nav");
  const backdrop = document.getElementById("nav-backdrop");
  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      const willOpen = !nav.classList.contains("open");
      if (willOpen) {
        stikeFloatNavPosition();
        nav.classList.add("open");
        if (backdrop) backdrop.classList.add("show");
        document.body.style.overflow = "hidden";
      } else {
        stikeCloseNav();
      }
    });
  }
  if (backdrop) backdrop.addEventListener("click", stikeCloseNav);
  window.addEventListener("resize", () => { if (nav && nav.classList.contains("open")) stikeFloatNavPosition(); });
  nav && nav.querySelectorAll(".nav-list > li").forEach(li => {
    const caret = li.querySelector(".caret");
    if (!caret) return;
    li.querySelector("a").addEventListener("click", (e) => {
      if (window.innerWidth <= 760 && li.querySelector(".dropdown")) {
        e.preventDefault();
        li.classList.toggle("open-sub");
        stikeFloatNavPosition();
      }
    });
  });
}

function stikeDoSearch(e) {
  e.preventDefault();
  const q = document.getElementById("site-search").value.trim();
  window.location.href = "tienda.html?q=" + encodeURIComponent(q);
}

/* ------------------------ BUSCADOR EN VIVO (overlay) ------------------- */
function stikeRenderSearchOverlay() {
  if (document.getElementById("search-overlay")) return;
  const el = document.createElement("div");
  el.id = "search-overlay";
  el.className = "search-overlay";
  el.innerHTML = `
    <div class="search-modal" role="dialog" aria-modal="true" aria-label="Buscar en Stike">
      <div class="search-bar">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>
        <input type="search" id="overlay-search" placeholder="Busca productos, marcas, categorías..." autocomplete="off" aria-label="Buscar">
        <button class="search-esc" type="button" onclick="stikeCloseSearch()">ESC</button>
      </div>
      <div class="search-body" id="overlay-results"></div>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener("click", (e) => { if (e.target === el) stikeCloseSearch(); });
  const inp = el.querySelector("#overlay-search");
  inp.addEventListener("input", () => stikeSearchRender(inp.value));
  inp.addEventListener("keydown", stikeSearchKeydown);
}
function stikeSearchRow(p) {
  return `<a class="sr-row" href="${stikeProductUrl(p)}">
    <span class="sr-thumb"><img src="${stikeProductImage(p, 120)}" alt=""></span>
    <span class="sr-meta"><span class="sr-name">${p.n}</span><span class="sr-brand">${p.brand}</span></span>
    <span class="sr-price">${stikePrice(p.price)}</span>
  </a>`;
}
function stikeSearchRender(q) {
  const box = document.getElementById("overlay-results");
  if (!box) return;
  q = (q || "").trim().toLowerCase();
  if (!q) {
    const cats = STIKE_CATEGORIES.map(c => `<a class="sr-chip" href="tienda.html?cat=${c.slug}">${c.name}</a>`).join("");
    const pop = STIKE_PRODUCTS.slice(0, 4).map(stikeSearchRow).join("");
    box.innerHTML = `<div class="sr-section"><div class="sr-head">Explora</div><div class="sr-chips">${cats}</div></div>
      <div class="sr-section"><div class="sr-head">Destacados</div>${pop}</div>`;
    return;
  }
  const prods = STIKE_PRODUCTS.filter(p =>
    (p.n + " " + p.brand + " " + (p.sub || "") + " " + p.cat).toLowerCase().includes(q)).slice(0, 7);
  const brands = STIKE_BRANDS.filter(b => b.toLowerCase().includes(q)).slice(0, 4);
  const cats = STIKE_CATEGORIES.filter(c => c.name.toLowerCase().includes(q));
  let html = "";
  if (cats.length || brands.length) {
    html += `<div class="sr-section"><div class="sr-head">Sugerencias</div><div class="sr-chips">` +
      cats.map(c => `<a class="sr-chip" href="tienda.html?cat=${c.slug}">${c.name}</a>`).join("") +
      brands.map(b => `<a class="sr-chip" href="tienda.html?brand=${encodeURIComponent(b)}">${b}</a>`).join("") +
      `</div></div>`;
  }
  if (prods.length) {
    html += `<div class="sr-section"><div class="sr-head">Productos</div>${prods.map(stikeSearchRow).join("")}</div>`;
    html += `<a class="sr-all" href="tienda.html?q=${encodeURIComponent(q)}">Ver todos los resultados de “${q}” →</a>`;
  } else if (!cats.length && !brands.length) {
    html = `<div class="sr-empty">Sin resultados para “${q}”.<br><a href="tienda.html?q=${encodeURIComponent(q)}">Buscar en toda la tienda →</a></div>`;
  }
  box.innerHTML = html;
}
function stikeSearchKeydown(e) {
  const rows = Array.prototype.slice.call(document.querySelectorAll("#overlay-results .sr-row"));
  let idx = rows.findIndex(r => r.classList.contains("active"));
  if (e.key === "ArrowDown") { e.preventDefault(); idx = Math.min(rows.length - 1, idx + 1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); idx = Math.max(0, idx - 1); }
  else if (e.key === "Enter") {
    if (idx >= 0 && rows[idx]) { window.location.href = rows[idx].getAttribute("href"); }
    else { const q = document.getElementById("overlay-search").value.trim(); if (q) window.location.href = "tienda.html?q=" + encodeURIComponent(q); }
    return;
  } else if (e.key === "Escape") { stikeCloseSearch(); return; }
  else return;
  rows.forEach(r => r.classList.remove("active"));
  if (rows[idx]) { rows[idx].classList.add("active"); rows[idx].scrollIntoView({ block: "nearest" }); }
}
function stikeOpenSearch() {
  stikeRenderSearchOverlay();
  const ov = document.getElementById("search-overlay");
  if (!ov) return;
  ov.classList.add("open");
  document.body.style.overflow = "hidden";
  stikeSearchRender("");
  setTimeout(() => { const inp = document.getElementById("overlay-search"); if (inp) { inp.value = ""; inp.focus(); } }, 30);
}
function stikeCloseSearch() {
  const ov = document.getElementById("search-overlay");
  if (ov) ov.classList.remove("open");
  document.body.style.overflow = "";
  const hs = document.getElementById("site-search");
  if (hs) hs.blur();
}

/* ------------------------------ FOOTER --------------------------------- */
function stikeRenderFooter() {
  const C = STIKE_CONFIG;
  const catLinks = STIKE_CATEGORIES.map(c =>
    `<a href="tienda.html?cat=${c.slug}">${c.name}</a>`).join("");
  /* El home trae su propia franja bajo el hero: no se repite al pie. */
  const strip = document.querySelector(".rd-strip") ? "" : `
  <div class="strip-band" aria-hidden="true">
    <div class="strip-track">
      ${Array(2).fill(`<span>Flatland</span><span>Comunidad Stike BMX</span><span>Ensamble gratis</span><span>Envíos nacionales</span><span>Street</span><span>Park</span><span>Asesoría de riders</span><span>3 cuotas sin interés</span>`).join("")}
    </div>
  </div>`;
  const footer = strip + `
  <section class="cta-band">
    <div class="wrap">
      <div>
        <span class="kicker">Bogotá — Venecia</span>
        <h2>¿Listo para <em>rodar?</em></h2>
        <p>Escríbenos por WhatsApp y arma tu BMX con asesoría real de riders.</p>
      </div>
      <a class="btn wa" href="https://wa.me/${C.whatsapp}" target="_blank" rel="noopener">Hablar por WhatsApp</a>
    </div>
  </section>
  <footer class="site-footer">
    <div class="wrap">
      <div class="footer-grid">
        <div class="footer-brand">
          <a href="index.html" class="foot-logo" aria-label="Stike Bike Shop">${stikeLogoSVG(84)}</a>
          <p>La casa de todo el que rueda. Repuestos, armado a tu medida y asesoría real de riders en Venecia, Bogotá.</p>
          <div class="foot-social">
            <a href="${C.ig}" target="_blank" rel="noopener" class="soc soc-ig" title="Instagram" aria-label="Instagram">${SOCICO_IG}</a>
            <a href="${C.fb}" target="_blank" rel="noopener" class="soc soc-fb" title="Facebook" aria-label="Facebook">${SOCICO_FB}</a>
            <a href="${C.tiktok}" target="_blank" rel="noopener" class="soc soc-tt" title="TikTok" aria-label="TikTok">${SOCICO_TT}</a>
            <a href="https://wa.me/${C.whatsapp}" target="_blank" rel="noopener" class="soc soc-wa" title="WhatsApp" aria-label="WhatsApp">${SOCICO_WA}</a>
          </div>
        </div>
        <div>
          <h5>Tienda</h5>
          ${catLinks}
          <a href="marcas.html">Marcas</a>
          <a href="fate/">Fate BMX</a>
        </div>
        <div>
          <h5>Stike</h5>
          <a href="armar.html">Arma tu BMX</a>
          <a href="nosotros.html">Nosotros</a>
          <a href="blog.html">Blog</a>
          <a href="contacto.html">Contacto</a>
        </div>
        <div>
          <h5>Ayuda</h5>
          <a href="envios.html">Envíos y entregas</a>
          <a href="devoluciones.html">Cambios y devoluciones</a>
          <a href="https://wa.me/${C.whatsapp}" target="_blank" rel="noopener">${C.whatsappPretty}</a>
          <p class="foot-hours">${C.hours}</p>
        </div>
      </div>
      <div class="footer-bottom">
        <span>© ${new Date().getFullYear()} ${C.full} — Bogotá, Colombia.</span>
        <nav class="footer-legal" aria-label="Enlaces legales">
          <a href="privacidad.html">Privacidad</a>
          <a href="cookies.html">Cookies</a>
          <a href="terminos.html">Términos</a>
          <a href="envios.html">Envíos</a>
          <a href="devoluciones.html">Devoluciones</a>
        </nav>
        <div class="pay-icons">
          <span>VISA</span><span>MASTERCARD</span><span>PSE</span><span>NEQUI</span><span>EFECTY</span>
        </div>
      </div>
    </div>
  </footer>`;
  const mount = document.getElementById("site-footer");
  if (mount) mount.innerHTML = footer;
}

/* --------------------------- ENVÍO DE FORMULARIOS ---------------------- */
/* Solo hay endpoint real si además hay llave -- sin llave, Web3Forms
   siempre responde 400 (access_key inválido), así que ni se intenta. */
function stikeFormEndpoint() {
  const e = STIKE_CONFIG.formEndpoint, k = STIKE_CONFIG.formAccessKey;
  return (e && /^https?:\/\//.test(e) && k) ? e : null;
}
/* No hay servidor propio que limite cuántas veces se puede enviar un
   formulario, así que el único freno posible vive aquí: un mismo formulario
   no puede reenviarse antes de este tiempo. No detiene a alguien decidido
   a saltárselo (podría llamar la función a mano), pero sí el caso real —
   doble click o alguien manteniendo apretado enviar. */
const FORM_COOLDOWN_MS = 8000;
const formLastSubmit = new WeakMap();

/* Envía `data` al endpoint configurado. Si no hay llave configurada todavía,
   o si el envío falla, ejecuta `fallback` (o confirma con un toast) en vez
   de dejar el mensaje perdido en silencio. `submit` es el evento del form. */
function stikeSubmitForm(e, data, successMsg, fallback) {
  e.preventDefault();
  const form = e.target;
  const last = formLastSubmit.get(form) || 0;
  if (Date.now() - last < FORM_COOLDOWN_MS) return;
  formLastSubmit.set(form, Date.now());
  const endpoint = stikeFormEndpoint();
  const runFallback = () => {
    if (typeof fallback === "function") fallback();
    else { form.reset(); stikeToast(successMsg); }
  };
  if (!endpoint) { runFallback(); return; }
  const btn = form.querySelector('[type="submit"]');
  const prev = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "Enviando…"; }
  fetch(endpoint, {
    method: "POST",
    headers: { "Accept": "application/json" },
    body: new URLSearchParams({ ...data, access_key: STIKE_CONFIG.formAccessKey })
  })
    .then(r => r.json().catch(() => ({})).then(body => {
      // Web3Forms (y servicios similares) pueden responder 200 con
      // success:false -- el status HTTP solo no alcanza para confiar.
      if (!r.ok || body.success === false) throw new Error(body.message || "bad status");
      form.reset();
      stikeToast(successMsg);
    }))
    .catch(() => runFallback())
    .finally(() => { if (btn) { btn.disabled = false; btn.textContent = prev; } });
}

function stikeContact(e) {
  const form = e.target;
  const val = sel => (form.querySelector(sel)?.value || "").trim();
  const nombre = val('input[type="text"]');
  const tel = val('input[type="tel"]');
  const tema = val('select');
  const mensaje = val('textarea');
  stikeSubmitForm(e,
    { nombre, telefono: tel, tema, mensaje, _subject: "Contacto web — " + tema },
    "Mensaje enviado, te contactamos pronto",
    () => {  // sin endpoint: abrimos WhatsApp con el mensaje ya escrito
      const text = `Hola Stike! Soy ${nombre}.\nTema: ${tema}\n${mensaje}\nMi WhatsApp/Tel: ${tel}`;
      window.open("https://wa.me/" + STIKE_CONFIG.whatsapp + "?text=" + encodeURIComponent(text), "_blank", "noopener");
      form.reset();
      stikeToast("Te llevamos a WhatsApp para enviar tu mensaje");
    });
}

/* ------------------------- Boletín (popup) ---------------------- */
const NEWSLETTER_KEY = "stike_newsletter_v1";

function stikeMarkNewsletterSubscribed() {
  localStorage.setItem(NEWSLETTER_KEY, "subscribed");
  const overlay = document.getElementById("newsletter-overlay");
  if (overlay) overlay.classList.remove("open");
}

/* Sin correo configurado (o si el envío falla), un suscriptor perdido en
   silencio es peor que uno confirmado por WhatsApp: al menos el dueño se
   entera y puede sumarlo a la lista a mano. */
function stikeNewsletterFallback(form, email, origen) {
  return () => {
    const text = `Nuevo suscriptor al boletín (${origen}): ${email}`;
    window.open("https://wa.me/" + STIKE_CONFIG.whatsapp + "?text=" + encodeURIComponent(text), "_blank", "noopener");
    form.reset();
    stikeToast("¡Gracias! Te sumamos por WhatsApp.");
  };
}

function stikeDismissNewsletter(e) {
  if (e && e.preventDefault) e.preventDefault();
  localStorage.setItem(NEWSLETTER_KEY, "dismissed");
  const overlay = document.getElementById("newsletter-overlay");
  if (overlay) overlay.classList.remove("open");
}

function stikeSubscribeFromPopup(e) {
  const form = e.target;
  const email = (form.querySelector('input[type="email"]').value || "").trim();
  stikeSubmitForm(e,
    { email, _subject: "Nuevo suscriptor — popup Stike", origen: "popup" },
    "¡Bienvenido a la comunidad Stike!",
    stikeNewsletterFallback(form, email, "popup"));
  stikeMarkNewsletterSubscribed();
}

function stikeRenderNewsletterPopup() {
  if (localStorage.getItem(NEWSLETTER_KEY)) return;
  if (document.getElementById("newsletter-overlay")) return;
  const el = document.createElement("div");
  el.id = "newsletter-overlay";
  el.className = "newsletter-overlay";
  el.innerHTML = `
    <div class="newsletter-modal" role="dialog" aria-modal="true" aria-label="Únete a la comunidad Stike">
      <button type="button" class="nl-close" aria-label="Cerrar" onclick="stikeDismissNewsletter()">✕</button>
      ${stikeLogoSVG(44)}
      <h3>Únete a la comunidad Stike</h3>
      <p>Entérate primero de lanzamientos, ofertas y eventos de la comunidad BMX en Bogotá.</p>
      <form onsubmit="stikeSubscribeFromPopup(event)">
        <input type="email" placeholder="Tu correo" required autocomplete="email">
        <button class="btn block" type="submit">Quiero unirme</button>
      </form>
      <a href="#" class="nl-skip" onclick="stikeDismissNewsletter(event)">Ahora no</a>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener("click", (e) => { if (e.target === el) stikeDismissNewsletter(); });
  setTimeout(() => el.classList.add("open"), 2200);
}

/* --------------------- Delegación global de eventos -------------------- */
document.addEventListener("click", (e) => {
  const add = e.target.closest("[data-add]");
  if (add) { stikeAddToCart(add.getAttribute("data-add")); }
  const fav = e.target.closest(".fav");
  if (fav) { fav.classList.toggle("liked"); }
});

/* Atajo de teclado para el buscador (⌘K / Ctrl+K) */
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); stikeOpenSearch(); }
});

/* WhatsApp flotante */
function stikeFloatingWA() {
  const a = document.createElement("a");
  a.className = "wa-float";
  a.href = "https://wa.me/" + STIKE_CONFIG.whatsapp;
  a.target = "_blank"; a.rel = "noopener";
  a.title = "Escríbenos por WhatsApp";
  a.setAttribute("aria-label", "Escríbenos por WhatsApp");
  a.innerHTML = SOCICO_WA;
  document.body.appendChild(a);
}

/* ------------------------- COOKIES / CONSENTIMIENTO -------------------- */
const STIKE_COOKIE_KEY = "stike_cookie_consent_v1";
function stikeCookieConsent() {
  try { return JSON.parse(localStorage.getItem(STIKE_COOKIE_KEY)); } catch (e) { return null; }
}
function stikeSetCookieConsent(choice) {
  try { localStorage.setItem(STIKE_COOKIE_KEY, JSON.stringify({ choice, ts: Date.now() })); } catch (e) {}
  /* Las analíticas/marketing deben escuchar este evento antes de cargar (consent mode) */
  document.dispatchEvent(new CustomEvent("stike:consent", { detail: { choice } }));
}
function stikeCookieBanner() {
  if (stikeCookieConsent()) return;            // el usuario ya decidió
  const el = document.createElement("div");
  el.className = "cookie-banner";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Aviso de cookies");
  el.innerHTML = `
    <div class="cookie-inner">
      <div class="cookie-text">
        <strong>Cookies en Stike</strong>
        <p>Usamos cookies propias y de terceros para que la tienda funcione, recordar tu carrito y entender el tráfico del sitio. Acepta o rechaza las opcionales. Lee nuestra <a href="cookies.html">Política de Cookies</a> y de <a href="privacidad.html">Privacidad</a>.</p>
      </div>
      <div class="cookie-actions">
        <button class="btn ghost sm" data-cookie="reject" type="button">Rechazar opcionales</button>
        <button class="btn sm" data-cookie="accept" type="button">Aceptar todas</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  el.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cookie]");
    if (!btn) return;
    stikeSetCookieConsent(btn.getAttribute("data-cookie"));
    el.classList.remove("show");
    setTimeout(() => { if (el.parentNode) el.remove(); }, 350);
  });
}

/* Rellena elementos con [data-cfg] desde STIKE_CONFIG (páginas legales) */
function stikeFillConfig(root) {
  const C = STIKE_CONFIG;
  const map = {
    site: C.full, legalName: C.legalName, nit: C.nit,
    email: C.email, whatsapp: C.whatsappPretty, phone: C.phone,
    address: C.address, hours: C.hours, updated: C.legalUpdated, igHandle: C.igHandle
  };
  (root || document).querySelectorAll("[data-cfg]").forEach(el => {
    const k = el.getAttribute("data-cfg");
    if (map[k] != null) el.textContent = map[k];
  });
}

/* ------------------------- CONTENIDO EDITABLE --------------------------
   Manifest plano (data/site-content.json) que el admin edita en la pestaña
   "Contenido del sitio". Se aplica por PRESENCIA de clave: una clave que el
   admin nunca toco no aparece en el archivo y el elemento se queda con su
   texto por defecto (el que ya trae el HTML); una clave guardada en blanco
   a proposito SI aparece (valor "") y el elemento se vacia. */
function stikeApplyContent() {
  const els = document.querySelectorAll("[data-content-key]");
  if (!els.length) return;
  fetch("data/site-content.json", { cache: "no-store" })
    .then(r => r.ok ? r.json() : {})
    .catch(() => ({}))
    .then(content => {
      els.forEach(el => {
        const key = el.getAttribute("data-content-key");
        if (Object.prototype.hasOwnProperty.call(content, key)) el.textContent = content[key];
      });
    });
}

/* Filtros plegables en movil: en pantallas chicas la columna de filtros
   (categoria, 25+ marcas, precio) empujaba los productos casi 1000px hacia
   abajo. Ahi se pliega a una sola barra "Filtrar" con el numero de filtros
   activos; en escritorio no cambia nada. */
function stikeCollapsibleFilters() {
  const box = document.querySelector(".filters");
  const head = box && box.querySelector("h4");
  if (!box || !head) return;
  const mq = window.matchMedia("(max-width: 760px)");
  head.setAttribute("role", "button");
  head.setAttribute("tabindex", "0");
  const label = head.textContent.trim();
  const sync = () => {
    const n = box.querySelectorAll('input[type=checkbox]:checked').length +
      (box.querySelector('input[name=price]:checked:not([value=all])') ? 1 : 0);
    head.innerHTML = `${label}${n ? ` <b class="f-count">${n}</b>` : ""}<span class="f-chev" aria-hidden="true"></span>`;
    head.setAttribute("aria-expanded", String(!box.classList.contains("collapsed")));
  };
  const apply = () => { box.classList.toggle("collapsed", mq.matches); sync(); };
  const toggle = () => { if (!mq.matches) return; box.classList.toggle("collapsed"); sync(); };
  head.addEventListener("click", toggle);
  head.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
  box.addEventListener("change", sync);
  box.addEventListener("click", e => { if (e.target.closest("#clear-filters")) setTimeout(sync, 0); });
  window.addEventListener("load", sync);
  (mq.addEventListener ? mq.addEventListener("change", apply) : mq.addListener(apply));
  apply();
}

/* Init común para todas las páginas */
function stikeInit(active) {
  stikeRenderHeader(active);
  stikeRenderFooter();
  stikeFloatingWA();
  stikeRenderSearchOverlay();
  stikeFillConfig();
  stikeCookieBanner();
  stikeRenderNewsletterPopup();
  stikeApplyContent();
  stikeCollapsibleFilters();
}
