/* Espejo de api/wompi-status.php -- ver wompi-sign.js para el contexto. */
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

  const id = req.query.id;
  if (!id) return res.status(400).json({ error: "missing_id" });

  const privateKey = process.env.WOMPI_PRIVATE_KEY;
  if (!privateKey) return res.status(500).json({ error: "server_misconfigured" });

  const base = privateKey.startsWith("prv_prod_")
    ? "https://production.wompi.co/v1"
    : "https://sandbox.wompi.co/v1";

  try {
    const r = await fetch(`${base}/transactions/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${privateKey}` },
    });
    const data = await r.json().catch(() => null);
    res.status(r.status).json(data);
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
};
