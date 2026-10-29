/* =========================================================================
   Panel: (1) agregar una MARCA NUEVA desde el desplegable de marca del editor
   de producto, sin que haya que tocar codigo; (2) foto del producto en el
   historial de ventas y en el detalle de cada venta.

     python3 -m http.server 8143   (en la raiz del repo)
     node tools/admin-brand-sales-test.mjs
   ========================================================================= */
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(process.env.PW_MODULES || "/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const ROOT = process.cwd(), B = "http://localhost:8143";
let fail = 0;
const t = (l, ok, x = "") => { if (!ok) fail++; console.log((ok ? "ok    " : "FALLA ") + l + (ok ? "" : "  -> " + x)); };
const br = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await br.newPage({ viewport: { width: 1300, height: 900 } });
const errs = []; page.on("pageerror", e => errs.push(e.message));

const SALE = { ts: new Date().toISOString(), slug: "marco-subrosa-joris", name: "Marco Subrosa Joris", qty: 1, unitPrice: 1850000, total: 1850000, admin: "prueba@test.com" };
const GONE = { ts: new Date(Date.now() - 1000).toISOString(), slug: "producto-que-ya-no-existe", name: "Producto borrado", qty: 1, unitPrice: 1000, total: 1000, admin: "prueba@test.com" };
const published = [];
await page.route("**/api/admin-login", r => r.fulfill({ json: { email: "x@test.com", role: "owner" } }));
await page.route("**/api/admin-health", r => r.fulfill({ json: { ok: true, ready: true, checks: [] } }));
await page.route("**/api/sales", r => r.fulfill({ json: [] }));
await page.route("**/api/gh?**", r => {
  const path = new URL(r.request().url()).searchParams.get("path"), f = ROOT + "/" + path;
  if (r.request().method() !== "GET") { if (r.request().method() === "PUT") published.push({ path, body: r.request().postDataJSON() }); return r.fulfill({ json: { content: { sha: "n" }, commit: { sha: "c" } } }); }
  if (path === "data/sales-log.json") return r.fulfill({ json: { sha: "s", content: Buffer.from(JSON.stringify([GONE, SALE])).toString("base64") } });
  return fs.existsSync(f) ? r.fulfill({ json: { sha: "s", content: fs.readFileSync(f).toString("base64") } }) : r.fulfill({ status: 404, json: {} });
});
await page.goto(B + "/admin.html", { waitUntil: "networkidle" }); await page.waitForTimeout(800);

console.log("\nMarca nueva en el editor de producto");
await page.evaluate(() => openEditor(null));
await page.waitForSelector("#ed-brand");
await page.locator("#ed-brand").click();
await page.keyboard.type("OJO BMX");
const addRow = page.locator(".cs-pop.open .cs-new");
t("antes: «Sin resultados» sin salida. Ahora ofrece «Agregar OJO BMX como marca nueva»", await addRow.count() === 1 && /Agregar «OJO BMX» como marca nueva/.test(await addRow.innerText()), await page.locator(".cs-pop.open").innerText());
t("el desplegable sigue sin tener esa marca antes de agregarla", await page.evaluate(() => ![...document.querySelectorAll("#ed-brand option")].some(o => o.value === "OJO BMX")));
await page.keyboard.press("Enter");
t("Enter la agrega y cierra la lista", await page.locator(".cs-pop.open").count() === 0);
t("la marca queda elegida en el desplegable", await page.locator("#ed-brand").inputValue() === "OJO BMX");
t("y en el borrador del producto", await page.evaluate(() => editorDraft.brand) === "OJO BMX");
t("el SKU se arma con la marca nueva (…-OJO-…)", /-OJO-/.test(await page.locator("#ed-sku").inputValue()), await page.locator("#ed-sku").inputValue());
await page.evaluate(() => { editorDraft.cat = "accesorios"; renderEditor(); });
t("al redibujar el editor (cambiar categoría) la marca nueva NO desaparece", await page.locator("#ed-brand").inputValue() === "OJO BMX");

console.log("\nSin duplicados ni basura");
await page.locator("#ed-brand").click();
await page.keyboard.type("nike");
t("escribir una marca que ya existe (nike) NO ofrece agregarla otra vez", await page.locator(".cs-pop.open .cs-new").count() === 0);
await page.keyboard.press("Escape");
await page.locator("#ed-brand").click();
await page.keyboard.type('Mala<img src=x onerror=window.__x=1>"marca');
await page.locator(".cs-pop.open .cs-new").click();
const got = await page.locator("#ed-brand").inputValue();
t("se quitan < > y comillas del nombre", !/[<>"]/.test(got) && got.startsWith("Mala"), got);
t("y no se ejecutó nada", await page.evaluate(() => window.__x === undefined));
await page.evaluate(() => { editorDraft.brand = "OJO BMX"; renderEditor(); });

console.log("\nEn la tienda (data.js)");
const listed = await page.evaluate(() => { const p = { slug: "x", n: "Gorra", brand: "OJO BMX", cat: "accesorios", price: 1, published: true, units: 1 }; return STIKE_BRANDS.includes("OJO BMX"); });
t("el panel todavía no la mete en STIKE_BRANDS (solo el catálogo publicado lo hace)", listed === false);
const pub = await br.newPage();
await pub.addInitScript(() => { window.STIKE_PRODUCTS = undefined; });
await pub.route("**/assets/js/products-data.js*", r => r.fulfill({ contentType: "application/javascript", body: 'window.STIKE_PRODUCTS = [{"slug":"gorra-ojo","sku":"ACC-OJO-001","n":"Gorra OJO BMX Nose Manual","brand":"OJO BMX","cat":"accesorios","sub":"Gorras","price":60000,"units":3,"imgs":[],"published":true}];' }));
await pub.goto(B + "/tienda.html?brand=OJO%20BMX");
await pub.waitForSelector("#grid > *");
t("tienda: la marca nueva sale en el filtro de marcas", await pub.locator("#filter-brands").innerText().then(x => /OJO BMX/.test(x)));
t("tienda: filtrar por ella muestra su producto", await pub.locator("#grid > *").count() === 1);
await pub.evaluate(() => stikeOpenSearch());
await pub.fill("#overlay-search", "ojo bmx");
t("buscador: «ojo bmx» encuentra la gorra y ofrece la marca", await pub.locator("#overlay-results .sr-row").count() === 1 && /OJO BMX/.test(await pub.locator("#overlay-results .sr-chip").allInnerTexts().then(a => a.join(" "))));
await pub.close();

console.log("\nFoto del producto en las ventas");
await page.evaluate(() => { closeEditor(); switchPanel("ventas"); });
await page.waitForSelector("#sales-tbody tr[data-sale-idx]");
const rows = page.locator("#sales-tbody tr[data-sale-idx]");
t("el historial muestra las 2 ventas", await rows.count() === 2);
const imgSrc = await rows.nth(0).locator(".sale-thumb img").getAttribute("src").catch(() => null);
t("la venta del Subrosa Joris trae la foto del producto", /marco-subrosa-joris-1\.jpg/.test(imgSrc || ""), String(imgSrc));
t("la foto se ve (cargó y tiene tamaño)", await rows.nth(0).locator(".sale-thumb img").evaluate(i => i.complete && i.naturalWidth > 0).catch(() => false));
t("un producto que ya no está en el catálogo muestra un recuadro vacío, sin romper nada", await rows.nth(1).locator(".sale-thumb.empty").count() === 1);
t("el nombre sigue ahí", /Marco Subrosa Joris/.test(await rows.nth(0).innerText()));
await rows.nth(0).click();
await page.waitForSelector("#confirm-modal .sale-thumb.big img");
t("el detalle de la venta también muestra la foto grande", await page.locator("#confirm-modal .sale-thumb.big img").count() === 1);

t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
await br.close();
console.log(fail ? `\n${fail} falla(s)` : "\nTodo bien");
process.exit(fail ? 1 : 0);
