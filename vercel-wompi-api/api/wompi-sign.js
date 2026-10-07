/* =========================================================================
   STIKE BIKE SHOP: backend temporal en Vercel para probar el flujo real de
   Wompi mientras GitHub Pages (el sitio en vivo) no corre PHP. Espejo de
   api/wompi-sign.php y tools/wompi-sign.mjs en el repo principal -- cuando
   exista Hostinger, esta carpeta se borra y el sitio vuelve a usar el PHP.
   ========================================================================= */
const crypto = require("crypto");

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

module.exports = (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const { reference, amount_in_cents: amountInCents, currency } = body;
  if (!reference || !amountInCents || !currency) {
    return res.status(400).json({ error: "missing_or_invalid_fields" });
  }

  const secret = process.env.WOMPI_INTEGRITY_SECRET;
  if (!secret) return res.status(500).json({ error: "server_misconfigured" });

  const signature = crypto
    .createHash("sha256")
    .update(`${reference}${amountInCents}${currency}${secret}`)
    .digest("hex");

  res.status(200).json({ reference, amount_in_cents: amountInCents, currency, signature });
};
