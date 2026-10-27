/* =========================================================================
   Prueba del buscador (lupa + tienda.html?q=): que las busquedas
   especificas encuentren productos, con tildes, plurales, palabras sueltas,
   sinonimos, SKU y errores de tipeo.

     node tools/search-test.mjs [http://localhost:8143]
   ========================================================================= */
import { createRequire } from "node:module";
const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const BASE = process.argv[2] || "http://localhost:8143";
let fail = 0;
const t = (l, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++; console.log(`  ${ok ? "ok  " : "FALLA"} ${l}${ok ? "" : `  -> dio ${JSON.stringify(got)}, esperaba ${JSON.stringify(want)}`}`); };

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
await page.goto(`${BASE}/tienda.html`);
await page.waitForFunction(() => typeof stikeSearchProducts === "function");

const names = (q, n = 50) => page.evaluate(([q, n]) => stikeSearchProducts(q).items.slice(0, n).map(p => p.n), [q, n]);
const info = q => page.evaluate(q => { const r = stikeSearchProducts(q); return { n: r.items.length, loose: r.loose }; }, q);

console.log("\nPalabras sueltas, tildes y plurales");
t("«tenedor Fiend» encuentra tenedores de Fiend", (await names("tenedor Fiend")).length > 0 && (await names("tenedor Fiend")).every(n => /fiend/i.test(n) || true), true);
t("«tenedor Fiend»: todos son de Fiend y tenedores", await page.evaluate(() => stikeSearchProducts("tenedor Fiend").items.every(p => p.brand === "Fiend" && p.sub === "Tenedores")), true);
t("«fiend tenedor» (otro orden) da lo mismo", (await names("fiend tenedor")).join("|"), (await names("tenedor Fiend")).join("|"));
t("«caña» y «cana» y «CAÑAS» dan lo mismo", [(await names("cana")).join("|") === (await names("caña")).join("|"), (await names("canas")).join("|") === (await names("CAÑAS")).join("|")], [true, true]);
t("«cana negra»: lo primero son cañas negras", await page.evaluate(() => { const r = stikeSearchProducts("cana negra").items.slice(0, 5); return r.length > 0 && r.every(p => p.sub === "Cañas" && /negr/i.test(p.n + " " + (p.spec || []).join(" "))); }), true);
t("«timon» (sin tilde) encuentra timones", await page.evaluate(() => stikeSearchProducts("timon").items.some(p => p.sub === "Timones")), true);
t("«horquilla» (sinónimo) encuentra tenedores", await page.evaluate(() => stikeSearchProducts("horquilla").items.some(p => p.sub === "Tenedores")), true);

console.log("\nNombre, SKU y detalles");
t("un nombre completo pone ese producto de primero", (await names("Marco Subrosa Joris", 1))[0], "Marco Subrosa Joris");
t("por SKU (REP-SUB-001) lo encuentra", (await names("REP-SUB-001", 1))[0], "Marco Subrosa Joris");
t("por SKU en minúscula y sin guiones raros", (await names("rep sub 001", 1))[0], "Marco Subrosa Joris");
t("por modelo suelto («Reynolds») trae varios", (await names("reynolds")).length > 3, true);
t("«fiend reynolds 25t» llega al plato", (await names("fiend reynolds 25t", 1))[0], "Plato Fiend Reynolds 25T Sin Guardia");

console.log("\nErrores de tipeo y búsquedas sin resultado exacto");
t("«tenedr» (typo) igual encuentra tenedores", await page.evaluate(() => stikeSearchProducts("tenedr").items.some(p => p.sub === "Tenedores")), true);
t("«fiedn» (typo) encuentra Fiend", await page.evaluate(() => stikeSearchProducts("fiedn").items.some(p => p.brand === "Fiend")), true);
t("«llantas bmx» ignora «bmx» y pone primero las llantas", await page.evaluate(() => { const r = stikeSearchProducts("llantas bmx").items, n = r.filter(p => p.sub === "Llantas").length; return n > 0 && r.slice(0, n).every(p => p.sub === "Llantas"); }), true);
t("palabras que no existen no devuelven nada", (await info("zzzxqwv")).n, 0);
t("una palabra buena + una inexistente muestra parecidos (loose)", await page.evaluate(() => { const r = stikeSearchProducts("tenedor zzzxqwv"); return r.loose && r.items.length > 0; }), true);

console.log("\nLupa (overlay)");
await page.goto(`${BASE}/index.html`);
await page.waitForFunction(() => typeof stikeOpenSearch === "function");
await page.evaluate(() => stikeOpenSearch());
await page.fill("#overlay-search", "tenedor fiend");
t("«tenedor fiend» en la lupa lista productos", await page.locator("#overlay-results .sr-row").count() > 0, true);
t("y el primero es un tenedor Fiend", /fiend/i.test(await page.locator("#overlay-results .sr-row .sr-name").first().innerText()), true);
t("ofrece el atajo «Tenedores» y la marca Fiend", await page.evaluate(() => [...document.querySelectorAll("#overlay-results .sr-chip")].map(a => a.textContent).sort()), ["Fiend", "Tenedores"]);
t("el enlace «Ver los N resultados» lleva a la tienda con la búsqueda", await page.locator("#overlay-results .sr-all").getAttribute("href"), "tienda.html?q=tenedor%20fiend");
await page.fill("#overlay-search", "<img src=x onerror=window.__xss=1>");
t("lo escrito se muestra como texto, no como HTML", await page.evaluate(() => window.__xss === undefined && !document.querySelector("#overlay-results img[src='x']")), true);
await page.fill("#overlay-search", "zzzxqwv");
t("sin nada muestra el mensaje de «no salió nada»", await page.locator("#overlay-results .sr-empty").count(), 1);

console.log("\nPágina de resultados (tienda.html?q=)");
await page.goto(`${BASE}/tienda.html?q=${encodeURIComponent("tenedor fiend")}`);
await page.waitForSelector("#grid .card, #grid [class*=card]");
t("muestra productos para «tenedor fiend»", await page.locator("#grid > *").count() > 0, true);
t("todas las tarjetas son de Fiend", await page.evaluate(() => [...document.querySelectorAll("#grid > *")].every(c => /fiend/i.test(c.textContent))), true);
await page.goto(`${BASE}/tienda.html?q=${encodeURIComponent("tenedor zzzxqwv")}`);
await page.waitForSelector("#grid > *");
t("con una palabra que no existe avisa que son parecidos", /parecidos/.test(await page.locator("#page-subtitle").innerText()), true);
await page.goto(`${BASE}/tienda.html?q=zzzxqwv`);
await page.waitForFunction(() => document.getElementById("empty").style.display === "block");
t("sin coincidencias muestra el estado vacío", await page.locator("#empty").isVisible(), true);

t("sin errores de JavaScript", errors, []);
await browser.close();
console.log(fail ? `\n${fail} falla(s)` : "\nTodo bien");
process.exit(fail ? 1 : 0);
