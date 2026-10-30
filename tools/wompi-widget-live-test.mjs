/* =========================================================================
   Prueba REAL del boton "Pagar ahora" contra el sandbox de Wompi.

   Abre carrito.html con la MISMA politica de seguridad (CSP) que el servidor,
   llena el envio, toca "Pagar ahora" y mira que:
     - el widget de Wompi cargue y abra su ventana (nada lo bloquea),
     - no haya violaciones de CSP ni errores de JavaScript,
     - la firma que mandamos sea la que Wompi espera.

   Usa la llave publica de DEMOSTRACION que Wompi publica en su documentacion
   (pub_test_Q5yDA9xoKdePzhSGeVe9HAez7HgGORGf, del comercio "Tienda Wompi").
   Como no conocemos el secreto de integridad de ESE comercio, firmamos con uno
   inventado: lo normal es que Wompi conteste "La firma es invalida" y eso
   confirma que todo lo demas (carga, CSP, datos) funciona. No cobra nada.

     python3 -m http.server 8143   (en la raiz del repo)
     node tools/wompi-widget-live-test.mjs
   ========================================================================= */
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import fs from "node:fs";
const require = createRequire(process.env.PW_MODULES || "/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const B = "http://localhost:8143";
const PUB = "pub_test_Q5yDA9xoKdePzhSGeVe9HAez7HgGORGf";
const FAKE_SECRET = "test_integrity_secreto_inventado_para_la_prueba";
let fail = 0;
const t = (l, ok, x = "") => { if (!ok) fail++; console.log((ok ? "ok    " : "FALLA ") + l + (ok ? "" : "  -> " + x)); };

const csp = (fs.readFileSync(".htaccess", "utf8").match(/Header set Content-Security-Policy "([^"]+)"/) || [])[1];
t("se leyó la política CSP de .htaccess", !!csp);

const br = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await br.newContext({ viewport: { width: 1300, height: 1000 } });
await ctx.route(u => /\.html$|\/$/.test(new URL(u).pathname) && new URL(u).origin === B, async route => {
  const r = await route.fetch();
  await route.fulfill({ response: r, headers: { ...r.headers(), "content-security-policy": csp } });
});
const violations = [], pageErrors = [], consoleErrors = [];
const page = await ctx.newPage();
page.on("pageerror", e => pageErrors.push(e.message));
page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
await page.addInitScript(() => {
  window.__csp = [];
  document.addEventListener("securitypolicyviolation", e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  localStorage.setItem("stike_cart_v1", JSON.stringify([{ slug: "cana-shadow-finest-negra-topload", qty: 1 }]));
  localStorage.setItem("stike_newsletter_v1", "dismissed");   // sin ventanas encima del boton
  localStorage.setItem("stike_cookie_consent_v1", JSON.stringify({ choice: "essential", ts: Date.now() }));
});

let signed = null;
await page.route("**/api/wompi-sign", async route => {
  const body = route.request().postDataJSON();
  const cents = 310000 * 100;   // 1 caña de $310.000: envio gratis (>= $300.000)
  signed = { reference: body.reference, amount_in_cents: cents, currency: "COP", public_key: PUB, total: 310000, subtotal: 310000, shipping: 0 };
  signed.signature = createHash("sha256").update(`${body.reference}${cents}COP${FAKE_SECRET}`).digest("hex");
  await route.fulfill({ json: signed });
});

await page.goto(`${B}/carrito.html`, { waitUntil: "networkidle" });
await page.fill("#ship-name", "Prueba Auditoria");
await page.fill("#ship-phone", "3000000000");
await page.fill("#ship-address", "Calle 1 # 2-3");
await page.fill("#ship-city", "Bogota");
await page.click("#pay-btn");

await page.waitForFunction(() => window.WidgetCheckout, null, { timeout: 20000 }).catch(() => {});
t("el widget.js de Wompi cargó (WidgetCheckout existe)", await page.evaluate(() => typeof window.WidgetCheckout === "function"));
await page.waitForSelector('iframe[src*="wompi"], #widget-wompi iframe, iframe', { timeout: 20000 }).catch(() => {});
const frames = page.frames().filter(f => /wompi/.test(f.url()));
t("se abrió la ventana de Wompi (iframe de checkout.wompi.co)", frames.length > 0, page.frames().map(f => f.url()).join(" | "));
t("el servidor devolvió referencia, monto, moneda y firma", !!(signed && signed.reference && signed.amount_in_cents && signed.signature.length === 64));

await page.waitForTimeout(9000);
let text = "";
for (const f of page.frames()) if (/wompi/.test(f.url())) text += " " + (await f.evaluate(() => document.body.innerText).catch(() => ""));
console.log("\n--- lo que dice la ventana de Wompi ---\n" + text.replace(/\s+/g, " ").trim().slice(0, 500) + "\n---");
t("Wompi reconoce el comercio y la firma que mandamos se evalúa (con secreto inventado: «firma inválida»)", /firma|signature/i.test(text), "texto: " + text.slice(0, 200));

const csps = await page.evaluate(() => window.__csp);
t("sin violaciones de CSP", csps.length === 0, csps.join(" ; "));
t("sin errores de JavaScript en nuestra página", pageErrors.length === 0, pageErrors.join(" | "));
const realErrors = consoleErrors.filter(e => !/favicon|net::ERR_|Failed to load resource/i.test(e));
t("sin errores relevantes en la consola", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));
await page.screenshot({ path: process.env.SHOT || "/tmp/wompi-widget.png" });
await br.close();
console.log(fail ? `\n${fail} falla(s)` : "\nTodo bien");
process.exit(fail ? 1 : 0);
