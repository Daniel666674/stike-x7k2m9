/* =========================================================================
   Panel > Configuración: el formulario «Correo de aviso de cada venta»
   (A: correo del dominio por SMTP; B: Resend; C: Gmail por la API de Google Cloud; a quién le llega; correo de prueba).
   (Servidor simulado; la parte del servidor la cubren tools/admin-config-test.mjs
   y tools/smtp-mail-test.mjs.)

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
const REDIRECT = "https://stikebikeshop.com/api/gmail-callback";
const CLIENT_ID = "752305520255-7e2abc762p3saer5sube25jh9rt9jle7.apps.googleusercontent.com", CLIENT_SECRET = "GOCSPX-AbCdEfGh12345678-de-prueba";
async function open(role, state, query = "") {
  const page = await br.newPage({ viewport: { width: 1300, height: 1200 } });
  const errs = []; page.on("pageerror", e => errs.push(e.message));
  const posted = [];
  await page.route("**/api/admin-login", r => r.fulfill({ json: { email: "x@test.com", role } }));
  await page.route("**/api/sales", r => r.fulfill({ json: [] }));
  await page.route("**/api/admin-health", r => {
    const gOn = !!(state.gmail && state.gmail.sender);
    const via = state.resend ? "Resend" : gOn ? "Gmail (API de Google)" : state.smtp ? "tu correo (SMTP)" : null;
    const detail = !via ? "Le llega a: j***@gmail.com. SIN servicio de correo propio: sale por el correo del hosting, que muchas veces no se entrega o cae en spam." : `Le llega a: j***@gmail.com. Sale por ${via}. Último envío (correo de prueba): hace 1 min ${state.lastOk ? "✔ por " + via + "." : "por el correo del hosting."}`;
    r.fulfill({ json: {
      ready: true, eventsUrl: "https://stikebikeshop.com/api/wompi-events",
      checks: [{ id: "wompi_keys", ok: true, label: "Llaves de Wompi", detail: "Producción" }, { id: "email", ok: !!(state.resend || state.smtp || gOn) && !!state.lastOk, label: "Correo de aviso de cada venta", detail }],
      mail: { recipients: state.recipients, recipientsFromPanel: false, from: state.from || "", resend: { configured: !!state.resend, source: state.resend ? "panel" : null, tail: state.resend ? state.resend.slice(-4) : null, length: state.resend ? state.resend.length : 0 }, smtp: state.smtp ? { configured: true, source: "panel", ...state.smtp } : { configured: false, source: null, host: "", port: 465, user: "" },
        gmail: state.gmail ? { clientConfigured: true, clientId: state.gmail.clientId, connected: gOn, sender: gOn ? state.gmail.sender : null, source: gOn ? "panel" : null, redirectUri: REDIRECT } : { clientConfigured: false, clientId: "", connected: false, sender: null, source: null, redirectUri: REDIRECT }, queued: 0 },
    } });
  });
  await page.route("**/api/admin-config", async r => {
    const body = r.request().postDataJSON(); posted.push(body);
    if (body.action === "test_email") return r.fulfill({ json: state.testReply });
    if (body.action === "smtp_clear") { state.smtp = null; return r.fulfill({ json: { ok: true, cleared: true } }); }
    if (body.action === "gmail_save_client") {
      if (!/^[0-9]{6,}-[a-z0-9]{10,}\.apps\.googleusercontent\.com$/.test(body.clientId)) return r.fulfill({ status: 400, json: { error: "invalid_client_id", detail: "El ID de cliente tiene este formato: 123456789-abcdef….apps.googleusercontent.com (Google Cloud → APIs y servicios → Credenciales → tu «ID de cliente de OAuth»)." } });
      state.gmail = { clientId: body.clientId, sender: state.gmail && state.gmail.clientId === body.clientId ? state.gmail.sender : null };
      return r.fulfill({ json: { ok: true, clientId: body.clientId, redirectUri: REDIRECT, encrypted: true } });
    }
    if (body.action === "gmail_connect_start") {
      if (!state.gmail) return r.fulfill({ status: 400, json: { error: "gmail_client_missing", detail: "Primero guarda el ID y el secreto de cliente." } });
      return r.fulfill({ json: { ok: true, url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=" + state.gmail.clientId + "&state=abc123", redirectUri: REDIRECT } });
    }
    if (body.action === "gmail_disconnect") { if (body.all) state.gmail = null; else if (state.gmail) state.gmail.sender = null; return r.fulfill({ json: { ok: true, disconnected: true } }); }
    if (body.action === "smtp_save") {
      if (body.pass === "mala") return r.fulfill({ status: 400, json: { error: "smtp_auth_failed", detail: "El servidor de correo rechazó el usuario o la contraseña (535: Username and Password not accepted). Revisa que el correo esté completo (ventas@tudominio.com) y la contraseña bien copiada." } });
      state.smtp = { host: body.host, port: body.port, user: body.user };
      return r.fulfill({ json: { ok: true, host: body.host, port: body.port, user: body.user, secure: "ssl", encrypted: true } });
    }
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
  await page.route("https://accounts.google.com/**", r => r.fulfill({ status: 200, contentType: "text/html", body: "<html><body>Google (simulado)</body></html>" }));
  await page.goto(B + "/admin.html" + query, { waitUntil: "networkidle" }); await page.waitForTimeout(600);
  await page.evaluate(() => switchPanel("config")); await page.waitForTimeout(500);
  return { page, errs, posted };
}
const msg = page => page.locator("#cfg-mail-msg").innerText();

console.log("\nDueño, sin correo propio (como está hoy)");
{
  const state = { resend: null, smtp: null, recipients: ["jparra375@gmail.com"], domains: [{ name: "stikebikeshop.com", status: "verified" }], testReply: { ok: true, via: "mail", reliable: false, to: "j***@gmail.com", resendConfigured: false, smtpConfigured: false, resendError: null, smtpError: null } };
  const { page, errs, posted } = await open("owner", state);
  t("se ve el formulario del correo, con el aviso «Revisar»", (await page.locator("#cfg-mail-box").isVisible()) && /revisar/i.test(await page.locator("#cfg-mail-box h4").innerText()));
  t("ofrece las tres formas: A (correo de tu dominio), B (Resend) y C (Gmail por Google Cloud)", /A\) Con un correo de tu dominio/.test(await page.locator("#cfg-mail-box").innerText()) && /B\) Con Resend/.test(await page.locator("#cfg-mail-box").innerText()) && /C\) Con tu cuenta de Gmail, por la API de Google Cloud/.test(await page.locator("#cfg-mail-box").innerText()));
  t("la opción A trae sus pasos (hPanel → Correos → servidor smtp.hostinger.com, puerto 465) y menciona Gmail con contraseña de aplicación", await page.locator("#cfg-mail-box details").first().evaluate(d => /Correos/.test(d.textContent) && /smtp\.hostinger\.com/.test(d.textContent) && /465/.test(d.textContent) && /contraseña de aplicación/.test(d.textContent)));
  t("sin nada configurado viene abierta la C (la que se pidió), con los pasos de Google Cloud", await page.locator("#cfg-gm-box details").evaluate(d => d.open && /console\.cloud\.google\.com/.test(d.textContent) && /Gmail API/.test(d.textContent) && /Publicar la app/.test(d.textContent) && /redirect_uri_mismatch/.test(d.textContent) && /Pruebas/.test(d.textContent)));
  t("la opción B trae sus pasos (resend.com → API Keys → Sending access → Verify)", await page.locator("#cfg-mail-box details").nth(1).evaluate(d => /resend\.com/.test(d.textContent) && /Sending access/.test(d.textContent) && /Verify/.test(d.textContent)));
  t("el correo que recibe los avisos viene escrito (el dueño ve a dónde llegan)", (await page.locator("#cfg-mto-input").inputValue()) === "jparra375@gmail.com");
  t("la llave de Resend y la contraseña no se rellenan nunca", (await page.locator("#cfg-mkey-input").inputValue()) === "" && (await page.locator("#cfg-ms-pass").inputValue()) === "");
  t("la contraseña se escribe oculta (type=password)", (await page.locator("#cfg-ms-pass").getAttribute("type")) === "password");
  t("el estado de arriba dice «SIN servicio de correo propio»", /SIN servicio de correo propio/.test(await page.locator("#cfg-health").innerText()));
  t("el botón de prueba está una sola vez", (await page.locator("#cfg-test-email").count()) === 1);

  console.log("\nOpción A: la cuenta de correo del dominio (SMTP)");
  await page.click("#cfg-ms-save");
  t("guardar sin llenar nada pide el servidor, el correo y la contraseña (y no manda nada)", /Escribe el servidor, el correo y su contraseña/.test(await msg(page)) && posted.length === 0);
  await page.fill("#cfg-ms-host", " smtp.hostinger.com ");
  await page.fill("#cfg-ms-port", "465");
  await page.fill("#cfg-ms-user", "ventas@stikebikeshop.com");
  await page.fill("#cfg-ms-pass", "mala");
  await page.click("#cfg-ms-save"); await page.waitForTimeout(500);
  t("contraseña mala: el panel muestra lo que dijo el servidor de correo, en claro", /rechazó el usuario o la contraseña/.test(await msg(page)) && /535/.test(await msg(page)));
  t("y manda action, servidor, puerto como número, correo y contraseña (nada más)", JSON.stringify(Object.keys(posted[0]).sort()) === JSON.stringify(["action", "host", "pass", "port", "user"]) && posted[0].action === "smtp_save" && posted[0].port === 465 && posted[0].host.trim() === "smtp.hostinger.com");
  t("los botones vuelven a estar disponibles para corregir", !(await page.locator("#cfg-ms-save").isDisabled()));

  state.testReply = { ok: true, via: "smtp", reliable: true, to: "j***@gmail.com", resendConfigured: false, smtpConfigured: true, resendError: null, smtpError: null };
  state.lastOk = true;
  await page.fill("#cfg-ms-pass", "clave-secreta-123");
  await page.click("#cfg-ms-save"); await page.waitForTimeout(1300);
  const m1 = await msg(page);
  t("con la contraseña buena: «El servidor entró a ventas@… en smtp.hostinger.com» y enseguida el correo de prueba por SMTP", /El servidor entró a ventas@stikebikeshop\.com en smtp\.hostinger\.com/.test(m1) && /Enviado desde tu correo \(SMTP\) a j\*\*\*@gmail\.com/.test(m1), m1);
  t("el correo de prueba se pidió solo, después de guardar", posted.some(p => p.action === "test_email"));
  t("el estado de arriba pasa a «Funcionando» y la opción A queda marcada como «Guardado»", /funcionando/i.test(await page.locator("#cfg-mail-box h4").innerText()) && /guardado/i.test(await page.locator("#cfg-mail-box h5").first().innerText()));
  t("servidor, puerto y correo quedan escritos; la contraseña NO (y el panel dice que ya hay una guardada)", (await page.locator("#cfg-ms-host").inputValue()) === "smtp.hostinger.com" && (await page.locator("#cfg-ms-port").inputValue()) === "465" && (await page.locator("#cfg-ms-user").inputValue()) === "ventas@stikebikeshop.com" && (await page.locator("#cfg-ms-pass").inputValue()) === "" && /ya hay una guardada/i.test(await page.locator("#cfg-mail-box").innerText()));
  t("la contraseña no queda en ninguna parte de la página", !(await page.content()).includes("clave-secreta-123"));

  state.testReply = { ok: true, via: "mail", reliable: false, to: "j***@gmail.com", resendConfigured: false, smtpConfigured: true, resendError: null, smtpError: { code: "smtp_unreachable", detail: "No se pudo conectar a smtp.hostinger.com:465 (Connection refused)." } };
  await page.click("#cfg-test-email"); await page.waitForTimeout(900);
  const m2 = await msg(page);
  t("si tu correo falla: dice «NO garantiza» (salió por el hosting) y «Tu correo (SMTP) falló» con el motivo", /NO garantiza/.test(m2) && /Tu correo \(SMTP\) falló: No se pudo conectar a smtp\.hostinger\.com:465/.test(m2), m2);

  await page.click("#cfg-ms-clear"); await page.waitForTimeout(900);
  t("«Quitar lo guardado aquí» manda smtp_clear y lo explica", posted.some(p => p.action === "smtp_clear") && /se quitó el correo guardado aquí/.test(await msg(page)));

  console.log("\nOpción B: Resend");
  await page.click("#cfg-mkey-save");
  posted.length = 0;
  await page.fill("#cfg-mkey-input", "prv_test_otra_cosa");
  await page.click("#cfg-mkey-save"); await page.waitForTimeout(400);
  t("si pega algo que no es de Resend: el servidor lo rechaza y el panel dice por qué", /Eso no es una llave de Resend/.test(await msg(page)));
  t("y manda solo la llave y el valor", JSON.stringify(Object.keys(posted[0]).sort()) === JSON.stringify(["key", "value"]) && posted[0].key === "RESEND_API_KEY");

  state.testReply = { ok: true, via: "resend", reliable: true, to: "j***@gmail.com", resendConfigured: true, smtpConfigured: false, resendError: null, smtpError: null };
  await page.fill("#cfg-mkey-input", "  re_llave_buena_1234567890abcdef ");
  await page.click("#cfg-mkey-save"); await page.waitForTimeout(1200);
  const m3 = await msg(page);
  t("con la llave buena: «Resend aceptó la llave», dominios verificados y, enseguida, el correo de prueba por Resend", /Resend aceptó la llave \(termina en …cdef\)/.test(m3) && /Dominios verificados en Resend: stikebikeshop\.com/.test(m3) && /Enviado por Resend a j\*\*\*@gmail\.com/.test(m3), m3);
  t("la llave aparece guardada (…cdef) sin mostrarla", /termina en …cdef/.test(await page.locator("#cfg-mail-box").innerText()) && !(await page.content()).includes("re_llave_buena_1234567890abcdef"));
  t("el campo de la llave queda vacío", (await page.locator("#cfg-mkey-input").inputValue()) === "");

  state.testReply = { ok: true, via: "mail", reliable: false, to: "j***@gmail.com", resendConfigured: true, smtpConfigured: false, resendError: { code: "sandbox_only", detail: "Con el remitente de pruebas de Resend (onboarding@resend.dev) solo se puede enviar al correo con el que se creó la cuenta de Resend (otro@gmail.com)." }, smtpError: null };
  await page.click("#cfg-test-email"); await page.waitForTimeout(900);
  const m4 = await msg(page);
  t("si Resend se niega: «NO garantiza», «Resend falló» y el motivo exacto", /NO garantiza/.test(m4) && /Resend falló: Con el remitente de pruebas/.test(m4) && /otro@gmail\.com/.test(m4), m4);

  console.log("\nA quién le llega y el remitente");
  await page.fill("#cfg-mto-input", "dueno@gmail.com, socio@gmail.com");
  state.testReply = { ok: true, via: "resend", reliable: true, to: "d***@gmail.com, s***@gmail.com", resendConfigured: true, smtpConfigured: false, resendError: null, smtpError: null };
  await page.click("#cfg-mto-save"); await page.waitForTimeout(1200);
  const m5 = await msg(page);
  t("cambiar quién recibe: manda la lista y confirma «llegarán a …» con prueba incluida", /llegarán a dueno@gmail\.com, socio@gmail\.com/.test(m5) && /Enviado por Resend a d\*\*\*@gmail\.com, s\*\*\*@gmail\.com/.test(m5), m5);
  t("la lista queda escrita en el campo para la próxima vez", (await page.locator("#cfg-mto-input").inputValue()) === "dueno@gmail.com, socio@gmail.com");
  await page.fill("#cfg-mfrom-input", "Stike Bike Shop <ventas@stikebikeshop.com>");
  await page.click("#cfg-mfrom-save"); await page.waitForTimeout(1200);
  t("el remitente se guarda y se prueba", /saldrán desde Stike Bike Shop <ventas@stikebikeshop\.com>/.test(await msg(page)) && posted.some(p => p.key === "RESEND_FROM"));
  await page.click("#cfg-mkey-clear"); await page.waitForTimeout(900);
  t("quitar la llave de Resend manda clear:true", posted.some(p => p.key === "RESEND_API_KEY" && p.clear === true) && /se quitó lo guardado aquí/.test(await msg(page)));
  t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
  await page.close();
}

console.log("\nOpción C: Gmail por la API de Google Cloud (conectar desde el panel)");
{
  const state = { resend: null, smtp: null, gmail: null, recipients: ["jparra375@gmail.com"], domains: [], testReply: { ok: true, via: "mail", reliable: false, to: "j***@gmail.com", resendConfigured: false, smtpConfigured: false, gmailConfigured: false, resendError: null, smtpError: null, gmailError: null } };
  const { page, errs, posted } = await open("owner", state);
  const gm = page.locator("#cfg-gm-box");
  t("se ve el bloque C con la URI de regreso lista para copiar (solo lectura)", (await gm.isVisible()) && (await page.locator("#cfg-gm-redirect").inputValue()) === REDIRECT && (await page.locator("#cfg-gm-redirect").getAttribute("readonly")) !== null);
  t("sin cliente guardado: botón «Guardar y conectar con Google», y no hay «Desconectar» ni «Quitar todo»", /guardar y conectar con google/i.test(await page.locator("#cfg-gm-connect").innerText()) && (await page.locator("#cfg-gm-disc").count()) === 0 && (await page.locator("#cfg-gm-clear").count()) === 0);
  t("el secreto se escribe oculto (type=password) y viene vacío", (await page.locator("#cfg-gm-secret").getAttribute("type")) === "password" && (await page.locator("#cfg-gm-secret").inputValue()) === "");
  await page.click("#cfg-gm-copy"); await page.waitForTimeout(300);
  t("«Copiar» responde (copiada, o pide copiar a mano si el navegador no deja)", /copiada|selecci[oó]nala/i.test(await page.locator("#cfg-gm-copy").innerText()));

  await page.click("#cfg-gm-connect");
  t("conectar sin llenar nada pide el ID y el secreto, y no manda nada", /Pega el ID de cliente y el secreto del cliente/.test(await msg(page)) && posted.length === 0);
  await page.fill("#cfg-gm-id", CLIENT_ID);
  await page.click("#cfg-gm-connect");
  t("con solo el ID pide el secreto", /Falta el secreto del cliente/.test(await msg(page)) && posted.length === 0);
  await page.fill("#cfg-gm-id", "abc"); await page.fill("#cfg-gm-secret", CLIENT_SECRET);
  await page.click("#cfg-gm-connect"); await page.waitForTimeout(500);
  t("un ID que no es de Google: el panel muestra lo que dijo el servidor (formato esperado) y no se va a Google", /apps\.googleusercontent\.com/.test(await msg(page)) && page.url().startsWith(B) && !(await page.locator("#cfg-gm-connect").isDisabled()));

  posted.length = 0;
  await page.fill("#cfg-gm-id", " " + CLIENT_ID + " ");
  await page.click("#cfg-gm-connect");
  await page.waitForURL(/accounts\.google\.com/, { timeout: 5000 }).catch(() => {});
  t("con el ID y el secreto buenos: guarda el cliente, pide la dirección de permiso y lleva el navegador a Google", page.url().startsWith("https://accounts.google.com/o/oauth2/v2/auth") && posted.map(p => p.action).join(",") === "gmail_save_client,gmail_connect_start", page.url() + " " + posted.map(p => p.action));
  t("al servidor solo le llegan acción, ID y secreto (sin espacios)", JSON.stringify(Object.keys(posted[0]).sort()) === JSON.stringify(["action", "clientId", "clientSecret"]) && posted[0].clientId === CLIENT_ID && posted[0].clientSecret === CLIENT_SECRET);
  await page.close();
}
{
  /* Cliente guardado pero sin conectar: «Conectar» no pide el secreto otra vez. */
  const state = { resend: null, smtp: null, gmail: { clientId: CLIENT_ID, sender: null }, recipients: ["jparra375@gmail.com"], domains: [], testReply: { ok: true, via: "mail", to: "j***@gmail.com" } };
  const { page, posted } = await open("owner", state);
  t("cliente guardado: el ID viene escrito, el secreto NO, y el bloque dice «Falta conectar»", (await page.locator("#cfg-gm-id").inputValue()) === CLIENT_ID && (await page.locator("#cfg-gm-secret").inputValue()) === "" && /falta conectar/i.test(await page.locator("#cfg-gm-box h5").innerText()) && /ya hay uno guardado/i.test(await page.locator("#cfg-gm-box").innerText()));
  t("y el estado de arriba (la vista de salud) lo sabe: abierta la C y con «Quitar todo» disponible", (await page.locator("#cfg-gm-box details").evaluate(d => d.open)) && (await page.locator("#cfg-gm-clear").count()) === 1);
  await page.click("#cfg-gm-connect");
  await page.waitForURL(/accounts\.google\.com/, { timeout: 5000 }).catch(() => {});
  t("«Conectar» sin cambiar nada: solo pide la dirección de permiso (no vuelve a guardar el secreto) y va a Google", page.url().startsWith("https://accounts.google.com/") && posted.map(p => p.action).join(",") === "gmail_connect_start", page.url() + " " + posted.map(p => p.action));
  await page.close();
}
{
  /* Regreso de Google: bien. */
  const state = { resend: null, smtp: null, gmail: { clientId: CLIENT_ID, sender: "ventas@gmail.com" }, recipients: ["jparra375@gmail.com"], domains: [], lastOk: true, testReply: { ok: true, via: "gmail", reliable: true, to: "j***@gmail.com", gmailConfigured: true, resendConfigured: false, smtpConfigured: false, resendError: null, smtpError: null, gmailError: null } };
  const { page, errs, posted } = await open("owner", state, "?gmail=ok");
  await page.waitForTimeout(900);
  t("al volver de Google (?gmail=ok) abre Configuración, limpia la dirección y manda solo el correo de prueba", (await page.locator("#panel-config").evaluate(e => e.classList.contains("active"))) && !/gmail=/.test(page.url()) && posted.map(p => p.action).join(",") === "test_email", page.url() + " " + posted.map(p => p.action));
  const m = await msg(page);
  t("dice que Google aceptó la conexión y que el correo de prueba salió por Gmail", /Google aceptó la conexión/.test(m) && /Enviado por Gmail \(API de Google\) a j\*\*\*@gmail\.com/.test(m), m);
  t("el bloque C queda «Conectada», con la cuenta, el botón de desconectar y el estado de arriba en «Funcionando»", /conectada/i.test(await page.locator("#cfg-gm-box h5").innerText()) && /ventas@gmail\.com/.test(await page.locator("#cfg-gm-status").innerText()) && (await page.locator("#cfg-gm-disc").count()) === 1 && /funcionando/i.test(await page.locator("#cfg-mail-box h4").innerText()));
  t("el secreto de cliente no está en ninguna parte de la página", !(await page.content()).includes(CLIENT_SECRET));

  console.log("\nDesconectar");
  posted.length = 0;
  await page.click("#cfg-gm-disc"); await page.waitForTimeout(900);
  t("«Desconectar la cuenta» manda gmail_disconnect (sin borrar el cliente) y el bloque pasa a «Falta conectar»", JSON.stringify(posted[0]) === JSON.stringify({ action: "gmail_disconnect" }) && /falta conectar/i.test(await page.locator("#cfg-gm-box h5").innerText()) && /quedó desconectada/.test(await msg(page)), JSON.stringify(posted));
  posted.length = 0;
  await page.click("#cfg-gm-clear"); await page.waitForTimeout(300);
  t("«Quitar todo» pregunta antes (y no manda nada hasta confirmar)", (await page.locator("#confirm-overlay").evaluate(e => e.classList.contains("open"))) && /Quitar la conexión con Gmail/.test(await page.locator("#confirm-modal").innerText()) && posted.length === 0);
  await page.click("#gc-cancel"); await page.waitForTimeout(200);
  t("cancelar no borra nada", !(await page.locator("#confirm-overlay").evaluate(e => e.classList.contains("open"))) && posted.length === 0);
  await page.click("#cfg-gm-clear"); await page.click("#gc-confirm"); await page.waitForTimeout(900);
  t("confirmar manda gmail_disconnect con all:true y el bloque vuelve al principio (sin cliente)", JSON.stringify(posted[0]) === JSON.stringify({ action: "gmail_disconnect", all: true }) && (await page.locator("#cfg-gm-id").inputValue()) === "" && (await page.locator("#cfg-gm-clear").count()) === 0 && /se borraron el ID y el secreto/.test(await msg(page)), JSON.stringify(posted));
  t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
  await page.close();
}
{
  /* Regreso de Google: errores, cada uno explicado. */
  const base = () => ({ resend: null, smtp: null, gmail: { clientId: CLIENT_ID, sender: null }, recipients: ["jparra375@gmail.com"], domains: [], testReply: { ok: true, via: "mail" } });
  const cases = [
    ["?gmail=error&r=denied", /Cancelaste el permiso en Google/],
    ["?gmail=error&r=state", /venció o ya se había usado/],
    ["?gmail=error&r=client", /Falta el ID y el secreto de cliente/],
    ["?gmail=error&r=no_refresh", /myaccount\.google\.com\/permissions/],
    ["?gmail=error&r=no_email", /no dijo cuál es la cuenta/],
    ["?gmail=error&r=save", /no pudo guardar la conexión/],
    ["?gmail=error&r=exchange&e=invalid_client", /Google no aceptó la conexión \(invalid_client\): el ID o el secreto de cliente no son correctos/],
    ["?gmail=error&r=exchange&e=invalid_grant", /\(invalid_grant\): el código de permiso venció/],
    ["?gmail=error&r=exchange&e=redirect_uri_mismatch", new RegExp("redirect_uri_mismatch\\): la URI de regreso no coincide.*" + REDIRECT.replace(/[.\/]/g, "\\$&"))],
    ["?gmail=error&r=exchange&e=algo_raro", /Google no aceptó la conexión \(algo_raro\)\. Vuelve a intentarlo/],
    ["?gmail=error&r=exchange", /Google no aceptó la conexión\. Vuelve a intentarlo/],
  ];
  for (const [qs, re] of cases) {
    const st = base();
    const { page, posted } = await open("owner", st, qs);
    await page.waitForTimeout(500);
    const m = await msg(page);
    t(`${qs.slice(1)} -> ${re.source.slice(0, 48)}…`, re.test(m) && !/gmail=/.test(page.url()) && (await page.locator("#panel-config").evaluate(e => e.classList.contains("active"))) && posted.length === 0, m);
    await page.close();
  }
  /* Quien no es dueño ni desarrollador no ve nada de esto, pero la dirección también se limpia. */
  const { page, posted } = await open("admin", base(), "?gmail=ok");
  await page.waitForTimeout(500);
  t("rol admin con ?gmail=ok: la dirección se limpia y no se manda ningún correo ni acción", !/gmail=/.test(page.url()) && posted.length === 0 && (await page.locator("#cfg-gm-box").count()) === 0);
  await page.close();
}

console.log("\nEl correo no salió por ningún camino");
{
  const state = { resend: null, smtp: null, recipients: ["jparra375@gmail.com"], domains: [], testReply: { ok: false, via: null, reliable: false, to: "j***@gmail.com", error: "email_failed", resendConfigured: false, smtpConfigured: false, resendError: null, smtpError: null } };
  const { page } = await open("developer", state);
  await page.click("#cfg-test-email"); await page.waitForTimeout(800);
  const m = await msg(page);
  t("el desarrollador también lo ve y, si nada pudo enviar, dice que llene la opción A, B o C", /No se pudo enviar el correo por ningún camino/.test(m) && /opción A, B o C/.test(m), m);
  await page.close();
}

console.log("\nQuien no es dueño ni desarrollador");
for (const role of ["admin", "staff", "editor"]) {
  const { page } = await open(role, { resend: null, smtp: null, recipients: ["jparra375@gmail.com"], domains: [] });
  t(`rol ${role}: no ve el formulario de correo`, (await page.locator("#cfg-mail-box").count()) === 0 && (await page.locator("#cfg-test-email").count()) === 0 && (await page.locator("#cfg-ms-pass").count()) === 0 && (await page.locator("#cfg-gm-box").count()) === 0);
  await page.close();
}
await br.close();
console.log(fail ? `\n${fail} falla(s)` : "\nTodo bien");
process.exit(fail ? 1 : 0);
