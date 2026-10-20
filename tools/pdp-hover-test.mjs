/* =========================================================================
   Prueba de la galeria de la ficha: pasar el mouse por una miniatura muestra
   esa foto (con animacion), sin hacer clic; en el celular se sigue tocando.

     python3 -m http.server 8143   (en la raiz del repo)
     node tools/pdp-hover-test.mjs
   ========================================================================= */
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(process.env.PW_MODULES || "/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const ROOT = process.cwd(), B = "http://localhost:8143";
const br = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
let fail = 0;
const t = (l, ok, x = "") => { if (!ok) fail++; console.log((ok ? "ok    " : "FALLA ") + l + (ok ? "" : "  -> " + x)); };
const wait = ms => new Promise(r => setTimeout(r, ms));

const MARK = "window.STIKE_PRODUCTS = ";
const raw = fs.readFileSync(ROOT + "/assets/js/products-data.js", "utf8");
const catalog = JSON.parse(raw.slice(raw.indexOf(MARK) + MARK.length, raw.lastIndexOf(";")));
const many = catalog.filter(p => p.published !== false && !p.colors && (p.imgs || []).length >= 4).sort((a, b) => b.imgs.length - a.imgs.length)[0];
const url = `${B}/producto/${many.slug}.html`;

async function open(ctxOpts = {}) {
  const ctx = await br.newContext({ viewport: { width: 1300, height: 900 }, ...ctxOpts });
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", e => errs.push(e.message));
  await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => { const st = document.createElement("style"); st.textContent = "[class*=cookie],#newsletter-overlay{display:none!important}"; document.head.appendChild(st); }));
  await page.goto(url, { waitUntil: "networkidle" });
  await wait(300);
  return { page, errs, ctx };
}
const main = page => page.locator("#main-img").getAttribute("src");
const thumb = (page, i) => page.locator(".pdp-thumbs [data-thumb]").nth(i);

console.log(`\nCon mouse (producto con ${many.imgs.length} fotos)`);
{
  const { page, errs, ctx } = await open();
  const first = await main(page);
  const src1 = await thumb(page, 1).getAttribute("data-src");
  await thumb(page, 1).hover();
  let sawGhost = false, sawSwap = false;
  for (let i = 0; i < 14 && !(sawGhost && sawSwap); i++) {
    sawGhost = sawGhost || await page.locator(".pdp-ghost").count() > 0;
    sawSwap = sawSwap || await page.locator("#main-img").evaluate(e => e.classList.contains("pdp-swap"));
    await wait(15);
  }
  await wait(120);
  t("al pasar el mouse por la 2.ª miniatura, la foto grande cambia sola (sin clic)", (await main(page)) === src1 && src1 !== first, `${await main(page)} vs ${src1}`);
  t("la miniatura queda marcada como activa", await thumb(page, 1).evaluate(e => e.classList.contains("active")) && !(await thumb(page, 0).evaluate(e => e.classList.contains("active"))));
  t("hubo animación: la foto anterior se desvanece encima", sawGhost);
  t("la foto nueva entra con su animación (acercamiento suave)", sawSwap);
  await wait(550);
  t("la animación termina y no deja basura (sin fantasma ni clase)", await page.locator(".pdp-ghost").count() === 0 && !(await page.locator("#main-img").evaluate(e => e.classList.contains("pdp-swap"))));
  t("el contador dice 2 / N", (await page.locator(".pdp-count").textContent()).trim().startsWith("2 /"), await page.locator(".pdp-count").textContent());

  const src2 = await thumb(page, 2).getAttribute("data-src");
  await thumb(page, 2).hover(); await wait(250);
  t("pasar a otra miniatura cambia de nuevo", (await main(page)) === src2);

  /* Cruzar rápido varias miniaturas: queda la última, sin parpadeos intermedios. */
  const n = await page.locator(".pdp-thumbs [data-thumb]").count();
  const boxes = [];
  for (let i = 0; i < n; i++) boxes.push(await thumb(page, i).boundingBox());
  const lastSrc = await thumb(page, n - 1).getAttribute("data-src");
  let changes = 0; await page.exposeFunction("__count", () => { changes++; });
  await page.evaluate(() => { new MutationObserver(() => window.__count()).observe(document.getElementById("main-img"), { attributes: true, attributeFilter: ["src"] }); });
  for (let i = 0; i < n; i++) { await page.mouse.move(boxes[i].x + boxes[i].width / 2, boxes[i].y + boxes[i].height / 2, { steps: 2 }); await wait(15); }
  await wait(350);
  t("cruzando rápido todas las miniaturas termina en la última", (await main(page)) === lastSrc);
  t("y no cambia la foto grande por cada miniatura que cruza", changes <= 2, String(changes));

  await page.mouse.move(5, 5); await wait(250);
  t("al sacar el mouse se queda la última foto elegida", (await main(page)) === lastSrc);

  await thumb(page, 0).click(); await wait(250);
  t("el clic sigue funcionando", (await main(page)) === first);
  await page.locator("#main-img").hover();
  await page.keyboard.press("ArrowRight"); await wait(400);
  t("las flechas siguen funcionando y también animan", (await main(page)) === src1);
  t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
  await ctx.close();
}

console.log("\nLa tira de miniaturas no se mueve al pasar el mouse");
{
  const { page, errs, ctx } = await open({ viewport: { width: 700, height: 900 } });
  const before = await page.locator(".pdp-thumbs").evaluate(e => ({ sl: e.scrollLeft, over: e.scrollWidth > e.clientWidth }));
  const n = await page.locator(".pdp-thumbs [data-thumb]").count();
  const last = thumb(page, Math.min(n - 1, 3));
  await last.hover(); await wait(500);
  const after = await page.locator(".pdp-thumbs").evaluate(e => e.scrollLeft);
  t("la tira no se desplaza sola (movería la miniatura de debajo del puntero)", after === before.sl, `${before.sl} -> ${after} (desborda: ${before.over})`);
  t("y la foto igual cambió", (await main(page)) === (await last.getAttribute("data-src")));
  t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
  await ctx.close();
}

console.log("\nCelular (sin mouse): solo al tocar");
{
  const { page, errs, ctx } = await open({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
  const first = await main(page);
  await thumb(page, 1).dispatchEvent("mouseenter"); await wait(250);
  t("un 'hover' simulado no cambia la foto", (await main(page)) === first);
  await thumb(page, 1).tap(); await wait(300);
  t("tocar la miniatura sí", (await main(page)) === await thumb(page, 1).getAttribute("data-src"));
  t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
  await ctx.close();
}

console.log("\nMenos movimiento (accesibilidad)");
{
  const { page, errs, ctx } = await open({ reducedMotion: "reduce" });
  const src1 = await thumb(page, 1).getAttribute("data-src");
  await thumb(page, 1).hover();
  let ghost = false;
  for (let i = 0; i < 10; i++) { if (await page.locator(".pdp-ghost").count()) ghost = true; await wait(20); }
  t("la foto cambia igual", (await main(page)) === src1);
  t("pero sin animación", !ghost && !(await page.locator("#main-img").evaluate(e => e.classList.contains("pdp-swap"))));
  t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
  await ctx.close();
}

await br.close();
console.log(fail ? `\n${fail} falla(s)` : "\nTodo bien");
process.exit(fail ? 1 : 0);
