/* =========================================================================
   STIKE BIKE SHOP: hidratacion de la ficha de producto estatica.
   El HTML de producto/<slug>.html ya viene pre-renderizado (SEO, precio,
   specs, opciones de talla/color con su stock en data-stock). Este script
   solo agrega interactividad: stepper de cantidad, seleccion de
   talla/color, agregar al carrito, galeria y "tambien te puede gustar".
   ========================================================================= */
function stikePdpInit(slug) {
  const p = stikeFindProduct(slug);
  const mount = document.querySelector(".pdp");
  if (!p) {
    if (mount) mount.innerHTML = `<div class="empty"><h3 style="font-size:30px">Producto no encontrado</h3><p>Es posible que ya no esté disponible.</p><a class="btn cyan" href="../tienda.html">Volver a la tienda</a></div>`;
    return;
  }

  let selectedSize = null;
  let selectedColor = null;
  // Con un solo valor real, la variante no tiene nada que elegir: se
  // autoselecciona (sigue mostrandose, es informativa, pero no bloquea el carrito).
  if (p.sizes && p.sizes.length === 1) selectedSize = p.sizes[0].v;
  if (p.colors && p.colors.length === 1) selectedColor = p.colors[0].v;

  const qtyEl = document.getElementById("qty");
  const addBtn = document.getElementById("add-btn");
  const waBuy = document.getElementById("wa-buy");
  const mainImg = document.getElementById("main-img");
  const thumbsBox = document.querySelector(".pdp-thumbs");
  const mainBox = document.querySelector(".pdp-gallery .main");

  // Cart icon on the add-to-cart button
  if (addBtn && !addBtn.querySelector("svg")) {
    addBtn.innerHTML = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>` + addBtn.textContent;
  }

  // Magnifier + lightbox: click the main photo (or the zoom button) to see it full-size
  if (mainBox && mainImg) {
    let lightbox = document.querySelector(".pdp-lightbox");
    if (!lightbox) {
      lightbox = document.createElement("div");
      lightbox.className = "pdp-lightbox";
      lightbox.innerHTML = `<button class="lb-close" aria-label="Cerrar"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button><button class="lb-nav prev" type="button" aria-label="Foto anterior"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 5 8 12 15 19"/></svg></button><button class="lb-nav next" type="button" aria-label="Foto siguiente"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 5 16 12 9 19"/></svg></button><img alt="">`;
      document.body.appendChild(lightbox);
      const lbImg = lightbox.querySelector("img");
      const close = () => lightbox.classList.remove("open");
      lightbox.querySelector(".lb-close").addEventListener("click", close);
      lightbox.addEventListener("click", e => { if (e.target === lightbox) close(); });
      document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
      lightbox._open = src => { lbImg.src = src; lightbox.classList.add("open"); };
    }
    const zoomBtn = document.createElement("button");
    zoomBtn.className = "pdp-zoom";
    zoomBtn.type = "button";
    zoomBtn.setAttribute("aria-label", "Ver imagen completa");
    zoomBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>`;
    mainBox.appendChild(zoomBtn);
    const openLightbox = () => document.querySelector(".pdp-lightbox")._open(mainImg.src);
    zoomBtn.addEventListener("click", openLightbox);
    mainImg.addEventListener("click", openLightbox);
  }

  const sizeWord = String(p.sizeLabel || "talla").toLowerCase();
  function currentStock() {
    return stikeStockFor(p, p.sizes ? selectedSize : undefined, p.colors ? selectedColor : undefined);
  }

  /* El texto lo redacta stikeWaText (assets/js/data.js), el mismo que usa el
     generador al hornear la ficha, para que el mensaje no dependa de si el
     cliente eligio variante o no. Si el producto esta agotado, el mensaje y
     la etiqueta del boton cambian a "avisame cuando llegue". */
  /* Precio de la opcion elegida (solo cambia si hay precios por variante). */
  const priceEl = document.getElementById("pdp-price");
  function updatePrice() {
    if (!priceEl) return;
    const r = stikePriceRange(p);
    if (!r.varies) return;
    const dim = (p.colors && p.colors.some(c => c.price > 0)) ? "color" : "size";
    const chosen = dim === "color" ? selectedColor : selectedSize;
    priceEl.textContent = chosen != null ? stikePrice(stikePriceFor(p, selectedSize, selectedColor)) : "Desde " + stikePrice(r.min);
  }
  function updateWaBuy() {
    updatePrice();
    if (!waBuy) return;
    const msg = stikeWaText(p, { size: selectedSize, color: selectedColor, shortName: STIKE_CONFIG.name });
    waBuy.href = `https://wa.me/${STIKE_CONFIG.whatsapp}?text=${encodeURIComponent(msg)}`;
    const label = stikeWaLabel(p);
    if (waBuy.textContent.trim() !== label) waBuy.textContent = label;
  }

  function applyColorGallery() {
    if (!selectedColor || !p.imgColorMap || !thumbsBox) return;
    const matches = (p.imgs || []).filter(u => p.imgColorMap[u] === selectedColor);
    if (!matches.length) return;
    thumbsBox.querySelectorAll("[data-thumb]").forEach(btn => {
      btn.style.display = matches.includes(btn.getAttribute("data-src")) ? "" : "none";
    });
    if (typeof showPhoto === "function") showPhoto(matches[0]); else if (mainImg) mainImg.src = matches[0];
  }

  // Cantidad
  if (qtyEl) {
    document.querySelectorAll("[data-q]").forEach(b => b.addEventListener("click", () => {
      const stock = currentStock();
      let v = parseInt(qtyEl.value) || 1;
      v = Math.max(1, v + parseInt(b.getAttribute("data-q")));
      if (stock != null && stock > 0) v = Math.min(v, stock);
      qtyEl.value = v;
    }));
    qtyEl.addEventListener("input", () => { qtyEl.value = qtyEl.value.replace(/[^0-9]/g, ""); });
  }

  /* El HTML de la ficha se genero con el stock de ESE momento; las ventas
     (tienda u online) lo cambian despues. Se re-sincronizan los botones con
     el catalogo vivo para que nunca se ofrezca algo vendido ni se bloquee
     algo que volvio a tener unidades. */
  /* Que se puede elegir depende de lo ya elegido: con tabla de
     combinaciones, una talla solo esta disponible si existe en el color
     elegido (y al reves). Sin combos son dos bodegas independientes. */
  function optionUnits(kind, value) {
    if (stikeHasCombos(p)) {
      return p.combos.reduce((n, r) => {
        if (kind === "size" && r.s !== value) return n;
        if (kind === "color" && r.c !== value) return n;
        if (kind === "size" && selectedColor && r.c !== selectedColor) return n;
        if (kind === "color" && selectedSize && r.s !== selectedSize) return n;
        return n + Math.max(0, r.u || 0);
      }, 0);
    }
    const pool = kind === "size" ? p.sizes : p.colors;
    const row = pool && pool.find(r => r.v === value);
    return row ? (row.u || 0) : 0;
  }
  function refreshOptions() {
    [["size", "#size-options .size-opt", "data-size"], ["color", "#color-options .color-opt", "data-color"]].forEach(([kind, sel, attr]) => {
      if (!(kind === "size" ? p.sizes : p.colors)) return;
      document.querySelectorAll(sel).forEach(b => {
        const u = optionUnits(kind, b.getAttribute(attr));
        b.setAttribute("data-stock", u);
        b.disabled = u <= 0;
        b.classList.toggle("out", u <= 0);
        if (u <= 0 && b.classList.contains("active")) {   // la eleccion ya no existe con la otra
          b.classList.remove("active");
          if (kind === "size") selectedSize = null; else selectedColor = null;
        }
      });
    });
  }
  refreshOptions();
  if (addBtn) {
    const sellable = stikeSellable(p);
    addBtn.disabled = sellable != null && sellable <= 0;
  }

  // Talla / color: los botones ya estan en el HTML (server-rendered) con su data-stock
  document.querySelectorAll("#size-options .size-opt").forEach(b => b.addEventListener("click", () => {
    if (b.disabled) return;
    document.querySelectorAll("#size-options .size-opt").forEach(o => o.classList.remove("active"));
    b.classList.add("active");
    selectedSize = b.getAttribute("data-size");
    const req = document.getElementById("size-req"); if (req) req.textContent = "";
    refreshOptions();
    updateWaBuy();
  }));
  document.querySelectorAll("#color-options .color-opt").forEach(b => b.addEventListener("click", () => {
    if (b.disabled) return;
    document.querySelectorAll("#color-options .color-opt").forEach(o => o.classList.remove("active"));
    b.classList.add("active");
    selectedColor = b.getAttribute("data-color");
    const req = document.getElementById("color-req"); if (req) req.textContent = "";
    refreshOptions();
    updateWaBuy();
    applyColorGallery();
  }));

  if (addBtn && !addBtn.disabled) addBtn.addEventListener("click", () => {
    if (p.sizes && !selectedSize) {
      const req = document.getElementById("size-req"); if (req) req.textContent = "(elige " + sizeWord + ")";
      const opts = document.getElementById("size-options");
      if (opts) { opts.classList.add("shake"); setTimeout(() => opts.classList.remove("shake"), 450); }
      stikeToast("Elige " + sizeWord + " primero");
      return;
    }
    if (p.colors && !selectedColor) {
      const req = document.getElementById("color-req"); if (req) req.textContent = "(elige un color)";
      const opts = document.getElementById("color-options");
      if (opts) { opts.classList.add("shake"); setTimeout(() => opts.classList.remove("shake"), 450); }
      stikeToast("Elige un color primero");
      return;
    }
    const stock = currentStock();
    if (stock != null && stock <= 0) { stikeToast("Sin stock para esa combinación"); return; }
    stikeAddToCart(p.slug, Math.max(1, parseInt(qtyEl.value) || 1), selectedSize, selectedColor);
  });

  // Compartir: copiar enlace
  const copyBtn = document.getElementById("share-copy");
  if (copyBtn) copyBtn.addEventListener("click", () => {
    const shareUrl = location.href;
    if (navigator.clipboard) navigator.clipboard.writeText(shareUrl).then(() => stikeToast("Enlace copiado")).catch(() => stikeToast("Copia: " + shareUrl));
    else stikeToast("Copia: " + shareUrl);
  });

  /* ---------------------------- Galeria ----------------------------------
     Flechas en pantalla, teclado (← →), deslizar con el dedo y contador.
     Recorre solo las fotos VISIBLES: al elegir un color la galeria se filtra
     (applyColorGallery) y las flechas siguen esa misma lista. Funciona igual
     en la foto principal y en la vista ampliada (lightbox). */
  const thumbBtns = () => thumbsBox ? Array.from(thumbsBox.querySelectorAll("[data-thumb]")) : [];
  const photoList = () => {
    const l = thumbBtns().filter(b => b.style.display !== "none").map(b => b.getAttribute("data-src"));
    return l.length ? l : (mainImg ? [mainImg.getAttribute("src")] : []);
  };
  let countEl = null;
  function updateGalleryUi() {
    const list = photoList();
    const i = Math.max(0, list.indexOf(mainImg.getAttribute("src")));
    if (countEl) { countEl.textContent = (i + 1) + " / " + list.length; countEl.hidden = list.length < 2; }
    mainBox.querySelectorAll(".pdp-nav").forEach(b => { b.hidden = list.length < 2; });
    const lb = document.querySelector(".pdp-lightbox");
    if (lb) lb.querySelectorAll(".lb-nav").forEach(b => { b.hidden = list.length < 2; });
  }
  function showPhoto(src) {
    if (!mainImg || !src) return;
    mainImg.setAttribute("src", src);
    thumbBtns().forEach(b => {
      const on = b.getAttribute("data-src") === src;
      b.classList.toggle("active", on);
      if (on && thumbsBox && thumbsBox.scrollTo) thumbsBox.scrollTo({ left: Math.max(0, b.offsetLeft - (thumbsBox.clientWidth - b.offsetWidth) / 2), behavior: "smooth" });
    });
    const lb = document.querySelector(".pdp-lightbox");
    if (lb && lb.classList.contains("open")) lb.querySelector("img").src = src;
    updateGalleryUi();
  }
  function stepPhoto(d) {
    const list = photoList();
    if (list.length < 2) return;
    const i = Math.max(0, list.indexOf(mainImg.getAttribute("src")));
    showPhoto(list[(i + d + list.length) % list.length]);
  }
  window.stikePhotoStep = stepPhoto;
  // Miniaturas: cambiar imagen principal
  thumbBtns().forEach(t => t.addEventListener("click", () => showPhoto(t.getAttribute("data-src"))));
  if (mainBox && mainImg) {
    const mk = (cls, label, svg, d) => { const b = document.createElement("button"); b.type = "button"; b.className = "pdp-nav " + cls; b.setAttribute("aria-label", label); b.innerHTML = svg; b.addEventListener("click", e => { e.stopPropagation(); stepPhoto(d); }); mainBox.appendChild(b); };
    mk("prev", "Foto anterior", '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 5 8 12 15 19"/></svg>', -1);
    mk("next", "Foto siguiente", '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 5 16 12 9 19"/></svg>', 1);
    countEl = document.createElement("span"); countEl.className = "pdp-count"; countEl.setAttribute("aria-live", "polite"); mainBox.appendChild(countEl);
    const lb = document.querySelector(".pdp-lightbox");
    if (lb) { lb.querySelector(".lb-nav.prev").addEventListener("click", e => { e.stopPropagation(); stepPhoto(-1); }); lb.querySelector(".lb-nav.next").addEventListener("click", e => { e.stopPropagation(); stepPhoto(1); }); }
    // Teclado: ← → (no se pisa lo que se escribe en un campo, ni atajos con Ctrl/Alt/Cmd)
    document.addEventListener("keydown", e => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const t = e.target;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      e.preventDefault();
      stepPhoto(e.key === "ArrowRight" ? 1 : -1);
    });
    // Deslizar con el dedo (foto principal y vista ampliada)
    const swipe = el => {
      let x0 = null, y0 = null;
      el.addEventListener("touchstart", e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
      el.addEventListener("touchend", e => {
        if (x0 == null) return;
        const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
        x0 = null;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.4) stepPhoto(dx < 0 ? 1 : -1);
      }, { passive: true });
    };
    swipe(mainBox);
    if (lb) swipe(lb);
    updateGalleryUi();
  }

  updateWaBuy();

  // Relacionados
  /* stikeRelatedProducts (assets/js/data.js) hace el trabajo real: misma
     marca + pieza complementaria primero, despues misma marca + medida,
     con relleno para que la seccion nunca quede vacia. Calculado en vivo
     del catalogo que acaba de cargar, asi que no envejece. */
  const relatedMount = document.getElementById("related");
  if (relatedMount) relatedMount.innerHTML = stikeRelatedProducts(p, 3).map(stikeProductCard).join("");
}
