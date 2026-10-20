/* =========================================================================
   Prueba del aviso de "Publicar cambios" del panel (showStatus en admin.js):
   el registro paso a paso (fotos, fusion, fichas, sitemap...) queda recogido,
   solo se abre solo si algo falla, y siempre se puede cerrar.

     python3 -m http.server 8143   (en la raiz del repo)
     node tools/admin-status-test.mjs
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

async function open(mode) {
  const page = await br.newPage({ viewport: { width: 1300, height: 900 } });
  const errs = []; page.on("pageerror", e => errs.push(e.message));
  await page.route("**/api/admin-login", r => r.fulfill({ json: { email: "x@test.com", role: "owner" } }));
  await page.route("**/api/admin-health", r => r.fulfill({ json: { ok: true } }));
  await page.route("**/api/sales", r => r.fulfill({ json: [] }));
  await page.route("**/api/gh?**", async r => {
    const path = new URL(r.request().url()).searchParams.get("path"), f = ROOT + "/" + path;
    if (r.request().method() !== "GET") {
      await wait(450);
      if (mode === "fail") return r.fulfill({ status: 500, json: { message: "boom" } });
      return r.fulfill({ json: { content: { sha: "n" }, commit: { sha: "c" } } });
    }
    return fs.existsSync(f) ? r.fulfill({ json: { sha: "s", content: fs.readFileSync(f).toString("base64") } }) : r.fulfill({ status: 404, json: {} });
  });
  await page.goto(B + "/admin.html", { waitUntil: "networkidle" }); await wait(800);
  return { page, errs };
}
async function edit(page) {
  await page.fill("#p-search", "Timón Fiend Reynolds"); await wait(300);
  await page.locator('[data-edit="timon-fiend-reynolds"]').first().click(); await wait(350);
  await page.fill("#ed-price", "351000"); await page.dispatchEvent("#ed-price", "input");
  await page.locator("#ed-save").click(); await wait(300);
}
const box = page => page.locator("#status-box");
const shown = async page => (await box(page).evaluate(e => e.classList.contains("show")));

console.log("\nPublicación que sale bien");
{
  const { page, errs } = await open("ok");
  await edit(page);
  await page.locator("#btn-publish").click(); await wait(300);
  t("mientras publica se ve el aviso compacto 'Publicando cambios…'", await shown(page) && /Publicando cambios/.test(await box(page).innerText()));
  t("con un indicador de que está trabajando", await page.locator("#status-box .st-spin").count() === 1);
  const txt = await box(page).innerText();
  t("el registro paso a paso NO se ve (nada de 'Fusionando', 'Sitemap', 'Subiendo foto')", !/Fusionando|sitemap|Subiendo|Regenerando/i.test(txt), txt.replace(/\n/g, " | "));
  t("tiene 'Ver detalles' y una ✕ para cerrar", await page.locator('#status-box [data-st="details"]').isVisible() && await page.locator('#status-box [data-st="close"]').isVisible());
  await page.locator('#status-box [data-st="details"]').click();
  await wait(100);
  t("'Ver detalles' abre el registro", /Fusionando|Regenerando|Subiendo/i.test(await box(page).innerText()) && /Ocultar detalles/.test(await box(page).innerText()));
  await page.locator('#status-box [data-st="details"]').click();
  t("'Ocultar detalles' lo vuelve a recoger", !/Fusionando|Regenerando/i.test(await box(page).innerText()));
  // no tapa los botones del editor
  await page.locator("#ed-save").waitFor({ state: "visible" }).catch(() => {});
  await wait(2500);
  const done = await box(page).innerText();
  t("al terminar dice 'Publicado'", /Publicado/.test(done), done.replace(/\n/g, " | "));
  t("y trae el resumen de lo publicado", /editado/.test(done));
  await wait(6600);
  t("se esconde solo unos segundos después", !(await shown(page)));
  t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
  await page.close();
}

console.log("\nCerrar a media publicación");
{
  const { page } = await open("ok");
  await edit(page);
  await page.locator("#btn-publish").click(); await wait(300);
  await page.locator('#status-box [data-st="close"]').click();
  t("la ✕ lo esconde", !(await shown(page)));
  await wait(3200);
  t("y no vuelve a asomar cuando termina bien", !(await shown(page)));
  t("pero la publicación sí terminó (botón Publicar apagado, sin cambios pendientes)", await page.locator("#btn-publish").isDisabled());
  await page.close();
}

console.log("\nPublicación que falla");
{
  const { page, errs } = await open("fail");
  await edit(page);
  await page.locator("#btn-publish").click(); await wait(2500);
  const f = await box(page).innerText();
  t("se muestra solo: 'No se pudo publicar'", /No se pudo publicar/.test(f), f.replace(/\n/g, " | "));
  t("con el error a la vista", await page.locator("#status-box .st-err .line.bad").count() >= 1);
  t("el registro completo sigue recogido, abre con 'Ver detalles'", !/Fusionando/i.test(f) && /Ver detalles/.test(f));
  await page.locator('#status-box [data-st="details"]').click();
  t("y al abrirlo muestra los pasos que alcanzó", /Fusionando|Subiendo|Regenerando/i.test(await box(page).innerText()));
  await wait(7500);
  t("un fallo NO se esconde solo", await shown(page));
  const eb = await page.locator("#ed-save, #ed-close").first().boundingBox();
  const sb = await box(page).boundingBox();
  t("no tapa los botones del editor", !eb || !sb || eb.x + eb.width < sb.x || sb.x + sb.width < eb.x || eb.y + eb.height < sb.y || sb.y + sb.height < eb.y, JSON.stringify({ eb, sb }));
  await page.locator('#status-box [data-st="close"]').click();
  t("se cierra con la ✕", !(await shown(page)));
  await page.close();
}

console.log("\nAvisos normales");
{
  const { page } = await open("ok");
  await page.locator("#btn-publish").evaluate(b => { b.disabled = false; });
  await page.evaluate(() => showStatus([{ text: "Listo: 263 productos.", cls: "ok" }]));
  t("un aviso de una línea se ve tal cual y tiene ✕", /Listo: 263/.test(await box(page).innerText()) && await page.locator('#status-box [data-st="close"]').isVisible());
  await page.locator('#status-box [data-st="close"]').click();
  t("y se cierra", !(await shown(page)));
  await page.close();
}
await br.close();
console.log(fail ? `\n${fail} falla(s)` : "\nTodo bien");
process.exit(fail ? 1 : 0);
