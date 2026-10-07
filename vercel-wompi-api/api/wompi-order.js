/* =========================================================================
   STIKE BIKE SHOP: registra en data/sales-log.json (el mismo log que lee
   el panel admin, pestana Ventas) lo que de verdad se compro con Wompi.

   Por que existe: Wompi solo sabe "referencia X, $Y, APPROVED" -- nunca
   conoce el catalogo, asi que es el UNICO lugar que puede decir que
   productos se vendieron. El navegador del cliente nos manda el carrito,
   pero nunca confiamos ciegamente en eso:

     1. Volvemos a consultar la transaccion directo con Wompi (con la
        llave PRIVADA, server-side) y exigimos APPROVED + que la
        referencia coincida. Si alguien llama este endpoint a mano sin
        haber pagado, no pasa nada.
     2. El nombre y el precio de cada producto salen del catalogo real
        publicado (products-data.js), nunca de lo que mande el navegador
        -- as the client could lie about the price.
     3. Idempotente por "reference": si Wompi reintenta el webhook o el
        cliente recarga pago-resultado.html, no se duplica la venta.

   El token de GitHub (GH_SALES_TOKEN) vive SOLO en las variables de
   entorno de este proyecto en Vercel. Nunca se expone al navegador y
   nunca se commitea -- tiene permiso de escritura sobre el repo, asi que
   si se filtra hay que revocarlo de inmediato en GitHub.
   ========================================================================= */

const REPO_OWNER = "Daniel666674";
const REPO_NAME = "stike-x7k2m9";
const REPO_BRANCH = "claude/sweet-albattani-ti0w0e";
const SALES_LOG_PATH = "data/sales-log.json";
const CATALOG_URL = "https://daniel666674.github.io/stike-x7k2m9/assets/js/products-data.js";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function fetchCatalog() {
  const res = await fetch(CATALOG_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`catalog_fetch_${res.status}`);
  const text = await res.text();
  const marker = "window.STIKE_PRODUCTS = ";
  const i = text.indexOf(marker);
  if (i < 0) throw new Error("catalog_parse_failed");
  const body = text.slice(i + marker.length, text.lastIndexOf(";"));
  return JSON.parse(body);
}

async function verifyWompiTransaction(wompiId, privateKey) {
  const base = privateKey.startsWith("prv_prod_")
    ? "https://production.wompi.co/v1"
    : "https://sandbox.wompi.co/v1";
  const res = await fetch(`${base}/transactions/${encodeURIComponent(wompiId)}`, {
    headers: { Authorization: `Bearer ${privateKey}` },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || !body.data) throw new Error(`wompi_verify_${res.status}`);
  return body.data;
}

async function ghGetFile(token, path) {
  const res = await fetch(
    `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}?ref=${REPO_BRANCH}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } }
  );
  if (res.status === 404) return { sha: null, data: [] };
  if (!res.ok) throw new Error(`github_get_${res.status}`);
  const meta = await res.json();
  const text = Buffer.from(meta.content, "base64").toString("utf-8");
  return { sha: meta.sha, data: JSON.parse(text || "[]") };
}

async function ghPutFile(token, path, dataArr, sha, message) {
  const content = Buffer.from(JSON.stringify(dataArr, null, 2) + "\n", "utf-8").toString("base64");
  const res = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message, content, branch: REPO_BRANCH, sha: sha || undefined }),
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    const err = new Error(`github_put_${res.status}: ${bodyText}`);
    err.conflict = res.status === 409 || res.status === 422;
    throw err;
  }
  return res.json();
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const { reference, wompiId, items, customerEmail } = body;
  if (!reference || !wompiId || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: "missing_or_invalid_fields" });
  }

  const ghToken = process.env.GH_SALES_TOKEN;
  const privateKey = process.env.WOMPI_PRIVATE_KEY;
  if (!ghToken || !privateKey) return res.status(500).json({ error: "server_misconfigured" });

  let txn;
  try {
    txn = await verifyWompiTransaction(wompiId, privateKey);
  } catch (err) {
    return res.status(502).json({ error: "wompi_verify_failed", detail: String(err.message || err) });
  }
  if (txn.status !== "APPROVED" || txn.reference !== reference) {
    return res.status(400).json({ error: "transaction_not_approved" });
  }

  let catalog;
  try {
    catalog = await fetchCatalog();
  } catch (err) {
    return res.status(502).json({ error: "catalog_fetch_failed", detail: String(err.message || err) });
  }

  const ts = new Date().toISOString();
  const adminTag = `Wompi (ref ${reference})`;
  const entries = items
    .map(it => {
      const p = catalog.find(x => x.slug === it.slug);
      if (!p) return null;
      const qty = Math.max(1, parseInt(it.qty) || 1);
      return {
        ts, slug: p.slug, name: p.n,
        size: it.size || null, color: it.color || null,
        qty, unitPrice: p.price, total: p.price * qty,
        admin: adminTag,
        source: "wompi", orderRef: reference, wompiId,
        customerEmail: customerEmail || txn.customer_email || null,
      };
    })
    .filter(Boolean);

  if (!entries.length) return res.status(400).json({ error: "no_matching_products" });

  for (let attempt = 1; attempt <= 4; attempt++) {
    let sha, data;
    try {
      ({ sha, data } = await ghGetFile(ghToken, SALES_LOG_PATH));
    } catch (err) {
      return res.status(502).json({ error: "github_read_failed", detail: String(err.message || err) });
    }

    if (data.some(e => e.orderRef === reference)) {
      return res.status(200).json({ ok: true, alreadyRecorded: true });
    }

    try {
      await ghPutFile(
        ghToken, SALES_LOG_PATH, data.concat(entries), sha,
        `Venta Wompi: ${entries.length} linea(s), ref ${reference}`
      );
      return res.status(200).json({ ok: true, recorded: entries.length });
    } catch (err) {
      if (err.conflict && attempt < 4) {
        await new Promise(r => setTimeout(r, 300 * attempt));
        continue;
      }
      return res.status(502).json({ error: "github_write_failed", detail: String(err.message || err) });
    }
  }
};
