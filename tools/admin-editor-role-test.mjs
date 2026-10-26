/* =========================================================================
   Prueba del panel con el rol «editor» (diseño y contenido, Rubí):
   solo ve Productos y Contenido del sitio, nada de costos ni ventas, y al
   publicar NO escribe los costos (su copia los trae en 0 y los pisaría).

     python3 -m http.server 8143   (en la raiz del repo)
     node tools/admin-editor-role-test.mjs
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
const prod = JSON.parse(raw.slice(raw.indexOf(MARK) + MARK.length, raw.lastIndexOf(";"))).find(p => p.published !== false && !p.sizes && !p.colors);

async function open(role) {
  const page = await br.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [], calls = [], apiHits = [];
  page.on("pageerror", e => errs.push(e.message));
  page.on("dialog", d => d.accept());
  await page.route("**/api/admin-login", r => r.fulfill({ json: { email: "rubi@test.com", role } }));
  await page.route("**/api/admin-health", r => r.fulfill({ json: { ok: true } }));
  await page.route("**/api/sales", r => { apiHits.push("sales"); r.fulfill(role === "editor" ? { status: 403, json: { error: "role_not_allowed" } } : { json: [] }); });
  await page.route("**/api/gh?**", async r => {
    const req = r.request(), p = new URL(req.url()).searchParams.get("path");
    if (req.method() === "GET") {
      if (role === "editor" && (p === "data/costs.json" || p === "data/sales-log.json")) return r.fulfill({ status: 404, json: {} });   // como el servidor
      const f = ROOT + "/" + p;
      return fs.existsSync(f) ? r.fulfill({ json: { sha: "s-" + p, content: fs.readFileSync(f).toString("base64") } }) : r.fulfill({ status: 404, json: {} });
    }
    calls.push({ method: req.method(), path: p });
    return r.fulfill({ json: { content: { sha: "n" }, commit: { sha: "c" } } });
  });
  await page.goto(B + "/admin.html", { waitUntil: "networkidle" });
  await wait(1000);
  return { page, errs, calls, apiHits };
}
const vis = (page, sel) => page.locator(sel).first().isVisible();

console.log("\nEl editor ve solo lo suyo");
{
  const { page, errs, calls, apiHits } = await open("editor");
  t("ve Productos y Contenido del sitio", await vis(page, '.navbtn[data-panel="productos"]') && await vis(page, '.navbtn[data-panel="contenido"]'));
  t("NO ve Ventas, KPIs, Auditoría ni Configuración", !(await vis(page, '.navbtn[data-panel="ventas"]')) && !(await vis(page, '.navbtn[data-panel="kpis"]')) && !(await vis(page, '.navbtn[data-panel="auditoria"]')) && !(await vis(page, '.navbtn[data-panel="config"]')));
  t("sin campana de ventas, sin «probar sonido» y sin botones «Vender»", !(await vis(page, "#btn-notif")) && !(await vis(page, "#btn-test-sound")) && !(await vis(page, "[data-sell]")));
  t("su etiqueta dice «Diseño y contenido»", /Diseño y contenido/.test(await page.locator("#session-info").textContent()));
  t("ni siquiera pide las ventas de los clientes al servidor", apiHits.length === 0, apiHits.join(","));
  await page.evaluate(() => switchPanel("kpis"));
  t("si intenta abrir KPIs por la fuerza, vuelve a Productos", await page.evaluate(() => currentPanelName()) === "productos");
  await page.evaluate(() => switchPanel("contenido"));
  await page.waitForSelector("[data-ct-input]", { timeout: 15000 });
  t("Contenido del sitio sí abre (con su vista previa)", await page.locator("#ct-pv").count() === 1 && await page.locator("[data-ct-input]").count() > 20);

  await page.evaluate(() => switchPanel("productos"));
  await page.fill("#p-search", prod.n.slice(0, 25)); await wait(300);
  await page.locator(`[data-edit="${prod.slug}"]`).first().click(); await wait(400);
  t("en el editor de producto NO aparece el costo", await page.locator("#ed-cost").count() === 0);
  t("pero sí puede guardar y publicar", await page.locator("#ed-save").isVisible() && await page.locator("#btn-publish").isVisible());
  await page.fill("#ed-n", prod.n + " "); await page.dispatchEvent("#ed-n", "input");
  await page.locator("#ed-save").click(); await wait(300);
  await page.locator("#btn-publish").click(); await wait(2500);
  const paths = calls.map(c => c.method + " " + c.path);
  t("al publicar escribe el catálogo y la ficha", paths.includes("PUT assets/js/products-data.js") && paths.includes(`PUT producto/${prod.slug}.html`), paths.join(" | "));
  t("y NO toca los costos (si no, los pondría todos en 0)", !paths.some(x => /costs\.json|sales-log/.test(x)), paths.join(" | "));
  t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
  await page.close();
}

console.log("\nLos demás roles no cambian");
{
  const { page, errs, calls } = await open("owner");
  t("el dueño sigue viendo todo (Ventas, KPIs, Auditoría, Configuración)", await vis(page, '.navbtn[data-panel="ventas"]') && await vis(page, '.navbtn[data-panel="kpis"]') && await vis(page, '.navbtn[data-panel="auditoria"]') && await vis(page, '.navbtn[data-panel="config"]'));
  await page.fill("#p-search", prod.n.slice(0, 25)); await wait(300);
  await page.locator(`[data-edit="${prod.slug}"]`).first().click(); await wait(400);
  t("y sigue viendo el costo en el editor", await page.locator("#ed-cost").count() === 1);
  await page.fill("#ed-n", prod.n + " "); await page.dispatchEvent("#ed-n", "input");
  await page.locator("#ed-save").click(); await wait(300);
  await page.locator("#btn-publish").click(); await wait(2500);
  t("el dueño al publicar SÍ guarda los costos", calls.some(c => c.path === "data/costs.json"));
  t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
  await page.close();
}
{
  const { page } = await open("staff");
  t("la tienda (staff) sigue con Productos y Ventas, y sin Contenido", await vis(page, '.navbtn[data-panel="ventas"]') && !(await vis(page, '.navbtn[data-panel="contenido"]')));
  await page.close();
}

await br.close();
console.log(fail ? `\n${fail} falla(s)` : "\nTodo bien");
process.exit(fail ? 1 : 0);
