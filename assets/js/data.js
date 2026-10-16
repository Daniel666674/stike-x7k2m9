/* =========================================================================
   STIKE BIKE SHOP: Categorias, marcas y helpers de catalogo.
   El catalogo en si (window.STIKE_PRODUCTS) vive en products-data.js, que se
   carga ANTES de este archivo y es lo que el panel admin reescribe via la
   API de contenidos de GitHub. Todo en espanol. Precios en COP.
   ========================================================================= */

/* ----------------------- Categorias y subcategorias --------------------- */
const STIKE_CATEGORIES = [
  {
    slug: "repuestos",
    name: "Repuestos",
    blurb: "Cada parte de tu BMX",
    color: "c2",
    subs: [
      "Marcos", "Tenedores", "Timones", "Manubrios", "Bielas", "Platos",
      "Cadenas", "Frenos", "Manzanas", "Rines", "Llantas", "Pedales",
      "Sillas y Postes", "Tacos y Protectores de Maza", "Espigas"
    ]
  },
  {
    slug: "protecciones",
    name: "Protecciones",
    blurb: "Cascos, rodilleras y mas",
    color: "c3",
    subs: ["Cascos", "Rodilleras", "Coderas", "Guantes", "Espinilleras", "Tobilleras"]
  },
  {
    slug: "ropa",
    name: "Ropa",
    blurb: "Street wear con actitud",
    color: "c4",
    subs: ["Camisetas", "Busos y Chaquetas", "Gorras", "Gafas", "Tenis", "Jeans"]
  },
  {
    slug: "accesorios",
    name: "Accesorios",
    blurb: "Detalles que marcan",
    color: "c5",
    subs: ["Herramientas", "Grips", "Pegatinas", "Maletas", "Bombas", "Luces", "Llaveros"]
  },
  {
    slug: "promo",
    name: "Promo",
    blurb: "Ofertas que vuelan",
    color: "c6",
    subs: []
  }
];

/* ------------------------------- Marcas -------------------------------- */
const STIKE_BRANDS = [
  "Total BMX", "Odyssey", "Shadow", "Cult", "Sunday", "Wethepeople",
  "Éclat", "Federal", "Kink", "BSD", "Fly Bikes", "Demolition",
  "SaltPlus", "Stranger", "Mutanty", "Trueno", "Fate BMX Colombia",
  "TSG", "KMC", "Cinema", "GW", "Fade", "Stike", "Smith",
  "Fiend", "Rant", "Subrosa", "Optimus", "Merritt", "Innova", "Primo",
  "R2 Protect", "Valkiria", "Volume", "Profile",
  "Nike", "Oakley", "Primitive", "Vans", "Quiksilver", "Animal", "AC",
  "Circuit BMX", "DCN-CRW", "No Fear", "Helio Brand", "Fox", "Kenda", "Kboom",
  "Nightmare", "Etnies", "XOXO", "Freaak", "S&M Bikes", "Fit Bike Co.",
  "Micos Trails", "Piraña", "Ontrail", "ODI", "Counter", "Colony", "Rhino",
  "Brainstorm", "Tall Order", "Extension", "Alpinestars", "Radio", "Stolen"
];

/* ------------------- Categorias/subcategorias con talla obligatoria -----
   Estas subcategorias muestran en el admin una tabla "talla + stock por
   talla" en vez de un campo de unidades plano. El color (cuando el
   producto tiene 2+ colores reales) es SIEMPRE una segunda tabla
   independiente, sin importar la categoria; ver stikeStockFor().        */
const SIZE_CATEGORIES = new Set([
  "Cascos", "Rodilleras", "Coderas", "Guantes", "Espinilleras", "Tobilleras", // protecciones
  "Camisetas", "Busos y Chaquetas", "Jeans", "Tenis"            // ropa
]);

/* Rango de tallas sugerido al crear un producto en una SIZE_CATEGORIES sub */
function stikeSizeRangeFor(sub) {
  if (sub === "Tenis") return ["38", "39", "40", "41", "42", "43", "44"];
  if (sub === "Camisetas" || sub === "Busos y Chaquetas" || sub === "Jeans") return ["S", "M", "L", "XL", "XXL"];
  if (sub === "Cascos" || sub === "Rodilleras" || sub === "Coderas" || sub === "Guantes" || sub === "Espinilleras" || sub === "Tobilleras") return ["S", "M", "L", "XL"];
  return null;
}

/* --------------------- Codigos para generar SKU ------------------------- */
const SKU_CAT_CODES = { repuestos: "REP", protecciones: "PRO", ropa: "ROP", accesorios: "ACC" };
function skuBrandCode(brand, taken) {
  taken = taken || new Set();
  const letters = (brand || "GEN").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z]/g, "") || "GEN";
  let code = letters.slice(0, 3).padEnd(3, "X");
  let i = 3;
  while (taken.has(code) && i < letters.length + 3) { code = (letters[0] + (letters[i - 2] || "X") + (letters[i - 1] || "X")).slice(0, 3); i++; }
  let n = 2;
  while (taken.has(code)) { code = (letters.slice(0, 2) + n).slice(0, 3); n++; }
  return code;
}

/* --------------------- Generador de imagen SVG (placeholder) ------------ */
/* Solo se usa cuando un producto no tiene foto real. Tratamiento premium
   monocromo: marco, marca de oso al agua y nombre. El acento de color se
   deriva del slug (determinista) en vez de guardarse como campo aparte. */
const STIKE_PALETTE = {
  pink:   ["#ffffff", "#18181b"],
  cyan:   ["#ffffff", "#161619"],
  yellow: ["#ffffff", "#1a1a1d"],
  lime:   ["#ffffff", "#141417"],
  orange: ["#ffffff", "#1c1c20"],
  purple: ["#ffffff", "#121215"]
};
const STIKE_PALETTE_KEYS = Object.keys(STIKE_PALETTE);
function stikeAccentFor(p) {
  const s = (p && (p.slug || p.n)) || "stike";
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return STIKE_PALETTE_KEYS[h % STIKE_PALETTE_KEYS.length];
}

function stikeProductImage(product, size) {
  if (product && product.imgs && product.imgs.length) return product.imgs[0];
  size = size || 600;
  const pal = STIKE_PALETTE[stikeAccentFor(product)];
  const label = (product.brand || "STIKE").toUpperCase();
  const name = (product.n || "").toUpperCase();
  const words = name.split(" ");
  const mid = Math.ceil(words.length / 2);
  const l1 = words.slice(0, mid).join(" ");
  const l2 = words.slice(mid).join(" ");
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 600 600">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${pal[1]}"/>
      <stop offset="1" stop-color="#0a0a0b"/>
    </linearGradient>
  </defs>
  <rect width="600" height="600" fill="url(#g)"/>
  <rect x="22" y="22" width="556" height="556" rx="18" fill="none" stroke="#ffffff" stroke-opacity="0.10"/>
  <!-- marca de oso al agua -->
  <g transform="translate(300,266)" fill="#ffffff" opacity="0.05">
    <circle cx="-86" cy="-78" r="50"/>
    <circle cx="86" cy="-78" r="50"/>
    <ellipse cx="0" cy="8" rx="132" ry="120"/>
  </g>
  <!-- gafas (pista del oso) -->
  <g transform="translate(300,260)" fill="#0a0a0b" opacity="0.45">
    <rect x="-92" y="-8" width="74" height="40" rx="18"/>
    <rect x="18" y="-8" width="74" height="40" rx="18"/>
    <rect x="-22" y="2" width="44" height="14" rx="7"/>
  </g>
  <!-- marca -->
  <text x="46" y="70" font-family="Arial Narrow, Arial, sans-serif" font-weight="700" letter-spacing="4" font-size="24" fill="#ffffff" opacity="0.92">${label}</text>
  <line x1="46" y1="84" x2="150" y2="84" stroke="#ffffff" stroke-opacity="0.5" stroke-width="2"/>
  <!-- nombre -->
  <text x="300" y="500" text-anchor="middle" font-family="Arial Narrow, Arial, sans-serif" font-weight="700" letter-spacing="1" font-size="34" fill="#ffffff" opacity="0.95">${l1}</text>
  <text x="300" y="540" text-anchor="middle" font-family="Arial Narrow, Arial, sans-serif" font-weight="700" letter-spacing="1" font-size="34" fill="#ffffff" opacity="0.6">${l2}</text>
</svg>`.trim();
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

/* Imagen a mostrar para un color concreto (si hay fotos etiquetadas), si no cae al cover */
function stikeImageForColor(p, colorValue) {
  if (colorValue && p.imgColorMap) {
    const hit = (p.imgs || []).find(u => p.imgColorMap[u] === colorValue);
    if (hit) return hit;
  }
  return stikeProductImage(p);
}

/* Helpers de busqueda usados por las paginas */
function stikeFindProduct(slug) { return STIKE_PRODUCTS.find(p => p.slug === slug); }
function stikeByCategory(slug) {
  if (slug === "promo") return STIKE_PRODUCTS.filter(p => p.promo);
  return STIKE_PRODUCTS.filter(p => p.cat === slug);
}
function stikeCategory(slug) { return STIKE_CATEGORIES.find(c => c.slug === slug); }

/* Formato de precio COP */
function stikePrice(n) {
  return "$" + n.toLocaleString("es-CO");
}

/* --------------------------- Tallas y colores ----------------------------
   Tallas y colores son pools de stock INDEPENDIENTES (no una matriz por
   combinacion). Si el producto tiene ambos, la cantidad vendible para una
   combinacion (talla, color) elegida es el minimo de las dos.            */
function stikeSizesFor(p) { return (p && p.sizes) || null; }
function stikeColorsFor(p) { return (p && p.colors) || null; }

function stikePoolStock(pool, value) {
  if (!pool) return null;
  const row = pool.find(r => r.v === value);
  return row ? row.u : 0;
}
function stikePoolTotal(pool) {
  if (!pool) return null;
  return pool.reduce((sum, r) => sum + r.u, 0);
}

/* PRECIO POR VARIANTE (opcional). Una fila de p.sizes o p.colors puede traer
   su propio "price" (COP): es el precio completo de esa opcion, no un
   recargo. p.price es el BASE y tiene que ser el mas bajo ("desde").
   Regla (misma en api/_lib.php, stike_unit_price): el precio del color manda;
   si no, el de la talla/medida; si no, el base. Se usa en la ficha, las
   tarjetas, el carrito, el WhatsApp, el panel y, sobre todo, el servidor, que
   es quien cobra. */
function stikePriceFor(p, size, color) {
  const c = color != null && p.colors ? p.colors.find(r => r.v === color) : null;
  if (c && c.price > 0) return c.price;
  const s = size != null && p.sizes ? p.sizes.find(r => r.v === size) : null;
  if (s && s.price > 0) return s.price;
  return p.price;
}
/* {min, max, varies}: el rango de precios que puede tener el producto. */
function stikePriceRange(p) {
  const all = [p.price];
  (p.colors || []).forEach(r => { if (r.price > 0) all.push(r.price); });
  (p.sizes || []).forEach(r => { if (r.price > 0) all.push(r.price); });
  const min = Math.min.apply(null, all), max = Math.max.apply(null, all);
  return { min: min, max: max, varies: max > min };
}
/* Texto de precio para tarjetas/listas: "Desde $X" si cambia segun la opcion. */
function stikePriceLabel(p) {
  const r = stikePriceRange(p);
  return (r.varies ? "Desde " : "") + stikePrice(r.min);
}

/* COMBINACIONES (opcional): un producto con tallas Y colores puede traer
   p.combos = [{s: talla, c: color, u: unidades}]. Entonces ESA tabla manda
   (una camiseta negra M y una blanca L no se confunden con negra L). Las
   pools p.sizes / p.colors quedan como la suma de cada fila/columna, para
   que todo lo que solo lee totales siga funcionando. */
function stikeHasCombos(p) { return !!(p && p.combos && p.combos.length && p.sizes && p.colors); }
function stikeComboUnits(p, size, color) {
  const row = (p.combos || []).find(r => r.s === size && r.c === color);
  return row ? Math.max(0, row.u || 0) : 0;
}

/* Stock vendible real para la seleccion actual (talla y/o color elegidos) */
function stikeStockFor(p, size, color) {
  if (stikeHasCombos(p)) {
    if (size == null || color == null) return null;
    return stikeComboUnits(p, size, color);
  }
  const sizeStock = p.sizes ? stikePoolStock(p.sizes, size) : null;
  const colorStock = p.colors ? stikePoolStock(p.colors, color) : null;
  if (p.sizes && p.colors) {
    if (size == null || color == null) return null; // falta elegir una de las dos
    return Math.min(sizeStock, colorStock);
  }
  if (p.sizes) return size == null ? null : sizeStock;
  if (p.colors) return color == null ? null : colorStock;
  return typeof p.units === "number" ? p.units : 0;
}

/* =========================================================================
   MOTOR DE STOCK Y VISIBILIDAD DE STIKE

   Estas cuatro funciones deciden que se puede vender y que se ve en el
   sitio. Viven aca, en data.js, y NO en products-data.js a proposito: el
   panel reescribe products-data.js completo en cada publicacion, asi que
   cualquier regla que viviera ahi se borraria sola.

   Son la unica fuente: assets/js/pdp-render.js las consume en vez de tener
   su propia copia (antes tenia una, y dos copias de la misma regla es la
   forma mas confiable de que un dia digan cosas distintas).

   Las tres reglas propias de Stike, y por que:

   1. DESCONOCIDO NO ES CERO. Un producto al que todavia no le registraron
      unidades no esta agotado: no sabemos cuanto hay. Antes se trataba
      como 0 y el sitio le ponia "Agotado" a mercancia que estaba en la
      vitrina fisica.

   2. STOCK POR COMBINACION MINIMA. Talla y color son dos bodegas
      independientes, no una matriz. Una camiseta M negra se puede vender
      hasta min(stock de M, stock de negro). Sumar las pools mentiria:
      diria "hay 4" cuando hay 4 repartidas en tallas que nadie pidio.

   3. EL AGOTADO NO DESAPARECE. isVisible solo esconde borradores. Un
      agotado se queda publicado, marcado OutOfStock, y su ficha ofrece
      avisar por WhatsApp cuando vuelva: conserva el posicionamiento que
      ya gano en Google y convierte la visita en un contacto en vez de un
      rebote. Vuelve a la venta solo cuando suben el stock, sin que nadie
      toque nada.
   ========================================================================= */

/* Suma cruda de una pool. Para el panel, que muestra el inventario tal
   como esta guardado; no para decidir si algo se puede vender. */
function stikeTotalStock(p) {
  if (stikeHasCombos(p)) return p.combos.reduce((n, r) => n + Math.max(0, r.u || 0), 0);
  const sizeTotal = p.sizes ? stikePoolTotal(p.sizes) : null;
  const colorTotal = p.colors ? stikePoolTotal(p.colors) : null;
  if (sizeTotal != null && colorTotal != null) return Math.min(sizeTotal, colorTotal);
  if (sizeTotal != null) return sizeTotal;
  if (colorTotal != null) return colorTotal;
  return typeof p.units === "number" ? p.units : 0;
}

/* Cuanto se puede vender AHORA, en la mejor combinacion disponible.
   Devuelve null cuando no hay stock registrado ("no sabemos"), que es
   distinto de 0 ("sabemos que no hay"). */
function stikeSellable(p) {
  if (!p) return null;
  const sizes = p.sizes && p.sizes.length ? p.sizes : null;
  const colors = p.colors && p.colors.length ? p.colors : null;

  if (stikeHasCombos(p)) return Math.max(0, ...p.combos.map(r => r.u || 0));
  if (sizes && colors) {
    /* Dos bodegas: la mejor combinacion posible es el mejor de los minimos.
       Con S=0 y negro=5, la talla S no se puede vender aunque haya negro. */
    let best = 0;
    for (const s of sizes) for (const c of colors) best = Math.max(best, Math.min(s.u || 0, c.u || 0));
    return best;
  }
  if (sizes) return Math.max(0, ...sizes.map(s => s.u || 0));
  if (colors) return Math.max(0, ...colors.map(c => c.u || 0));
  return typeof p.units === "number" ? p.units : null;   // null = sin registrar
}

/* true SOLO si sabemos con certeza que no hay nada vendible. */
function stikeIsOut(p) {
  const n = stikeSellable(p);
  return n !== null && n <= 0;
}

/* Que puede mostrar el sitio. Un borrador no; un agotado si. */
function stikeIsVisible(p) {
  return !!p && p.published !== false;
}

/* Nombre viejo, mismo significado. Se conserva porque lo llaman las
   tarjetas de la vitrina y el carrito. */
function stikeIsOutOfStock(p) { return stikeIsOut(p); }

/* ============================== RECOMENDACIONES ===========================
   Motor de "tambien te puede gustar" / cross-sell con reglas de prioridad
   explicitas -- antes era "mismo cat (repuestos/ropa), los primeros 3", que
   no distinguia ni marca ni tipo de pieza real.

     1. Misma marca + (mismo sub, o un sub que arma el build con el actual
        -- ej. una caña Fiend sugiere timones y tenedores Fiend).
     2. Misma marca + misma medida (compatibilidad real: mismo diametro,
        dientes o rosca), si el nivel 1 no llena el cupo.
     3. Mismo sub, cualquier marca (relleno).
     4. Cualquier producto disponible (ultimo recurso, la seccion nunca
        queda vacia).

   Se excluye el producto actual y todo lo agotado, en cada nivel. */
var STIKE_RELATED_SUB_MAP = {
  "Espigas": ["Timones", "Tenedores", "Sillas y Postes"],
  "Tenedores": ["Espigas", "Timones", "Rines"],
  "Bielas": ["Platos", "Pedales", "Cadenas"],
  "Platos": ["Bielas", "Cadenas"],
  "Cadenas": ["Platos", "Bielas"],
  "Manzanas": ["Rines", "Tacos y Protectores de Maza"],
  "Tacos y Protectores de Maza": ["Manzanas", "Rines"],
  "Rines": ["Llantas", "Manzanas", "Tacos y Protectores de Maza"],
  "Llantas": ["Rines"],
  "Timones": ["Espigas", "Grips", "Manubrios"],
  "Manubrios": ["Timones", "Grips"],
  "Grips": ["Timones", "Manubrios"],
  "Frenos": ["Timones", "Rines"],
  "Marcos": ["Tenedores", "Bielas"],
  "Sillas y Postes": ["Espigas"],
  "Pedales": ["Bielas"],
};

/* Medidas (diametro/dientes/rosca) salen del nombre o del slug -- en este
   catalogo siempre quedan ahi (ej. "20mm", "25T", "M25"), no en spec[] con
   una clave consistente entre subcategorias. No cubre medidas en pulgadas
   (ej. los timones usan 9" - 9.25" x 27.25") -- esos caen al nivel 3. */
function stikeMeasureTokens(p) {
  var text = (p.n + " " + p.slug).toLowerCase();
  var out = {};
  (text.match(/\d+(\.\d+)?\s?mm/g) || []).forEach(function (m) { out[m.replace(/\s/g, "")] = true; });
  (text.match(/\b\d{2,3}t\b/g) || []).forEach(function (m) { out[m] = true; });
  (text.match(/\bm\d{2}\b/g) || []).forEach(function (m) { out[m] = true; });
  return out;
}
function stikeShareMeasure(a, b) {
  var i, keys = Object.keys(a);
  for (i = 0; i < keys.length; i++) if (b[keys[i]]) return true;
  return false;
}

function stikeRelatedProducts(p, limit) {
  limit = limit || 4;
  var pool = STIKE_PRODUCTS.filter(function (x) { return x.slug !== p.slug && !stikeIsOut(x) && stikeIsVisible(x); });
  var picked = [], seen = {};
  function add(list) {
    for (var i = 0; i < list.length && picked.length < limit; i++) {
      var x = list[i];
      if (seen[x.slug]) continue;
      seen[x.slug] = true;
      picked.push(x);
    }
  }

  // Nivel 1: misma marca + (mismo sub primero, luego subs complementarios)
  var complementSubs = STIKE_RELATED_SUB_MAP[p.sub] || [];
  var tier1 = pool.filter(function (x) { return x.brand === p.brand && (x.sub === p.sub || complementSubs.indexOf(x.sub) !== -1); });
  tier1.sort(function (a, b) { return (a.sub === p.sub ? 0 : 1) - (b.sub === p.sub ? 0 : 1); });
  add(tier1);

  // Nivel 2: misma marca + misma medida
  if (picked.length < limit) {
    var myMeasures = stikeMeasureTokens(p);
    if (Object.keys(myMeasures).length) {
      var tier2 = pool.filter(function (x) { return x.brand === p.brand && stikeShareMeasure(myMeasures, stikeMeasureTokens(x)); });
      add(tier2);
    }
  }

  // Nivel 3: mismo sub, cualquier marca
  if (picked.length < limit) add(pool.filter(function (x) { return x.sub === p.sub; }));

  // Nivel 4: cualquier producto disponible
  if (picked.length < limit) add(pool);

  return picked.slice(0, limit);
}

/* El texto del mensaje de WhatsApp de una ficha de producto.
   Vive aca porque lo necesitan DOS lados: pdp-render.js lo hornea en el
   HTML (para quien llega con JavaScript apagado o lento) y pdp.js lo
   reescribe cuando el cliente elige talla o color. Cuando cada uno tenia su
   propia redaccion, cambiar el saludo en uno dejaba el otro viejo.

   Si el producto esta agotado el mensaje cambia de "quiero comprar" a
   "avisame cuando llegue": la ficha sigue publicada, asi que la visita se
   convierte en un contacto en vez de un rebote. */
function stikeWaText(p, opts) {
  opts = opts || {};
  const bits = [];
  if (opts.size) bits.push(String((p && p.sizeLabel) || "talla").toLowerCase() + " " + opts.size);
  if (opts.color) bits.push("color " + opts.color);
  const variant = bits.length ? " (" + bits.join(", ") + ")" : "";
  const name = opts.shortName || "Stike";
  const range = stikePriceRange(p);
  const priceTxt = range.varies && opts.size == null && opts.color == null
    ? "desde " + stikePrice(range.min) : stikePrice(stikePriceFor(p, opts.size, opts.color));
  return stikeIsOut(p)
    ? `Hola ${name}! ${p.n}${variant} está agotado, ¿me avisas cuando vuelva?`
    : `Hola ${name}! Me interesa: ${p.n}${variant} (${priceTxt}). ¿Está disponible?`;
}

/* La etiqueta del boton, que tiene que ir a juego con el mensaje. */
function stikeWaLabel(p) {
  return stikeIsOut(p) ? "Avísame cuando llegue" : "Comprar por WhatsApp";
}

/* ---------------------------- Colores redondos ----------------------------
   El selector de color NO muestra la palabra: es un circulo del color. Se
   deduce del NOMBRE del color guardado (por palabras clave, asi "Negro
   brillante", "Negra" y "Black" caen en el mismo tono). Un color de dos
   tonos ("Azul/Rojo") sale partido en dos mitades. Si el nombre no se
   reconoce sale gris con un aviso en consola (nunca un circulo vacio). */
const STIKE_COLOR_HEX = [
  [/cromad|chrome|plata|silver/, "linear-gradient(135deg,#f4f5f6 0%,#9ea3a8 45%,#eceef0 60%,#7d8388 100%)"],
  [/dorad|gold|oro(?! rosa)/, "linear-gradient(135deg,#f6dd7a,#c99a1c 55%,#f0cf62)"],
  [/oro rosa|rose/, "linear-gradient(135deg,#f4cfc2,#c98b7a)"],
  [/tornasol|iridisc|holograf/, "conic-gradient(#7be0d8,#c79bf2,#f5a8c9,#f6e58a,#7be0d8)"],
  [/camuflad|camo/, "radial-gradient(circle at 30% 30%,#6b7a4a 0 28%,#3e4a2c 30% 55%,#8a7a52 57% 80%,#2b3320 82%)"],
  [/aguamarina|turquesa|aqua/, "#2ec4b6"],
  [/negr|black/, "#16171a"],
  [/blanc|white|perla|crema/, "#f3f1ec"],
  [/roj|red|corsa|vinotint/, "#d4202c"],
  [/azul|blue/, "#2563c9"],
  [/verde|green|oliva|militar/, "#2f9e4f"],
  [/morad|purpura|púrpura|lila|violet/, "#7a3fc4"],
  [/rosad|rosa|fucsia|fuscia|pink/, "#e86aa6"],
  [/amarill|yellow/, "#f2c21b"],
  [/naranj|orange|anaranjad/, "#f07a1a"],
  [/gris|gray|grey/, "#8b9096"],
  [/caf[eé]|marr[oó]n|chocolate|brown/, "#6b4a2f"],
  [/beige|arena|crema/, "#d9c7a3"],
];
function stikeColorOne(name) {
  const n = String(name || "").toLowerCase();
  for (const [re, css] of STIKE_COLOR_HEX) if (re.test(n)) return css;
  if (typeof console !== "undefined") console.warn("[stike] color sin tono definido:", name);
  return "#9aa0a6";
}
/* Un tono plano (el primer color de un degradado), para las mitades. */
function stikeColorSolid(name) {
  const css = stikeColorOne(name);
  const m = css.match(/#[0-9a-f]{3,6}/i);
  return m ? m[0] : "#9aa0a6";
}
/* Valor CSS de "background" para un nombre de color (una o dos mitades). */
function stikeColorStyle(name) {
  const parts = String(name || "").split(/\s*\/\s*|\s+y\s+/i).filter(Boolean);   // "Azul/Rojo" y "Beige y negro": dos mitades
  if (parts.length >= 2) return `linear-gradient(90deg,${stikeColorSolid(parts[0])} 0 50%,${stikeColorSolid(parts[1])} 50% 100%)`;
  return stikeColorOne(name);
}
/* Circulo de color: sin texto visible; el nombre queda para lectores de
   pantalla (aria-label) y el hover. */
function stikeColorDot(c, extra) {
  return `<span class="cdot${c.u <= 0 ? " out" : ""}" style="background:${stikeColorStyle(c.v)}" role="img" aria-label="${String(c.v).replace(/"/g, "&quot;")}"${extra || ""}></span>`;
}

/* Etiqueta corta para tarjetas: tallas en texto, colores en circulos */
function stikeVariantChips(p) {
  const parts = [];
  if (p.sizes) parts.push(`<div class="swatch-row">${p.sizes.map(s => `<span class="swatch${s.u <= 0 ? " out" : ""}">${s.v}</span>`).join("")}</div>`);
  if (p.colors) parts.push(`<div class="swatch-row dots">${p.colors.map(c => stikeColorDot(c)).join("")}</div>`);
  return parts.join("");
}

/* =========================================================================
   CATALOGO VISIBLE

   Un borrador (published: false) no se ve en el sitio. En vez de repetir el
   filtro en las ~30 vitrinas que leen el catalogo (tienda, las 23 landings
   de parte, home, fate, buscador, relacionados, carrito, el configurador),
   se filtra UNA vez aca: data.js carga siempre justo despues de
   products-data.js, antes que cualquier pagina lea nada.

   El catalogo crudo queda en STIKE_ALL_PRODUCTS, que es lo que necesita el
   panel de administracion: ahi si hay que ver los borradores, marcados
   como tales.
   ========================================================================= */
/* El sitio corre esto en el navegador; tools/build-pages.mjs lo corre en
   Node, donde no hay window. Un solo nombre para el global de los dos. */
const STIKE_GLOBAL = typeof window !== "undefined" ? window : globalThis;

STIKE_GLOBAL.STIKE_ALL_PRODUCTS = STIKE_GLOBAL.STIKE_PRODUCTS || [];
STIKE_GLOBAL.STIKE_PRODUCTS = STIKE_GLOBAL.STIKE_ALL_PRODUCTS.filter(stikeIsVisible);

/* Part types that have their own landing page (categoria/<slug>.html). */
STIKE_GLOBAL.STIKE_PART_PAGES = ["bielas","bombas","busos-y-chaquetas","cadenas","camisetas","cascos","espigas","espinilleras","frenos","gafas","gorras","grips","guantes","herramientas","llantas","llaveros","manubrios","manzanas","marcos","pedales","platos","rines","rodilleras","sillas-y-postes","tacos-y-protectores-de-maza","tenedores","tenis","timones","tobilleras"];
/* Marcas con pagina propia (marca/<slug>.html): lo escribe tools/build-seo.mjs. */
STIKE_GLOBAL.STIKE_BRAND_PAGES = {"Animal":"marca/animal.html","Brainstorm":"marca/brainstorm.html","BSD":"marca/bsd.html","Cinema":"marca/cinema.html","Cult":"marca/cult.html","Demolition":"marca/demolition.html","Éclat":"marca/eclat.html","Federal":"marca/federal.html","Fiend":"marca/fiend.html","Fit Bike Co.":"marca/fit-bike-co.html","Fox":"marca/fox.html","GW":"marca/gw.html","Helio Brand":"marca/helio-brand.html","Innova":"marca/innova.html","Kink":"marca/kink.html","Merritt":"marca/merritt.html","Mutanty":"marca/mutanty.html","Nightmare":"marca/nightmare.html","Nike":"marca/nike.html","ODI":"marca/odi.html","Odyssey":"marca/odyssey.html","Optimus":"marca/optimus.html","Primitive":"marca/primitive.html","Primo":"marca/primo.html","Profile":"marca/profile.html","R2 Protect":"marca/r2-protect.html","Rant":"marca/rant.html","S&M Bikes":"marca/s-m-bikes.html","Shadow":"marca/shadow.html","Stranger":"marca/stranger.html","Subrosa":"marca/subrosa.html","Sunday":"marca/sunday.html","Total BMX":"marca/total-bmx.html","Trueno":"marca/trueno.html","Vans":"marca/vans.html","Wethepeople":"marca/wethepeople.html","XOXO":"marca/xoxo.html"};

/* Doble export: el sitio lo carga con <script>, y tools/build-pages.mjs lo
   consume desde Node para generar las fichas con exactamente estas reglas. */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    STIKE_CATEGORIES, STIKE_BRANDS, SIZE_CATEGORIES, SKU_CAT_CODES,
    stikeTotalStock, stikeSellable, stikeIsOut, stikeIsVisible, stikeIsOutOfStock,
    stikeStockFor, stikePoolStock, stikePoolTotal, stikeCategory, stikePrice,
    stikeWaText, stikeWaLabel, stikeColorStyle, stikeHasCombos, stikeComboUnits, stikePriceFor, stikePriceRange, stikePriceLabel,
  };
}
