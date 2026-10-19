/* =========================================================================
   Prueba de la regla "solo se dice cuántas quedan cuando son menos de 3".

     python3 -m http.server 8143   (en la raiz del repo, para la parte de navegador)
     node tools/stock-display-test.mjs

   Con 3 o más unidades la ficha dice "En stock" a secas. Con 1 dice "¡Última
   unidad!" y con 2 "¡Solo quedan 2!". Vale para TODAS las fichas, para la
   opción elegida (talla/color), para el carrito y para el armador.
   ========================================================================= */
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(process.env.PW_MODULES || "/opt/node-tools/node_modules/");
const D = require(process.cwd() + "/assets/js/data.js");
let fail = 0;
const t = (l, ok, x = "") => { if (!ok) fail++; console.log((ok ? "ok    " : "FALLA ") + l + (ok ? "" : "  -> " + x)); };

console.log("\nLa regla");
t("1 -> Última unidad", D.stikeLowStockLabel(1) === "¡Última unidad!");
t("2 -> Solo quedan 2", D.stikeLowStockLabel(2) === "¡Solo quedan 2!");
t("3 -> nada (se dice 'En stock')", D.stikeLowStockLabel(3) === null);
t("28 -> nada", D.stikeLowStockLabel(28) === null);
t("0 -> nada (eso es 'Agotado')", D.stikeLowStockLabel(0) === null);

console.log("\nMarco Fate Namaste V2");
global.window = {}; require(process.cwd() + "/assets/js/products-data.js");
const marco = window.STIKE_PRODUCTS.find(p => p.slug === "marco-fate-namaste-v2");
t("20.4 -> 1 unidad", marco.sizes.find(s => s.v === "20.4").u === 1);
t("20.75 -> 28 unidades", marco.sizes.find(s => s.v === "20.75").u === 28);

console.log("\nTodas las fichas publicadas");
let checked = 0; const bad = [];
for (const p of window.STIKE_PRODUCTS.filter(p => p.published !== false)) {
  const html = fs.readFileSync(`producto/${p.slug}.html`, "utf8");
  const m = html.match(/<span class="stock[^"]*">([^<]*)<\/span>/);
  if (!m) { bad.push(p.slug + ": sin línea de stock"); continue; }
  const total = D.stikeTotalStock(p), out = D.stikeIsOut(p);
  const want = out ? "● Agotado por ahora" : (total > 0 ? "● " + (D.stikeLowStockLabel(total) || "En stock") : "● Disponible");
  if (!m[1].startsWith(want)) bad.push(`${p.slug}: dice "${m[1]}" y debía decir "${want}"`);
  if (/\(\d+ disponibles?\)/.test(html)) bad.push(p.slug + ": todavía dice '(N disponibles)'");
  checked++;
}
t(`las ${checked} fichas siguen la regla`, bad.length === 0, bad.slice(0, 3).join(" | "));
const loose = fs.readdirSync("producto").filter(f => f.endsWith(".html")).filter(f => /\(\d+ disponibles?\)|¡Solo [3-9]\d* disponible/.test(fs.readFileSync("producto/" + f, "utf8")));
t("ninguna ficha publica un número de 3 o más", loose.length === 0, loose.slice(0, 3).join(", "));

console.log("\nCarrito");
const cat = [{ slug: "a", n: "Producto A", price: 50000, units: 5 }, { slug: "b", n: "Producto B", price: 50000, units: 2 }, { slug: "c", n: "Producto C", price: 50000, units: 50 }];
const r1 = D.stikeSanitizeCart([{ slug: "a", qty: 9 }], cat);
t("5 en bodega y piden 9: ajusta SIN decir cuántas hay", r1.cart[0].qty === 5 && !/\b5\b/.test(r1.notes[0]) && /disponible/.test(r1.notes[0]), r1.notes[0]);
const r2 = D.stikeSanitizeCart([{ slug: "b", qty: 9 }], cat);
t("2 en bodega: sí dice 2", r2.cart[0].qty === 2 && /\b2\b/.test(r2.notes[0]), r2.notes[0]);
const r3 = D.stikeSanitizeCart([{ slug: "c", qty: 30 }], cat);
t("el tope por pedido (20) se sigue diciendo", r3.cart[0].qty === 20 && /20/.test(r3.notes[0]), r3.notes[0]);

console.log("\nEn la ficha, según la opción elegida");
const { chromium } = require("playwright");
const br = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await br.newContext({ viewport: { width: 1200, height: 900 } });
await ctx.addInitScript(() => { document.addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = "[class*=cookie],#newsletter-overlay{display:none!important}"; document.head.appendChild(s); }); });
const page = await ctx.newPage();
const errs = []; page.on("pageerror", e => errs.push(e.message));
await page.goto("http://localhost:8143/producto/marco-fate-namaste-v2.html", { waitUntil: "networkidle" });
const line = () => page.locator(".stock-line .stock").textContent();
const cls = () => page.locator(".stock-line .stock").getAttribute("class");
t("al abrir (29 en total) dice 'En stock' sin número", (await line()).trim() === "● En stock", await line());
await page.locator('#size-options [data-size="20.4"]').click();
t("elegir 20.4 (queda 1) dice '¡Última unidad!'", (await line()).includes("Última unidad"), await line());
t("y se marca en alerta", /\blow\b/.test(await cls()));
await page.locator('#size-options [data-size="20.75"]').click();
t("elegir 20.75 (quedan 28) vuelve a 'En stock' sin número", (await line()).trim() === "● En stock" && !/\blow\b/.test(await cls()), await line());
const txt = await page.locator(".pdp-info").innerText();
t("en toda la ficha no aparece el número 28 ni 29 como stock", !/\b(28|29)\s+(disponibles|unidades|en stock)/i.test(txt));

await page.goto("http://localhost:8143/producto/cana-volume-50mm-azul.html", { waitUntil: "networkidle" });
t("un producto con 1 unidad lo dice desde el inicio", (await line()).includes("Última unidad"), await line());
t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
await br.close();
console.log(fail ? `\n${fail} falla(s)` : "\nTodo bien");
process.exit(fail ? 1 : 0);
