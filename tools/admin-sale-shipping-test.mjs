/* =========================================================================
   Panel > Ventas > detalle de una venta online: como el ENVIO ya no se cobra en el
   pago (se cotiza por WhatsApp y lo paga el cliente), el detalle le dice al dueño
   que falta cotizarlo y le da un boton de WhatsApp al cliente con el mensaje ya
   escrito. Las ventas anteriores al cambio (que ya cobraron el envio) no llevan
   ese aviso.

     python3 -m http.server 8143   (en la raiz del repo)
     node tools/admin-sale-shipping-test.mjs
   ========================================================================= */
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(process.env.PW_MODULES || "/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const ROOT = process.cwd(), B = "http://localhost:8143";
let fail = 0;
const t = (l, ok, x = "") => { if (!ok) fail++; console.log((ok ? "ok    " : "FALLA ") + l + (ok ? "" : "  -> " + x)); };
const br = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await br.newPage({ viewport: { width: 1300, height: 1000 } });
const errs = []; page.on("pageerror", e => errs.push(e.message));

const now = Date.now();
const SHIP = { name: "Cliente Prueba", phone: "300 111 2233", address: "Calle 1 # 2-3", city: "Bogota", notes: "" };
const base = { slug: "grips-odi-soft-negros", name: "Grips ODI Soft Negros", qty: 1, unitPrice: 60000, total: 60000, source: "wompi", wompiId: "txn-1", customerEmail: "c@x.com", shipping: SHIP };
const NEW = { ...base, ts: new Date(now).toISOString(), admin: "Wompi (ref stike-111-aaaa)", orderRef: "stike-111-aaaa", shippingAck: true };
const BADPHONE = { ...base, ts: new Date(now - 1000).toISOString(), admin: "Wompi (ref stike-222-bbbb)", orderRef: "stike-222-bbbb", shippingAck: true, shipping: { ...SHIP, phone: "12345" } };
const OLD = { ...base, ts: new Date(now - 2000).toISOString(), admin: "Wompi (ref stike-000-old)", orderRef: "stike-000-old" };   // antes del cambio: el envio ya iba en el total
await page.route("**/api/admin-login", r => r.fulfill({ json: { email: "x@test.com", role: "owner" } }));
await page.route("**/api/admin-health", r => r.fulfill({ json: { ok: true, ready: true, checks: [] } }));
await page.route("**/api/sales", r => r.fulfill({ json: [NEW, BADPHONE, OLD] }));
await page.route("**/api/gh?**", r => {
  const path = new URL(r.request().url()).searchParams.get("path"), f = ROOT + "/" + path;
  if (r.request().method() !== "GET") return r.fulfill({ json: { content: { sha: "n" }, commit: { sha: "c" } } });
  if (path === "data/sales-log.json") return r.fulfill({ json: { sha: "s", content: Buffer.from("[]").toString("base64") } });
  return fs.existsSync(f) ? r.fulfill({ json: { sha: "s", content: fs.readFileSync(f).toString("base64") } }) : r.fulfill({ status: 404, json: {} });
});
await page.goto(B + "/admin.html", { waitUntil: "networkidle" }); await page.waitForTimeout(800);
await page.evaluate(() => switchPanel("ventas"));
await page.waitForSelector("#sales-tbody tr[data-sale-idx]");
const open = async n => { await page.locator("#sales-tbody tr[data-sale-idx]").nth(n).click(); await page.waitForSelector("#confirm-modal .sale-prod"); return page.locator("#confirm-modal").innerText(); };
const close = async () => { await page.locator("#sd-close").click(); await page.waitForTimeout(150); };

console.log("\nVenta nueva (el envio NO se cobro en el pago)");
const m1 = await open(0);
t("el detalle trae los datos de envío del cliente", m1.includes("Calle 1 # 2-3") && m1.includes("Bogota"), m1.slice(0, 300));
t("dice que el envío no se cobró en el pago, que se cotiza y que el cliente lo aceptó al pagar", /El envío no se cobró en el pago/.test(m1) && /lo aceptó al pagar/.test(m1) && /Bogota/.test(m1), m1);
const wa = decodeURIComponent(await page.locator("#sd-wa").getAttribute("href"));
t("tiene un botón de WhatsApp al teléfono del cliente (+57, aunque lo haya escrito con espacios)", wa.startsWith("https://wa.me/573001112233?text="), wa);
t("con el mensaje ya escrito: nombre, pedido, ciudad, «va por tu cuenta» y el valor por completar", wa.includes("Cliente Prueba") && wa.includes("stike-111-aaaa") && wa.includes("Bogota") && wa.includes("va por tu cuenta") && wa.trim().endsWith("cuesta $"), wa);
t("el botón abre WhatsApp en otra pestaña sin dar acceso a este panel", (await page.locator("#sd-wa").getAttribute("target")) === "_blank" && /noopener/.test(await page.locator("#sd-wa").getAttribute("rel")));
await close();

console.log("\nTeléfono que no se puede convertir a WhatsApp");
const m2 = await open(1);
t("avisa que no pudo armar el enlace y muestra el teléfono para escribirle a mano (sin botón roto)", /No pude armar el enlace de WhatsApp/.test(m2) && m2.includes("12345") && (await page.locator("#sd-wa").count()) === 0, m2);
await close();

console.log("\nVenta anterior al cambio (el envío ya iba dentro del total)");
const m3 = await open(2);
t("conserva sus datos de envío y NO lleva el aviso de «el envío no se cobró»", m3.includes("Calle 1 # 2-3") && !/El envío no se cobró/.test(m3) && (await page.locator("#sd-wa").count()) === 0, m3.slice(0, 300));
await close();
t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
await br.close();
console.log(fail ? `\n${fail} falla(s)` : "\nTodo bien");
process.exit(fail ? 1 : 0);
