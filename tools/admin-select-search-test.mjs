/* =========================================================================
   Prueba del buscador en los desplegables del panel (assets/js/select-search.js).

     python3 -m http.server 8143   (en la raiz del repo)
     node tools/admin-select-search-test.mjs

   Cada <select> del panel abre una lista con barra de busqueda: se ven las
   letras que se escriben, la lista se acorta, no importan mayusculas ni
   tildes, y elegir dispara el mismo "change" de siempre.
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
const page = await br.newPage({ viewport: { width: 1300, height: 900 } });
const errs = []; page.on("pageerror", e => errs.push(e.message));
await page.route("**/api/admin-login", r => r.fulfill({ json: { email: "x@test.com", role: "owner" } }));
await page.route("**/api/admin-health", r => r.fulfill({ json: { ok: true } }));
await page.route("**/api/sales", r => r.fulfill({ json: [] }));
await page.route("**/api/gh?**", r => { const path = new URL(r.request().url()).searchParams.get("path"); const f = ROOT + "/" + path; if (r.request().method() !== "GET") return r.fulfill({ json: { content: { sha: "n" }, commit: { sha: "c" } } }); return fs.existsSync(f) ? r.fulfill({ json: { sha: "s", content: fs.readFileSync(f).toString("base64") } }) : r.fulfill({ status: 404, json: {} }); });
await page.goto(B + "/admin.html", { waitUntil: "networkidle" }); await page.waitForTimeout(800);

const pop = page.locator(".cs-pop.open");
const opts = () => page.locator(".cs-pop.open .cs-opt").allInnerTexts().then(a => a.map(x => x.replace(/\s*✓\s*$/, "").trim()));
const closed = async () => (await page.locator(".cs-pop.open").count()) === 0;

console.log("\nFiltro de categoría");
const nativeCount = await page.locator("#p-filter-cat option").count();
await page.locator("#p-filter-cat").click();
t("al hacer clic se abre la lista con barra de búsqueda", await pop.isVisible() && await page.locator(".cs-pop.open .cs-q").isVisible());
t("el cursor ya está en la barra", await page.evaluate(() => document.activeElement && document.activeElement.classList.contains("cs-q")));
t("muestra todas las opciones al abrir", (await opts()).length === nativeCount, `${(await opts()).length} vs ${nativeCount}`);
await page.keyboard.type("rep");
t("se ven las letras que se escriben", (await page.locator(".cs-pop.open .cs-q").inputValue()) === "rep");
const after = await opts();
t("la lista se acorta", after.length > 0 && after.length < nativeCount, JSON.stringify(after));
t("y solo deja lo que coincide", after.every(x => /rep/i.test(x)), JSON.stringify(after));
t("las letras coincidentes se resaltan", (await page.locator(".cs-pop.open .cs-opt mark").count()) > 0);
await page.keyboard.press("Enter");
t("Enter elige y cierra", await closed());
t("el desplegable queda en Repuestos", (await page.locator("#p-filter-cat").inputValue()) === "repuestos");
await wait(200);
const shown = await page.locator("#result-count, #p-count, .p-count").first().innerText().catch(() => "");
const cardsRep = await page.locator("#product-grid .pcard").count();
t("el panel reaccionó al cambio (filtró los productos)", cardsRep > 0 && cardsRep < 262, String(cardsRep));

console.log("\nSin importar tildes ni mayúsculas");
await page.locator("#p-filter-sub").click();
await page.keyboard.type("CANAS");
t("'CANAS' encuentra Cañas", (await opts()).some(x => /^Cañas/.test(x)), JSON.stringify(await opts()));
await page.keyboard.press("Escape");
t("Escape cierra sin elegir", await closed() && (await page.locator("#p-filter-sub").inputValue()) === "");
await page.locator("#p-filter-sub").click();
await page.keyboard.type("manzana tra");
const mz = await opts();
t("varias palabras: 'manzana tra' -> Manzana Trasera", mz.length === 1 && /Manzana Trasera/.test(mz[0]), JSON.stringify(mz));
await page.keyboard.press("Escape");
await page.locator("#p-filter-sub").click();
await page.keyboard.type("zzzz");
t("sin coincidencias avisa", (await page.locator(".cs-pop.open .cs-empty").innerText()).includes("Sin resultados"));
await page.keyboard.press("Escape");

console.log("\nTeclado");
await page.locator("#p-filter-brand").focus();
await page.keyboard.press("f");
t("con el desplegable enfocado, escribir una letra lo abre", await pop.isVisible());
t("y esa letra ya está en la barra", (await page.locator(".cs-pop.open .cs-q").inputValue()) === "f");
await page.keyboard.type("ie");
t("'fie' deja Fiend", (await opts()).some(x => /^Fiend/.test(x)) && (await opts()).every(x => /fie/i.test(x)), JSON.stringify(await opts()));
await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowUp");
await page.keyboard.press("Enter");
t("elige con Enter", (await page.locator("#p-filter-brand").inputValue()) === "Fiend", await page.locator("#p-filter-brand").inputValue());
await page.locator("#p-filter-brand").focus();
await page.keyboard.press("Space");
t("Espacio abre", await pop.isVisible());
await page.keyboard.press("Escape");
await page.locator("#p-filter-status").click();
t("hasta el de 3-4 opciones tiene barra", await page.locator(".cs-pop.open .cs-q").isVisible());
await page.mouse.click(5, 5);
await wait(100);
t("clic afuera cierra", await closed());
await page.locator("#p-filter-brand").selectOption("");
await page.locator("#p-filter-cat").selectOption("");

console.log("\nEditor de producto");
await page.fill("#p-search", "Timón Fiend Reynolds"); await page.waitForTimeout(300);
await page.locator('[data-edit="timon-fiend-reynolds"]').first().click(); await page.waitForTimeout(400);
const editorSelects = await page.locator("#ed-brand, #ed-cat, #ed-sub").count();
t("el editor tiene sus desplegables (marca, categoría, sub)", editorSelects === 3, String(editorSelects));
await page.locator("#ed-brand").click();
await page.keyboard.type("subro");
t("marca: 'subro' -> Subrosa", (await opts()).length >= 1 && (await opts()).every(x => /subro/i.test(x)), JSON.stringify(await opts()));
t("la ventana queda dentro de la pantalla", await page.evaluate(() => { const r = document.querySelector(".cs-pop.open").getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; }));
await page.keyboard.press("Enter");
t("elegir una marca dispara el 'change' del editor", (await page.locator("#ed-brand").inputValue()) === "Subrosa");
t("el editor siguió abierto (Escape/Enter no lo cerraron)", await page.locator("#ed-save").isVisible());
await page.locator("#ed-brand").click();
await page.keyboard.press("Escape");
t("Escape en la lista NO cierra el editor", await page.locator("#ed-save").isVisible() && await closed());

console.log("\nTodos los desplegables del panel");
/* Hace clic de verdad (con el mouse) sobre cada <select> que se ve y comprueba que abre con barra. */
async function sweep(label, scopeSel) {
  const total = await page.evaluate(sc => document.querySelectorAll(sc + " select").length, scopeSel);
  let tried = 0, ok = 0; const missing = [];
  for (let i = 0; i < total; i++) {
    const info = await page.evaluate(([sc, i]) => {
      const el = document.querySelectorAll(sc + " select")[i];
      if (!el || el.disabled || el.offsetParent === null) return null;
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      const x = r.left + Math.min(r.width / 2, 30), y = r.top + r.height / 2;
      const top = document.elementFromPoint(x, y);
      return { x, y, hit: top === el, name: el.id || el.getAttribute("data-photo-color") || el.className || el.tagName };
    }, [scopeSel, i]);
    if (!info || !info.hit) continue;
    tried++;
    await page.mouse.click(info.x, info.y);
    await wait(40);
    if ((await page.locator(".cs-pop.open .cs-q").count()) === 1) { ok++; await page.keyboard.press("Escape"); } else missing.push(info.name);
  }
  t(`${label}: ${ok} de ${tried} desplegables visibles abren con barra de búsqueda`, tried > 0 && ok === tried, `faltan: ${missing.join(", ")}`);
  return tried;
}
await sweep("con el editor abierto", "body");
await page.evaluate(() => { const c = document.querySelector("#ed-close, #ed-cancel, [data-ed-close]"); if (c) c.click(); });
await page.keyboard.press("Escape");
await wait(300);
await sweep("filtros del inventario", "body");

console.log("\nVenta rápida");
await page.locator("#ed-cancel, .ed-close, #ed-close").first().click().catch(() => {});
await page.keyboard.press("Escape");
await page.locator('[data-panel="ventas"]').click().catch(() => {}); await page.waitForTimeout(300);
if (await page.locator("#sale-product").isVisible()) {
  await page.locator("#sale-product").click();
  await page.keyboard.type("trooper");
  const sp = await opts();
  t("producto de la venta: 'trooper' deja solo los pedales Trooper", sp.length >= 1 && sp.every(x => /trooper/i.test(x)), JSON.stringify(sp));
  await page.keyboard.press("Enter");
  t("elegirlo carga el producto", /trooper/i.test(await page.locator("#sale-product option:checked").innerText()));
} else console.log("      (la pestaña de ventas no se mostró: se omite)");

t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
await br.close();
console.log(fail ? `\n${fail} falla(s)` : "\nTodo bien");
process.exit(fail ? 1 : 0);
