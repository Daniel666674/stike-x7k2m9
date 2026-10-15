/* Prueba de variantes (colores redondos, tallas, combos, roles). Servir el repo en :8140 (python3 -m http.server 8140) y correr: node tools/admin-roles-test.mjs */
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(process.env.PW_MODULES || "/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const ROOT = process.cwd(), B = "http://localhost:8140";
const br = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
let fail = 0;
const t = (l, ok, extra = "") => { if (!ok) fail++; console.log((ok ? "ok    " : "FALLA ") + l + (ok ? "" : "  -> " + extra)); };

async function open(role) {
  const ctx = await br.newContext({ viewport: { width: 1300, height: 900 } });
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", e => errs.push(e.message));
  const puts = []; page._puts = puts; page._errs = errs;
  await page.route("**/api/admin-login", r => r.fulfill({ json: { email: "x@test.com", role } }));
  await page.route("**/api/admin-health", r => r.fulfill({ json: { ok: true } }));
  await page.route("**/api/sales", r => r.fulfill({ json: [] }));
  await page.route("**/api/gh?**", async r => {
    const req = r.request(); const path = new URL(req.url()).searchParams.get("path");
    if (req.method() === "GET") {
      const f = ROOT + "/" + path;
      if (!fs.existsSync(f)) return r.fulfill({ status: 404, json: {} });
      return r.fulfill({ json: { sha: "sha-" + path, content: fs.readFileSync(f).toString("base64") } });
    }
    puts.push({ path, body: req.postDataJSON() });
    return r.fulfill({ json: { content: { sha: "new" }, commit: { sha: "c" } } });
  });
  await page.goto(B + "/admin.html", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  return page;
}

// ---- dueño: editor con tabla talla x color
{
  const page = await open("owner");
  await page.fill("#p-search", "Camiseta Fate BMX");
  await page.waitForTimeout(300);
  await page.locator('[data-edit="camiseta-fate-bmx"]').first().click();
  await page.waitForTimeout(300);
  t("la tabla talla x color aparece", await page.locator("#ed-combos-box table").count() === 1);
  t("2 colores x 2 tallas = 4 celdas", await page.locator("#ed-combos-box input").count() === 4);
  t("circulos de color en el editor", await page.locator("#ed-colors-table .cdot").count() === 2);
  t("las pools quedan de solo lectura", await page.locator("#ed-sizes-box [data-size-u]").first().evaluate(e => e.readOnly));
  const cell = page.locator('#ed-combos-box input[data-combo-s="L"][data-combo-c="Negro"]');
  await cell.fill("3");
  const lU = await page.locator("#ed-sizes-box [data-size-u]").nth(1).inputValue();   // talla L = Blanco 1 + Negro 3
  t("la talla L suma 4 al cambiar la celda", lU === "4", lU);
  await page.locator("#ed-save").click();
  await page.waitForTimeout(300);
  t("sin errores JS en el editor", page._errs.length === 0, page._errs.join("|"));
  // vender uno
  await page.locator('[data-panel="ventas"]').click();
  await page.waitForTimeout(200);
  await page.selectOption("#sale-product", "camiseta-fate-bmx");
  await page.waitForTimeout(200);
  t("la venta ofrece talla y color", await page.locator("#sale-size-field").isVisible() && await page.locator("#sale-color-field").isVisible());
  await page.close();
}

// ---- tienda (Kevin): limitado
{
  const page = await open("staff");
  const hidden = async sel => !(await page.locator(sel).first().isVisible());
  t("tienda: no ve KPIs", await hidden('[data-panel="kpis"]'));
  t("tienda: no ve Auditoría", await hidden('[data-panel="auditoria"]'));
  t("tienda: no ve Configuración", await hidden('[data-panel="config"]'));
  t("tienda: no ve Contenido del sitio", await hidden('[data-panel="contenido"]'));
  t("tienda: no ve Nuevo producto", await hidden("#btn-new-product"));
  t("tienda: no ve Publicar cambios", await hidden("#btn-publish"));
  t("tienda: SI ve Productos y Ventas", await page.locator('[data-panel="productos"]').isVisible() && await page.locator('[data-panel="ventas"]').isVisible());
  t("tienda: pill dice Tienda", (await page.locator("#session-info .pill").first().textContent()).includes("Tienda"));
  await page.locator('[data-panel="ventas"]').click();
  const kpis = await page.locator("#sales-kpis").innerText();
  t("tienda: sin ingresos ni ticket promedio", !/Ventas \(30d\)|Ticket promedio/i.test(kpis), kpis.replace(/\n/g, " "));
  t("tienda: sin errores JS", page._errs.length === 0, page._errs.join("|"));
  await page.close();
}
for (const role of ["admin", "dev_assistant", "developer"]) {
  const page = await open(role);
  t(role + ": ve KPIs y Configuración", await page.locator('[data-panel="kpis"]').isVisible() && await page.locator('[data-panel="config"]').isVisible());
  await page.close();
}
await br.close();
console.log(fail ? `\n${fail} fallaron` : "\ntodo ok");
process.exit(fail ? 1 : 0);
