/* =========================================================================
   Prueba del aviso de venta por la API de Gmail (Google Cloud): el panel guarda
   el ID y el secreto de cliente OAuth, manda a Google a pedir permiso (solo para
   ENVIAR correos), recibe el regreso en api/gmail-callback.php y desde ahi cada
   aviso sale por users.messages.send desde la cuenta conectada.

     node tools/gmail-api-test.mjs

   Levanta el servidor embebido de PHP y un Google FALSO (autorizacion, token,
   revocacion y la API de Gmail) y un Resend falso. Comprueba el flujo completo,
   que ningun secreto ni permiso permanente se guarda en claro ni se devuelve, que
   el regreso de Google solo sirve con un «state» vigente y de un solo uso, el
   formato del mensaje, el orden Resend -> Gmail -> hosting y cada error de Google
   explicado en español.

   Necesita `php` en el PATH. No toca la red ni cuentas reales.
   ========================================================================= */
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtempSync, readFileSync, existsSync, readdirSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

if (spawnSync("php", ["-v"]).status !== 0) { console.log("sin php: se omite la prueba de la API de Gmail"); process.exit(0); }
const ROOT = fileURLToPath(new URL("..", import.meta.url));
let fail = 0;
const t = (l, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++; console.log(`  ${ok ? "ok  " : "FALLA"} ${l}${ok ? "" : `  -> dio ${JSON.stringify(got)}, esperaba ${JSON.stringify(want)}`}`); };
const freePort = () => new Promise(res => { const s = createNetServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
const listen = handler => new Promise(res => { const s = createServer(handler); s.listen(0, "127.0.0.1", () => res(s)); });
const wait = ms => new Promise(r => setTimeout(r, ms));
const b64u = o => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");

const WORK = mkdtempSync(join(tmpdir(), "stike-gmail-"));
const CLIENT_ID = "123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com";
const CLIENT_SECRET = "GOCSPX-AbCdEfGh12345678_de_prueba";
const REFRESH = "1//0AbCdEfGh12345678-refresh-token-de-prueba-SECRETO";
const SENDER = "avisos.stike@gmail.com";

/* ---- Google falso: autorizacion (no se visita), token, revocacion y la API de Gmail ---- */
const g = { codeMode: "ok", refreshMode: "ok", gmailMode: "ok", tokenCalls: [], refreshCalls: 0, revoked: [], sent: [], gmailAuth: [] };
const google = await listen((req, res) => {
  const chunks = []; req.on("data", d => chunks.push(d));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString();
    const send = (code, obj) => { res.statusCode = code; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(obj)); };
    if (req.method === "POST" && req.url === "/token") {
      const f = Object.fromEntries(new URLSearchParams(body));
      if (f.grant_type === "authorization_code") {
        g.tokenCalls.push(f);
        if (g.codeMode === "bad_code") return send(400, { error: "invalid_grant", error_description: "Bad Request" });
        if (g.codeMode === "redirect_mismatch") return send(400, { error: "redirect_uri_mismatch" });
        const idt = ["h", b64u({ email: g.codeMode === "no_email" ? undefined : "Avisos.Stike@Gmail.com", email_verified: true }), "s"].join(".");
        return send(200, { access_token: "ya29.del-codigo", expires_in: 3599, scope: "openid https://www.googleapis.com/auth/gmail.send", token_type: "Bearer", id_token: idt, ...(g.codeMode === "no_refresh" ? {} : { refresh_token: REFRESH }) });
      }
      if (f.grant_type === "refresh_token") {
        g.refreshCalls++;
        if (f.client_id !== CLIENT_ID || f.client_secret !== CLIENT_SECRET || f.refresh_token !== REFRESH) return send(401, { error: "invalid_client" });
        if (g.refreshMode === "revoked") return send(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
        if (g.refreshMode === "client") return send(401, { error: "invalid_client", error_description: "The OAuth client was not found." });
        if (g.refreshMode === "down") return send(503, {});
        return send(200, { access_token: "ya29.renovado-" + g.refreshCalls, expires_in: 3599, token_type: "Bearer" });
      }
      return send(400, { error: "unsupported_grant_type" });
    }
    if (req.method === "POST" && req.url === "/revoke") { g.revoked.push(Object.fromEntries(new URLSearchParams(body)).token); return send(200, {}); }
    if (req.method === "POST" && req.url === "/gmail/v1/users/me/messages/send") {
      g.gmailAuth.push(req.headers.authorization || "");
      if (g.gmailMode === "disabled") return send(403, { error: { code: 403, message: "Gmail API has not been used in project 123 before or it is disabled.", status: "PERMISSION_DENIED", errors: [{ reason: "accessNotConfigured" }] } });
      if (g.gmailMode === "scope") return send(403, { error: { code: 403, message: "Request had insufficient authentication scopes.", status: "PERMISSION_DENIED", errors: [{ reason: "insufficientPermissions" }] } });
      if (g.gmailMode === "rate") return send(429, { error: { code: 429, message: "User-rate limit exceeded.", errors: [{ reason: "rateLimitExceeded" }] } });
      if (g.gmailMode === "down") return send(500, { error: { code: 500, message: "Backend Error" } });
      if (g.gmailMode === "unauth") return send(401, { error: { code: 401, message: "Invalid Credentials" } });
      const raw = JSON.parse(body).raw;
      g.sent.push({ raw: Buffer.from(raw, "base64url").toString("utf8"), b64: raw });
      return send(200, { id: "msg-" + g.sent.length, threadId: "th-1", labelIds: ["SENT"] });
    }
    send(404, {});
  });
});

/* ---- Resend falso (solo para probar el orden Resend -> Gmail) ---- */
const resendMails = []; let resendMode = "ok";
const resend = await listen((req, res) => {
  const c = []; req.on("data", d => c.push(d));
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (req.method === "POST" && req.url === "/emails") {
      if (resendMode === "down") { res.statusCode = 500; return res.end(JSON.stringify({ name: "application_error", message: "Internal server error" })); }
      resendMails.push(JSON.parse(Buffer.concat(c).toString() || "{}")); return res.end(JSON.stringify({ id: "em_1" }));
    }
    res.statusCode = 404; res.end("{}");
  });
});

const WHO = { owner: "jparra375@gmail.com", developer: "daniel.f.acosta96@gmail.com", admin: "yeimy.hernandez.corredor@gmail.com", staff: "kevinarevalo1996@gmail.com" };
const googleId = await listen((req, res) => {
  const tok = new URL(req.url, "http://x").searchParams.get("id_token");
  if (!WHO[tok]) { res.statusCode = 400; return res.end("{}"); }
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ aud: "752305520255-7e2abc762p3saer5sube25jh9rt9jle7.apps.googleusercontent.com", iss: "https://accounts.google.com", email: WHO[tok], email_verified: "true", exp: String(Math.floor(Date.now() / 1000) + 3600) }));
});

/* sendmail falso: lo que mail() del hosting entregaria queda en un archivo. */
const FAKE_SENDMAIL = join(WORK, "fake-sendmail.sh");
writeFileSync(FAKE_SENDMAIL, ["#!/bin/sh", 'd="${STIKE_MAIL_CAPTURE:-' + WORK + '}"', 'f="$d/mail-$(date +%s%N)-$$"', 'cat > "$f.eml"', 'exit ${STIKE_MAIL_EXIT:-0}'].join("\n") + "\n"); chmodSync(FAKE_SENDMAIL, 0o755);
const hostingMails = dir => readdirSync(dir).filter(f => f.endsWith(".eml")).length;

const PHP = (spawnSync("php", ["-r", "echo PHP_BINARY;"]).stdout || "").toString().trim() || "php";
const procs = [];
async function startPhp(extra = {}) {
  const port = await freePort();
  const storage = mkdtempSync(join(WORK, "st-")), cap = mkdtempSync(join(WORK, "cap-"));
  const env = {
    ...process.env, ADMIN_API_KEY: "k".repeat(32), GITHUB_TOKEN: "ghp_falso", STIKE_GOOGLE_TOKENINFO: `http://127.0.0.1:${googleId.address().port}`, STIKE_INSECURE_COOKIE: "1", NO_PROXY: "*", no_proxy: "*",
    WOMPI_PUBLIC_KEY: "pub_test_demo1234", WOMPI_PRIVATE_KEY: "prv_test_demo1234", WOMPI_INTEGRITY_SECRET: "test_integrity_AbCdEfGh12345678",
    RESEND_API_BASE: `http://127.0.0.1:${resend.address().port}`, RESEND_API_KEY: "",
    SITE_URL: `http://127.0.0.1:${port}`, GOOGLE_OAUTH_BASE: `http://127.0.0.1:${google.address().port}`, GOOGLE_AUTH_URL: `http://127.0.0.1:${google.address().port}/auth`, GMAIL_API_BASE: `http://127.0.0.1:${google.address().port}`,
    STORAGE_DIR: storage, STIKE_MAIL_CAPTURE: cap, ...extra,
  };
  const proc = spawn("php", ["-d", `sendmail_path=${FAKE_SENDMAIL} -t -i`, "-S", `127.0.0.1:${port}`, "-t", ROOT], { env, stdio: "ignore" });
  procs.push(proc);
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port}/api/admin-login.php`); break; } catch { await wait(100); } }
  return { proc, base: `http://127.0.0.1:${port}`, API: `http://127.0.0.1:${port}/api`, storage, cap };
}
const loginAt = async (api, who) => (await fetch(`${api}/admin-login.php`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credential: who }) })).headers.get("set-cookie").split(";")[0];
const post = (api, cookie, body) => fetch(`${api}/admin-config.php`, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) }).then(async r => ({ code: r.status, json: await r.json().catch(() => null) }));
const health = (api, cookie) => fetch(`${api}/admin-health.php`, { headers: { Cookie: cookie } }).then(r => r.json());
const emailCheck = h => (h.checks || []).find(c => c.id === "email") || {};
const callback = (S, qs, method = "GET") => fetch(`${S.API}/gmail-callback.php?${qs}`, { method, redirect: "manual" }).then(async r => ({ code: r.status, html: await r.text() }));
const bounceTo = html => decodeURIComponent((html.match(/url=([^"]+)"/) || [])[1] || "").replace(/&amp;/g, "&");
const parseEml = raw => {
  const txt = raw.replace(/\r\n/g, "\n"); const [head, ...rest] = txt.split("\n\n"); const body = rest.join("\n\n");
  const unfolded = head.replace(/\n[ \t]+/g, " ");
  const hdr = n => (unfolded.match(new RegExp("^" + n + ":\\s*(.*)$", "im")) || [])[1] || "";
  const words = s => s.replace(/=\?UTF-8\?B\?([^?]*)\?=\s*/gi, (_, b) => Buffer.from(b, "base64").toString("utf8"));
  const bound = (hdr("Content-Type").match(/boundary="([^"]+)"/) || [])[1]; const parts = {};
  if (bound) for (const p of body.split("--" + bound)) { const m = p.match(/Content-Type:\s*([^;\s]+)[\s\S]*?\n\n([\s\S]*)$/i); if (m) parts[m[1]] = Buffer.from(m[2].replace(/\s+/g, ""), "base64").toString("utf8"); }
  return { subject: words(hdr("Subject")), from: words(hdr("From")), to: hdr("To"), msgId: hdr("Message-ID"), type: hdr("Content-Type"), parts, maxLine: Math.max(...txt.split("\n").map(l => l.length)) };
};
const phpEval = (code, env = {}) => new Promise(res => {
  const p = spawn(PHP, ["-d", `sendmail_path=${FAKE_SENDMAIL} -t -i`, "-r", `require "api/_lib.php"; ${code}`], { cwd: ROOT, env: { ...process.env, ...env } });
  let out = ""; p.stdout.on("data", d => { out += d; }); p.on("close", status => res({ status, out: out.trim() }));
});

try {
  const S = await startPhp();
  const owner = await loginAt(S.API, "owner"), adminU = await loginAt(S.API, "admin"), staff = await loginAt(S.API, "staff");
  const cfgFile = join(S.storage, "runtime-config.json");
  const onDisk = () => existsSync(cfgFile) ? readFileSync(cfgFile, "utf8") : "";
  const keys = () => existsSync(cfgFile) ? Object.keys(JSON.parse(onDisk())).filter(k => k.startsWith("GMAIL_")).sort() : [];
  const startUrl = async () => { const r = await post(S.API, owner, { action: "gmail_connect_start" }); return { r, url: r.json && r.json.url ? new URL(r.json.url) : null }; };

  /* ============================================================ A. ID y secreto de cliente ============================================================ */
  console.log("\nGoogle Cloud: el ID y el secreto de cliente se pegan en el panel y se guardan cifrados");
  for (const a of ["gmail_save_client", "gmail_connect_start", "gmail_disconnect"]) t(`${a}: sin sesión 401, administrador y tienda 403`, [(await post(S.API, null, { action: a })).code, (await post(S.API, adminU, { action: a })).code, (await post(S.API, staff, { action: a })).code], [401, 403, 403]);
  t("pedir permiso antes de guardar el cliente -> 400 gmail_client_missing", (await post(S.API, owner, { action: "gmail_connect_start" })).json.error, "gmail_client_missing");
  t("un ID de cliente que no es de Google -> 400 con el formato esperado", [(await post(S.API, owner, { action: "gmail_save_client", clientId: "abc", clientSecret: CLIENT_SECRET })).json.error, /apps\.googleusercontent\.com/.test((await post(S.API, owner, { action: "gmail_save_client", clientId: "abc", clientSecret: CLIENT_SECRET })).json.detail)], ["invalid_client_id", true]);
  t("un secreto demasiado corto -> 400", (await post(S.API, owner, { action: "gmail_save_client", clientId: CLIENT_ID, clientSecret: "corto" })).json.error, "invalid_client_secret");
  t("no se puede escribir un permiso permanente a mano por la ruta genérica (solo lo entrega Google)", (await post(S.API, owner, { key: "GMAIL_REFRESH_TOKEN", value: REFRESH })).json.error, "invalid_key");
  const sv = await post(S.API, owner, { action: "gmail_save_client", clientId: ` ${CLIENT_ID} `, clientSecret: ` ${CLIENT_SECRET}\n` });
  t("se guarda y dice qué «URI de redireccionamiento» hay que autorizar en Google Cloud", [sv.code, sv.json.ok, sv.json.clientId, sv.json.redirectUri, sv.json.encrypted], [200, true, CLIENT_ID, `${S.base}/api/gmail-callback`, true]);
  t("el secreto va cifrado en el disco y nunca vuelve en la respuesta", [onDisk().includes("GOCSPX"), JSON.stringify(sv.json).includes("GOCSPX"), JSON.parse(onDisk()).GMAIL_CLIENT_SECRET.enc], [false, false, "v1"]);
  const h0 = await health(S.API, owner);
  t("el panel sabe que el cliente está guardado pero la cuenta no está conectada, y dice qué falta", [h0.mail.gmail.clientConfigured, h0.mail.gmail.connected, h0.mail.gmail.redirectUri, /Falta conectar la cuenta de Gmail/.test(emailCheck(h0).detail)], [true, false, `${S.base}/api/gmail-callback`, true]);

  /* ============================================================ B. conectar la cuenta ============================================================ */
  console.log("\nConectar con Google: se manda a pedir permiso (solo enviar correos) y Google vuelve al callback");
  const { r: r1, url: u1 } = await startUrl();
  const q = u1 ? Object.fromEntries(u1.searchParams) : {};
  t("la dirección es la de Google con el cliente, la URI de regreso y pide ACCESO PERMANENTE", [r1.code, u1 && u1.origin + u1.pathname, q.client_id, q.redirect_uri, q.response_type, q.access_type, q.prompt], [200, `http://127.0.0.1:${google.address().port}/auth`, CLIENT_ID, `${S.base}/api/gmail-callback`, "code", "offline", "consent"]);
  t("el único permiso que pide es enviar correos (y el correo para saber qué cuenta aceptó)", q.scope && q.scope.split(" ").sort(), ["email", "https://www.googleapis.com/auth/gmail.send", "openid"]);
  t("lleva un «state» aleatorio de 64 letras/números, y el secreto del cliente NO viaja en la dirección", [/^[a-f0-9]{64}$/.test(q.state || ""), (u1 ? u1.href : "").includes("GOCSPX")], [true, false]);
  const stateA = q.state;

  const noState = await callback(S, "code=x");
  t("regreso sin «state» -> vuelve al panel con «el enlace venció» y no guarda nada", [noState.code, bounceTo(noState.html), keys().includes("GMAIL_REFRESH_TOKEN")], [200, "/admin.html?gmail=error&r=state", false]);
  t("regreso con un «state» inventado -> igual", bounceTo((await callback(S, `code=x&state=${"a".repeat(64)}`)).html), "/admin.html?gmail=error&r=state");
  t("regreso con basura en el «state» -> igual (no toca el disco con eso)", bounceTo((await callback(S, `code=x&state=../../etc/passwd`)).html), "/admin.html?gmail=error&r=state");
  t("regresar con POST no está permitido (405)", (await callback(S, `code=x&state=${stateA}`, "POST")).code, 405);
  t("si la cuenta cancela el permiso en Google -> «denied»", bounceTo((await callback(S, `error=access_denied&state=${stateA}`)).html), "/admin.html?gmail=error&r=denied");

  g.codeMode = "bad_code";
  t("si Google rechaza el código -> «exchange» con el motivo de Google (sin guardar nada)", [bounceTo((await callback(S, `code=malo&state=${(await startUrl()).url.searchParams.get("state")}`)).html), keys().includes("GMAIL_REFRESH_TOKEN")], ["/admin.html?gmail=error&r=exchange&e=invalid_grant", false]);
  g.codeMode = "no_refresh";
  t("si Google no entrega el permiso permanente -> «no_refresh» (pasa cuando ya se había aceptado antes)", bounceTo((await callback(S, `code=c&state=${(await startUrl()).url.searchParams.get("state")}`)).html), "/admin.html?gmail=error&r=no_refresh");
  g.codeMode = "no_email";
  t("si no dice qué cuenta es -> «no_email»", bounceTo((await callback(S, `code=c&state=${(await startUrl()).url.searchParams.get("state")}`)).html), "/admin.html?gmail=error&r=no_email");
  g.codeMode = "ok";

  const stOld = (await startUrl()).url.searchParams.get("state");
  const fOld = join(S.storage, "oauth-state", stOld + ".json"); writeFileSync(fOld, JSON.stringify({ by: "jparra375@gmail.com", at: Math.floor(Date.now() / 1000) - 700 }));
  t("un «state» de hace más de 10 minutos ya no sirve", bounceTo((await callback(S, `code=c&state=${stOld}`)).html), "/admin.html?gmail=error&r=state");

  g.tokenCalls.length = 0;
  const stateOk = (await startUrl()).url.searchParams.get("state");
  const okCb = await callback(S, `code=el-codigo-bueno&state=${stateOk}`);
  t("el regreso bueno cambia el código por el permiso, guarda la cuenta y vuelve al panel con «gmail=ok»", [okCb.code, bounceTo(okCb.html), keys()], [200, "/admin.html?gmail=ok", ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN", "GMAIL_SENDER"]]);
  t("Google recibió el código, el ID y el secreto del cliente, la misma URI de regreso y el tipo de permiso", [g.tokenCalls[0].code, g.tokenCalls[0].client_id, g.tokenCalls[0].client_secret, g.tokenCalls[0].redirect_uri, g.tokenCalls[0].grant_type], ["el-codigo-bueno", CLIENT_ID, CLIENT_SECRET, `${S.base}/api/gmail-callback`, "authorization_code"]);
  t("el permiso permanente va cifrado en el disco y la página de regreso no muestra ningún token", [onDisk().includes("refresh-token-de-prueba"), okCb.html.includes("refresh-token"), okCb.html.includes("ya29"), JSON.parse(onDisk()).GMAIL_REFRESH_TOKEN.enc], [false, false, false, "v1"]);
  t("la cuenta conectada es la que dijo Google (en minúsculas) y quedó anotado quién la conectó", [JSON.parse(onDisk()).GMAIL_SENDER.by, (await health(S.API, owner)).mail.gmail.sender], ["jparra375@gmail.com", SENDER]);
  t("repetir el mismo regreso no sirve (el «state» es de un solo uso)", [bounceTo((await callback(S, `code=el-codigo-bueno&state=${stateOk}`)).html), g.tokenCalls.length], ["/admin.html?gmail=error&r=state", 1]);

  /* ============================================================ C. enviar ============================================================ */
  console.log("\nEl aviso sale por la API de Gmail desde la cuenta conectada");
  const hC = await health(S.API, owner), eC = emailCheck(hC);
  t("el panel dice «Sale por Gmail…» y que todavía falta probar", [/Sale por Gmail \(API de Google\), desde la cuenta a\*\*\*@gmail\.com/.test(eC.detail), /Todav[ií]a no se ha enviado/.test(eC.detail), eC.ok, hC.mail.gmail.connected, hC.mail.gmail.source], [true, true, false, true, "panel"]);
  const t1 = await post(S.API, owner, { action: "test_email" });
  t("el correo de prueba sale por Gmail y es confiable (no por el hosting)", [t1.json.ok, t1.json.via, t1.json.reliable, t1.json.gmailConfigured, hostingMails(S.cap)], [true, "gmail", true, true, 0]);
  const m1 = g.sent[0], p1 = parseEml(m1.raw);
  t("Google recibió el token renovado (el permiso permanente se cambió por uno de una hora)", [g.refreshCalls, g.gmailAuth[0]], [1, "Bearer ya29.renovado-1"]);
  t("el mensaje es válido: para el dueño, desde «Stike Bike Shop» con la cuenta conectada, texto + HTML y sin líneas de más de 998 caracteres", [p1.to, p1.from, /multipart\/alternative/.test(p1.type), !!p1.parts["text/plain"] && !!p1.parts["text/html"], p1.maxLine <= 998], ["jparra375@gmail.com", `Stike Bike Shop <${SENDER}>`, true, true, true]);
  t("el asunto con acentos y raya se lee bien y el cuerpo dice lo mismo", [p1.subject, /Si lees esto/.test(p1.parts["text/plain"]), /<h2>/.test(p1.parts["text/html"])], ["Prueba de correo — Stike Bike Shop", true, true]);
  t("va codificado como pide la API (base64url, sin «+», «/» ni «=»)", /^[A-Za-z0-9_-]+$/.test(m1.b64), true);
  const hC2 = emailCheck(await health(S.API, owner));
  t("el panel lo marca ✔ «por Gmail (API de Google)»", [hC2.ok, /✔ por Gmail \(API de Google\)/.test(hC2.detail)], [true, true]);
  t("ninguna respuesta del panel trae el secreto del cliente ni el permiso permanente", JSON.stringify([hC, await health(S.API, owner), t1.json]).match(/GOCSPX|refresh-token|ya29/g), null);

  console.log("\nSi Google o Gmail fallan, el panel dice por qué y el aviso no se pierde (sale por el hosting)");
  const nh = hostingMails(S.cap);
  g.gmailMode = "disabled";
  const f1 = await post(S.API, owner, { action: "test_email" });
  t("API de Gmail sin activar en el proyecto: lo dice con la ruta exacta (APIs y servicios → Biblioteca) y se usa el hosting", [f1.json.ok, f1.json.via, f1.json.reliable, f1.json.gmailError.code, /Biblioteca/.test(f1.json.gmailError.detail) && /Gmail API/.test(f1.json.gmailError.detail), hostingMails(S.cap) - nh], [true, "mail", false, "gmail_api_disabled", true, 1]);
  const eF = emailCheck(await health(S.API, owner));
  t("el panel marca ✕ y cuenta que el envío principal falló y por qué", [eF.ok, /El env[ií]o principal fall[oó] y se us[oó] el correo del hosting/.test(eF.detail), /Gmail API/.test(eF.detail)], [false, true, true]);
  g.gmailMode = "scope"; t("falta el permiso de enviar -> «desconéctala y vuelve a conectarla»", (await post(S.API, owner, { action: "test_email" })).json.gmailError.code, "gmail_scope");
  g.gmailMode = "rate"; t("límite de envíos -> gmail_rate_limited", (await post(S.API, owner, { action: "test_email" })).json.gmailError.code, "gmail_rate_limited");
  g.gmailMode = "down"; t("Gmail caído (500) -> gmail_down", (await post(S.API, owner, { action: "test_email" })).json.gmailError.code, "gmail_down");
  g.gmailMode = "unauth"; t("Google rechaza el token (401) -> pide conectar de nuevo", (await post(S.API, owner, { action: "test_email" })).json.gmailError.code, "gmail_token_rejected");
  g.gmailMode = "ok";
  g.refreshMode = "revoked";
  const f2 = await post(S.API, owner, { action: "test_email" });
  t("Google anuló el permiso (cambió la contraseña / pasaron 7 días en «Pruebas»): lo dice y explica que hay que volver a conectar y publicar la app", [f2.json.via, f2.json.gmailError.code, /contraseña/.test(f2.json.gmailError.detail) && /Pruebas/.test(f2.json.gmailError.detail) && /publica la app/.test(f2.json.gmailError.detail)], ["mail", "gmail_disconnected", true]);
  g.refreshMode = "client"; t("el secreto de cliente ya no es válido -> gmail_client_rejected", (await post(S.API, owner, { action: "test_email" })).json.gmailError.code, "gmail_client_rejected");
  g.refreshMode = "down"; t("Google caído al renovar el token -> gmail_down", (await post(S.API, owner, { action: "test_email" })).json.gmailError.code, "gmail_down");
  g.refreshMode = "ok";
  t("y cuando Google vuelve, el mismo botón vuelve a enviar por Gmail", (await post(S.API, owner, { action: "test_email" })).json.via, "gmail");

  console.log("\nOrden de envío: Resend primero, luego Gmail, y el hosting al final");
  const E = await startPhp({ RESEND_API_KEY: "re_falsa_para_prueba_1234567890" });
  const ownerE = await loginAt(E.API, "owner");
  await post(E.API, ownerE, { action: "gmail_save_client", clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
  await callback(E, `code=c&state=${new URL((await post(E.API, ownerE, { action: "gmail_connect_start" })).json.url).searchParams.get("state")}`);
  const s0 = g.sent.length, r0 = resendMails.length;
  const e1 = await post(E.API, ownerE, { action: "test_email" });
  t("con Resend funcionando, sale por Resend y no se toca Gmail", [e1.json.via, resendMails.length - r0, g.sent.length - s0], ["resend", 1, 0]);
  resendMode = "down";
  const e2 = await post(E.API, ownerE, { action: "test_email" });
  t("si Resend falla, sale por Gmail y se explica lo de Resend", [e2.json.via, e2.json.reliable, e2.json.resendError.code, g.sent.length - s0, hostingMails(E.cap)], ["gmail", true, "resend_down", 1, 0]);
  resendMode = "ok";

  console.log("\nSi Gmail cae, el aviso de venta no se pierde; y si tampoco responde el hosting, se guarda y se reintenta solo");
  g.gmailMode = "down";
  const envOff = { STORAGE_DIR: S.storage, STIKE_MAIL_CAPTURE: S.cap, SITE_URL: S.base, GOOGLE_OAUTH_BASE: `http://127.0.0.1:${google.address().port}`, GMAIL_API_BASE: `http://127.0.0.1:${google.address().port}`, ADMIN_API_KEY: "k".repeat(32), NO_PROXY: "*", no_proxy: "*" };
  const hBefore = hostingMails(S.cap);
  const o0 = JSON.parse((await phpEval(`echo json_encode(stike_send_owner_mail("Nueva venta Y", "<p>hola</p>", ["kind" => "venta", "noQueue" => true]));`, envOff)).out || "{}");
  t("con Gmail caído el aviso de venta sale por el respaldo del hosting y el panel anota el motivo", [o0.sent, o0.gmailError && o0.gmailError.code, hostingMails(S.cap) - hBefore], ["mail", "gmail_down", 1]);
  const o1 = JSON.parse((await phpEval(`echo json_encode(stike_send_owner_mail("Nueva venta X", "<p>hola</p>", ["kind" => "venta"]));`, { ...envOff, STIKE_MAIL_EXIT: "1" })).out || "{}");
  t("sin Gmail y sin hosting el aviso de venta queda guardado para reintentar, con el motivo", [o1.error, o1.queued, o1.gmailError && o1.gmailError.code], ["email_failed", true, "gmail_down"]);
  g.gmailMode = "ok";
  const nSent = g.sent.length;
  const flush = await phpEval(`echo stike_mail_outbox_flush();`, envOff);
  const late = g.sent[nSent] ? parseEml(g.sent[nSent].raw) : null;
  t("cuando Gmail vuelve, el aviso guardado sale solo, con la nota «se reenvió»", [flush.out, late && /Nueva venta X/.test(late.subject), late && /se reenvió porque el primer envío falló/.test(late.parts["text/html"] || "")], ["1", true, true]);

  console.log("\nDesconectar");
  g.revoked.length = 0;
  const dc = await post(S.API, owner, { action: "gmail_disconnect" });
  t("quita el permiso permanente y la cuenta (y deja el ID y el secreto para volver a conectar) y le avisa a Google que lo anule", [dc.json.ok, keys(), g.revoked], [true, ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET"], [REFRESH]]);
  const hD = await health(S.API, owner);
  t("el panel vuelve a decir que falta conectar, y el aviso sale por el hosting", [hD.mail.gmail.connected, hD.mail.gmail.clientConfigured, (await post(S.API, owner, { action: "test_email" })).json.via], [false, true, "mail"]);
  const dc2 = await post(S.API, owner, { action: "gmail_disconnect", all: true });
  t("«Quitar todo» borra también el ID y el secreto de cliente", [dc2.json.ok, keys()], [true, []]);

  console.log("\nEl servidor no depende de la web para el regreso");
  t("el regreso de Google está enrutado en .htaccess (api/gmail-callback)", /RewriteRule \^api\/\([^)]*gmail-callback[^)]*\)\/\?\$ api\/\$1\.php \[L\]/.test(readFileSync(join(ROOT, ".htaccess"), "utf8")), true);
} finally {
  for (const p of procs) p.kill();
  google.close(); googleId.close(); resend.close();
  rmSync(WORK, { recursive: true, force: true });
}
console.log(fail ? `\n${fail} falla(s)` : "\nTodo bien");
process.exit(fail ? 1 : 0);
