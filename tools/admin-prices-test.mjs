/* Prueba del panel con precios por opcion: editor (columna Precio), precio base, formulario de venta, validacion.
   Servir el repo en :8143 (python3 -m http.server 8143) y: node tools/admin-prices-test.mjs */
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(process.env.PW_MODULES || "/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const ROOT = process.cwd(), B = "http://localhost:8143";
const br = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
let fail = 0; const t = (l, ok, x = "") => { if (!ok) fail++; console.log((ok ? "ok    " : "FALLA ") + l + (ok ? "" : "  -> " + x)); };
const page = await br.newPage({ viewport: { width: 1300, height: 900 } });
const errs = []; page.on("pageerror", e => errs.push(e.message));
await page.route("**/api/admin-login", r => r.fulfill({ json: { email: "x@test.com", role: "owner" } }));
await page.route("**/api/admin-health", r => r.fulfill({ json: { ok: true } }));
await page.route("**/api/sales", r => r.fulfill({ json: [] }));
await page.route("**/api/gh?**", r => { const path = new URL(r.request().url()).searchParams.get("path"); const f = ROOT + "/" + path; if (r.request().method() !== "GET") return r.fulfill({ json: { content: { sha: "n" }, commit: { sha: "c" } } }); return fs.existsSync(f) ? r.fulfill({ json: { sha: "s", content: fs.readFileSync(f).toString("base64") } }) : r.fulfill({ status: 404, json: {} }); });
await page.goto(B + "/admin.html", { waitUntil: "networkidle" }); await page.waitForTimeout(800);
const nb = s => s.replace(/ /g, " ");

await page.fill("#p-search", "Timón Fiend Reynolds"); await page.waitForTimeout(300);
t("el listado dice 'Desde $350.000'", nb(await page.locator("#product-grid").innerText()).includes("Desde $350.000"));
await page.locator('[data-edit="timon-fiend-reynolds"]').first().click(); await page.waitForTimeout(300);
t("columna Precio por color", await page.locator("#ed-colors-table [data-color-p]").count() === 2);
t("cromado muestra 400000", await page.locator("#ed-colors-table [data-color-p]").nth(1).inputValue() === "400000");
t("negro (base) queda vacio", await page.locator("#ed-colors-table [data-color-p]").nth(0).inputValue() === "");
await page.locator("#ed-colors-table [data-color-p]").nth(1).fill("420000");
t("subir el cromado no mueve el base", await page.locator("#ed-price").inputValue() === "350000");
await page.locator("#ed-colors-table [data-color-p]").nth(0).fill("300000");
t("si todas las opciones tienen precio, el base = el mas bajo (300000)", await page.locator("#ed-price").inputValue() === "300000", await page.locator("#ed-price").inputValue());
await page.locator("#ed-colors-table [data-color-p]").nth(0).fill("");
t("quitar el precio del negro -> el base no sube solo (sigue 300000)", await page.locator("#ed-price").inputValue() === "300000", await page.locator("#ed-price").inputValue());
await page.fill("#ed-price", "350000"); await page.dispatchEvent("#ed-price", "input");
await page.locator("#ed-colors-table [data-color-p]").nth(1).fill("400000");
await page.locator("#ed-save").click(); await page.waitForTimeout(300);
// venta
await page.locator('[data-panel="ventas"]').click(); await page.waitForTimeout(200);
await page.selectOption("#sale-product", "timon-fiend-reynolds"); await page.waitForTimeout(200);
t("venta: color negro -> $350.000", await page.locator("#sale-price").inputValue() === "350000", await page.locator("#sale-price").inputValue());
await page.selectOption("#sale-color", "Cromado"); await page.waitForTimeout(150);
t("venta: al elegir cromado el precio pasa a 400000", await page.locator("#sale-price").inputValue() === "400000", await page.locator("#sale-price").inputValue());
t("sin errores JS", errs.length === 0, errs.join("|"));
await br.close(); process.exit(fail ? 1 : 0);
