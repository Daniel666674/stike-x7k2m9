/* =========================================================================
   Panel > Configuración: el formulario «Correo de aviso de cada venta» (llave de
   Resend, quien recibe el aviso, remitente y correo de prueba).
   (Servidor simulado; la parte del servidor la cubre tools/admin-config-test.mjs.)

     python3 -m http.server 8143   (en la raiz del repo)
     node tools/admin-email-ui-test.mjs
   ========================================================================= */
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(process.env.PW_MODULES || "/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const ROOT = process.cwd(), B = "http://localhost:8143";
let fail = 0;
const t = (l, ok, x = "") => { if (!ok) fail++; console.log((ok ? "ok    " : "FALLA ") + l + (ok ? "" : "  -> " + x)); };
const br = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

/* state: lo que el «servidor» tiene hoy. */
async function open(role, state) {
  const page = await br.newPage({ viewport: { width: 1300, height: 1200 } });
  const errs = []; page.on("pageerror", e => errs.push(e.message));
  const posted = [];
  await page.route("**/api/admin-login", r => r.fulfill({ json: { email: "x@test.com", role } }));
  await page.route("**/api/sales", r => r.fulfill({ json: [] }));
  await page.route("**/api/admin-health", r => {
    const detail = !state.resend ? "Le llega a: j***@gmail.com. SIN Resend: sale por el correo del hosting, que muchas veces no se entrega o cae en spam." : `Le llega a: j***@gmail.com. Sale por Resend. Último envío (correo de prueba): hace 1 min ${state.lastOk ? "✔ por Resend." : "por el correo del hosting."}`;
    r.fulfill({ json: {
      ready: true, eventsUrl: "https://stikebikeshop.com/api/wompi-events",
      checks: [{ id: "wompi_keys", ok: true, label: "Llaves de Wompi", detail: "Producción" }, { id: "email", ok: !!state.resend && !!state.lastOk, label: "Correo de aviso de cada venta", detail }],
      mail: { recipients: state.recipients, recipientsFromPanel: false, from: state.from || "", resend: { configured: !!state.resend, source: state.resend ? "panel" : null, tail: state.resend ? state.resend.slice(-4) : null, length: state.resend ? state.resend.length : 0 }, queued: 0 },
    } });
  });
  await page.route("**/api/admin-config", async r => {
    const body = r.request().postDataJSON(); posted.push(body);
    if (body.action === "test_email") return r.fulfill({ json: state.testReply });
    if (body.clear) { if (body.key === "RESEND_API_KEY") state.resend = null; return r.fulfill({ json: { ok: true, cleared: true, key: body.key } }); }
    if (body.key === "RESEND_API_KEY") {
      if (!/^re_/.test(body.value.trim())) return r.fulfill({ status: 400, json: { error: "wrong_kind", detail: "Eso no es una llave de Resend (empieza por re_)." } });
      state.resend = body.value.trim();
      return r.fulfill({ json: { ok: true, key: body.key, length: state.resend.length, tail: state.resend.slice(-4), restricted: false, domains: state.domains } });
    }
    if (body.key === "OWNER_NOTIFY_EMAIL") { state.recipients = body.value.split(/[,\s;]+/).filter(Boolean); return r.fulfill({ json: { ok: true, key: body.key, value: state.recipients.join(", "), count: state.recipients.length } }); }
    if (body.key === "RESEND_FROM") { state.from = body.value.trim(); return r.fulfill({ json: { ok: true, key: body.key, value: state.from, usesTestSender: /resend\.dev/.test(state.from) } }); }
    r.fulfill({ status: 400, json: { error: "invalid_key" } });
  });
  await page.route("**/api/gh?**", r => { const path = new URL(r.request().url()).searchParams.get("path"), f = ROOT + "/" + path; if (r.request().method() !== "GET") return r.fulfill({ json: { content: { sha: "n" }, commit: { sha: "c" } } }); return fs.existsSync(f) ? r.fulfill({ json: { sha: "s", content: fs.readFileSync(f).toString("base64") } }) : r.fulfill({ status: 404, json: {} }); });
  await page.goto(B + "/admin.html", { waitUntil: "networkidle" }); await page.waitForTimeout(600);
  await page.evaluate(() => switchPanel("config")); await page.waitForTimeout(500);
  return { page, errs, posted };
}
const msg = page => page.locator("#cfg-mail-msg").innerText();

console.log("\nDueño, sin Resend (como está hoy)");
{
  const state = { resend: null, recipients: ["jparra375@gmail.com"], domains: [{ name: "stikebikeshop.com", status: "verified" }], testReply: { ok: true, via: "mail", reliable: false, to: "j***@gmail.com", resendConfigured: false, resendError: null } };
  const { page, errs, posted } = await open("owner", state);
  t("se ve el formulario del correo, con el aviso «Revisar»", (await page.locator("#cfg-mail-box").isVisible()) && /revisar/i.test(await page.locator("#cfg-mail-box h4").innerText()));
  t("la llave de Resend aparece como «Falta»", /falta/i.test(await page.locator("#cfg-mail-box").innerText()));
  t("el correo que recibe los avisos viene escrito (el dueño ve a dónde llegan)", (await page.locator("#cfg-mto-input").inputValue()) === "jparra375@gmail.com");
  t("la llave no se rellena nunca", (await page.locator("#cfg-mkey-input").inputValue()) === "");
  t("trae los pasos para activarlo en 5 minutos (resend.com → API Keys → Sending access → pegar)", await page.locator("#cfg-mail-box details").evaluate(d => /resend\.com/.test(d.textContent) && /Sending access/.test(d.textContent) && /Verify/.test(d.textContent)));
  t("el estado de arriba dice «SIN Resend»", /SIN Resend/.test(await page.locator("#cfg-health").innerText()));
  t("el botón viejo de prueba ya no está duplicado en «Si un cliente pagó…»", (await page.locator("#cfg-test-email").count()) === 1);

  await page.click("#cfg-mkey-save");
  t("guardar sin pegar nada pide pegar la llave (y no manda nada)", /Pega primero la llave/.test(await msg(page)) && posted.length === 0);

  await page.fill("#cfg-mkey-input", "prv_test_otra_cosa");
  await page.click("#cfg-mkey-save"); await page.waitForTimeout(400);
  t("si pega algo que no es de Resend: el servidor lo rechaza y el panel dice por qué", /Eso no es una llave de Resend/.test(await msg(page)));
  t("y manda solo la llave y el valor", JSON.stringify(Object.keys(posted[0]).sort()) === JSON.stringify(["key", "value"]) && posted[0].key === "RESEND_API_KEY");

  state.testReply = { ok: true, via: "resend", reliable: true, to: "j***@gmail.com", resendConfigured: true, resendError: null };
  state.lastOk = true;
  await page.fill("#cfg-mkey-input", "  re_llave_buena_1234567890abcdef ");
  await page.click("#cfg-mkey-save"); await page.waitForTimeout(1200);
  const m1 = await msg(page);
  t("con la llave buena: «Resend aceptó la llave», dominios verificados y, enseguida, el correo de prueba por Resend", /Resend aceptó la llave \(termina en …cdef\)/.test(m1) && /Dominios verificados en Resend: stikebikeshop\.com/.test(m1) && /Enviado por Resend a j\*\*\*@gmail\.com/.test(m1), m1);
  t("el correo de prueba se pidió solo, después de guardar", posted.some(p => p.action === "test_email"));
  t("el mensaje sale en verde", (await page.locator("#cfg-mail-msg").evaluate(e => getComputedStyle(e).color)) !== "");
  t("el estado de arriba pasa a ✔ «Funcionando» y la llave aparece guardada (…cdef), sin mostrarla", /funcionando/i.test(await page.locator("#cfg-mail-box h4").innerText()) && /termina en …cdef/.test(await page.locator("#cfg-mail-box").innerText()) && !(await page.content()).includes("re_llave_buena_1234567890abcdef"));
  t("el campo de la llave queda vacío", (await page.locator("#cfg-mkey-input").inputValue()) === "");

  state.testReply = { ok: true, via: "mail", reliable: false, to: "j***@gmail.com", resendConfigured: true, resendError: { code: "sandbox_only", detail: "Con el remitente de pruebas de Resend (onboarding@resend.dev) solo se puede enviar al correo con el que se creó la cuenta de Resend (otro@gmail.com)." } };
  await page.click("#cfg-test-email"); await page.waitForTimeout(900);
  const m2 = await msg(page);
  t("si Resend se niega: el panel dice «NO garantiza», «Resend falló» y el motivo exacto (en rojo)", /NO garantiza/.test(m2) && /Resend falló: Con el remitente de pruebas/.test(m2) && /otro@gmail\.com/.test(m2), m2);

  await page.fill("#cfg-mto-input", "dueno@gmail.com, socio@gmail.com");
  state.testReply = { ok: true, via: "resend", reliable: true, to: "d***@gmail.com, s***@gmail.com", resendConfigured: true, resendError: null };
  await page.click("#cfg-mto-save"); await page.waitForTimeout(1200);
  const m3 = await msg(page);
  t("cambiar quién recibe: manda la lista y confirma «llegarán a …» con prueba incluida", /llegarán a dueno@gmail\.com, socio@gmail\.com/.test(m3) && /Enviado por Resend a d\*\*\*@gmail\.com, s\*\*\*@gmail\.com/.test(m3), m3);
  t("la lista queda escrita en el campo para la próxima vez", (await page.locator("#cfg-mto-input").inputValue()) === "dueno@gmail.com, socio@gmail.com");

  await page.fill("#cfg-mfrom-input", "Stike Bike Shop <ventas@stikebikeshop.com>");
  await page.click("#cfg-mfrom-save"); await page.waitForTimeout(1200);
  t("el remitente se guarda y se prueba", /saldrán desde Stike Bike Shop <ventas@stikebikeshop\.com>/.test(await msg(page)) && posted.some(p => p.key === "RESEND_FROM"));

  await page.click("#cfg-mkey-clear"); await page.waitForTimeout(900);
  t("«Quitar lo guardado aquí» manda clear:true y vuelve a lo del servidor", posted.some(p => p.key === "RESEND_API_KEY" && p.clear === true) && /se quitó lo guardado aquí/.test(await msg(page)));
  t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
  await page.close();
}

console.log("\nEl correo no salió por ningún camino");
{
  const state = { resend: null, recipients: ["jparra375@gmail.com"], domains: [], testReply: { ok: false, via: null, reliable: false, to: "j***@gmail.com", error: "email_failed", resendConfigured: false, resendError: null } };
  const { page } = await open("developer", state);
  await page.click("#cfg-test-email"); await page.waitForTimeout(800);
  const m = await msg(page);
  t("el desarrollador también lo ve y, si nada pudo enviar, dice que pegue la llave (paso 1)", /No se pudo enviar el correo por ningún camino/.test(m) && /pégala arriba \(paso 1\)/.test(m), m);
  await page.close();
}

console.log("\nQuien no es dueño ni desarrollador");
for (const role of ["admin", "staff", "editor"]) {
  const { page } = await open(role, { resend: null, recipients: ["jparra375@gmail.com"], domains: [] });
  t(`rol ${role}: no ve el formulario de correo`, (await page.locator("#cfg-mail-box").count()) === 0 && (await page.locator("#cfg-test-email").count()) === 0);
  await page.close();
}
await br.close();
console.log(fail ? `\n${fail} falla(s)` : "\nTodo bien");
process.exit(fail ? 1 : 0);
