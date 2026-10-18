/* =========================================================================
   Prueba del menu de Repuestos (header): que NO se cierre por accidente y
   que sea util.

     python3 -m http.server 8143   (en la raiz del repo)
     node tools/nav-test.mjs
   ========================================================================= */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
const require = createRequire(process.env.PW_MODULES || "/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const B = "http://localhost:8143";
const br = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
let fail = 0;
const t = (l, ok, x = "") => { if (!ok) fail++; console.log((ok ? "ok    " : "FALLA ") + l + (ok ? "" : "  -> " + x)); };
const wait = ms => new Promise(r => setTimeout(r, ms));

const ctx = await br.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => { document.addEventListener("DOMContentLoaded", () => { const st = document.createElement("style"); st.textContent = "[class*=cookie],#newsletter-overlay{display:none!important}"; document.head.appendChild(st); }); });
const page = await ctx.newPage();
const errs = []; page.on("pageerror", e => errs.push(e.message));
await page.goto(`${B}/index.html`, { waitUntil: "networkidle" });

const trigger = page.locator('.nav-list > li.has-mega > a', { hasText: "Repuestos" });
const panel = page.locator(".mega-parts");
const visible = async () => (await panel.evaluate(el => { const c = getComputedStyle(el); return c.visibility === "visible" && +c.opacity > 0.5; }));
const box = async loc => loc.boundingBox();

console.log("\nAbrir");
const tb = await box(trigger);
await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
await wait(20);
t("no abre al instante (intención, 90 ms)", !(await visible()));
await wait(300);
t("abre cuando el mouse se posa", await visible());

console.log("\nNo se cierra solo");
const pb = await box(panel);
t("el panel es ancho (>= 900 px)", pb.width >= 900, String(pb.width));
t("y no se come la pantalla (< 620 px de alto)", pb.height < 620, String(pb.height));
// bajar despacio por el hueco hasta un link del panel
const target = await box(page.locator(".mg-link").first());
const steps = 25;
let stayed = true;
for (let i = 1; i <= steps; i++) {
  await page.mouse.move(tb.x + tb.width / 2 + (target.x + 30 - tb.x - tb.width / 2) * i / steps, tb.y + tb.height / 2 + (target.y + 10 - tb.y - tb.height / 2) * i / steps);
  await wait(30);
  if (!(await visible())) { stayed = false; break; }
}
t("cruzar del link al panel lo mantiene abierto", stayed);
// salir en diagonal rápido del link hacia un lado y volver (pulso torcido)
await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
await page.mouse.move(tb.x + tb.width / 2 + 160, tb.y - 60);
await wait(120);
t("salir 120 ms y volver no lo cierra (gracia)", await visible());
await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
await wait(500);
t("sigue abierto tras volver", await visible());

console.log("\nCerrar");
await page.mouse.move(700, 890);
await wait(150);
t("a los 150 ms todavía no se cierra", await visible());
await wait(600);
t("y se cierra solo después de la gracia", !(await visible()));

console.log("\nCruzar de pasada");
const ib = await box(page.locator('.nav-list > li', { hasText: "Inicio" }).first());
await page.mouse.move(ib.x + 4, tb.y + tb.height / 2);
await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 2 });
await page.mouse.move(tb.x + tb.width + 400, tb.y + tb.height / 2, { steps: 2 });
await wait(600);
t("pasar rápido por encima de Repuestos no abre el menú", !(await visible()));

console.log("\nTeclado");
await trigger.focus();
await wait(100);
t("al enfocar con Tab abre", await visible());
await page.keyboard.press("ArrowDown");
t("flecha abajo entra al primer link", await page.evaluate(() => document.activeElement && document.activeElement.classList.contains("mg-link")));
await page.keyboard.press("Escape");
await wait(100);
t("Escape cierra", !(await visible()));
t("y devuelve el foco a Repuestos", await page.evaluate(() => /repuestos/i.test(document.activeElement.textContent)));
await page.evaluate(() => document.activeElement.blur());

console.log("\nContenido útil");
await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
await wait(400);
const html = await panel.innerText();
t("agrupa por sistema de la bici", ["Cuadro y dirección", "Transmisión", "Ruedas"].every(g => new RegExp(g, "i").test(html)), html.slice(0, 120));
t("tiene Cañas, Pegs y Manzanas", /Cañas/i.test(html) && /Pegs y Protectores/i.test(html) && /Manzana Delantera/i.test(html) && /Manzana Trasera/i.test(html));
t("no usa la terminología vieja", !/espigas|tacos|\bmaza/i.test(html), html.match(/espigas|tacos|\bmaza/i));
t("cada tipo trae su conteo", (await page.locator(".mg-link i").count()) >= 10);
t("cada tipo explica para qué sirve", (await page.locator(".mg-link small").count()) >= 10);
t("tarjeta de Arma tu BMX", (await page.locator('.mg-build[href="armar.html"]').count()) === 1);
t("muestra lo último que llegó (3)", (await page.locator(".mg-prod").count()) === 3);
t("las fotos cargaron al abrir", await page.evaluate(() => [...document.querySelectorAll(".mg-pimg img")].every(i => i.src && i.complete && i.naturalWidth > 0)));
t("muestra marcas con repuestos", (await page.locator(".mg-brands a").count()) >= 3);
const hrefs = await page.locator(".mega-parts a").evaluateAll(a => a.map(x => x.getAttribute("href")).filter(h => h && !/^https?:/.test(h)));
const bad = hrefs.filter(h => !existsSync(h.split("?")[0].replace(/^\//, "")));
t("ningún link del menú está roto", bad.length === 0, bad.join(", "));
const counts = await page.locator(".mg-col").evaluateAll(cols => cols.map(c => [...c.querySelectorAll(".mg-link")].map(a => [a.querySelector("b").textContent, +a.querySelector("i").textContent])));
const real = await page.evaluate(() => { const o = {}; STIKE_PRODUCTS.filter(p => p.cat === "repuestos").forEach(p => o[p.sub] = (o[p.sub] || 0) + 1); return o; });
t("los conteos del menú coinciden con el catálogo", counts.flat().every(([n, c]) => real[n] === c), JSON.stringify(counts.flat().filter(([n, c]) => real[n] !== c)));

console.log("\nOtros menús");
const ropa = page.locator('.nav-list > li.has-mega > a', { hasText: "Ropa" });
const rb = await box(ropa);
await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
await wait(400);
t("Ropa abre su lista y cierra el mega de Repuestos", !(await visible()) && await ropa.locator("xpath=..").locator(".dropdown").evaluate(el => getComputedStyle(el).visibility === "visible"));
await page.mouse.move(700, 890); await wait(700);

console.log("\nMóvil");
const mctx = await br.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
const mp = await mctx.newPage();
await mp.goto(`${B}/index.html`, { waitUntil: "networkidle" });
await mp.addStyleTag({ content: "[class*=cookie],#newsletter-overlay{display:none!important}" });
await mp.locator("#menu-toggle").tap();
await wait(300);
await mp.locator('.nav-list > li.has-mega > a', { hasText: "Repuestos" }).tap();
await wait(250);
t("en el celular Repuestos despliega la lista", await mp.locator(".mega-parts .mg-link").first().isVisible());
t("sin tarjeta lateral en el celular", !(await mp.locator(".mg-side").isVisible()));
t("sin scroll horizontal", await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
await br.close();
console.log(fail ? `\n${fail} falla(s)` : "\nTodo bien");
process.exit(fail ? 1 : 0);
