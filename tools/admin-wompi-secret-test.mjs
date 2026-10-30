/* =========================================================================
   Panel > Configuración: el formulario «Secreto de integridad de Wompi».
   (Servidor simulado; la parte del servidor la cubre tools/admin-config-test.mjs.)

     python3 -m http.server 8143   (en la raiz del repo)
     node tools/admin-wompi-secret-test.mjs
   ========================================================================= */
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(process.env.PW_MODULES || "/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const ROOT = process.cwd(), B = "http://localhost:8143";
let fail = 0;
const t = (l, ok, x = "") => { if (!ok) fail++; console.log((ok ? "ok    " : "FALLA ") + l + (ok ? "" : "  -> " + x)); };
const br = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

async function open(role, state) {
  const page = await br.newPage({ viewport: { width: 1300, height: 1000 } });
  const errs = []; page.on("pageerror", e => errs.push(e.message));
  const posted = [];
  await page.route("**/api/admin-login", r => r.fulfill({ json: { email: "x@test.com", role } }));
  await page.route("**/api/sales", r => r.fulfill({ json: [] }));
  await page.route("**/api/admin-health", r => r.fulfill({ json: {
    ready: state.ready, eventsUrl: "https://stikebikeshop.com/api/wompi-events",
    checks: [{ id: "wompi_keys", ok: state.ready, label: "Llaves de Wompi", detail: state.ready ? "Sandbox (pruebas, no cobra)" : "WOMPI_INTEGRITY_SECRET debe ser el SECRETO DE INTEGRIDAD, pero lo que hay parece la llave PRIVADA." }],
  } }));
  await page.route("**/api/admin-config", async r => {
    const body = r.request().postDataJSON(); posted.push(body);
    if (body.clear) return r.fulfill({ json: { ok: true, cleared: true } });
    if (!/^test_integrity_/.test((body.value || "").trim())) return r.fulfill({ status: 400, json: { error: "wrong_kind", detail: "Eso no es el SECRETO DE INTEGRIDAD; parece la llave PRIVADA." } });
    state.ready = true;
    const v = body.value.trim(); r.fulfill({ json: { ok: true, key: body.key, environment: "test", length: v.length, tail: v.slice(-4) } });
  });
  await page.route("**/api/gh?**", r => { const path = new URL(r.request().url()).searchParams.get("path"), f = ROOT + "/" + path; if (r.request().method() !== "GET") return r.fulfill({ json: { content: { sha: "n" }, commit: { sha: "c" } } }); return fs.existsSync(f) ? r.fulfill({ json: { sha: "s", content: fs.readFileSync(f).toString("base64") } }) : r.fulfill({ status: 404, json: {} }); });
  await page.goto(B + "/admin.html", { waitUntil: "networkidle" }); await page.waitForTimeout(600);
  await page.evaluate(() => switchPanel("config")); await page.waitForTimeout(500);
  return { page, errs, posted };
}

console.log("\nDueño, con el pago caído");
{
  const state = { ready: false };
  const { page, errs, posted } = await open("owner", state);
  t("se ve el formulario del secreto de integridad", await page.locator("#cfg-int-secret").isVisible());
  t("el menú Configuración tiene el punto rojo de «falta configurar»", await page.locator('.navbtn[data-panel="config"]').evaluate(e => e.classList.contains("needs")));
  await page.fill("#cfg-int-secret", "prv_test_la_privada");
  await page.click("#cfg-int-save");
  await page.waitForTimeout(400);
  t("si pega la llave privada: el servidor lo rechaza y el panel dice por qué", /parece la llave PRIVADA/.test(await page.locator("#cfg-int-msg").innerText()));
  t("y manda solo la llave y el valor (nada más)", JSON.stringify(Object.keys(posted[0]).sort()), JSON.stringify(["key", "value"]));
  await page.fill("#cfg-int-secret", "  test_integrity_AbCdEfGh12345678 ");
  await page.click("#cfg-int-save");
  await page.waitForTimeout(800);
  const msg = await page.locator("#cfg-int-msg").innerText();
  t("con el correcto: «Guardado», últimas 4 letras y ambiente", /Guardado/.test(msg) && /…5678/.test(msg) && /sandbox/.test(msg), msg);
  t("el panel se vuelve a revisar solo y dice «Listo para cobrar»", /Listo para cobrar/.test(await page.locator("#cfg-health").innerText()));
  t("el punto rojo desaparece", await page.locator('.navbtn[data-panel="config"]').evaluate(e => !e.classList.contains("needs")));
  t("el campo queda vacío (el secreto no se queda en pantalla)", (await page.locator("#cfg-int-secret").inputValue()) === "");
  await page.click("#cfg-int-clear");
  await page.waitForTimeout(600);
  t("«Quitar lo guardado aquí» manda clear:true", posted[posted.length - 1].clear === true);
  t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
  await page.close();
}

console.log("\nQuien no es dueño ni desarrollador");
for (const role of ["admin", "staff", "editor"]) {
  const { page } = await open(role, { ready: false });
  const visible = await page.locator("#cfg-int-secret").count();
  t(`rol ${role}: no ve el formulario`, visible === 0);
  await page.close();
}
await br.close();
console.log(fail ? `\n${fail} falla(s)` : "\nTodo bien");
process.exit(fail ? 1 : 0);
