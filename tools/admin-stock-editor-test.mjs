/* =========================================================================
   Prueba del editor de tallas y colores del panel (renderStockEditor en admin.js):
   grande, con encabezados, atajos de un toque (sugerencias de talla y de color)
   y botones − / + junto a las cantidades.

     python3 -m http.server 8143   (en la raiz del repo)
     node tools/admin-stock-editor-test.mjs
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

async function open(viewport) {
  const page = await br.newPage({ viewport });
  const errs = []; page.on("pageerror", e => errs.push(e.message));
  await page.route("**/api/admin-login", r => r.fulfill({ json: { email: "x@test.com", role: "owner" } }));
  await page.route("**/api/admin-health", r => r.fulfill({ json: { ok: true } }));
  await page.route("**/api/sales", r => r.fulfill({ json: [] }));
  await page.route("**/api/gh?**", r => { const path = new URL(r.request().url()).searchParams.get("path"); const f = ROOT + "/" + path; if (r.request().method() !== "GET") return r.fulfill({ json: { content: { sha: "n" }, commit: { sha: "c" } } }); return fs.existsSync(f) ? r.fulfill({ json: { sha: "s", content: fs.readFileSync(f).toString("base64") } }) : r.fulfill({ status: 404, json: {} }); });
  await page.goto(B + "/admin.html", { waitUntil: "networkidle" }); await page.waitForTimeout(800);
  return { page, errs };
}
const draft = (page, f) => page.evaluate(f);

{
  const { page, errs } = await open({ width: 1300, height: 1000 });
  await page.locator("#btn-new-product").click(); await wait(400);

  console.log("\nProducto sin tallas ni colores");
  const sw = await page.locator("#ed-has-sizes").boundingBox();
  t("los interruptores de Tallas y Colores son grandes y se ven", sw.width >= 44 && sw.height >= 24, JSON.stringify(sw));
  t("hay un campo de unidades con botones − / +", await page.locator("#ed-units-field .stp").count() === 2);
  await page.locator('#ed-units-field [data-stp="1"]').click();
  await page.locator('#ed-units-field [data-stp="1"]').click();
  t("+ suma unidades (2)", (await page.locator("#ed-units").inputValue()) === "2" && await draft(page, () => editorDraft.units) === 2);
  await page.locator('#ed-units-field [data-stp="-1"]').click();
  await page.locator('#ed-units-field [data-stp="-1"]').click();
  await page.locator('#ed-units-field [data-stp="-1"]').click();
  t("− nunca baja de 0", (await page.locator("#ed-units").inputValue()) === "0" && await draft(page, () => editorDraft.units) === 0);

  console.log("\nTallas");
  await page.selectOption("#ed-cat", "ropa"); await page.selectOption("#ed-sub", "Camisetas"); await wait(300);
  t("camisetas: 5 tallas listas (S–XXL)", await page.locator("#ed-sizes-box [data-size-v]").count() === 5);
  const heads = await page.locator("#ed-sizes-box .stk-cols").innerText();
  t("encabezados claros: Talla / Unidades / Precio", /talla/i.test(heads) && /unidades/i.test(heads) && /precio/i.test(heads), heads);
  const inp = await page.locator('#ed-sizes-box [data-size-u="0"]').boundingBox();
  t("las casillas son altas (>= 40 px)", inp.height >= 40, String(inp.height));
  await page.locator('#ed-sizes-box .stk-row').nth(0).locator('[data-stp="1"]').click();
  await page.locator('#ed-sizes-box .stk-row').nth(0).locator('[data-stp="1"]').click();
  await page.locator('#ed-sizes-box .stk-row').nth(0).locator('[data-stp="1"]').click();
  t("+ sube la talla S a 3", (await page.locator('#ed-sizes-box [data-size-u="0"]').inputValue()) === "3" && await draft(page, () => editorDraft.sizes[0].u) === 3);
  await page.locator('#ed-sizes-box [data-size-u="1"]').fill("7");
  t("escribir el número a mano sigue funcionando", await draft(page, () => editorDraft.sizes[1].u) === 7);
  t("las tallas que ya están no se ofrecen otra vez como sugerencia", await page.locator("#ed-size-chips [data-add-size]").count() === 0);
  await page.locator('#ed-sizes-box [data-size-rm="4"]').click();
  t("✕ quita la talla XXL", await page.locator("#ed-sizes-box [data-size-v]").count() === 4);
  const chip = page.locator('#ed-size-chips [data-add-size="XXL"]');
  t("XXL vuelve a aparecer como sugerencia de un toque", await chip.count() === 1);
  await chip.click();
  t("tocar la sugerencia la agrega", await page.locator("#ed-sizes-box [data-size-v]").count() === 5 && await draft(page, () => editorDraft.sizes[4].v) === "XXL");
  t("y deja el cursor en sus unidades, listo para escribir", await page.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-size-u") === "4"));
  await page.locator("#ed-size-add").click();
  t("'Agregar otra talla' crea una fila y deja el cursor en su nombre", await page.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-size-v") === "5"));
  await page.keyboard.type("XXXL");
  t("lo que se teclea reemplaza el nombre", await draft(page, () => editorDraft.sizes[5].v) === "XXXL");

  console.log("\nColores");
  await page.locator("label.stk-switch:has(#ed-has-colors)").click(); await wait(200);
  t("activar Colores muestra sugerencias con su círculo de color", await page.locator("#ed-color-chips [data-add-color]").count() >= 15 && await page.locator("#ed-color-chips .cdot").count() >= 15);
  await page.locator('#ed-color-chips [data-add-color="Rojo"]').click();
  t("tocar 'Rojo' agrega el color", await draft(page, () => editorDraft.colors.map(c => c.v)).then(a => a.includes("Rojo")), JSON.stringify(await draft(page, () => editorDraft.colors)));
  t("Rojo ya no aparece como sugerencia", await page.locator('#ed-color-chips [data-add-color="Rojo"]').count() === 0);
  t("cada color tiene su círculo en la fila", await page.locator("#ed-colors-table .stk-row .cdot").count() === await page.locator("#ed-colors-table .stk-row").count());
  await page.locator("#ed-color-add").click();
  t("'Agregar otro color' deja el cursor en el nombre", await page.evaluate(() => document.activeElement && document.activeElement.hasAttribute("data-color-v")));
  await page.keyboard.type("Verde militar");
  t("el nombre queda guardado", await draft(page, () => editorDraft.colors.some(c => c.v === "Verde militar")));
  t("el color verde militar pinta su círculo", await page.locator("#ed-colors-table .stk-row").last().locator(".cdot").evaluate(e => e.style.background !== ""));

  console.log("\nTabla talla x color");
  const ch = await page.locator("#ed-combos-box [data-combo-s]").first().boundingBox();
  t("la tabla de stock por combinación tiene casillas grandes", ch.height >= 40 && ch.width >= 70, JSON.stringify(ch));
  t("cada fila dice el nombre del color (no solo el círculo)", /Rojo/.test(await page.locator("#ed-combos-box").innerText()));
  t("con tabla, las cantidades de arriba son suma (− / + apagados)", await page.locator("#ed-sizes-box .stepper.ro").count() > 0);
  const before = await page.locator('#ed-sizes-box [data-size-u="0"]').inputValue();
  await page.locator('#ed-sizes-box .stk-row').nth(0).locator('[data-stp="1"]').click({ force: true }).catch(() => {});
  t("y no cambian la suma por error", (await page.locator('#ed-sizes-box [data-size-u="0"]').inputValue()) === before);
  await page.locator('#ed-combos-box input[data-combo-s="S"][data-combo-c="Rojo"]').fill("4");
  t("escribir en la tabla actualiza la suma de arriba", (await page.locator('#ed-sizes-box [data-size-u="0"]').inputValue()) === "4" && await draft(page, () => editorDraft.sizes[0].u) === 4);
  const nBefore = await page.locator("#ed-colors-table .stk-row").count();
  await page.locator('#ed-colors-table [data-color-rm="1"]').click();
  t("✕ quita el color", await page.locator("#ed-colors-table .stk-row").count() === nBefore - 1 && await draft(page, () => editorDraft.colors.length) === nBefore - 1);

  console.log("\nFotos");
  const sel = await page.locator("#ed-photogrid select").count();
  console.log("      (sin fotos nuevas: el selector de color de las fotos aparece al subirlas; selectores:", sel + ")");
  t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
  await page.close();
}

{
  console.log("\nCelular (390 px)");
  const { page, errs } = await open({ width: 390, height: 800 });
  await page.locator("#btn-new-product").click(); await wait(400);
  await page.selectOption("#ed-cat", "ropa"); await page.selectOption("#ed-sub", "Camisetas"); await wait(200);
  await page.locator("label.stk-switch:has(#ed-has-colors)").click(); await wait(200);
  await page.locator('#ed-color-chips [data-add-color="Rojo"]').click(); await wait(200);
  const over = await page.evaluate(() => { const d = document.querySelector("#editor, .drawer, .editor, .overlay .panel") || document.body; return [...document.querySelectorAll("#ed-sizes-box, #ed-colors-box, #ed-combos-box")].map(e => e.scrollWidth - e.clientWidth); });
  t("las filas de tallas/colores no se salen de la pantalla", over.every(x => x <= 1), JSON.stringify(over));
  t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
  await page.close();
}
await br.close();
console.log(fail ? `\n${fail} falla(s)` : "\nTodo bien");
process.exit(fail ? 1 : 0);
