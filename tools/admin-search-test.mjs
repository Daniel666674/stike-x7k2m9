/* =========================================================================
   Prueba de la búsqueda global del panel (Ctrl+K) y del buscador de la pestaña
   Ventas (busqueda en admin.js, seccion BUSQUEDA GLOBAL).

     python3 -m http.server 8143   (en la raiz del repo)
     node tools/admin-search-test.mjs
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
let lastDialog = null;
page.on("dialog", d => { lastDialog = d.message(); d.dismiss(); });
await page.route("**/api/admin-login", r => r.fulfill({ json: { email: "x@test.com", role: "owner" } }));
await page.route("**/api/admin-health", r => r.fulfill({ json: { ok: true } }));
await page.route("**/api/sales", r => r.fulfill({ json: [] }));
await page.route("**/api/gh?**", r => { const path = new URL(r.request().url()).searchParams.get("path"); const f = ROOT + "/" + path; if (r.request().method() !== "GET") return r.fulfill({ json: { content: { sha: "n" }, commit: { sha: "c" } } }); return fs.existsSync(f) ? r.fulfill({ json: { sha: "s", content: fs.readFileSync(f).toString("base64") } }) : r.fulfill({ status: 404, json: {} }); });
await page.goto(B + "/admin.html", { waitUntil: "networkidle" }); await wait(800);

const open = () => page.locator("#cmdk.open").count().then(n => n === 1);
const rows = () => page.locator("#cmdk-list .sr-row").evaluateAll(a => a.map(r => r.querySelector("b").textContent));

console.log("\nLa barra está en todo el panel");
for (const [name, label] of [["productos", "Productos"], ["ventas", "Ventas"], ["kpis", "KPIs"], ["auditoria", "Auditoría"], ["contenido", "Contenido"], ["config", "Configuración"]]) {
  await page.locator(`.navbtn[data-panel="${name}"]`).click(); await wait(150);
  t(`${label}: la barra de búsqueda se ve arriba`, await page.locator("#cmdk-open").isVisible());
}
await page.locator('.navbtn[data-panel="productos"]').click();
t("muestra el atajo Ctrl K", /K/.test(await page.locator("#cmdk-kbd").innerText()));

console.log("\nAbrir y cerrar");
await page.locator("#cmdk-open").click();
t("clic en la barra abre la búsqueda", await open());
t("el cursor ya está escribiendo", await page.evaluate(() => document.activeElement.id === "cmdk-q"));
t("sin texto ofrece secciones y acciones", /ir a/i.test(await page.locator("#cmdk-list").innerText()));
await page.keyboard.press("Escape");
t("Esc cierra", !(await open()));
await page.locator("body").click({ position: { x: 600, y: 300 } });
await page.keyboard.press("Control+k");
t("Ctrl+K abre", await open());
await page.keyboard.press("Control+k");
t("Ctrl+K otra vez cierra", !(await open()));
await page.locator("#p-search").focus();
await page.keyboard.press("Control+k");
t("Ctrl+K funciona incluso dentro de un campo de texto", await open());
await page.keyboard.press("Escape");
await page.locator("body").click({ position: { x: 600, y: 300 } });
await page.keyboard.press("/");
t("'/' abre la búsqueda fuera de los campos", await open());
await page.keyboard.press("Escape");

console.log("\nBuscar productos");
await page.keyboard.press("Control+k");
await page.keyboard.type("marco fate");
const r1 = await rows();
t("'marco fate' encuentra el Marco Fate Namaste V2", r1.some(x => /Marco Fate Namaste V2/.test(x)), JSON.stringify(r1));
t("y lo pone de primero", /Marco Fate Namaste V2/.test(r1[0] || ""), r1[0]);
const row0 = await page.locator("#cmdk-list .sr-row").first().innerText();
t("la fila muestra marca, SKU, precio y stock", /REP-FAT-010/.test(row0) && /\$/.test(row0) && /stock|Quedan|Agotado/i.test(row0), row0.replace(/\n/g, " | "));
await page.keyboard.type(" zzzz");
t("sin coincidencias avisa", /No encontré/.test(await page.locator("#cmdk-list").innerText()));
await page.keyboard.press("Control+a"); await page.keyboard.type("silla tripode");
t("no importan las tildes ('tripode' encuentra Trípode)", (await rows()).some(x => /Trípode/.test(x)), JSON.stringify(await rows()));
await page.keyboard.press("Control+a"); await page.keyboard.type("REP-FAT-010");
t("el SKU exacto va de primero", /Marco Fate Namaste V2/.test((await rows())[0] || ""));
await page.keyboard.press("Control+a"); await page.keyboard.type("decaye amarill");
const r2 = await rows();
t("varias palabras: 'decaye amarill' deja solo las Decaye amarillas", r2.length >= 2 && r2.every(x => /decaye/i.test(x)) , JSON.stringify(r2));
t("las letras que coinciden se resaltan", (await page.locator("#cmdk-list mark").count()) > 0);

console.log("\nAcciones sobre el resultado");
await page.keyboard.press("Control+a"); await page.keyboard.type("REP-FAT-010");
await page.keyboard.press("Enter");
await wait(400);
t("Enter abre el editor de ese producto", !(await open()) && (await page.locator("#ed-n").inputValue()) === "Marco Fate Namaste V2");
t("el editor muestra las dos medidas con su stock", (await page.locator('#ed-sizes-box [data-size-u="0"]').inputValue()) === "1" && (await page.locator('#ed-sizes-box [data-size-u="1"]').inputValue()) === "28");
// con el editor abierto y SIN cambios, cambiar de producto no pregunta
lastDialog = null;
await page.keyboard.press("Control+k"); await page.keyboard.type("REP-FIE-001"); await page.keyboard.press("Enter"); await wait(300);
t("sin cambios sin guardar, cambia de producto sin preguntar", lastDialog === null && /Caña Fiend Mills/.test(await page.locator("#ed-n").inputValue()));
// con cambios: pregunta
await page.fill("#ed-n", "Caña Fiend Mills EDITADA");
await page.keyboard.press("Control+k"); await page.keyboard.type("REP-FAT-010"); await page.keyboard.press("Enter"); await wait(300);
t("con cambios sin guardar, pregunta antes de descartarlos", /sin guardar/.test(lastDialog || ""), String(lastDialog));
t("y si dice que no, se queda con lo que tenía", (await page.locator("#ed-n").inputValue()) === "Caña Fiend Mills EDITADA");
await page.keyboard.press("Escape"); await wait(100);
await page.locator("#ed-close").click(); await wait(200);
await page.keyboard.press("Control+k"); await page.keyboard.type("REP-FAT-010");
await page.keyboard.press("Control+Enter"); await wait(400);
t("Ctrl+Enter abre la venta rápida de ese producto", /Marco Fate Namaste V2/.test(await page.locator("#sale-modal").innerText()));
await page.locator("#qs-cancel").click(); await wait(150);
await page.keyboard.press("Control+k"); await page.keyboard.type("Pedales Cinema Tilt");
await page.keyboard.press("Control+Enter"); await wait(300);
t("un producto agotado no se puede vender desde la búsqueda", !(await page.locator("#sale-overlay.open").count()));
await page.keyboard.press("Escape");

console.log("\nPestaña Ventas");
await page.locator('.navbtn[data-panel="ventas"]').click(); await wait(300);
t("al entrar a Ventas el cursor ya está en el buscador", await page.evaluate(() => document.activeElement.id === "sale-q"));
t("no hay producto elegido de entrada (ya no queda el primero de la lista)", (await page.locator("#sale-product").inputValue()) === "");
await page.keyboard.type("grips odi");
t("al escribir salen los productos debajo", (await page.locator("#sale-results .sr-row").count()) >= 1 && await page.locator("#sale-results").isVisible());
const names = await page.locator("#sale-results .sr-row b").allInnerTexts();
t("y todos coinciden con lo escrito", names.every(x => /grips/i.test(x) && /odi/i.test(x)), JSON.stringify(names));
await page.keyboard.press("Enter"); await wait(250);
t("Enter elige el producto en el formulario", /ODI/i.test(await page.locator("#sale-product option:checked").innerText()));
t("y muestra su tarjeta (foto, precio, stock)", await page.locator("#sale-picked.has").isVisible() && /\$/.test(await page.locator("#sale-picked").innerText()));
t("el precio ya viene cargado", Number(await page.locator("#sale-price").inputValue()) > 0);
await page.locator("#sale-picked-clear").click(); await wait(150);
t("'Cambiar' deja todo listo para buscar otro", (await page.locator("#sale-product").inputValue()) === "" && await page.evaluate(() => document.activeElement.id === "sale-q"));
await page.keyboard.type("camiseta decaye letras amarillas");
await page.keyboard.press("Enter"); await wait(300);
t("un producto con tallas/colores: el cursor pasa a la talla", await page.evaluate(() => document.activeElement.id === "sale-size"), await page.evaluate(() => document.activeElement.id));
t("y aparecen los selectores de talla y color", await page.locator("#sale-size").isVisible() && await page.locator("#sale-color").isVisible());
await page.locator("#sale-q").focus(); await page.keyboard.type("Pedales Cinema Tilt");
t("un agotado sale marcado y no se elige", (await page.locator("#sale-results .sr-row.dis").count()) >= 1);
await page.keyboard.press("Enter"); await wait(200);
t("y no cambia el producto elegido", /Camiseta Decaye Letras Amarillas/.test(await page.locator("#sale-product option:checked").innerText()));
await page.locator("#sale-q").fill("");
await page.keyboard.press("Control+k");
t("Ctrl+K en Ventas abre la búsqueda global", await open());
await page.keyboard.type("trooper");
t("en Ventas el Enter dice 'elegir para la venta'", /elegir para la venta/.test(await page.locator("#cmdk-foot").innerText()));
await page.keyboard.press("Enter"); await wait(300);
t("y deja elegido el producto en el formulario", /Trooper/i.test(await page.locator("#sale-product option:checked").innerText()) && !(await open()));
await page.locator("#sale-qty").fill("1");
await page.locator("#btn-registrar-venta").click(); await wait(1200);
t("después de registrar, el formulario queda listo para la siguiente venta", (await page.locator("#sale-product").inputValue()) === "" && (await page.locator("#sale-qty").inputValue()) === "1", `${await page.locator("#sale-product").inputValue()} / ${await page.locator("#sale-qty").inputValue()}`);

console.log("\nVentas hechas: buscador del historial");
await page.locator('.navbtn[data-panel="ventas"]').click(); await wait(300);
const all = await page.evaluate(() => salesLog.length);
const trs = () => page.locator("#sales-tbody tr[data-sale-idx]").evaluateAll(a => a.map(r => r.innerText.replace(/\s+/g, " ")));
t("el historial tiene su barra de búsqueda", await page.locator("#sales-q").isVisible());
t("sin escribir muestra todas las ventas", (await trs()).length === all && /registrada/.test(await page.locator("#sales-count").innerText()), String((await trs()).length) + "/" + all);
await page.locator("#sales-q").fill("fate");
let r = await trs();
t("'fate' deja solo las ventas de productos Fate", r.length === 3 && r.every(x => /fate/i.test(x)), JSON.stringify(r));
t("dice cuántas de cuántas", new RegExp(`3 de ${all}`).test(await page.locator("#sales-count").innerText()), await page.locator("#sales-count").innerText());
t("y resume las unidades vendidas", /3 ventas · 6 unidades/.test(await page.locator("#sales-summary").innerText()), await page.locator("#sales-summary").innerText());
t("las letras que coinciden se resaltan", (await page.locator("#sales-tbody mark").count()) > 0);
await page.locator("#sales-q").fill("cromado");
r = await trs(); t("busca también por color ('cromado' -> Plato Fate Garuda)", r.length === 1 && /Garuda/.test(r[0]), JSON.stringify(r));
await page.locator("#sales-q").fill("1022");
r = await trs(); t("y por talla/medida ('1022' -> Caja de Centro Fate)", r.length === 1 && /Caja de Centro/.test(r[0]), JSON.stringify(r));
await page.locator("#sales-q").fill("daniel");
r = await trs(); t("y por vendedor ('daniel' -> la venta de Daniel)", r.length === 1 && /Primo/.test(r[0]), JSON.stringify(r));
await page.locator("#sales-q").fill("REP-FAT-017");
r = await trs(); t("y por SKU del producto vendido", r.length === 1 && /Cadena Fate x KMC/.test(r[0]), JSON.stringify(r));
await page.locator("#sales-q").fill("octubre");
t("y por fecha ('octubre')", (await trs()).length === all);
await page.locator("#sales-q").fill("zzzz");
t("sin coincidencias lo dice", /No hay ventas que coincidan/.test(await page.locator("#sales-tbody").innerText()));
await page.locator("#sales-q").fill("fate");
await page.locator('#sales-range [data-range="30"]').click();
t("los periodos se combinan con la búsqueda", await page.locator('#sales-range [data-range="30"]').evaluate(e => e.classList.contains("active")) && (await trs()).length <= 3);
await page.locator('#sales-range [data-range="all"]').click();
await page.locator("#sales-tbody tr[data-sale-idx]").first().click(); await wait(200);
t("clic en una venta abre su detalle", /Detalle de la venta/.test(await page.locator("#confirm-modal").innerText()));
await page.locator("#sd-close").click(); await wait(100);
await page.locator("#sales-q").press("Escape");
t("Esc limpia la búsqueda y vuelven todas", (await page.locator("#sales-q").inputValue()) === "" && (await trs()).length === all);

console.log("\nVentas hechas dentro de Ctrl+K");
await page.keyboard.press("Control+k"); await page.keyboard.type("grips");
const secs = await page.locator("#cmdk-list .cmdk-sec").allInnerTexts();
t("aparece la sección 'Ventas hechas' con lo vendido de grips", secs.some(x => /ventas hechas/i.test(x)) && (await page.locator("#cmdk-list .sr-sale").count()) === 2, JSON.stringify(secs));
await page.locator("#cmdk-list .sr-sale").first().click(); await wait(250);
t("al elegir una venta se abre su detalle", /Detalle de la venta/.test(await page.locator("#confirm-modal").innerText()) && !(await open()));
await page.locator("#sd-close").click(); await wait(100);
await page.keyboard.press("Control+k"); await page.keyboard.type("a");
const verTodas = page.locator("#cmdk-list .sr-nav", { hasText: "en la pestaña Ventas" });
t("con muchas coincidencias ofrece 'Ver las N ventas en la pestaña Ventas'", await verTodas.count() === 1);
await verTodas.click(); await wait(300);
t("y las deja filtradas en el historial", (await page.locator("#sales-q").inputValue()) === "a" && (await trs()).length >= 1);
await page.locator("#sales-q").fill("");

t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
await br.close();
console.log(fail ? `\n${fail} falla(s)` : "\nTodo bien");
process.exit(fail ? 1 : 0);
