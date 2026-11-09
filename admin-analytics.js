/* =========================================================================
   STIKE BIKE SHOP: pestaña «Analítica» del panel (admin.html → #panel-analitica).

   Se carga aparte (admin.php?f=an: solo la reciben los roles con acceso a las finanzas) la primera vez que se abre la pestaña.
   Lee todo de api/analytics.php (Google Analytics 4, Search Console y el contador propio del sitio) y lo dibuja con SVG y HTML
   a mano, sin librerías. Reglas de los gráficos (guía dataviz): una paleta validada contra la superficie del panel, marcas
   delgadas, rejilla suave, ventana con el valor al pasar el mouse o al enfocar con el teclado, y una tabla equivalente de
   cada gráfico («Ver tabla»). Todo texto que viene de los datos (rutas, búsquedas, nombres) se escapa: nunca entra como HTML.

   Pestañas: Resumen · WhatsApp · Cómo llegan · Qué ven · Quiénes · Google (SEO) · En vivo · Conexión.
   Si Google todavía no está conectado, Resumen y WhatsApp se llenan con el contador propio del sitio (sin cookies).
   ========================================================================= */
(function () {
  "use strict";
  if (window.StikeAnalytics) return;

  /* ============================== utilidades ============================== */
  const $ = s => document.querySelector(s);
  const num = n => { n = Number(n); return isFinite(n) ? n : 0; };
  const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const N = n => num(n).toLocaleString("es-CO", { maximumFractionDigits: 0 });
  const DEC = (n, d) => num(n).toLocaleString("es-CO", { minimumFractionDigits: d, maximumFractionDigits: d });
  const COP = n => "$" + N(n);
  const PCT = (x, d) => DEC(num(x) * 100, d == null ? 1 : d) + " %";
  const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const DIA = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  const DIA_LARGO = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];   // GA4 cuenta el domingo como 0; el mapa empieza por el lunes

  function ymd(s) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s)); return m ? { y: +m[1], m: +m[2], d: +m[3] } : null; }
  function dayShort(s) { const p = ymd(s); return p ? p.d + " " + MES[p.m - 1] : String(s); }
  function dayLong(s) { const p = ymd(s); if (!p) return String(s); return DIA[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()] + " " + p.d + " " + MES[p.m - 1] + " " + p.y; }
  function eachDay(from, to) {
    const a = ymd(from), b = ymd(to), out = [];
    if (!a || !b) return out;
    const t0 = Date.UTC(a.y, a.m - 1, a.d), t1 = Date.UTC(b.y, b.m - 1, b.d);
    for (let t = t0; t <= t1 && out.length < 800; t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
    return out;
  }
  const dateCats = dates => dates.map(d => ({ s: dayShort(d), l: dayLong(d) }));
  function dur(sec) { sec = num(sec); return sec < 60 ? Math.round(sec) + " s" : Math.floor(sec / 60) + " min " + Math.round(sec % 60) + " s"; }
  function hourLabel(h) { return h === 0 ? "12 a. m." : h < 12 ? h + " a. m." : h === 12 ? "12 p. m." : (h - 12) + " p. m."; }
  /* 12.500 → «12,5 mil»; 2.000.000 → «2 M» (ejes de los gráficos) */
  function axisNum(v, money) {
    const p = money ? "$" : "";
    v = num(v);
    if (v >= 1e6) return p + DEC(v / 1e6, v % 1e6 ? 1 : 0) + " M";
    if (v >= 1e4) return p + DEC(v / 1e3, v % 1e3 ? 1 : 0) + " mil";
    return p + N(v);
  }
  function bucket(values, k) {   // resume una serie larga en pocos tramos (los 12-14 puntos de una miniatura)
    const v = values.map(num);
    if (v.length <= k) return v;
    const out = [];
    for (let i = 0; i < k; i++) { const a = Math.floor(i * v.length / k), b = Math.floor((i + 1) * v.length / k); out.push(v.slice(a, Math.max(b, a + 1)).reduce((x, y) => x + y, 0)); }
    return out;
  }
  const sum = a => a.reduce((x, y) => x + num(y), 0);
  const byKey = (rows, k) => { const o = {}; (rows || []).forEach(r => { o[String(r[k])] = r; }); return o; };

  /* ============================== textos (lo que dicen los códigos) ============================== */
  const EV = {
    page_view: "Visitas a páginas", whatsapp_click: "Clics a WhatsApp", view_item: "Vieron un producto", add_to_cart: "Agregaron al carrito",
    begin_checkout: "Iniciaron el pago", purchase: "Compras online", generate_lead: "Formularios enviados", contact_click: "Clics de contacto (teléfono, correo)",
    search: "Búsquedas en la tienda", view_item_list: "Vieron un listado", select_item: "Abrieron un producto desde un listado", view_cart: "Abrieron el carrito",
    payment_failed: "Pagos rechazados", checkout_error: "Errores al pagar", share: "Compartieron un enlace", page_not_found: "Páginas que no existen (404)",
  };
  const evLabel = k => EV[k] || k;
  const LOC = {
    floating_button: "Botón flotante", cart: "Carrito", build: "Arma tu BMX", product_page: "Ficha de producto", menu: "Menú", footer: "Pie de página", header: "Encabezado",
    form_fallback: "Formulario de contacto", payment_result: "Pago finalizado", contact_page: "Página de contacto", home: "Inicio", fate: "Sección Fate", blog: "Blog", other: "Otro lugar",
  };
  const loc = k => LOC[k] || (k === "(not set)" || k === "" ? "Sin dato" : k);
  const PT = {
    home: "Inicio", product: "Fichas de producto", catalog: "Tienda y categorías", cart: "Carrito", payment_result: "Resultado del pago", build: "Arma tu BMX", contact: "Contacto",
    blog: "Blog", fate: "Fate", legal: "Políticas y ayuda", other: "Otras páginas",
  };
  const pt = k => PT[k] || (k === "(not set)" || k === "" ? "Sin dato" : k);
  const DEV = { mobile: "Celular", desktop: "Computador", tablet: "Tableta", "smart tv": "Televisor", m: "Celular", d: "Computador", MOBILE: "Celular", DESKTOP: "Computador", TABLET: "Tableta" };
  const dev = k => DEV[k] || k;
  const DEV_COLOR = { Celular: "var(--an-1)", Computador: "var(--an-2)", Tableta: "var(--an-3)" };
  const CHAN = {
    Direct: "Directo (escribió la dirección o la guardó)", "Organic Search": "Búsqueda en Google y otros (gratis)", "Paid Search": "Búsqueda de pago (anuncios)", "Organic Social": "Redes sociales (gratis)",
    "Paid Social": "Redes sociales (anuncios)", Referral: "Otros sitios que enlazan", Email: "Correo", Display: "Anuncios de display", "Organic Video": "Video (gratis)", "Paid Video": "Video (anuncios)",
    "Cross-network": "Campañas automáticas de Google", Unassigned: "Sin clasificar", "Organic Shopping": "Compras (gratis)", "Paid Shopping": "Compras (anuncios)", Affiliates: "Afiliados", SMS: "SMS", Audio: "Audio",
  };
  const chan = k => CHAN[k] || (k === "(not set)" || k === "" ? "Sin dato" : k);
  const REF = { direct: "Directo", search: "Buscadores", social: "Redes sociales", campaign: "Campañas con enlaces marcados", internal: "Dentro del mismo sitio", other: "Otros sitios" };
  const COUNTRY = { COL: "Colombia", USA: "Estados Unidos", MEX: "México", ESP: "España", ECU: "Ecuador", PER: "Perú", VEN: "Venezuela", ARG: "Argentina", CHL: "Chile", BRA: "Brasil", PAN: "Panamá", CRI: "Costa Rica", DOM: "Rep. Dominicana", CAN: "Canadá" };
  const country = k => COUNTRY[String(k).toUpperCase()] || String(k).toUpperCase();
  const RANGE_TXT = { today: "hoy", "7d": "los últimos 7 días", "28d": "los últimos 28 días", "90d": "los últimos 90 días" };
  const PREV_TXT = { today: "ayer", "7d": "los 7 días anteriores", "28d": "los 28 días anteriores", "90d": "los 90 días anteriores" };

  /* ============================== estado ============================== */
  const TABS = [["resumen", "Resumen"], ["whatsapp", "WhatsApp"], ["llegan", "Cómo llegan"], ["ven", "Qué ven"], ["quienes", "Quiénes"], ["seo", "Google (SEO)"], ["vivo", "En vivo"], ["conexion", "Conexión"]];
  const RANGES = [["today", "Hoy"], ["7d", "7 días"], ["28d", "28 días"], ["90d", "90 días"]];
  const S = { deps: null, ready: false, tab: "resumen", range: "28d", status: null, cache: new Map(), token: 0, timer: null, ros: [], fresh: false, sort: "views" };
  try { const r = localStorage.getItem("stike_an_range"); if (RANGES.some(x => x[0] === r)) S.range = r; } catch (e) {}
  const canManage = () => !!S.deps && ["owner", "developer"].includes(S.deps.role);
  const root = () => document.getElementById("an-root");

  /* ============================== servidor ============================== */
  const failure = (code, detail) => ({ ok: false, code, detail });
  async function api(view, o) {
    o = o || {};
    const range = o.noRange ? "" : S.range;
    const key = view + "|" + range;
    if (!S.fresh) { const c = S.cache.get(key); if (c && Date.now() - c.t < 60000 && !o.noCache) return c.data; }
    const url = new URL("api/analytics", document.baseURI);
    url.searchParams.set("view", view);
    if (range) url.searchParams.set("range", range);
    if (S.fresh) url.searchParams.set("refresh", "1");
    let res, data = null;
    try { res = await fetch(url.href, { credentials: "same-origin", cache: "no-store" }); }
    catch (e) { return failure("network", "No hay conexión con el servidor. Revisa tu internet e intenta de nuevo."); }
    if (res.status === 401) { location.reload(); return failure("auth", "La sesión venció."); }
    try { data = await res.json(); } catch (e) {}
    if (res.status === 403) return failure("forbidden", "Tu rol no puede ver la analítica.");
    if (res.status === 429) return failure("rate", "Se hicieron demasiadas consultas seguidas. Espera un minuto y vuelve a intentar.");
    if (!res.ok || !data || typeof data !== "object") return failure("server", "El servidor no contestó bien (" + res.status + "). Intenta de nuevo en un momento.");
    if (data.ok !== false && !o.noCache) S.cache.set(key, { t: Date.now(), data });
    return data;
  }
  async function post(url, body) {
    let res, data = null;
    try { res = await fetch(new URL(url, document.baseURI).href, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
    catch (e) { return { ok: false, status: 0, data: { error: "network", detail: "No hay conexión con el servidor." } }; }
    try { data = await res.json(); } catch (e) {}
    if (res.status === 401) { location.reload(); }
    return { ok: res.ok, status: res.status, data: data || {} };
  }

  /* ============================== ventana con el valor (tooltip) ============================== */
  function tipEl() {
    let el = document.querySelector(".an-tt");
    if (!el) { el = document.createElement("div"); el.className = "an-tt"; el.setAttribute("role", "tooltip"); document.body.appendChild(el); }
    return el;
  }
  /* rows: [{c: color de la marca, v: valor, l: nombre}]. Todo entra con textContent: los nombres vienen de los datos. */
  function ttShow(title, rows, x, y) {
    const el = tipEl();
    el.textContent = "";
    if (title) { const t = document.createElement("div"); t.className = "t"; t.textContent = title; el.appendChild(t); }
    (rows || []).forEach(r => {
      const d = document.createElement("div"); d.className = "r";
      if (r.c) { const i = document.createElement("i"); i.style.background = r.c; d.appendChild(i); }
      const b = document.createElement("b"); b.textContent = r.v; d.appendChild(b);
      if (r.l) { const s = document.createElement("span"); s.textContent = r.l; d.appendChild(s); }
      el.appendChild(d);
    });
    el.style.display = "block";
    const w = el.offsetWidth, h = el.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    let left = x + 14, top = y + 14;
    if (left + w > vw - 8) left = x - w - 14;
    if (left < 8) left = 8;
    if (top + h > vh - 8) top = y - h - 14;
    if (top < 8) top = 8;
    el.style.left = left + "px"; el.style.top = top + "px";
  }
  function ttHide() { const el = document.querySelector(".an-tt"); if (el) el.style.display = "none"; }
  const tipAttr = (title, rows) => esc(JSON.stringify({ t: title, r: rows }));
  function wireTips(host) {
    const show = (n, x, y) => { let d; try { d = JSON.parse(n.getAttribute("data-tt")); } catch (e) { return; } ttShow(d.t, d.r, x, y); };
    host.addEventListener("pointermove", e => {
      const n = e.target.closest && e.target.closest("[data-tt]");
      if (n) show(n, e.clientX, e.clientY);
      else if (!(e.target.closest && e.target.closest("[data-own-tip]"))) ttHide();   // las líneas manejan su propia ventana
    });
    host.addEventListener("pointerleave", ttHide);
    host.addEventListener("focusin", e => { const n = e.target.closest && e.target.closest("[data-tt]"); if (n) { const r = n.getBoundingClientRect(); show(n, r.left + r.width / 2, r.top); } });
    host.addEventListener("focusout", ttHide);
  }
  /* un solo punto de tabulador por gráfico; las flechas recorren las marcas (cols > 0: también arriba y abajo) */
  function rovingKeys(host, sel, cols) {
    host.addEventListener("keydown", e => {
      const nodes = Array.from(host.querySelectorAll(sel)), cur = nodes.indexOf(document.activeElement);
      if (cur < 0) return;
      let nx = cur;
      if (e.key === "ArrowRight") nx = cur + 1; else if (e.key === "ArrowLeft") nx = cur - 1;
      else if (cols && e.key === "ArrowDown") nx = cur + cols; else if (cols && e.key === "ArrowUp") nx = cur - cols;
      else if (e.key === "Home") nx = 0; else if (e.key === "End") nx = nodes.length - 1; else return;
      if (nx < 0 || nx >= nodes.length) return;
      e.preventDefault();
      nodes[cur].setAttribute("tabindex", "-1"); nodes[nx].setAttribute("tabindex", "0"); nodes[nx].focus();
    });
  }
  function rovingInit(host, sel) { Array.from(host.querySelectorAll(sel)).forEach((n, i) => n.setAttribute("tabindex", i === 0 ? "0" : "-1")); }

  /* ============================== piezas de gráficos ============================== */
  function niceTicks(max, int) {
    if (!(max > 0)) return [0, 1];
    const raw = max / 4, e = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / e;
    const cands = int ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10];
    let step = (cands.find(c => f <= c + 1e-9) || 10) * e;
    if (int && step < 1) step = 1;
    const out = [];
    for (let v = 0; v <= max + step - 1e-9 && out.length < 9; v += step) out.push(+v.toFixed(8));
    return out;
  }
  function autosize(host, draw) {
    let last = 0;
    const run = () => { const w = Math.round(host.clientWidth); if (w < 40) return; last = w; draw(w); };
    run();
    if (window.ResizeObserver) { const ro = new ResizeObserver(() => { if (Math.abs(Math.round(host.clientWidth) - last) > 1) run(); }); ro.observe(host); S.ros.push(ro); }
  }
  const emptyHtml = msg => `<p class="an-empty">${esc(msg || "Todavía no hay datos en este periodo.")}</p>`;

  /* línea (tendencia en el tiempo). o: {cats:[{s,l}], series:[{name,color,values,area,muted,nameAt}], fmt, axis, height, int, aria} */
  function lineChart(host, o) {
    const n = o.cats.length;
    if (!n || !o.series.some(s => s.values.some(v => num(v) > 0))) { host.innerHTML = emptyHtml(o.empty); return; }
    host.classList.add("an-plot");
    host.setAttribute("data-own-tip", "");
    host.setAttribute("tabindex", "0");
    host.setAttribute("role", "group");
    host.setAttribute("aria-label", (o.aria || "Gráfico de líneas") + ". Usa las flechas izquierda y derecha para recorrer los días; debajo hay una tabla con los mismos datos.");
    let geo = null, kb = -1;
    function draw(W) {
      const H = o.height || 230, m = { t: 12, r: 14, b: 26, l: o.axisW || 46 };
      const pw = W - m.l - m.r, ph = H - m.t - m.b;
      const max = Math.max(1, ...o.series.flatMap(s => s.values.map(num)));
      const ticks = niceTicks(max, o.int !== false), top = ticks[ticks.length - 1];
      const X = i => m.l + (n === 1 ? pw / 2 : pw * i / (n - 1));
      const Y = v => m.t + ph * (1 - num(v) / top);
      let g = "";
      ticks.forEach(t => { const y = Y(t).toFixed(1); g += `<line class="${t === 0 ? "ax" : "gl"}" x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}"/><text x="${m.l - 8}" y="${(Y(t) + 4).toFixed(1)}" text-anchor="end">${esc((o.axis || axisNum)(t))}</text>`; });
      const k = Math.min(n, W < 520 ? 4 : 7), idx = [];
      for (let j = 0; j < k; j++) { const i = k === 1 ? 0 : Math.round(j * (n - 1) / (k - 1)); if (!idx.includes(i)) idx.push(i); }
      idx.forEach(i => { const anchor = n > 1 && i === 0 ? "start" : n > 1 && i === n - 1 ? "end" : "middle"; g += `<text x="${X(i).toFixed(1)}" y="${H - 6}" text-anchor="${anchor}">${esc(o.cats[i].s)}</text>`; });
      o.series.slice().sort((a, b) => (b.muted ? 1 : 0) - (a.muted ? 1 : 0)).forEach(s => {
        const pts = s.values.map((v, i) => [X(i), Y(v)]);
        const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join("");
        if (n === 1) { g += `<circle cx="${pts[0][0].toFixed(1)}" cy="${pts[0][1].toFixed(1)}" r="4" style="fill:${s.color}"/>`; return; }
        if (s.area) g += `<path d="${d}L${X(n - 1).toFixed(1)},${Y(0).toFixed(1)}L${X(0).toFixed(1)},${Y(0).toFixed(1)}Z" style="fill:${s.color};fill-opacity:.10"/>`;
        g += `<path d="${d}" fill="none" style="stroke:${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      });
      const main = o.series.find(s => !s.muted) || o.series[0];
      if (main && n > 1) g += `<circle cx="${X(n - 1).toFixed(1)}" cy="${Y(main.values[n - 1]).toFixed(1)}" r="4" stroke-width="2" style="fill:${main.color};stroke:var(--panel)"/>`;
      g += `<line class="xh" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" style="display:none"/><g class="dots" style="display:none">${o.series.map(s => `<circle r="4" stroke-width="2" style="fill:${s.color};stroke:var(--panel)"/>`).join("")}</g>`;
      host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">${g}</svg>`;
      geo = { W, H, m, X, Y, pw };
    }
    function at(i, cx, cy) {
      const svg = host.querySelector("svg"); if (!geo || !svg) return;
      const x = geo.X(i), xh = svg.querySelector(".xh"), dots = svg.querySelector(".dots");
      xh.setAttribute("x1", x); xh.setAttribute("x2", x); xh.style.display = "";
      dots.style.display = "";
      Array.from(dots.children).forEach((c, j) => { c.setAttribute("cx", x); c.setAttribute("cy", geo.Y(o.series[j].values[i])); });
      const rows = o.series.map(s => ({ c: s.color, v: (o.fmt || N)(s.values[i], s), l: s.nameAt ? s.nameAt(i) : s.name }));
      const rect = svg.getBoundingClientRect(), sc = rect.width / geo.W;
      ttShow(o.cats[i].l, rows, cx != null ? cx : rect.left + x * sc, cy != null ? cy : rect.top + geo.Y(Math.max(...o.series.map(s => num(s.values[i])))) * sc);
    }
    function clear() { const svg = host.querySelector("svg"); if (svg) { const xh = svg.querySelector(".xh"), d = svg.querySelector(".dots"); if (xh) xh.style.display = "none"; if (d) d.style.display = "none"; } ttHide(); }
    host.addEventListener("pointermove", e => {
      const svg = host.querySelector("svg"); if (!geo || !svg) return;
      const rect = svg.getBoundingClientRect(), px = (e.clientX - rect.left) * (geo.W / rect.width);
      if (px < geo.m.l - 6 || px > geo.W - geo.m.r + 6) return clear();
      const i = n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round((px - geo.m.l) / geo.pw * (n - 1))));
      kb = i; at(i, e.clientX, e.clientY);
    });
    host.addEventListener("pointerleave", clear);
    host.addEventListener("keydown", e => {
      if (e.key === "Escape") return clear();
      const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "Home" ? -99999 : e.key === "End" ? 99999 : 0;
      if (!step) return;
      e.preventDefault(); kb = Math.max(0, Math.min(n - 1, (kb < 0 ? n - 1 : kb) + step)); at(kb);
    });
    host.addEventListener("focus", () => { if (kb < 0) kb = n - 1; at(kb); });
    host.addEventListener("blur", clear);
    autosize(host, draw);
  }

  /* columnas (un valor por día u hora). o: {cats:[{s,l,v}], color, fmt, axis, height, int, name, aria, labelMax} */
  function columnChart(host, o) {
    const n = o.cats.length;
    if (!n || !o.cats.some(c => num(c.v) > 0)) { host.innerHTML = emptyHtml(o.empty); return; }
    host.classList.add("an-plot");
    host.setAttribute("role", "group");
    host.setAttribute("aria-label", (o.aria || "Gráfico de columnas") + ". Usa las flechas para recorrer las barras; debajo hay una tabla con los mismos datos.");
    function draw(W) {
      const H = o.height || 190, m = { t: 22, r: 10, b: 26, l: o.axisW || 40 };
      const pw = W - m.l - m.r, ph = H - m.t - m.b, band = pw / n, bw = Math.max(2, Math.min(24, band - 2));
      const max = Math.max(1, ...o.cats.map(c => num(c.v)));
      const ticks = niceTicks(max, o.int !== false), top = ticks[ticks.length - 1];
      const Y = v => m.t + ph * (1 - num(v) / top);
      let g = "";
      ticks.forEach(t => { const y = Y(t).toFixed(1); g += `<line class="${t === 0 ? "ax" : "gl"}" x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}"/><text x="${m.l - 8}" y="${(Y(t) + 4).toFixed(1)}" text-anchor="end">${esc((o.axis || axisNum)(t))}</text>`; });
      const k = Math.min(n, Math.max(2, Math.floor(pw / 70))), idx = [];
      for (let j = 0; j < k; j++) { const i = k === 1 ? 0 : Math.round(j * (n - 1) / (k - 1)); if (!idx.includes(i)) idx.push(i); }
      idx.forEach(i => { g += `<text x="${(m.l + band * i + band / 2).toFixed(1)}" y="${H - 6}" text-anchor="${n > 1 && i === 0 ? "start" : n > 1 && i === n - 1 ? "end" : "middle"}">${esc(o.cats[i].s)}</text>`; });
      let maxI = 0;
      o.cats.forEach((c, i) => { if (num(c.v) > num(o.cats[maxI].v)) maxI = i; });
      o.cats.forEach((c, i) => {
        const bx = m.l + band * i + (band - bw) / 2, y = Y(c.v), base = Y(0), h = base - y, r = Math.max(0, Math.min(4, h / 2, bw / 2));
        g += `<g class="bw" data-tt="${tipAttr(c.l, [{ v: (o.fmt || N)(c.v), l: o.name || "" }])}"><rect x="${(m.l + band * i).toFixed(1)}" y="${m.t}" width="${band.toFixed(1)}" height="${ph}" fill="transparent"/>`
          + (num(c.v) > 0 ? `<path class="bar" d="M${bx.toFixed(1)},${base.toFixed(1)}V${(y + r).toFixed(1)}a${r},${r} 0 0 1 ${r},${-r}H${(bx + bw - r).toFixed(1)}a${r},${r} 0 0 1 ${r},${r}V${base.toFixed(1)}Z" style="fill:${o.color}"/>` : "") + `</g>`;
      });
      if (o.labelMax !== false) {
        const lx = Math.max(m.l + 16, Math.min(W - m.r - 16, m.l + band * maxI + band / 2));
        g += `<text x="${lx.toFixed(1)}" y="${(Y(o.cats[maxI].v) - 6).toFixed(1)}" text-anchor="middle" style="fill:var(--ink-2)">${esc((o.fmt || N)(o.cats[maxI].v))}</text>`;
      }
      host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${g}</svg>`;
      rovingInit(host, ".bw");
    }
    rovingKeys(host, ".bw", 0);
    autosize(host, draw);
  }

  function spark(values, color) {
    const v = bucket(values, 14);
    if (v.length < 2 || Math.max(...v) <= 0) return `<div class="sp"></div>`;
    const W = 120, H = 30, max = Math.max(...v);
    const d = v.map((a, i) => (i ? "L" : "M") + (i * W / (v.length - 1)).toFixed(1) + "," + (H - 2 - (H - 4) * (a / max)).toFixed(1)).join("");
    return `<svg class="sp" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}L${W},${H}L0,${H}Z" style="fill:${color};fill-opacity:.10"/><path d="${d}" fill="none" style="stroke:${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
  }

  /* barras horizontales ordenadas (una sola serie: un solo color). items: [{label, value, sub}] */
  function hbars(items, o) {
    o = o || {};
    const rows = (items || []).filter(x => num(x.value) >= 0);
    if (!rows.length) return emptyHtml(o.empty);
    const max = Math.max(1, ...rows.map(x => num(x.value))), fmt = o.fmt || N;
    return `<div class="an-hb">` + rows.map(x => `<div class="row"><span class="lab" title="${esc(x.label)}">${esc(x.label)}</span><span class="bar"><i style="width:${(num(x.value) / max * 76).toFixed(1)}%${o.color ? ";background:" + o.color : ""}"></i><b>${esc(fmt(x.value))}</b>${x.sub ? `<small>${esc(x.sub)}</small>` : ""}</span></div>`).join("") + `</div>`;
  }

  /* una cifra repartida en partes (≤ 6): barra delgada y, al lado, la lista con cifras. items: [{label, value, color}] */
  const SLOTS = ["var(--an-1)", "var(--an-2)", "var(--an-3)", "var(--an-4)", "var(--an-5)", "var(--an-7)"];
  function parts(items, o) {
    o = o || {};
    let rows = (items || []).filter(x => num(x.value) > 0).sort((a, b) => num(b.value) - num(a.value));
    if (!rows.length) return emptyHtml(o.empty);
    if (rows.length > 6) { const rest = rows.slice(5); rows = rows.slice(0, 5).concat([{ label: "Otros", value: sum(rest.map(x => x.value)), color: "var(--an-gray)" }]); }
    const total = sum(rows.map(x => x.value)), fmt = o.fmt || N;
    rows.forEach((x, i) => { x.c = x.color || SLOTS[i % SLOTS.length]; });
    return `<div class="an-seg" role="img" aria-label="${esc(o.aria || "Reparto")}">` + rows.map(x => `<i style="flex:${num(x.value)} 1 0;background:${x.c}" data-tt="${tipAttr(x.label, [{ c: x.c, v: fmt(x.value), l: PCT(x.value / total, 0) }])}" tabindex="0"></i>`).join("") + `</div>`
      + `<div class="an-leg">` + rows.map(x => `<div class="r"><span class="sw" style="background:${x.c}"></span><span class="nm" title="${esc(x.label)}">${esc(x.label)}</span><b>${esc(fmt(x.value))}</b><small>${PCT(x.value / total, 0)}</small></div>`).join("") + `</div>`;
  }

  /* embudo: etapas en orden, una sola rampa de azul (cada etapa un paso). stages: [{label, value}] */
  function funnel(stages, extra) {
    const top = Math.max(1, num(stages[0] && stages[0].value));
    const row = (label, value, color, cv, cls) => `<div class="row${cls ? " " + cls : ""}"><span class="lab">${esc(label)}</span><span class="fb"><span class="bar"><i style="width:${Math.max(0.5, num(value) / top * 76).toFixed(1)}%;background:${color}"></i><b>${esc(N(value))}</b></span>${cv ? `<span class="cv">${esc(cv)}</span>` : ""}</span></div>`;
    const cols = ["var(--an-o1)", "var(--an-o2)", "var(--an-o3)", "var(--an-o4)", "var(--an-o5)"];
    let html = `<div class="an-funnel">` + stages.map((s, i) => row(s.label, s.value, cols[Math.min(i, cols.length - 1)], i > 0 && num(stages[i - 1].value) ? PCT(num(s.value) / num(stages[i - 1].value), 1) + " del paso anterior" : "")).join("");
    if (extra) html += row(extra.label, extra.value, "var(--an-3)", num(stages[0].value) ? PCT(num(extra.value) / num(stages[0].value), 1) + " de las sesiones" : "", "or");
    return html + `</div>`;
  }

  /* mapa de calor día × hora. items: [{dow, hour, v}] */
  const HEAT = ["var(--an-o1)", "var(--an-o2)", "var(--an-o3)", "var(--an-o4)", "var(--an-o5)"];
  function heatmap(items, unit) {
    const grid = DOW_ORDER.map(() => Array(24).fill(0));
    (items || []).forEach(x => { const r = DOW_ORDER.indexOf(num(x.dow)); const h = num(x.hour); if (r >= 0 && h >= 0 && h < 24) grid[r][h] += num(x.v); });
    const flat = grid.reduce((a, r) => a.concat(r), []), pos = flat.filter(v => v > 0).sort((a, b) => a - b);
    if (!pos.length) return emptyHtml("Todavía no hay datos suficientes para este mapa.");
    const q = k => pos[Math.min(pos.length - 1, Math.floor(pos.length * k))];
    const th = [q(0.2), q(0.4), q(0.6), q(0.8)];
    const bk = v => v <= 0 ? -1 : v <= th[0] ? 0 : v <= th[1] ? 1 : v <= th[2] ? 2 : v <= th[3] ? 3 : 4;
    let cells = `<span></span>` + Array.from({ length: 24 }, (_, h) => `<span class="h">${h % 3 === 0 ? h : ""}</span>`).join("");
    DOW_ORDER.forEach((dw, r) => {
      cells += `<span class="d">${esc(DIA[dw].replace(/^./, c => c.toUpperCase()))}</span>`;
      for (let h = 0; h < 24; h++) {
        const v = grid[r][h], b = bk(v);
        cells += `<div class="c" ${b >= 0 ? `style="background:${HEAT[b]}"` : ""} data-tt="${tipAttr(DIA_LARGO[dw][0].toUpperCase() + DIA_LARGO[dw].slice(1) + " · " + hourLabel(h), [{ v: N(v), l: unit }])}"></div>`;
      }
    });
    return `<div class="an-heat" id="${"hm" + Math.random().toString(36).slice(2, 7)}" data-heat><div class="an-hg" role="group" aria-label="Mapa de calor por día y hora. Usa las flechas para recorrerlo.">${cells}</div>`
      + `<div class="an-scale"><span>Menos</span>${HEAT.map(c => `<i style="background:${c}"></i>`).join("")}<span>Más</span><span style="margin-left:10px"><i style="display:inline-block;width:14px;height:10px;border-radius:3px;background:var(--an-empty);vertical-align:-1px"></i> sin datos</span></div></div>`;
  }

  /* tabla. cols: [{h, k, r (a la derecha), f(row) → texto, raw (f devuelve HTML ya escapado), bar (mini barra), p (ruta larga)}] */
  function tbl(cols, rows, o) {
    o = o || {};
    if (!rows || !rows.length) return emptyHtml(o.empty);
    const mx = {};
    cols.forEach(c => { if (c.bar) mx[c.k] = Math.max(1, ...rows.map(r => num(r[c.k]))); });
    const th = cols.map(c => `<th class="${c.r ? "r" : ""}">${esc(c.h)}</th>`).join("");
    const body = rows.map(r => `<tr>` + cols.map(c => {
      const v = c.f ? c.f(r) : r[c.k];
      let cell = c.raw ? v : esc(v);
      if (c.bar) cell = `<span class="mini" style="width:${(num(r[c.k]) / mx[c.k] * 56).toFixed(0)}px"></span>` + cell;
      return `<td class="${c.r ? "r" : ""}${c.p ? " p" : ""}"${c.p ? ` title="${esc(c.f ? c.f(r) : r[c.k])}"` : ""}>${cell}</td>`;
    }).join("") + `</tr>`).join("");
    return `<div class="an-tw"><table class="an-tbl"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  /* ficha de cifra (value ya formateado) con su cambio frente al periodo anterior */
  function deltaHtml(cur, prev, goodUp, label) {
    cur = num(cur); prev = num(prev);
    const tail = label === false ? "" : `<span>vs. ${esc(PREV_TXT[S.range] || "el periodo anterior")}</span>`;
    if (!prev && !cur) return `<span class="an-d flat">▬ sin datos</span>`;
    if (!prev) return `<span class="an-d ${goodUp === false ? "bad" : "good"}">▲ nuevo</span>${tail}`;
    const ch = (cur - prev) / prev;
    if (Math.abs(ch) < 0.005) return `<span class="an-d flat">▬ igual</span>${tail}`;
    const up = ch > 0, good = up === (goodUp !== false);
    return `<span class="an-d ${good ? "good" : "bad"}">${up ? "▲" : "▼"} ${esc(PCT(Math.abs(ch), Math.abs(ch) < 0.1 ? 1 : 0))}</span>${tail}`;
  }
  function tile(o) {
    return `<div class="an-tile"><div class="l">${esc(o.label)}</div><div class="n" title="${esc(o.value)}">${esc(o.value)}</div><div class="d">${o.note ? esc(o.note) : deltaHtml(o.cur, o.prev, o.goodUp)}</div>${o.spark || ""}</div>`;
  }

  function card(o) {
    return `<section class="an-card${o.cls ? " " + o.cls : ""}"><div class="an-head"><div><h3>${esc(o.title)}</h3>${o.sub ? `<p class="sub">${esc(o.sub)}</p>` : ""}</div>${o.actions || ""}${o.table ? `<button type="button" class="btn ghost sm" data-vt aria-pressed="false">Ver tabla</button>` : ""}</div>`
      + `<div class="an-view">${o.body}</div>${o.table ? `<div class="an-view an-tv" hidden>${o.table}</div>` : ""}${o.foot ? `<p class="foot">${o.foot}</p>` : ""}</section>`;
  }
  /* tarjeta con un gráfico que se dibuja después de insertar el HTML (necesita medir su ancho) */
  function chartCard(ctx, o) {
    const id = ctx.id();
    ctx.mounts.push(() => { const h = document.getElementById(id); if (h) o.build(h); });
    return card({ title: o.title, sub: o.sub, cls: o.cls, foot: o.foot, table: o.table, actions: o.actions, body: `<div id="${id}"></div>${o.legend ? `<div class="an-legend">${o.legend}</div>` : ""}` });
  }
  function note(kind, icon, html, acts) { return `<div class="an-note ${kind || ""}"><span class="ic" aria-hidden="true">${icon}</span><div>${html}${acts ? `<div class="acts">${acts}</div>` : ""}</div></div>`; }
  const goBtn = (tab, label) => `<button type="button" class="btn cyan sm" data-go="${tab}">${esc(label)}</button>`;
  function setupNote(res) {
    const notConf = /_not_configured$/.test(res.code || "");
    const which = res.setup === "gsc" ? "Search Console" : "Google Analytics";
    if (notConf) return note("", "🔌", `<p><b>${esc(which)} todavía no está conectado</b></p><p>${esc(res.detail || "")}</p>`, goBtn("conexion", "Abrir Conexión"));
    return note("bad", "⚠️", `<p><b>${esc(which)} no entregó los datos</b></p><p>${esc(res.detail || "Intenta de nuevo en un momento.")}</p>`, goBtn("conexion", "Abrir Conexión") + `<button type="button" class="btn ghost sm" data-refresh>Reintentar</button>`);
  }
  const reads = items => `<ul class="an-reads">${items.map(i => `<li><span class="b ${i.k || ""}"></span><span>${i.h}</span></li>`).join("")}</ul>`;
  const legendLine = (color, text) => `<span><i style="background:${color}"></i>${esc(text)}</span>`;

  /* lo que mide cada gráfico, por día (GA4 se salta los días sin datos: se rellenan con 0) */
  const fillDays = (dates, rows, key, valKey) => { const m = {}; (rows || []).forEach(r => { m[r.date] = num(r[valKey]); }); return dates.map(d => m[d] || 0); };
  const rangeText = r => (r && r.from ? dayShort(r.from) + " – " + dayShort(r.to) : "");

  /* ============================== pestañas ============================== */
  function ctxNew() { let c = 0; return { mounts: [], id: () => "anc" + (++c) }; }
  const productName = slug => { try { return (S.deps.productName && S.deps.productName(slug)) || slug; } catch (e) { return slug; } };
  const fpTop = (ev, k) => (ev && Array.isArray(ev[k]) ? ev[k] : []);
  const fpHours = ev => { const h = ev && ev.hour, out = Array(24).fill(0); if (Array.isArray(h)) h.forEach((v, i) => { if (i < 24) out[i] = num(v); }); else if (h && typeof h === "object") Object.keys(h).forEach(k => { if (+k >= 0 && +k < 24) out[+k] = num(h[k]); }); return out; };
  const fpDays = fp => { const d = fp && fp.days; return d && !Array.isArray(d) ? d : {}; };

  /* ---------- Resumen ---------- */
  async function tResumen(ctx) {
    const [gs, fp] = await Promise.all([api("summary"), api("firstparty")]);
    const ok = gs.ok;
    const fev = (fp.ok && fp.ev) || {};
    let html = "";
    if (!ok) html += setupNote(gs) + note("warn", "📟", `<p><b>Mientras tanto, esto es lo que cuenta el sitio por su cuenta</b> (contador propio, sin cookies ni Google): visitas y clics a WhatsApp, carrito y pago. No sabe de compras ni de dónde llega la gente: eso lo trae Google Analytics.</p>`);
    const r = (ok ? gs.range : fp.range) || {};
    const dates = eachDay(r.from, r.to), cats = dateCats(dates);

    if (ok) {
      const k = gs.kpis, ev = gs.events || {}, wa = ev.whatsapp_click || { cur: 0, prev: 0 }, ser = byKey(gs.series, "date");
      const col = key => dates.map(d => (ser[d] ? num(ser[d][key]) : 0));
      const conv = { cur: k.sessions.cur ? k.purchases.cur / k.sessions.cur : 0, prev: k.sessions.prev ? k.purchases.prev / k.sessions.prev : 0 };
      html += `<div class="an-tiles">`
        + tile({ label: "Visitantes", value: N(k.users.cur), cur: k.users.cur, prev: k.users.prev, spark: spark(col("users"), "var(--an-1)") })
        + tile({ label: "Sesiones", value: N(k.sessions.cur), cur: k.sessions.cur, prev: k.sessions.prev, spark: spark(col("sessions"), "var(--an-1)") })
        + tile({ label: "Clics a WhatsApp", value: N(wa.cur), cur: wa.cur, prev: wa.prev, spark: spark(col("whatsapp"), "var(--an-1)") })
        + tile({ label: "Agregaron al carrito", value: N(k.addToCarts.cur), cur: k.addToCarts.cur, prev: k.addToCarts.prev, spark: spark(col("addToCarts"), "var(--an-1)") })
        + tile({ label: "Compras online", value: N(k.purchases.cur), cur: k.purchases.cur, prev: k.purchases.prev, spark: spark(col("purchases"), "var(--an-1)") })
        + tile({ label: "Ingresos online (Wompi)", value: COP(k.revenue.cur), cur: k.revenue.cur, prev: k.revenue.prev, spark: spark(col("revenue"), "var(--an-1)") })
        + tile({ label: "Visitas que compran", value: PCT(conv.cur, 2), cur: conv.cur, prev: conv.prev })
        + tile({ label: "Tiempo por visita", value: dur(k.avgDuration.cur), cur: k.avgDuration.cur, prev: k.avgDuration.prev })
        + `</div>`;
      const prevDates = eachDay(r.prevFrom, r.prevTo), prevSer = byKey(gs.prevSeries, "date");
      const curV = col("sessions"), prevV = prevDates.map(d => (prevSer[d] ? num(prevSer[d].sessions) : 0)).slice(0, dates.length);
      while (prevV.length < dates.length) prevV.push(0);
      const lines = [];
      lines.push({ h: `Hubo <b>${esc(N(k.sessions.cur))} sesiones</b> de <b>${esc(N(k.users.cur))} personas</b>${k.sessions.prev ? ` (un ${esc(PCT(Math.abs(k.sessions.cur - k.sessions.prev) / k.sessions.prev, 0))} ${k.sessions.cur >= k.sessions.prev ? "más" : "menos"} que en ${esc(PREV_TXT[S.range])})` : ""}.`, k: k.sessions.cur >= k.sessions.prev ? "up" : "down" });
      lines.push(wa.cur > 0
        ? { h: `<b>${esc(N(wa.cur))} clics a WhatsApp</b>${k.sessions.cur ? `: el ${esc(PCT(wa.cur / k.sessions.cur, 1))} de las sesiones` : ""}. Un clic no es una conversación, pero sí quien quiere escribirte.`, k: wa.cur >= wa.prev ? "up" : "down" }
        : { h: `Nadie tocó WhatsApp en este periodo. Si esperabas clics, mira en <b>Conexión</b> que el ID de medición esté publicado.`, k: "down" });
      lines.push(k.purchases.cur > 0
        ? { h: `<b>${esc(N(k.purchases.cur))} compra${k.purchases.cur === 1 ? "" : "s"} online</b> por <b>${esc(COP(k.revenue.cur))}</b>.` }
        : { h: `No hubo compras online en este periodo. Las ventas por WhatsApp o en la tienda física no salen aquí: se registran en la pestaña Ventas.` });
      if (k.addToCarts.cur >= 5) lines.push({ h: `De <b>${esc(N(k.addToCarts.cur))}</b> veces que alguien agregó algo al carrito, <b>${esc(N(k.checkouts.cur))}</b> llegaron a pagar (${esc(PCT(k.checkouts.cur / k.addToCarts.cur, 0))}).` });
      html += `<div class="an-grid c21">`
        + chartCard(ctx, {
          title: "Sesiones por día", sub: "Cada punto es un día. La línea gris es el periodo anterior, día a día.", legend: legendLine("var(--an-1)", "Este periodo (" + rangeText(r) + ")") + legendLine("var(--an-gray)", "Periodo anterior (" + rangeText({ from: r.prevFrom, to: r.prevTo }) + ")"),
          build: h => lineChart(h, { cats, aria: "Sesiones por día", series: [{ name: "Sesiones", color: "var(--an-1)", values: curV, area: true }, { name: "Periodo anterior", color: "var(--an-gray)", values: prevV, muted: true, nameAt: i => "Periodo anterior (" + dayShort(prevDates[i] || "") + ")" }] }),
          table: tbl([{ h: "Día", k: "d" }, { h: "Sesiones", k: "s", r: true }, { h: "Periodo anterior", k: "p", r: true }], dates.map((d, i) => ({ d: dayLong(d), s: N(curV[i]), p: N(prevV[i]) })).reverse()),
        })
        + card({ title: "Lo que se nota", sub: "Resumen en palabras de " + RANGE_TXT[S.range] + ".", body: reads(lines) })
        + `</div>`;
      const f = gs.funnel || {};
      html += `<div class="an-grid c2">`
        + card({
          title: "Del primer vistazo a la compra", sub: "Cuenta eventos, no personas: alguien puede ver varios productos en una sesión.",
          body: funnel([{ label: "Sesiones", value: f.sessions }, { label: "Vieron un producto", value: f.viewItem }, { label: "Agregaron al carrito", value: f.addToCart }, { label: "Iniciaron el pago", value: f.beginCheckout }, { label: "Compraron", value: f.purchase }], { label: "Alternativa: escribieron por WhatsApp", value: f.whatsapp }),
          table: tbl([{ h: "Paso", k: "l" }, { h: "Eventos", k: "v", r: true }], [["Sesiones", f.sessions], ["Vieron un producto", f.viewItem], ["Agregaron al carrito", f.addToCart], ["Iniciaron el pago", f.beginCheckout], ["Compraron", f.purchase], ["Clics a WhatsApp", f.whatsapp]].map(x => ({ l: x[0], v: N(x[1]) }))),
        })
        + card({
          title: "Acciones clave", sub: "Lo que hace la gente en el sitio, frente al periodo anterior.",
          body: tbl([{ h: "Acción", k: "n", f: x => `${esc(evLabel(x.n))} <span class="muted mono">${esc(x.n)}</span>`, raw: true }, { h: "Ahora", k: "cur", r: true, f: x => N(x.cur) }, { h: "Antes", k: "prev", r: true, f: x => N(x.prev) }, { h: "Cambio", k: "d", r: true, raw: true, f: x => deltaHtml(x.cur, x.prev, !["payment_failed", "checkout_error", "page_not_found"].includes(x.n), false) }],
            Object.keys(ev).map(n => ({ n, cur: num(ev[n].cur), prev: num(ev[n].prev) })).filter(x => x.cur || x.prev).sort((a, b) => b.cur - a.cur), { empty: "Todavía no llegan acciones de la tienda." }),
        })
        + `</div>`;
      // contraste con el contador propio (cuánto ve Google frente a lo que cuenta el sitio)
      const cmp = [["Visitas a páginas", k.pageViews.cur, fev.page_view], ["Clics a WhatsApp", wa.cur, fev.whatsapp_click], ["Agregaron al carrito", (ev.add_to_cart || {}).cur, fev.add_to_cart], ["Iniciaron el pago", (ev.begin_checkout || {}).cur, fev.begin_checkout]];
      if (fp.ok && cmp.some(x => x[2] && x[2].n > 0)) {
        html += card({
          title: "¿Google Analytics está viendo todo?", sub: "Google no cuenta a quien rechaza las cookies ni a quien usa bloqueador de anuncios. El contador propio del sitio sí, y no guarda nada de la persona.",
          body: tbl([{ h: "Qué", k: "l" }, { h: "Google Analytics", k: "g", r: true, f: x => N(x.g) }, { h: "Contador propio", k: "f", r: true, f: x => N(x.f) }, { h: "Diferencia", k: "d", r: true, f: x => x.f ? (x.g >= x.f ? "+" : "−") + PCT(Math.abs(x.g - x.f) / x.f, 0) : "—" }], cmp.filter(x => x[2]).map(x => ({ l: x[0], g: num(x[1]), f: num(x[2].n) }))),
          foot: `Si Google ve mucho menos (más de la mitad), revisa el ID de medición y el aviso de cookies. ${fp.first && r.from && fp.first > r.from ? `El contador propio empezó a contar el ${esc(dayLong(fp.first))}: antes de esa fecha no hay datos suyos.` : ""}`,
        });
      }
    } else {
      // sin Google: el contador propio
      const dd = fpDays(fp), series = k => dates.map(d => num((dd[d] || {})[k]));
      const tot = k => num((fev[k] || {}).n), pv = k => num((fev[k] || {}).prev);
      html += `<div class="an-tiles">`
        + tile({ label: "Visitas a páginas", value: N(tot("page_view")), cur: tot("page_view"), prev: pv("page_view"), spark: spark(series("page_view"), "var(--an-1)") })
        + tile({ label: "Clics a WhatsApp", value: N(tot("whatsapp_click")), cur: tot("whatsapp_click"), prev: pv("whatsapp_click"), spark: spark(series("whatsapp_click"), "var(--an-1)") })
        + tile({ label: "Vieron un producto", value: N(tot("view_item")), cur: tot("view_item"), prev: pv("view_item"), spark: spark(series("view_item"), "var(--an-1)") })
        + tile({ label: "Agregaron al carrito", value: N(tot("add_to_cart")), cur: tot("add_to_cart"), prev: pv("add_to_cart"), spark: spark(series("add_to_cart"), "var(--an-1)") })
        + tile({ label: "Iniciaron el pago", value: N(tot("begin_checkout")), cur: tot("begin_checkout"), prev: pv("begin_checkout"), spark: spark(series("begin_checkout"), "var(--an-1)") })
        + tile({ label: "Búsquedas en la tienda", value: N(tot("search")), cur: tot("search"), prev: pv("search"), spark: spark(series("search"), "var(--an-1)") })
        + `</div>`;
      html += `<div class="an-grid c21">`
        + chartCard(ctx, {
          title: "Visitas a páginas por día", sub: "Contador propio del sitio. No cuenta al equipo ni a los robots.",
          build: h => lineChart(h, { cats, aria: "Visitas a páginas por día", series: [{ name: "Visitas a páginas", color: "var(--an-1)", values: series("page_view"), area: true }] }),
          table: tbl([{ h: "Día", k: "d" }, { h: "Visitas", k: "v", r: true }, { h: "Clics a WhatsApp", k: "w", r: true }], dates.map(d => ({ d: dayLong(d), v: N((dd[d] || {}).page_view), w: N((dd[d] || {}).whatsapp_click) })).reverse()),
        })
        + card({
          title: "Del primer vistazo al pago", sub: "Cuenta eventos, no personas.",
          body: fp.ok ? funnel([{ label: "Visitas a páginas", value: tot("page_view") }, { label: "Vieron un producto", value: tot("view_item") }, { label: "Agregaron al carrito", value: tot("add_to_cart") }, { label: "Iniciaron el pago", value: tot("begin_checkout") }], { label: "Alternativa: escribieron por WhatsApp", value: tot("whatsapp_click") }) : emptyHtml("El contador propio no respondió."),
        })
        + `</div>`;
    }
    return { html, mounts: ctx.mounts };
  }

  /* ---------- WhatsApp ---------- */
  async function tWhatsapp(ctx) {
    const [wa, gs, aud, pg, fp] = await Promise.all([api("whatsapp"), api("summary"), api("audience"), api("pages"), api("firstparty")]);
    const ga = wa.ok, fe = (fp.ok && fp.ev && fp.ev.whatsapp_click) || null;
    const r = (gs.ok ? gs.range : fp.range) || {}, dates = eachDay(r.from, r.to), cats = dateCats(dates);
    let html = "";
    if (!ga) html += setupNote(wa) + note("warn", "📟", `<p><b>Mostrando el contador propio del sitio.</b> Cuenta los clics a WhatsApp sin cookies ni Google: dice en qué botón, en qué página, de qué producto y a qué hora.</p>`);
    else if ((wa.missingDimensions || []).length) html += note("warn", "🧩", `<p><b>Falta registrar ${wa.missingDimensions.length === 2 ? "dos dimensiones" : "una dimensión"} en Google Analytics</b> (${wa.missingDimensions.map(x => `<span class="mono">${esc(x)}</span>`).join(" y ")}) para ver los clics por botón y por tipo de página. Mientras tanto esas dos tarjetas usan el contador propio.</p><p>En GA4: Administrar → Definiciones personalizadas → Crear dimensión personalizada → alcance <b>Evento</b> → el nombre del parámetro es exactamente ese. Los clics anteriores al registro no se recuperan.</p>`, goBtn("conexion", "Ver la guía"));
    if (!ga && !fe) return { html: html + card({ title: "WhatsApp", body: emptyHtml("Todavía no hay clics a WhatsApp anotados. Se anotan solos cuando alguien toca un botón de WhatsApp del sitio.") }), mounts: ctx.mounts };

    const cur = ga ? num(wa.total.cur) : num(fe.n), prev = ga ? num(wa.total.prev) : num(fe.prev), sessions = gs.ok ? num(gs.kpis.sessions.cur) : 0;
    html += `<div class="an-card flush"><div class="an-hero"><div><div class="l">Clics a WhatsApp en ${esc(RANGE_TXT[S.range])}</div><div class="n">${esc(N(cur))}</div></div><div class="an-tile" style="border:0;padding:0;background:none"><div class="d">${deltaHtml(cur, prev, true)}</div>${sessions ? `<div class="d"><span>${esc(PCT(cur / sessions, 1))} de las sesiones</span></div>` : ""}</div></div>`
      + `<p class="foot">Un clic es alguien que tocó un botón para escribirte: es la intención, no la conversación. Cuenta ${ga ? "Google Analytics" : "el contador propio"}${ga && fe ? `; el contador propio anotó ${esc(N(fe.n))}.` : "."}</p></div>`;

    // por día
    const dayVals = gs.ok ? (() => { const m = byKey(gs.series, "date"); return dates.map(d => (m[d] ? num(m[d].whatsapp) : 0)); })() : dates.map(d => num((fpDays(fp)[d] || {}).whatsapp_click));
    html += chartCard(ctx, {
      title: "Clics por día", sub: gs.ok ? "Fuente: Google Analytics." : "Fuente: contador propio.", cls: "flush",
      build: h => columnChart(h, { cats: cats.map((c, i) => Object.assign({ v: dayVals[i] }, c)), color: "var(--an-1)", name: "clics a WhatsApp", aria: "Clics a WhatsApp por día" }),
      table: tbl([{ h: "Día", k: "d" }, { h: "Clics", k: "v", r: true }], dates.map((d, i) => ({ d: dayLong(d), v: N(dayVals[i]) })).reverse()),
    });

    // dónde y en qué página
    const locGA = ga && Array.isArray(wa.byLocation) && wa.byLocation.length ? wa.byLocation.map(x => ({ label: loc(x.name), value: x.clicks })) : null;
    const ptGA = ga && Array.isArray(wa.byPageType) && wa.byPageType.length ? wa.byPageType.map(x => ({ label: pt(x.name), value: x.clicks })) : null;
    const locRows = locGA || fpTop(fe, "loc").map(x => ({ label: loc(x.name), value: x.n })), ptRows = ptGA || fpTop(fe, "pt").map(x => ({ label: pt(x.name), value: x.n }));
    html += `<div class="an-grid c2">`
      + card({ title: "¿Desde qué botón escriben?", sub: "Fuente: " + (locGA ? "Google Analytics" : "contador propio") + ".", body: hbars(locRows, { empty: "Todavía no hay datos de botones." }), table: tbl([{ h: "Botón", k: "label" }, { h: "Clics", k: "value", r: true, f: x => N(x.value) }], locRows) })
      + card({ title: "¿En qué tipo de página?", sub: "Fuente: " + (ptGA ? "Google Analytics" : "contador propio") + ".", body: hbars(ptRows, { empty: "Todavía no hay datos de páginas." }), table: tbl([{ h: "Tipo de página", k: "label" }, { h: "Clics", k: "value", r: true, f: x => N(x.value) }], ptRows) })
      + `</div>`;

    // productos y páginas que más chats generan
    const prodRows = fpTop(fe, "slug").map(x => ({ label: productName(x.name), value: x.n }));
    const pageRows = ga && pg.ok && (pg.whatsappPages || []).length ? pg.whatsappPages.map(x => ({ label: x.path, value: x.clicks })) : fpTop(fe, "path").map(x => ({ label: x.name, value: x.n }));
    html += `<div class="an-grid c2">`
      + card({ title: "Productos que más generan chats", sub: "Los botones de «Escribir por este producto». Fuente: contador propio.", body: hbars(prodRows, { empty: "Todavía nadie ha escrito desde la ficha de un producto." }), table: tbl([{ h: "Producto", k: "label" }, { h: "Clics", k: "value", r: true, f: x => N(x.value) }], prodRows) })
      + card({ title: "Páginas que más generan chats", sub: "Fuente: " + (ga && pg.ok && (pg.whatsappPages || []).length ? "Google Analytics" : "contador propio") + ".", body: hbars(pageRows, { empty: "Todavía no hay datos de páginas." }), table: tbl([{ h: "Página", k: "label", p: true }, { h: "Clics", k: "value", r: true, f: x => N(x.value) }], pageRows) })
      + `</div>`;

    // cuándo, desde qué aparato y de dónde viene
    const heatOk = ga && aud.ok && (aud.heatWhatsapp || []).length;
    const hours = fpHours(fe);
    const devRows = ga && (wa.byDevice || []).length ? wa.byDevice.map(x => ({ label: dev(x.name), value: x.clicks, color: DEV_COLOR[dev(x.name)] })) : fpTop(fe, "dev").map(x => ({ label: dev(x.name), value: x.n, color: DEV_COLOR[dev(x.name)] }));
    html += `<div class="an-grid c21">`
      + (heatOk
        ? card({ title: "¿A qué hora escriben?", sub: "Clics a WhatsApp por día de la semana y hora (hora de Colombia). Sirve para saber cuándo tener a alguien atento. Fuente: Google Analytics.", body: heatmap(aud.heatWhatsapp, "clics a WhatsApp"), table: tbl([{ h: "Día", k: "d" }, { h: "Hora", k: "h" }, { h: "Clics", k: "v", r: true }], aud.heatWhatsapp.slice().sort((a, b) => b.v - a.v).slice(0, 40).map(x => ({ d: DIA_LARGO[x.dow], h: hourLabel(x.hour), v: N(x.v) }))) })
        : chartCard(ctx, {
          title: "¿A qué hora escriben?", sub: "Clics a WhatsApp por hora del día (hora de Colombia). Fuente: contador propio.",
          build: h => columnChart(h, { cats: hours.map((v, i) => ({ s: String(i), l: hourLabel(i), v })), color: "var(--an-1)", name: "clics a WhatsApp", aria: "Clics a WhatsApp por hora", labelMax: true }),
          table: tbl([{ h: "Hora", k: "h" }, { h: "Clics", k: "v", r: true }], hours.map((v, i) => ({ h: hourLabel(i), v: N(v) })).filter(x => x.v !== "0")),
        }))
      + card({ title: "¿Desde qué aparato?", sub: "Fuente: " + (ga && (wa.byDevice || []).length ? "Google Analytics" : "contador propio") + ".", body: parts(devRows, { aria: "Clics a WhatsApp por aparato", empty: "Todavía no hay datos." }) })
      + `</div>`;
    if (ga && (wa.bySource || []).length) {
      html += card({ title: "¿De dónde venían quienes escribieron?", sub: "Fuente / medio de la visita en la que tocaron WhatsApp. Fuente: Google Analytics.", cls: "flush", body: hbars(wa.bySource.map(x => ({ label: x.name, value: x.clicks })), {}), table: tbl([{ h: "Fuente / medio", k: "name" }, { h: "Clics", k: "clicks", r: true, f: x => N(x.clicks) }], wa.bySource) });
    }
    return { html, mounts: ctx.mounts };
  }

  /* ---------- Cómo llegan ---------- */
  async function tLlegan(ctx) {
    const [ac, fp] = await Promise.all([api("acquisition"), api("firstparty")]);
    let html = "";
    if (!ac.ok) {
      html += setupNote(ac);
      const refs = fp.ok && fp.ev && fp.ev.page_view ? fpTop(fp.ev.page_view, "ref").map(x => ({ label: REF[x.name] || x.name, value: x.n })) : [];
      html += card({ title: "De dónde llegan las visitas (contador propio)", sub: "Solo distingue entre directo, buscadores, redes sociales, campañas y otros sitios.", body: hbars(refs, { empty: "Todavía no hay visitas anotadas." }) });
      return { html, mounts: ctx.mounts };
    }
    const waRows = ac.channels.filter(x => x.whatsapp > 0).map(x => ({ label: chan(x.name), value: x.whatsapp }));
    html += card({
      title: "Canales", sub: "Cómo llegó cada visita según Google (" + rangeText(ac.range) + "). «Con interacción» son las visitas en las que la persona hizo algo (más de 10 segundos, otra página o un evento).", cls: "flush",
      body: tbl([{ h: "Canal", k: "name", f: x => chan(x.name) }, { h: "Sesiones", k: "sessions", r: true, bar: true, f: x => N(x.sessions) }, { h: "Con interacción", k: "eng", r: true, f: x => x.sessions ? PCT(x.engaged / x.sessions, 0) : "—" }, { h: "Clics a WhatsApp", k: "whatsapp", r: true, f: x => N(x.whatsapp) }, { h: "Compras", k: "purchases", r: true, f: x => N(x.purchases) }, { h: "Ingresos", k: "revenue", r: true, f: x => COP(x.revenue) }], ac.channels, { empty: "Todavía no hay visitas en este periodo." }),
    });
    html += `<div class="an-grid c2">`
      + card({ title: "¿Qué canal trae más chats de WhatsApp?", sub: "Clics a WhatsApp según el canal de la visita.", body: hbars(waRows, { empty: "Todavía no hay clics a WhatsApp con canal conocido." }) })
      + card({ title: "Fuente / medio", sub: "El detalle: google / organic, instagram / referral…", body: tbl([{ h: "Fuente / medio", k: "name", p: true }, { h: "Sesiones", k: "sessions", r: true, bar: true, f: x => N(x.sessions) }, { h: "Compras", k: "purchases", r: true, f: x => N(x.purchases) }], ac.sources, { empty: "Todavía no hay datos." }) })
      + `</div>`;
    html += card({ title: "Páginas por donde entran", sub: "La primera página que ve la persona. Si una página de entrada tiene pocas visitas con interacción, vale la pena mejorarla.", body: tbl([{ h: "Página", k: "path", p: true }, { h: "Sesiones", k: "sessions", r: true, bar: true, f: x => N(x.sessions) }, { h: "Con interacción", k: "eng", r: true, f: x => x.sessions ? PCT(x.engaged / x.sessions, 0) : "—" }, { h: "Compras", k: "purchases", r: true, f: x => N(x.purchases) }], ac.landing, { empty: "Todavía no hay datos." }) });
    return { html, mounts: ctx.mounts };
  }

  /* ---------- Qué ven ---------- */
  const SORTS = { views: "Vistas", addToCart: "Agregados al carrito", purchased: "Compras", revenue: "Ingresos" };
  async function tVen(ctx) {
    const [pr, pg, fp] = await Promise.all([api("products"), api("pages"), api("firstparty")]);
    let html = "";
    if (!pr.ok && !pg.ok) {
      html += setupNote(pr);
      const q = fp.ok && fp.ev && fp.ev.search ? fpTop(fp.ev.search, "q").map(x => ({ label: x.name, value: x.n })) : [];
      return { html: html + card({ title: "Lo que buscan en la tienda (contador propio)", body: hbars(q, { empty: "Todavía nadie ha usado el buscador." }) }), mounts: ctx.mounts };
    }
    if (pr.ok) {
      const rows = pr.products.slice().sort((a, b) => num(b[S.sort]) - num(a[S.sort]));
      const withRate = rows.map(x => Object.assign({}, x, { rate: x.views ? x.addToCart / x.views : 0 }));
      const review = withRate.filter(x => x.views >= 20 && x.rate < 0.03).sort((a, b) => b.views - a.views).slice(0, 5);
      const noBuy = withRate.filter(x => x.addToCart >= 3 && x.purchased === 0).sort((a, b) => b.addToCart - a.addToCart).slice(0, 5);
      const lines = [];
      review.forEach(x => lines.push({ h: `<b>${esc(x.name)}</b>: ${esc(N(x.views))} vistas y solo ${esc(N(x.addToCart))} al carrito (${esc(PCT(x.rate, 1))}). Revisa precio, fotos y tallas.`, k: "down" }));
      noBuy.forEach(x => lines.push({ h: `<b>${esc(x.name)}</b>: lo agregaron ${esc(N(x.addToCart))} veces al carrito y nadie lo compró online. ¿Preguntan por WhatsApp o el pago les falla?` }));
      html += `<div class="an-grid c21">`
        + card({
          title: "Productos más vistos", sub: "Vistas de la ficha, agregados al carrito y compras online (" + rangeText(pr.range) + "). Ordenado por " + SORTS[S.sort].toLowerCase() + ".",
          actions: `<label class="an-sel"><span class="muted" style="font-size:12px">Ordenar por</span><select id="an-sort" aria-label="Ordenar los productos por">${Object.keys(SORTS).map(k => `<option value="${k}"${k === S.sort ? " selected" : ""}>${esc(SORTS[k])}</option>`).join("")}</select></label>`,
          body: tbl([{ h: "Producto", k: "name", p: true }, { h: "Vistas", k: "views", r: true, bar: true, f: x => N(x.views) }, { h: "Al carrito", k: "addToCart", r: true, f: x => N(x.addToCart) }, { h: "Del total", k: "rate", r: true, f: x => x.views ? PCT(x.rate, 1) : "—" }, { h: "Compras", k: "purchased", r: true, f: x => N(x.purchased) }, { h: "Ingresos", k: "revenue", r: true, f: x => COP(x.revenue) }], withRate, { empty: "Todavía no hay vistas de productos en Google Analytics." }),
        })
        + card({ title: "Para revisar", sub: "Pistas sacadas de los números de arriba.", body: lines.length ? reads(lines) : emptyHtml("Por ahora nada llama la atención: ningún producto muy visto se queda sin carrito."), foot: "«Del total» es la parte de las vistas que terminó en el carrito." })
        + `</div>`;
      html += `<div class="an-grid c2">`
        + card({ title: "Categorías", sub: "Vistas de productos por categoría.", body: hbars(pr.categories.map(x => ({ label: x.name, value: x.views, sub: N(x.addToCart) + " al carrito" })), { empty: "Todavía no hay datos." }), table: tbl([{ h: "Categoría", k: "name" }, { h: "Vistas", k: "views", r: true, f: x => N(x.views) }, { h: "Al carrito", k: "addToCart", r: true, f: x => N(x.addToCart) }, { h: "Compras", k: "purchased", r: true, f: x => N(x.purchased) }], pr.categories) })
        + card({ title: "Marcas", sub: "Vistas de productos por marca.", body: hbars(pr.brands.map(x => ({ label: x.name, value: x.views, sub: N(x.addToCart) + " al carrito" })), { empty: "Todavía no hay datos." }), table: tbl([{ h: "Marca", k: "name" }, { h: "Vistas", k: "views", r: true, f: x => N(x.views) }, { h: "Al carrito", k: "addToCart", r: true, f: x => N(x.addToCart) }, { h: "Compras", k: "purchased", r: true, f: x => N(x.purchased) }], pr.brands) })
        + `</div>`;
    } else html += setupNote(pr);
    if (pg.ok) {
      const searches = pg.searches.length ? pg.searches.map(x => ({ label: x.term, value: x.count })) : fpTop(fp.ok && fp.ev && fp.ev.search, "q").map(x => ({ label: x.name, value: x.n }));
      html += `<div class="an-grid c2">`
        + card({ title: "Lo que buscan en la tienda", sub: "Lo que escribe la gente en el buscador del sitio. Si buscan algo que no tienes, es una pista de qué traer.", body: hbars(searches, { empty: "Todavía nadie ha usado el buscador." }), table: tbl([{ h: "Búsqueda", k: "label", p: true }, { h: "Veces", k: "value", r: true, f: x => N(x.value) }], searches) })
        + card({ title: "Páginas que no existen (error 404)", sub: "Enlaces rotos que alguien intentó abrir. Si es un enlace de tu propio sitio, corrígelo; si es un producto que ya no está, conviene redirigirlo.", body: tbl([{ h: "Página", k: "path", p: true }, { h: "Veces", k: "views", r: true, f: x => N(x.views) }], pg.notFound, { empty: "Ninguna en este periodo. Todo en orden." }) })
        + `</div>`;
      html += card({ title: "Páginas más vistas", sub: "Visitas por página y tiempo promedio que la persona se queda activa en ella.", body: tbl([{ h: "Página", k: "path", p: true }, { h: "Vistas", k: "views", r: true, bar: true, f: x => N(x.views) }, { h: "Personas", k: "users", r: true, f: x => N(x.users) }, { h: "Tiempo promedio", k: "avgSeconds", r: true, f: x => dur(x.avgSeconds) }], pg.pages, { empty: "Todavía no hay datos." }) });
    } else html += setupNote(pg);
    return { html, mounts: ctx.mounts };
  }

  /* ---------- Quiénes ---------- */
  async function tQuienes(ctx) {
    const au = await api("audience");
    if (!au.ok) return { html: setupNote(au), mounts: ctx.mounts };
    const NVR = { new: "Nuevos", returning: "Recurrentes" };
    const devRows = au.devices.map(x => ({ label: dev(x.name), value: x.sessions, color: DEV_COLOR[dev(x.name)] }));
    const nvrRows = au.newVsReturning.filter(x => NVR[x.name]).map(x => ({ label: NVR[x.name], value: x.sessions, color: x.name === "new" ? "var(--an-1)" : "var(--an-2)" }));
    let html = `<div class="an-grid c3">`
      + card({ title: "Aparatos", sub: "Sesiones por tipo de aparato.", body: parts(devRows, { aria: "Sesiones por aparato", empty: "Todavía no hay datos." }), table: tbl([{ h: "Aparato", k: "n" }, { h: "Sesiones", k: "s", r: true }, { h: "Personas", k: "u", r: true }, { h: "Compras", k: "p", r: true }], au.devices.map(x => ({ n: dev(x.name), s: N(x.sessions), u: N(x.users), p: N(x.purchases) }))) })
      + card({ title: "Nuevos y recurrentes", sub: "Sesiones de quien llega por primera vez y de quien vuelve.", body: parts(nvrRows, { aria: "Sesiones nuevas y recurrentes", empty: "Todavía no hay datos." }) })
      + card({ title: "Ciudades", sub: "Sesiones por ciudad (las 12 con más visitas).", body: hbars(au.cities.map(x => ({ label: x.name, value: x.sessions })), { empty: "Todavía no hay datos." }), table: tbl([{ h: "Ciudad", k: "name" }, { h: "Sesiones", k: "sessions", r: true, f: x => N(x.sessions) }, { h: "Personas", k: "users", r: true, f: x => N(x.users) }], au.cities) })
      + `</div>`;
    html += card({ title: "¿Cuándo nos visitan?", sub: "Sesiones por día de la semana y hora (hora de Colombia). Sirve para elegir cuándo publicar, responder o lanzar una promoción.", cls: "flush", body: heatmap(au.heatSessions, "sesiones"), table: tbl([{ h: "Día", k: "d" }, { h: "Hora", k: "h" }, { h: "Sesiones", k: "v", r: true }], au.heatSessions.slice().sort((a, b) => b.v - a.v).slice(0, 40).map(x => ({ d: DIA_LARGO[x.dow], h: hourLabel(x.hour), v: N(x.v) }))) });
    return { html, mounts: ctx.mounts };
  }

  /* ---------- Google (SEO) ---------- */
  async function tSeo(ctx) {
    const [sr, sm] = await Promise.all([api("search"), api("sitemaps")]);
    if (!sr.ok) return { html: setupNote(sr), mounts: ctx.mounts };
    const t = sr.totals, c = t.cur, p = t.prev, r = sr.range || {};
    const dates = eachDay(r.from, r.to), cats = dateCats(dates), ser = byKey(sr.series, "date");
    const col = k => dates.map(d => (ser[d] ? num(ser[d][k]) : 0));
    const path = u => { try { return new URL(u).pathname || "/"; } catch (e) { return String(u); } };
    let html = `<div class="an-tiles">`
      + tile({ label: "Clics desde Google", value: N(c.clicks), cur: c.clicks, prev: p.clicks, spark: spark(col("clicks"), "var(--an-1)") })
      + tile({ label: "Veces que apareciste", value: N(c.impressions), cur: c.impressions, prev: p.impressions, spark: spark(col("impressions"), "var(--an-1)") })
      + tile({ label: "Clics por cada aparición (CTR)", value: PCT(c.ctr, 1), cur: c.ctr, prev: p.ctr })
      + tile({ label: "Posición media", value: DEC(c.position, 1), cur: c.position, prev: p.position, goodUp: false })
      + `</div>`;
    html += `<p class="an-stamp" style="margin:-4px 0 14px">Search Console: del ${esc(dayLong(r.from))} al ${esc(dayLong(r.to))}. Google tiene estos datos con unos 2 días de retraso.</p>`;
    html += `<div class="an-grid c2">`
      + chartCard(ctx, { title: "Clics desde Google por día", sub: "Personas que vieron tu página en Google y entraron.", build: h => lineChart(h, { cats, aria: "Clics desde Google por día", series: [{ name: "Clics", color: "var(--an-1)", values: col("clicks"), area: true }] }), table: tbl([{ h: "Día", k: "d" }, { h: "Clics", k: "c", r: true }, { h: "Apariciones", k: "i", r: true }], dates.map(d => ({ d: dayLong(d), c: N((ser[d] || {}).clicks), i: N((ser[d] || {}).impressions) })).reverse()) })
      + chartCard(ctx, { title: "Veces que apareciste en Google por día", sub: "Cada vez que tu página salió en una búsqueda, la hayan tocado o no.", build: h => lineChart(h, { cats, aria: "Apariciones en Google por día", series: [{ name: "Apariciones", color: "var(--an-1)", values: col("impressions"), area: true }] }) })
      + `</div>`;
    const brandRows = [{ label: "Buscaron «Stike»", value: sr.brand.clicks, color: "var(--an-1)" }, { label: "Buscaron otra cosa", value: sr.nonBrand.clicks, color: "var(--an-2)" }];
    html += `<div class="an-grid c12">`
      + card({ title: "¿Te buscan por nombre?", sub: "Clics según si la búsqueda llevaba «Stike» o no (de las 250 búsquedas con más apariciones). Crecer en «otra cosa» es que te encuentran sin conocerte.", body: parts(brandRows, { aria: "Clics por tipo de búsqueda", empty: "Todavía no hay clics." }) })
      + card({ title: "Búsquedas que te traen visitas", sub: "Lo que escribió la gente en Google. «Posición» 1 es el primer resultado.", body: tbl([{ h: "Búsqueda", k: "query", p: true }, { h: "Clics", k: "clicks", r: true, bar: true, f: x => N(x.clicks) }, { h: "Apariciones", k: "impressions", r: true, f: x => N(x.impressions) }, { h: "CTR", k: "ctr", r: true, f: x => PCT(x.ctr, 1) }, { h: "Posición", k: "position", r: true, f: x => DEC(x.position, 1) }], sr.queries, { empty: "Todavía no hay búsquedas anotadas (una propiedad nueva tarda unos días)." }) })
      + `</div>`;
    html += card({ title: "Oportunidades", sub: "Búsquedas en las que ya apareces, pero abajo (posición 4 a 20). Mejorar el título y la descripción de esa página, o dar más contenido sobre el tema, puede subirte al primer lugar.", cls: "flush", body: tbl([{ h: "Búsqueda", k: "query", p: true }, { h: "Apariciones", k: "impressions", r: true, bar: true, f: x => N(x.impressions) }, { h: "Clics", k: "clicks", r: true, f: x => N(x.clicks) }, { h: "Posición", k: "position", r: true, f: x => DEC(x.position, 1) }], sr.opportunities, { empty: "Por ahora no hay búsquedas con suficientes apariciones en esa zona." }) });
    html += `<div class="an-grid c21">`
      + card({ title: "Páginas que más aparecen", sub: "Qué páginas del sitio muestra Google.", body: tbl([{ h: "Página", k: "page", p: true, f: x => path(x.page) }, { h: "Clics", k: "clicks", r: true, bar: true, f: x => N(x.clicks) }, { h: "Apariciones", k: "impressions", r: true, f: x => N(x.impressions) }, { h: "CTR", k: "ctr", r: true, f: x => PCT(x.ctr, 1) }, { h: "Posición", k: "position", r: true, f: x => DEC(x.position, 1) }], sr.pages, { empty: "Todavía no hay datos." }) })
      + `<div>`
      + card({ title: "Aparatos", sub: "Clics por tipo de aparato.", body: parts(sr.devices.map(x => ({ label: dev(x.name), value: x.clicks, color: DEV_COLOR[dev(x.name)] })), { aria: "Clics por aparato", empty: "Todavía no hay datos." }) })
      + `<div style="height:14px"></div>`
      + card({ title: "Países", sub: "Clics por país.", body: hbars(sr.countries.map(x => ({ label: country(x.name), value: x.clicks })), { empty: "Todavía no hay datos." }) })
      + `</div></div>`;
    // sitemaps
    let smHtml;
    if (sm.ok) {
      const list = sm.sitemaps.map(s => `<div class="r"><span class="i ${s.errors ? "no" : "ok"}">${s.errors ? "✕" : "✔"}</span><span style="flex:1;min-width:0"><b>${esc(s.path)}</b><br><span class="muted">Enviado ${esc(s.lastSubmitted ? dayLong(s.lastSubmitted) : "—")} · leído por Google ${esc(s.lastDownloaded ? dayLong(s.lastDownloaded) : "todavía no")}${s.pending ? " · pendiente" : ""} · ${esc(N(s.submitted))} ${s.submitted === 1 ? "dirección" : "direcciones"}${s.errors ? ` · <span style="color:var(--bad)">${esc(N(s.errors))} ${s.errors === 1 ? "error" : "errores"}</span>` : ""}${s.warnings ? ` · ${esc(N(s.warnings))} ${s.warnings === 1 ? "aviso" : "avisos"}` : ""}</span></span></div>`).join("");
      smHtml = (sm.sitemaps.length ? `<div class="an-checks">${list}</div>` : emptyHtml("Todavía no hay ningún sitemap enviado.")) + (canManage() ? `<div style="margin-top:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button type="button" class="btn ghost sm" id="an-sm-send">Enviar sitemap a Google</button><span class="an-msg" id="an-sm-msg" role="status"></span></div>` : "");
    } else smHtml = setupNote(sm);
    html += card({ title: "Sitemap", sub: "La lista de páginas que le das a Google para que las encuentre. Se actualiza sola cada vez que cambias productos.", body: smHtml, cls: "flush" });
    ctx.after.push(() => {
      const b = $("#an-sm-send"); if (!b) return;
      b.addEventListener("click", async () => {
        const m = $("#an-sm-msg"); b.disabled = true; m.className = "an-msg"; m.textContent = "Enviando…";
        const x = await post("api/analytics", { view: "sitemap_submit" });
        b.disabled = false;
        if (x.ok && x.data.ok) { m.className = "an-msg ok"; m.textContent = "Listo: Google recibió " + x.data.sitemap + ". Puede tardar un rato en leerlo."; S.cache.delete("sitemaps|"); }
        else { m.className = "an-msg bad"; m.textContent = (x.data && (x.data.detail || x.data.error)) || "No se pudo enviar."; }
      });
    });
    return { html, mounts: ctx.mounts };
  }

  /* ---------- En vivo ---------- */
  async function tVivo(ctx) {
    const rt = await api("realtime", { noRange: true, noCache: true });
    if (!rt.ok) return { html: setupNote(rt), mounts: ctx.mounts };
    let html = `<div class="an-grid c21"><div class="an-card"><div class="an-head"><div><h3>Personas en el sitio ahora mismo</h3><p class="sub">Los últimos 30 minutos, según Google Analytics. Se actualiza solo cada 30 segundos mientras miras esta pestaña.</p></div></div>`
      + `<div class="an-live-n"><span class="an-pulse" aria-hidden="true"></span>${esc(N(rt.activeUsers))}</div></div>`
      + card({ title: "Dónde están", sub: "Ciudades.", body: hbars(rt.cities.map(x => ({ label: x.name, value: x.users })), { empty: "Nadie ahora mismo." }) }) + `</div>`;
    html += `<div class="an-grid c2">`
      + card({ title: "Qué están mirando", sub: "Páginas abiertas ahora.", body: hbars(rt.pages.map(x => ({ label: x.name, value: x.users })), { empty: "Nadie ahora mismo." }) })
      + card({ title: "Qué están haciendo", sub: "Acciones de los últimos 30 minutos.", body: hbars(rt.events.map(x => ({ label: evLabel(x.name), value: x.count })), { empty: "Todavía no hay acciones." }) })
      + `</div>`;
    ctx.after.push(() => {
      clearInterval(S.timer);
      S.timer = setInterval(() => {
        const panel = document.getElementById("panel-analitica");
        if (document.hidden || S.tab !== "vivo" || !panel || !panel.classList.contains("active")) return;
        render({ quiet: true });
      }, 30000);
    });
    return { html, mounts: ctx.mounts };
  }

  /* ---------- Conexión ---------- */
  function checksHtml(list) {
    return `<div class="an-checks">` + list.map(c => `<div class="r"><span class="i ${c.ok ? "ok" : "no"}">${c.ok ? "✔" : "✕"}</span><span style="flex:1;min-width:0"><b>${esc(c.label)}</b><br><span class="muted">${esc(c.detail)}</span></span></div>`).join("") + `</div>`;
  }
  function internalFlag() { try { return localStorage.getItem("stike_internal") !== "0"; } catch (e) { return true; } }
  async function readSiteCfg() {
    try { if (S.deps.ghGetFile) { const f = await S.deps.ghGetFile("data/analytics.json"); if (f) { const j = JSON.parse(f.text); if (j && typeof j === "object") return j; } } } catch (e) {}
    return null;
  }
  async function tConexion(ctx) {
    const st = await api("status", { noRange: true, noCache: true });
    if (!st.ok) return { html: note("bad", "⚠️", `<p><b>No se pudo leer el estado</b></p><p>${esc(st.detail || "")}</p>`), mounts: ctx.mounts };
    S.status = st;
    const cfg = (await readSiteCfg()) || st.site || {};
    const sa = st.google.serviceAccount, mid = String(cfg.ga4MeasurementId || "");
    const steps = [
      { ok: /^G-[A-Z0-9]{6,14}$/.test(String(st.site.measurementId || "")), label: "El sitio manda las visitas a Google Analytics", detail: st.site.measurementId ? "ID de medición publicado: " + st.site.measurementId + "." : "Falta el ID de medición (G-…). Pégalo en «Medición del sitio»." },
      { ok: st.firstParty.events30d > 0, label: "Contador propio del sitio", detail: st.firstParty.events30d > 0 ? N(st.firstParty.events30d) + " eventos anotados en los últimos 30 días." : "Todavía no hay eventos (se anotan solos cuando alguien visita el sitio; no cuentan los navegadores del equipo)." },
      { ok: !!sa, label: "Cuenta de servicio de Google (para leer los datos aquí)", detail: sa ? sa.email + (sa.project ? " · proyecto " + sa.project : "") + " · llave guardada " + (st.google.source === "panel" ? "desde el panel" : "en el servidor") + "." : "Falta la llave JSON de la cuenta de servicio (paso 3 de la guía)." },
      { ok: !!st.ga4.propertyId, label: "Propiedad de Google Analytics 4", detail: st.ga4.propertyId ? "ID de propiedad " + st.ga4.propertyId + "." : "Falta el ID de propiedad (solo números)." },
      { ok: !!st.gsc.site, label: "Propiedad de Search Console", detail: st.gsc.site ? st.gsc.site : "Falta la propiedad (sc-domain:stikebikeshop.com o la dirección del sitio)." },
    ];
    const manage = canManage(), internal = internalFlag();
    let html = card({
      title: "Estado de la conexión", sub: "Lo que ya está listo y lo que falta. «Probar conexión» entra de verdad a Google y dice qué falla.", cls: "flush",
      actions: manage ? `<button type="button" class="btn cyan sm" id="an-test">Probar conexión</button>` : "",
      body: checksHtml(steps) + `<div id="an-test-out" style="margin-top:12px"></div>` + (!manage ? `<p class="foot">Solo el dueño y el desarrollador pueden cambiar la conexión o probarla.</p>` : ""),
    });
    if (manage) {
      html += `<div class="an-grid c2 an-form">`
        + card({
          title: "Medición del sitio", sub: "Lo que decide qué mide el sitio. Se publica solo (tarda 1-3 minutos en llegar a la página).",
          body: `<div class="field"><label for="an-mid">ID de medición de Google Analytics</label><input id="an-mid" type="text" class="mono" placeholder="G-AB12CD34EF" value="${esc(mid)}" autocomplete="off" autocapitalize="characters" spellcheck="false"><p class="hint">GA4 → Administrar → Flujos de datos → tu sitio web → «ID de medición». Si lo dejas vacío, el sitio no manda nada a Google.</p></div>`
            + `<div class="field"><label for="an-consent">Cookies y permiso</label><select id="an-consent"><option value="opt_out"${cfg.consentMode === "opt_in" ? "" : " selected"}>Medir mientras la persona no rechace (recomendado)</option><option value="opt_in"${cfg.consentMode === "opt_in" ? " selected" : ""}>Medir solo si la persona acepta las cookies</option></select><p class="hint">Con cualquiera de las dos, quien rechaza el aviso de cookies, activa «No rastrear» o el control de privacidad del navegador no se mide.</p></div>`
            + `<div class="field"><label style="text-transform:none;letter-spacing:0;display:flex;gap:8px;align-items:center;color:var(--ink-2)"><input id="an-fp" type="checkbox"${cfg.firstParty === false ? "" : " checked"}> Contador propio sin cookies (respaldo de Google)</label><p class="hint">Cuenta visitas, WhatsApp, carrito y pago sin guardar nada de la persona. Así sigues viendo números aunque Google no cuente a todos.</p></div>`
            + `<div class="field"><label for="an-gsc">Token de verificación de Search Console (opcional)</label><input id="an-gsc" type="text" class="mono" placeholder="solo si verificas con la etiqueta HTML" value="${esc(cfg.gscVerification || "")}" autocomplete="off" spellcheck="false"><p class="hint">Search Console → verificar con «Etiqueta HTML»: pega la etiqueta completa o solo el valor de <span class="mono">content</span>.</p></div>`
            + `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button type="button" class="btn cyan" id="an-site-save">Guardar y publicar</button></div><p class="an-msg" id="an-site-msg" role="status"></p>`,
        })
        + card({
          title: "Conexión con Google (solo lectura)", sub: "Con esto el panel lee Google Analytics y Search Console. La llave se guarda cifrada en el servidor y nunca vuelve a mostrarse.",
          body: `<div class="field"><label for="an-prop">ID de propiedad de Google Analytics 4 ${st.ga4.propertyId ? `<span class="muted" style="text-transform:none;letter-spacing:0">· guardado: ${esc(st.ga4.propertyId)}</span>` : ""}</label><input id="an-prop" type="text" inputmode="numeric" class="mono" placeholder="412345678" autocomplete="off" spellcheck="false"><p class="hint">Solo números: GA4 → Administrar → Detalles de la propiedad → «ID de propiedad» (no es el que empieza por G-).</p></div>`
            + `<div class="field"><label for="an-site">Propiedad de Search Console ${st.gsc.site ? `<span class="muted" style="text-transform:none;letter-spacing:0">· guardada: ${esc(st.gsc.site)}</span>` : ""}</label><input id="an-site" type="text" class="mono" placeholder="sc-domain:stikebikeshop.com" autocomplete="off" autocapitalize="off" spellcheck="false"><p class="hint">Tal como aparece arriba a la izquierda en Search Console: <span class="mono">sc-domain:stikebikeshop.com</span> (tipo «Dominio») o <span class="mono">https://stikebikeshop.com/</span> (tipo «Prefijo de URL»).</p></div>`
            + `<div class="field"><label for="an-key">Llave de la cuenta de servicio (archivo JSON) ${sa ? `<span class="muted" style="text-transform:none;letter-spacing:0">· ya hay una guardada; pega otra solo para cambiarla</span>` : ""}</label><textarea id="an-key" class="mono" placeholder='Abre el archivo .json descargado, copia TODO (desde { hasta }) y pégalo aquí' autocomplete="off" autocapitalize="off" spellcheck="false"></textarea></div>`
            + (sa ? `<p class="foot" style="margin:0 0 12px">Esta cuenta tiene que estar agregada como lector en GA4 y en Search Console:<br><span class="mono" style="color:var(--ink)">${esc(sa.email)}</span> <button type="button" class="btn ghost sm" id="an-copy" data-copy="${esc(sa.email)}">Copiar</button></p>` : "")
            + `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button type="button" class="btn cyan" id="an-g-save">Guardar y probar</button><button type="button" class="btn ghost sm" id="an-g-clear" title="Borra la llave y los IDs guardados desde el panel">Quitar lo guardado aquí</button></div><p class="an-msg" id="an-g-msg" role="status"></p>`,
        })
        + `</div>`;
    }
    html += card({
      title: "Guía paso a paso (una sola vez, unos 15 minutos)", sub: "Para que el panel pueda leer Google Analytics y Search Console.", cls: "flush",
      body: `<details${sa && st.ga4.propertyId && st.gsc.site ? "" : " open"}><summary style="cursor:pointer;font-weight:600">Ver los pasos</summary><ol class="an-steps">`
        + `<li><b>Google Cloud:</b> entra a <span class="mono">console.cloud.google.com</span>, elige (o crea) un proyecto y activa dos APIs: <b>Google Analytics Data API</b> y <b>Google Search Console API</b> (buscador de arriba → nombre de la API → «Habilitar»).</li>`
        + `<li><b>Cuenta de servicio:</b> menú → IAM y administración → Cuentas de servicio → Crear cuenta (nombre «stike-analitica», sin roles). Entra a ella → pestaña <b>Claves</b> → Agregar clave → Crear clave nueva → <b>JSON</b>. Se descarga un archivo: no lo compartas por chat ni por correo.</li>`
        + `<li><b>Pega la llave aquí:</b> arriba, en «Conexión con Google», pega todo el contenido del archivo. Al guardar, el panel te muestra el correo de la cuenta (termina en <span class="mono">.iam.gserviceaccount.com</span>).</li>`
        + `<li><b>Google Analytics:</b> Administrar → <b>Acceso a la propiedad</b> → + → pega ese correo → rol <b>Lector</b> → Agregar. Luego, en Detalles de la propiedad, copia el <b>ID de propiedad</b> (solo números) y pégalo arriba.</li>`
        + `<li><b>Search Console:</b> Configuración → <b>Usuarios y permisos</b> → Agregar usuario → el mismo correo → permiso <b>Completo</b> (con «Restringido» se lee todo, pero no se puede enviar el sitemap desde aquí). Escribe arriba el nombre de la propiedad.</li>`
        + `<li><b>Pulsa «Guardar y probar»</b> y luego «Probar conexión»: cada punto tiene que quedar en ✔.</li>`
        + `<li><b>En GA4, una sola vez:</b> Administrar → Eventos → marca <span class="mono">whatsapp_click</span> como <b>evento clave</b>; y en Definiciones personalizadas → Crear dimensión personalizada (alcance <b>Evento</b>) crea dos: «Botón de WhatsApp» con el parámetro <span class="mono">link_location</span> y «Tipo de página» con el parámetro <span class="mono">page_type</span>. Sin ellas no se ve desde qué botón escriben (el contador propio sí lo muestra).</li>`
        + `</ol></details>`,
    });
    html += card({
      title: "Probar el seguimiento", sub: "Cómo comprobar que el sitio está midiendo.", cls: "flush",
      body: `<p style="margin:0 0 10px;font-size:13px;line-height:1.6;color:var(--ink-2)">Este navegador <b>${internal ? "no cuenta" : "sí cuenta"}</b> como visita (los navegadores del equipo se excluyen solos al abrir el panel, para no inflar los números).</p>`
        + `<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center"><button type="button" class="btn ghost sm" id="an-int">${internal ? "Contar mis visitas (para probar)" : "Volver a excluir este navegador"}</button><a class="btn ghost sm" href="/?stike_debug=1" target="_blank" rel="noopener" style="text-decoration:none">Abrir el sitio en modo prueba</a></div>`
        + `<p class="foot">En modo prueba (<span class="mono">?stike_debug=1</span>) el sitio muestra en la consola del navegador (F12) cada evento que manda. Los datos tardan unos minutos en aparecer aquí; algunos informes de Google, hasta 24 horas. En GA4 → Administrar → DebugView ves los eventos al instante.</p>`,
    });
    ctx.after.push(wireConexion);
    return { html, mounts: ctx.mounts };
  }

  const setMsg = (id, ok, text) => { const el = document.getElementById(id); if (el) { el.className = "an-msg " + (ok ? "ok" : "bad"); el.textContent = text; } };
  async function runTest() {
    const out = $("#an-test-out"), b = $("#an-test"); if (!out) return;
    if (b) b.disabled = true;
    out.innerHTML = `<p class="muted" style="font-size:13px">Probando la conexión con Google…</p>`;
    const x = await post("api/analytics", { view: "test" });
    if (b) b.disabled = false;
    if (!x.ok || !x.data.checks) { out.innerHTML = note("bad", "⚠️", `<p>${esc((x.data && (x.data.detail || x.data.error)) || "No se pudo probar.")}</p>`); return; }
    out.innerHTML = `<p style="margin:0 0 4px;font-weight:600;font-size:13px">Resultado de la prueba</p>` + checksHtml(x.data.checks);
  }
  function wireConexion() {
    const t = $("#an-test"); if (t) t.addEventListener("click", runTest);
    const cp = $("#an-copy"); if (cp) cp.addEventListener("click", () => { const v = cp.getAttribute("data-copy"); (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(() => { cp.textContent = "Copiado"; }).catch(() => { cp.textContent = "Selecciónalo y copia"; }); });
    const ib = $("#an-int"); if (ib) ib.addEventListener("click", () => { try { localStorage.setItem("stike_internal", internalFlag() ? "0" : "1"); } catch (e) {} render(); });
    const sb = $("#an-site-save"); if (sb) sb.addEventListener("click", async () => {
      const mid = $("#an-mid").value.trim().toUpperCase();
      let gsc = $("#an-gsc").value.trim();
      const m = /content\s*=\s*["']([^"']+)["']/i.exec(gsc); if (m) gsc = m[1];
      if (mid && !/^G-[A-Z0-9]{6,14}$/.test(mid)) return setMsg("an-site-msg", false, "El ID de medición empieza por G- y sigue con letras y números (por ejemplo G-AB12CD34EF). Lo ves en GA4 → Administrar → Flujos de datos → tu sitio web.");
      if (gsc && !/^[A-Za-z0-9_-]{20,100}$/.test(gsc)) return setMsg("an-site-msg", false, "El token de Search Console son solo letras, números, guion y guion bajo. Pega la etiqueta completa o solo el valor de content, sin comillas.");
      sb.disabled = true; setMsg("an-site-msg", true, "Guardando…");
      try {
        await S.deps.mergeFlatMap("data/analytics.json", { ga4MeasurementId: mid, consentMode: $("#an-consent").value === "opt_in" ? "opt_in" : "opt_out", firstParty: $("#an-fp").checked, gscVerification: gsc }, [], "Analítica: medición del sitio" + (mid ? " (" + mid + ")" : " (sin ID)"));
        $("#an-mid").value = mid; $("#an-gsc").value = gsc;
        setMsg("an-site-msg", true, "Guardado. El sitio empieza a usar esta configuración cuando termine de publicarse (1 a 3 minutos)." + (gsc ? " El token de Search Console queda en la página de inicio en esa misma publicación." : ""));
      } catch (e) { setMsg("an-site-msg", false, "No se pudo guardar: " + (e && e.message ? e.message : e)); }
      sb.disabled = false;
    });
    const gb = $("#an-g-save"); if (gb) gb.addEventListener("click", async () => {
      const body = { action: "analytics_save" }, prop = $("#an-prop").value.trim(), site = $("#an-site").value.trim(), key = $("#an-key").value.trim();
      if (prop) body.propertyId = prop; if (site) body.gscSite = site; if (key) body.serviceAccountJson = key;
      if (!prop && !site && !key) return setMsg("an-g-msg", false, "Escribe el ID de propiedad, la propiedad de Search Console o pega la llave JSON.");
      gb.disabled = true; setMsg("an-g-msg", true, "Guardando…");
      const x = await post("api/admin-config", body);
      gb.disabled = false;
      if (!x.ok) return setMsg("an-g-msg", false, (x.data && (x.data.detail || x.data.error)) || "No se pudo guardar.");
      $("#an-key").value = "";   // la llave no se queda en la pantalla
      S.cache.clear();
      setMsg("an-g-msg", true, "Guardado" + (x.data.serviceAccount ? " (cuenta " + x.data.serviceAccount.email + ")" : "") + ". Probando la conexión…");
      await render({ then: runTest });
    });
    const cb = $("#an-g-clear"); if (cb) cb.addEventListener("click", async () => {
      if (!window.confirm("¿Quitar la llave y los IDs que se guardaron desde el panel? Tendrás que pegarlos de nuevo para ver Google Analytics y Search Console aquí.")) return;
      cb.disabled = true;
      const x = await post("api/admin-config", { action: "analytics_clear", all: true });
      cb.disabled = false;
      if (!x.ok) return setMsg("an-g-msg", false, (x.data && (x.data.detail || x.data.error)) || "No se pudo quitar.");
      S.cache.clear(); await render(); setMsg("an-g-msg", true, "Listo: se quitó lo guardado desde el panel.");
    });
  }

  /* ============================== estructura y navegación ============================== */
  const RENDERERS = { resumen: tResumen, whatsapp: tWhatsapp, llegan: tLlegan, ven: tVen, quienes: tQuienes, seo: tSeo, vivo: tVivo, conexion: tConexion };
  function buildShell() {
    root().innerHTML = `<div class="an-filters" id="an-filters"><div class="viewtoggle" role="group" aria-label="Periodo" id="an-ranges">${RANGES.map(([k, t]) => `<button type="button" class="viewtoggle-btn${k === S.range ? " active" : ""}" data-range="${k}" aria-pressed="${k === S.range}">${esc(t)}</button>`).join("")}</div>`
      + `<button type="button" class="btn ghost sm" id="an-refresh" title="Volver a pedir los datos a Google">↻ Actualizar</button><span class="an-stamp" id="an-stamp"></span><span class="grow"></span><span class="an-stamp" id="an-rng"></span></div>`
      + `<div class="an-tabs" role="tablist" id="an-tabs">${TABS.map(([k, t]) => `<button type="button" role="tab" class="an-tab${k === S.tab ? " active" : ""}" data-tab="${k}" aria-selected="${k === S.tab}">${esc(t)}${k === "conexion" ? `<span class="dot" id="an-dot" hidden></span>` : ""}</button>`).join("")}</div>`
      + `<div class="an-body" id="an-body" aria-live="polite"></div>`;
    const r = root();
    wireTips(r);
    r.addEventListener("click", e => {
      const rb = e.target.closest("[data-range]"); if (rb) { S.range = rb.getAttribute("data-range"); try { localStorage.setItem("stike_an_range", S.range); } catch (x) {} syncShell(); return render(); }
      const tb = e.target.closest("[data-tab]"); if (tb) { setTab(tb.getAttribute("data-tab")); return; }
      const go = e.target.closest("[data-go]"); if (go) { setTab(go.getAttribute("data-go")); return; }
      if (e.target.closest("#an-refresh") || e.target.closest("[data-refresh]")) { S.fresh = true; S.cache.clear(); render().then(() => { S.fresh = false; }); return; }
      const vt = e.target.closest("[data-vt]");
      if (vt) { const c = vt.closest(".an-card"), tv = c.querySelector(".an-tv"), cv = c.querySelector(".an-view:not(.an-tv)"), on = tv.hidden; tv.hidden = !on; cv.hidden = on; vt.textContent = on ? "Ver gráfico" : "Ver tabla"; vt.setAttribute("aria-pressed", String(on)); }
    });
    r.addEventListener("change", e => { if (e.target && e.target.id === "an-sort") { S.sort = e.target.value; render({ quiet: true }); } });
  }
  function syncShell() {
    $$all("#an-ranges [data-range]").forEach(b => { const on = b.getAttribute("data-range") === S.range; b.classList.toggle("active", on); b.setAttribute("aria-pressed", String(on)); });
    $$all("#an-tabs [data-tab]").forEach(b => { const on = b.getAttribute("data-tab") === S.tab; b.classList.toggle("active", on); b.setAttribute("aria-selected", String(on)); });
    const noRange = S.tab === "vivo" || S.tab === "conexion";
    const rg = $("#an-ranges"), rf = $("#an-refresh"); if (rg) rg.hidden = noRange; if (rf) rf.hidden = S.tab === "conexion";
  }
  const $$all = s => Array.from(document.querySelectorAll(s));
  function setTab(t) { if (!RENDERERS[t]) return; S.tab = t; syncShell(); render(); }
  function updateDot() {
    const d = $("#an-dot"), st = S.status; if (!d || !st) return;
    const all = /^G-/.test(String(st.site.measurementId || "")) && !!st.google.serviceAccount && !!st.ga4.propertyId && !!st.gsc.site;
    d.hidden = false; d.className = "dot" + (all ? " ok" : ""); d.title = all ? "Todo conectado" : "Faltan pasos por conectar";
  }

  async function render(o) {
    o = o || {};
    const body = $("#an-body"); if (!body) return;
    const my = ++S.token;
    clearInterval(S.timer); S.timer = null;
    ttHide();
    if (!o.quiet) body.classList.add("loading");
    const ctx = ctxNew(); ctx.after = [];
    let res;
    try { res = await RENDERERS[S.tab](ctx); }
    catch (e) { console.error(e); res = { html: note("bad", "⚠️", `<p><b>No se pudo dibujar esta pestaña.</b></p><p>${esc(e && e.message ? e.message : e)}</p>`, `<button type="button" class="btn ghost sm" data-refresh>Reintentar</button>`), mounts: [] }; }
    if (my !== S.token) return;   // llegó una petición más nueva: esta ya no sirve
    S.ros.forEach(r => r.disconnect()); S.ros = [];
    body.innerHTML = res.html;
    body.classList.remove("loading");
    $$all("[data-heat] .an-hg").forEach(g => { rovingInit(g, ".c"); rovingKeys(g, ".c", 24); });
    res.mounts.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
    ctx.after.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
    const rn = $("#an-rng"), sp = $("#an-stamp");
    if (sp) sp.textContent = "Actualizado " + new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
    if (rn) rn.textContent = "";
    syncShell(); updateDot();
    if (o.then) o.then();
  }

  /* ============================== API pública ============================== */
  window.StikeAnalytics = {
    open(deps) {
      S.deps = deps;
      if (!S.ready) { buildShell(); S.ready = true; }
      syncShell();
      api("status", { noRange: true, noCache: true }).then(st => { if (st && st.ok) { S.status = st; updateDot(); } });
      return render();
    },
    pause() { clearInterval(S.timer); S.timer = null; ttHide(); },
  };
})();
