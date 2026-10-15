/* Prueba de precios por opcion (color/medida): ficha, carrito, tarjetas, WhatsApp. Servir el repo en :8143: node tools/prices-test.mjs */
import { createRequire } from "node:module";
const require = createRequire(process.env.PW_MODULES || "/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const B = "http://localhost:8143";
const br = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
let fail = 0; const t = (l, ok, x = "") => { if (!ok) fail++; console.log((ok ? "ok    " : "FALLA ") + l + (ok ? "" : "  -> " + x)); };
const ctx = await br.newContext({ viewport: { width: 1200, height: 900 } });
const page = await ctx.newPage();
await page.addInitScript(() => { document.addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = "[class*=cookie],#newsletter-overlay{display:none!important}"; document.head.appendChild(s); }); });
const errs = []; page.on("pageerror", e => errs.push(e.message));
const price = async () => (await page.locator("#pdp-price").innerText()).replace(/\s+/g, " ").trim();
const nb = s => s.replace(/ /g, " ");

await page.goto(`${B}/producto/timon-fiend-reynolds.html`, { waitUntil: "networkidle" });
t("sin elegir: 'Desde $350.000'", nb(await price()) === "Desde $350.000", await price());
await page.locator('#color-options [data-color="Cromado"]').click();
t("cromado: $400.000", nb(await price()) === "$400.000", await price());
await page.locator('#color-options [data-color="Negro"]').click();
t("negro: $350.000", nb(await price()) === "$350.000", await price());
const wa = await page.locator("#wa-buy").getAttribute("href");
t("WhatsApp lleva el precio de la opcion", decodeURIComponent(wa).includes("$350.000"), decodeURIComponent(wa));
await page.locator('#color-options [data-color="Cromado"]').click();
const wa2 = decodeURIComponent(await page.locator("#wa-buy").getAttribute("href"));
t("WhatsApp cromado = $400.000", wa2.includes("$400.000"), wa2);
// al carrito: cromado x2 + negro x1
await page.locator("#qty").fill("2");
await page.locator("button:has-text('Agregar al carrito')").first().click();
await page.locator('#color-options [data-color="Negro"]').click();
await page.locator("#qty").fill("1");
await page.locator("button:has-text('Agregar al carrito')").first().click();
await page.waitForTimeout(400);
const cart = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => /cart/i.test(k))) || "[]"));
t("carrito con 2 lineas (cromado y negro)", cart.length === 2, JSON.stringify(cart));
t("total del carrito = 2x400.000 + 350.000", await page.evaluate(() => stikeCartTotal()) === 1150000, await page.evaluate(() => stikeCartTotal()));
await page.goto(`${B}/carrito.html`, { waitUntil: "networkidle" });
const rows = await page.locator(".ci-price").allInnerTexts();
t("carrito.html: cada linea con su precio", rows.map(nb).sort().join("|") === "$350.000|$400.000", rows.join("|"));
// tarjeta y busqueda
await page.goto(`${B}/tienda.html?cat=repuestos&sub=Timones`, { waitUntil: "networkidle" });
const prices = await page.locator(".card:has(a:text-is('Timón Fiend Reynolds')) .price").first().innerText();
t("tarjeta: 'Desde $350.000'", nb(prices).includes("Desde $350.000"), prices);
// medida con precio
await page.goto(`${B}/producto/cubierta-peg-fate.html`, { waitUntil: "networkidle" });
t("peg: desde $15.000", nb(await price()) === "Desde $15.000", await price());
await page.locator('#size-options [data-size=\'4.5"\']').click();
t('peg 4.5": $20.000', nb(await price()) === "$20.000", await price());
// plato: dientes con precio
await page.goto(`${B}/producto/plato-odyssey-utility-pro-negro.html`, { waitUntil: "networkidle" });
await page.locator('#size-options [data-size="28T"]').click();
t("utility pro 28T: $340.000", nb(await price()) === "$340.000", await price());
// producto sin precios por opcion no cambia
await page.goto(`${B}/producto/pedales-demolition-trooper.html`, { waitUntil: "networkidle" });
t("trooper: precio fijo $95.000 sin 'Desde'", nb(await price()) === "$95.000", await price());
// redirect
await page.goto(`${B}/producto/timon-fiend-reynolds-cromado.html`, { waitUntil: "networkidle" });
t("ficha vieja -> agrupada", page.url().endsWith("/producto/timon-fiend-reynolds.html"), page.url());
t("sin errores JS", errs.length === 0, errs.join("|"));
await br.close(); process.exit(fail ? 1 : 0);
