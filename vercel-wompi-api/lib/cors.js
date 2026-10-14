/* =========================================================================
   CORS de las funciones. Con ALLOWED_ORIGINS vacio responde "*" (sandbox y
   pruebas). Para produccion, en las variables de entorno de Vercel:

     ALLOWED_ORIGINS=https://stikebikeshop.com,https://www.stikebikeshop.com

   y solo esos origenes pueden llamar la API desde un navegador. Ojo: CORS
   no protege contra quien llama con curl; lo que protege el cobro es que el
   monto lo calcula el servidor (lib/pricing.js).
   ========================================================================= */
function setCors(req, res, methods) {
  const allowed = (process.env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  if (allowed.length === 0) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else {
    res.setHeader("Vary", "Origin");
    const origin = req.headers && req.headers.origin;
    if (origin && allowed.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

module.exports = { setCors };
