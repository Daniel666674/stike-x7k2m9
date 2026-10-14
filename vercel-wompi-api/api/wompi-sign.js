/* =========================================================================
   STIKE BIKE SHOP: backend en Vercel que firma el cobro de Wompi (GitHub
   Pages, donde vive el sitio, no corre PHP). Espejo de api/wompi-sign.php.

   El navegador manda { reference, items: [{ slug, qty }] } y NUNCA un monto:
   el monto lo calcula este servidor con los precios del catalogo publicado
   (lib/pricing.js) y es ese el que se firma y el que se devuelve. Cualquier
   amount_in_cents que llegue en la peticion se ignora a proposito.
   ========================================================================= */
const crypto = require("crypto");
const { setCors } = require("../lib/cors");
const { fetchCatalog, priceOrder, PricingError } = require("../lib/pricing");

const CURRENCY = "COP";
const REFERENCE_RE = /^[A-Za-z0-9_-]{8,64}$/;

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch { return null; }
}

module.exports = async (req, res) => {
  setCors(req, res, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const body = readBody(req);
  if (!body) return res.status(400).json({ error: "invalid_json" });
  const { reference, items } = body;
  if (typeof reference !== "string" || !REFERENCE_RE.test(reference)) {
    return res.status(400).json({ error: "invalid_reference" });
  }

  const secret = process.env.WOMPI_INTEGRITY_SECRET;
  if (!secret) return res.status(500).json({ error: "server_misconfigured" });

  let priced;
  try {
    priced = priceOrder(await fetchCatalog(), items);
  } catch (err) {
    if (err instanceof PricingError && err.code.startsWith("catalog_")) {
      return res.status(502).json({ error: err.code });
    }
    if (err instanceof PricingError) {
      return res.status(400).json({ error: err.code, detail: err.message });
    }
    return res.status(500).json({ error: "pricing_failed" });
  }

  const signature = crypto
    .createHash("sha256")
    .update(`${reference}${priced.amountInCents}${CURRENCY}${secret}`)
    .digest("hex");

  res.status(200).json({
    reference,
    amount_in_cents: priced.amountInCents,
    currency: CURRENCY,
    signature,
    subtotal: priced.subtotal,
    shipping: priced.shipping,
    total: priced.total,
  });
};
