/* =========================================================================
   STIKE BIKE SHOP: precio del pedido calculado EN EL SERVIDOR.

   Por que existe: wompi-sign firma el monto que va a cobrar Wompi. Antes
   firmaba el monto que mandaba el navegador, asi que cualquiera con las
   herramientas del navegador podia pagar $1 por un marco de $1.850.000 --
   la firma salia valida porque el servidor firmaba lo que le pedian.

   Ahora el navegador solo manda QUE quiere comprar (slug + cantidad) y el
   servidor calcula el monto con los precios del catalogo publicado
   (assets/js/products-data.js). Cualquier precio, total o monto que venga
   en la peticion se ignora.

   Las dos constantes de envio replican las de carrito.html (FREE_SHIP y
   SHIP_COST). Si se cambian alla, cambiarlas aca: el carrito compara su
   total con el del servidor y, si no coinciden, frena el pago antes de
   abrir Wompi (mejor un aviso que un cobro distinto al que el cliente vio).

   Sin dependencias, CommonJS: lo usan las funciones de Vercel, el servidor
   local de pruebas (tools/wompi-dev-server.mjs) y tools/wompi-pricing-test.mjs.
   ========================================================================= */

const FREE_SHIP = 300000;   // pesos: desde este subtotal el envio es gratis
const SHIP_COST = 18000;    // pesos
const MAX_LINES = 50;       // lineas distintas por pedido
const MAX_QTY = 20;         // unidades por linea

const DEFAULT_CATALOG_URL = "https://daniel666674.github.io/stike-x7k2m9/assets/js/products-data.js";

class PricingError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

/* products-data.js es JS plano: "window.STIKE_PRODUCTS = [ ... ];" */
function parseCatalog(text) {
  const marker = "window.STIKE_PRODUCTS = ";
  const i = text.indexOf(marker);
  if (i < 0) throw new PricingError("catalog_parse_failed");
  const body = text.slice(i + marker.length, text.lastIndexOf(";"));
  let catalog;
  try { catalog = JSON.parse(body); }
  catch { throw new PricingError("catalog_parse_failed"); }
  if (!Array.isArray(catalog)) throw new PricingError("catalog_parse_failed");
  return catalog;
}

async function fetchCatalog(url) {
  const res = await fetch(url || process.env.CATALOG_URL || DEFAULT_CATALOG_URL, { cache: "no-store" });
  if (!res.ok) throw new PricingError("catalog_fetch_failed", String(res.status));
  return parseCatalog(await res.text());
}

/* items: [{ slug, qty, ...ignorado }]. Devuelve montos en PESOS enteros.
   Lanza PricingError con un code estable si algo no cuadra. */
function priceOrder(catalog, items) {
  if (!Array.isArray(items) || items.length === 0) throw new PricingError("empty_order");
  if (items.length > MAX_LINES) throw new PricingError("too_many_lines");

  const bySlug = new Map(catalog.map(p => [p.slug, p]));
  let subtotal = 0;
  const lines = items.map(it => {
    const slug = it && it.slug;
    const qty = it && it.qty;
    if (typeof slug !== "string" || !slug) throw new PricingError("invalid_item");
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) throw new PricingError("invalid_qty", slug);
    const p = bySlug.get(slug);
    if (!p || p.published === false) throw new PricingError("unknown_product", slug);
    if (!Number.isInteger(p.price) || p.price <= 0) throw new PricingError("product_without_price", slug);
    const total = p.price * qty;
    subtotal += total;
    return { slug, name: p.n, qty, unitPrice: p.price, total };
  });

  const shipping = subtotal >= FREE_SHIP ? 0 : SHIP_COST;
  const total = subtotal + shipping;
  return { lines, subtotal, shipping, total, amountInCents: total * 100 };
}

module.exports = { FREE_SHIP, SHIP_COST, MAX_LINES, MAX_QTY, PricingError, parseCatalog, fetchCatalog, priceOrder };
