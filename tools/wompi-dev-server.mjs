#!/usr/bin/env node
/* =========================================================================
   STIKE BIKE SHOP: server local que sirve el sitio estatico Y responde en
   las mismas rutas que van a vivir en Hostinger (/api/wompi-sign.php,
   /api/wompi-status.php), para probar el flujo completo de Wompi contra
   el sandbox real sin tener que subir nada a produccion todavia.

   Uso:
     node tools/wompi-dev-server.mjs [puerto=8139]

   Sirve el repo bajo el mismo BASE_PATH que el sitio real (assets/js/site.js)
   para que <base href> no rompa las rutas relativas.
   ========================================================================= */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { loadEnv, signWompiTransaction } from "./wompi-sign.mjs";
import { fetchWompiTransaction } from "./wompi-status.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Mismo calculo de precio que corre en Vercel (y que espeja el PHP).
const { parseCatalog, priceOrder, PricingError } = createRequire(import.meta.url)("../vercel-wompi-api/lib/pricing.js");
const PORT = Number(process.argv[2]) || 8139;
// Misma ruta base que el sitio real (assets/js/site.js): "" en stikebikeshop.com.
const BASE = createRequire(import.meta.url)("../assets/js/site.js").basePath.replace(/\/$/, "");

const env = loadEnv();

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2",
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", c => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = decodeURIComponent(url.pathname);

  // --- /api/wompi-sign.php (espejo de api/wompi-sign.php) ---
  if (pathname === "/api/wompi-sign.php" && req.method === "POST") {
    try {
      const body = JSON.parse(await readBody(req));
      const { reference, items } = body;
      if (!reference) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_reference" }));
        return;
      }
      const catalog = parseCatalog(fs.readFileSync(path.join(ROOT, "assets/js/products-data.js"), "utf8"));
      const priced = priceOrder(catalog, items);   // el monto SIEMPRE lo calcula el servidor
      const signature = signWompiTransaction({ reference, amountInCents: priced.amountInCents, currency: "COP", integritySecret: env.WOMPI_INTEGRITY_SECRET });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        reference, amount_in_cents: priced.amountInCents, currency: "COP", signature,
        subtotal: priced.subtotal, shipping: priced.shipping, total: priced.total,
      }));
    } catch (err) {
      res.writeHead(err instanceof PricingError ? 400 : 500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.code || String(err.message || err) }));
    }
    return;
  }

  // --- /api/wompi-status.php (espejo de api/wompi-status.php) ---
  if (pathname === "/api/wompi-status.php" && req.method === "GET") {
    const id = url.searchParams.get("id");
    if (!id) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "missing_id" }));
      return;
    }
    try {
      const data = await fetchWompiTransaction(id, env.WOMPI_PRIVATE_KEY);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(err.status || 502, { "Content-Type": "application/json" });
      res.end(JSON.stringify(err.body || { error: String(err.message || err) }));
    }
    return;
  }

  // --- archivos estaticos bajo /stike-x7k2m9/... ---
  if (!pathname.startsWith(BASE)) {
    res.writeHead(404);
    res.end("not found (esperaba rutas bajo " + BASE + ")");
    return;
  }
  let rel = pathname.slice(BASE.length) || "/";
  if (rel.endsWith("/")) rel += "index.html";
  const filePath = path.join(ROOT, rel);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("not found: " + rel);
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`wompi-dev-server en http://localhost:${PORT}${BASE}/`);
});
