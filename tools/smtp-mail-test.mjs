/* =========================================================================
   Prueba del aviso de venta por SMTP (un correo del propio dominio, p. ej.
   ventas@stikebikeshop.com de Hostinger, o Gmail con contraseña de aplicación):
   sin crear cuentas en servicios nuevos.

     node tools/smtp-mail-test.mjs

   Levanta el servidor embebido de PHP, un servidor SMTP FALSO (conexion segura
   desde el primer byte como el puerto 465, y STARTTLS como el 587) y un Resend
   falso. Comprueba que el panel entra a la cuenta ANTES de guardar, que la
   contraseña va cifrada y nunca se devuelve, que el aviso sale por la cuenta
   (con el formato que Gmail espera), el orden Resend -> SMTP -> hosting, los
   errores explicados en español y que un servidor interno no se puede usar.

   Necesita `php` y `openssl` en el PATH. No toca la red ni cuentas reales.
   ========================================================================= */
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import tls from "node:tls";
import { mkdtempSync, readFileSync, existsSync, readdirSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

if (spawnSync("php", ["-v"]).status !== 0) { console.log("sin php: se omite la prueba de SMTP"); process.exit(0); }
if (spawnSync("openssl", ["version"]).status !== 0) { console.log("sin openssl: se omite la prueba de SMTP"); process.exit(0); }
const ROOT = fileURLToPath(new URL("..", import.meta.url));
let fail = 0;
const t = (l, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++; console.log(`  ${ok ? "ok  " : "FALLA"} ${l}${ok ? "" : `  -> dio ${JSON.stringify(got)}, esperaba ${JSON.stringify(want)}`}`); };
const freePort = () => new Promise(res => { const s = createNetServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
const listen = handler => new Promise(res => { const s = createServer(handler); s.listen(0, "127.0.0.1", () => res(s)); });
const wait = ms => new Promise(r => setTimeout(r, ms));

const WORK = mkdtempSync(join(tmpdir(), "stike-smtp-"));
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(WORK, "k.pem"), "-out", join(WORK, "c.pem"), "-days", "1", "-subj", "/CN=127.0.0.1"], { stdio: "ignore" });
const KEY = readFileSync(join(WORK, "k.pem")), CERT = readFileSync(join(WORK, "c.pem"));

/* ---- Servidor SMTP falso. mode: ssl (como 465) | starttls (como 587) | plain | nostarttls (587 que no ofrece TLS) ---- */
function smtpMock(opts = {}) {
  const o = { user: "ventas@stikebikeshop.com", pass: "clave-secreta-123", mode: "ssl", offer: "PLAIN LOGIN", rejectFrom: false, rejectRcpt: [], ...opts };
  const inbox = [], logins = [];
  function session(stream, secure) {
    let buf = "", st = "cmd", cur = { from: null, to: [] }, authed = false, step = null, tmpUser = "";
    const w = s => stream.write(s + "\r\n");
    const reply = lines => lines.forEach((l, i) => w((i < lines.length - 1 ? "250-" : "250 ") + l));
    const finishAuth = (u, p) => { logins.push({ user: u, passLen: (p || "").length, pass: p }); if (u === o.user && p === o.pass) { authed = true; return w("235 2.7.0 Authentication successful"); } return w("535 5.7.8 Username and Password not accepted"); };
    const cmd = line => {
      const up = line.toUpperCase();
      if (step === "login-user") { tmpUser = Buffer.from(line, "base64").toString(); step = "login-pass"; return w("334 UGFzc3dvcmQ6"); }
      if (step === "login-pass") { step = null; return finishAuth(tmpUser, Buffer.from(line, "base64").toString()); }
      if (up.startsWith("EHLO") || up.startsWith("HELO")) { const caps = ["mock.test", "8BITMIME"]; if (o.mode === "starttls" && !secure) caps.push("STARTTLS"); else caps.push("AUTH " + o.offer); return reply(caps); }
      if (up === "STARTTLS") { w("220 2.0.0 Ready to start TLS"); stream.removeAllListeners("data"); session(new tls.TLSSocket(stream, { isServer: true, key: KEY, cert: CERT }), true); return; }
      if (up.startsWith("AUTH PLAIN")) { const p = Buffer.from(line.slice(11).trim(), "base64").toString().split("\0"); return finishAuth(p[1], p[2]); }
      if (up === "AUTH LOGIN") { step = "login-user"; return w("334 VXNlcm5hbWU6"); }
      if (up.startsWith("MAIL FROM:")) { if (!authed) return w("530 5.7.0 Authentication required"); if (o.rejectFrom) return w("553 5.7.1 Sender address rejected: not owned by user"); cur.from = (line.match(/<([^>]*)>/) || [])[1]; return w("250 2.1.0 Ok"); }
      if (up.startsWith("RCPT TO:")) { const a = (line.match(/<([^>]*)>/) || [])[1]; if (o.rejectRcpt.includes(a)) return w("550 5.1.1 Recipient address rejected"); cur.to.push(a); return w("250 2.1.5 Ok"); }
      if (up === "DATA") { if (!cur.to.length) return w("503 5.5.1 Need RCPT first"); st = "data"; return w("354 End data with <CR><LF>.<CR><LF>"); }
      if (up === "QUIT") { w("221 2.0.0 Bye"); return stream.end(); }
      w("500 5.5.2 Command not recognized");
    };
    const drain = () => {
      for (;;) {
        if (st === "data") {
          const i = buf.indexOf("\r\n.\r\n"); if (i < 0) return;
          const data = buf.slice(0, i).replace(/\r\n\.\./g, "\r\n."); buf = buf.slice(i + 5); st = "cmd";
          inbox.push({ from: cur.from, to: cur.to, data, secure, authedAs: authed ? o.user : null }); cur = { from: null, to: [] };
          w("250 2.0.0 Ok: queued as MOCK" + inbox.length); continue;
        }
        const i = buf.indexOf("\r\n"); if (i < 0) return;
        const line = buf.slice(0, i); buf = buf.slice(i + 2); cmd(line);
      }
    };
    stream.on("data", c => { buf += c.toString("latin1"); drain(); });
    stream.on("error", () => {});
  }
  const greet = (stream, secure) => { stream.write("220 mock.test ESMTP ready\r\n"); session(stream, secure); };
  const server = o.mode === "ssl" ? tls.createServer({ key: KEY, cert: CERT }, s => { s.on("error", () => {}); greet(s, true); }) : createNetServer(s => { s.on("error", () => {}); greet(s, false); });
  return new Promise(res => server.listen(0, "127.0.0.1", () => res({ port: server.address().port, inbox, logins, opts: o, close: () => new Promise(r => { server.close(r); server.closeAllConnections?.(); }) })));
}

/* ---- Resend falso (solo para probar el orden Resend -> SMTP) ---- */
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
const google = await listen((req, res) => {
  const tok = new URL(req.url, "http://x").searchParams.get("id_token");
  if (!WHO[tok]) { res.statusCode = 400; return res.end("{}"); }
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ aud: "752305520255-7e2abc762p3saer5sube25jh9rt9jle7.apps.googleusercontent.com", iss: "https://accounts.google.com", email: WHO[tok], email_verified: "true", exp: String(Math.floor(Date.now() / 1000) + 3600) }));
});

/* sendmail falso: lo que mail() del hosting entregaria queda en un archivo. */
const CAPTURE = join(WORK, "cap"); execFileSync("mkdir", ["-p", CAPTURE]);
const FAKE_SENDMAIL = join(WORK, "fake-sendmail.sh");
writeFileSync(FAKE_SENDMAIL, ["#!/bin/sh", 'd="${STIKE_MAIL_CAPTURE:-' + CAPTURE + '}"', 'f="$d/mail-$(date +%s%N)-$$"', 'cat > "$f.eml"', 'exit ${STIKE_MAIL_EXIT:-0}'].join("\n") + "\n"); chmodSync(FAKE_SENDMAIL, 0o755);
const hostingMails = dir => readdirSync(dir).filter(f => f.endsWith(".eml")).length;

const baseEnv = {
  ...process.env, ADMIN_API_KEY: "k".repeat(32), GITHUB_TOKEN: "ghp_falso", STIKE_GOOGLE_TOKENINFO: `http://127.0.0.1:${google.address().port}`, STIKE_INSECURE_COOKIE: "1", NO_PROXY: "*", no_proxy: "*",
  WOMPI_PUBLIC_KEY: "pub_test_demo1234", WOMPI_PRIVATE_KEY: "prv_test_demo1234", WOMPI_INTEGRITY_SECRET: "test_integrity_AbCdEfGh12345678",
  RESEND_API_BASE: `http://127.0.0.1:${resend.address().port}`, RESEND_API_KEY: "", STIKE_SMTP_INSECURE: "1",
};
const procs = [];
async function startPhp(extra = {}) {
  const port = await freePort();
  const storage = mkdtempSync(join(WORK, "st-")), cap = mkdtempSync(join(WORK, "cap-"));
  const proc = spawn("php", ["-d", `sendmail_path=${FAKE_SENDMAIL} -t -i`, "-S", `127.0.0.1:${port}`, "-t", ROOT], { env: { ...baseEnv, STORAGE_DIR: storage, STIKE_MAIL_CAPTURE: cap, ...extra }, stdio: "ignore" });
  procs.push(proc);
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port}/api/admin-login.php`); break; } catch { await wait(100); } }
  return { proc, API: `http://127.0.0.1:${port}/api`, storage, cap };
}
const loginAt = async (api, who) => (await fetch(`${api}/admin-login.php`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credential: who }) })).headers.get("set-cookie").split(";")[0];
const post = (api, cookie, body) => fetch(`${api}/admin-config.php`, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) }).then(async r => ({ code: r.status, json: await r.json().catch(() => null) }));
const health = (api, cookie) => fetch(`${api}/admin-health.php`, { headers: { Cookie: cookie } }).then(r => r.json());
const emailCheck = h => (h.checks || []).find(c => c.id === "email") || {};
const parseEml = raw => {
  const txt = raw.replace(/\r\n/g, "\n"); const [head, ...rest] = txt.split("\n\n"); const body = rest.join("\n\n");
  const unfolded = head.replace(/\n[ \t]+/g, " ");
  const hdr = n => (unfolded.match(new RegExp("^" + n + ":\\s*(.*)$", "im")) || [])[1] || "";
  const words = s => s.replace(/=\?UTF-8\?B\?([^?]*)\?=\s*/gi, (_, b) => Buffer.from(b, "base64").toString("utf8"));
  const bound = (hdr("Content-Type").match(/boundary="([^"]+)"/) || [])[1]; const parts = {};
  if (bound) for (const p of body.split("--" + bound)) { const m = p.match(/Content-Type:\s*([^;\s]+)[\s\S]*?\n\n([\s\S]*)$/i); if (m) parts[m[1]] = Buffer.from(m[2].replace(/\s+/g, ""), "base64").toString("utf8"); }
  return { subject: words(hdr("Subject")), from: words(hdr("From")), to: hdr("To"), msgId: hdr("Message-ID"), date: hdr("Date"), type: hdr("Content-Type"), parts, maxLine: Math.max(...txt.split("\n").map(l => l.length)) };
};
const phpEval = (code, env = {}) => new Promise(res => {
  const p = spawn("php", ["-d", `sendmail_path=${FAKE_SENDMAIL} -t -i`, "-r", `require "api/_lib.php"; ${code}`], { cwd: ROOT, env: { ...baseEnv, ...env } });
  let out = ""; p.stdout.on("data", d => { out += d; }); p.on("close", status => res({ status, out: out.trim() }));
});

const smtp = await smtpMock({ mode: "ssl" });
const mocks = [smtp];
try {
  /* ============================================================ A. guardar la cuenta desde el panel ============================================================ */
  console.log("\nLa cuenta de correo se pega en el panel: se comprueba entrando a ella ANTES de guardar");
  const A = await startPhp({ SMTP_SECURE: "ssl" });
  const owner = await loginAt(A.API, "owner"), adminU = await loginAt(A.API, "admin"), staff = await loginAt(A.API, "staff");
  const good = { action: "smtp_save", host: "127.0.0.1", port: smtp.port, user: "ventas@stikebikeshop.com", pass: "clave-secreta-123" };
  const cfgFile = join(A.storage, "runtime-config.json");
  const savedKeys = () => existsSync(cfgFile) ? Object.keys(JSON.parse(readFileSync(cfgFile, "utf8"))).filter(k => k.startsWith("SMTP_")) : [];
  t("sin sesión: 401", (await post(A.API, null, good)).code, 401);
  t("administrador y tienda: 403 (solo dueño y desarrollador)", [(await post(A.API, adminU, good)).code, (await post(A.API, staff, good)).code], [403, 403]);
  t("servidor mal escrito -> 400 invalid_host", (await post(A.API, owner, { ...good, host: "smtp hostinger com" })).json.error, "invalid_host");
  t("puerto imposible -> 400 invalid_port", (await post(A.API, owner, { ...good, port: 0 })).json.error, "invalid_port");
  t("usuario que no es un correo -> 400 invalid_user", (await post(A.API, owner, { ...good, user: "ventas" })).json.error, "invalid_user");
  t("sin contraseña -> 400", (await post(A.API, owner, { ...good, pass: "   " })).json.error, "empty_value");
  t("un servidor que no existe -> 400 smtp_unreachable y no se guarda nada", [(await post(A.API, owner, { ...good, host: "no-existe.invalid" })).json.error, savedKeys()], ["smtp_unreachable", []]);
  const closed = await freePort();
  const rUn = await post(A.API, owner, { ...good, port: closed });
  t("un puerto donde no hay servidor de correo -> 502 smtp_unreachable, dice a dónde intentó y no se guarda", [rUn.code, rUn.json.error, /127\.0\.0\.1:\d+/.test(rUn.json.detail), savedKeys()], [502, "smtp_unreachable", true, []]);
  const rBad = await post(A.API, owner, { ...good, pass: "otra-clave" });
  t("contraseña equivocada -> 400 smtp_auth_failed, con lo que dijo el servidor, y NO se guarda", [rBad.code, rBad.json.error, /rechaz/.test(rBad.json.detail), /535/.test(rBad.json.detail), savedKeys()], [400, "smtp_auth_failed", true, true, []]);
  t("el mensaje de error nunca trae la contraseña", JSON.stringify(rBad.json).includes("otra-clave"), false);
  const rGm = await post(A.API, owner, { ...good, user: "dueno@gmail.com", pass: "mala" });
  t("con un correo de Gmail y contraseña mala, explica la «contraseña de aplicación»", /contraseña de aplicación/.test(rGm.json.detail), true);
  const rOk = await post(A.API, owner, good);
  t("cuenta y contraseña correctas -> 200 (se entró a la cuenta), conexión segura", [rOk.code, rOk.json.ok, rOk.json.user, rOk.json.secure, rOk.json.encrypted], [200, true, "ventas@stikebikeshop.com", "ssl", true]);
  const raw = readFileSync(cfgFile, "utf8");
  t("la contraseña va cifrada en el disco y la respuesta no la trae", [raw.includes("clave-secreta-123"), JSON.stringify(rOk.json).includes("clave-secreta-123"), savedKeys().sort(), JSON.parse(raw).SMTP_PASS.enc], [false, false, ["SMTP_HOST", "SMTP_PASS", "SMTP_PORT", "SMTP_USER"], "v1"]);
  t("el servidor de correo recibió el usuario y la contraseña verdaderos (AUTH PLAIN)", smtp.logins.some(l => l.user === "ventas@stikebikeshop.com" && l.pass === "clave-secreta-123"), true);

  console.log("\nEl panel muestra la cuenta (sin la contraseña) y el aviso sale desde ahí");
  const h0 = await health(A.API, owner);
  t("el formulario recibe servidor, puerto y correo, y que la contraseña existe (guardada en el panel)", [h0.mail.smtp.configured, h0.mail.smtp.source, h0.mail.smtp.host, h0.mail.smtp.port, h0.mail.smtp.user], [true, "panel", "127.0.0.1", smtp.port, "ventas@stikebikeshop.com"]);
  t("el administrador no recibe ese bloque y ninguna respuesta del panel trae la contraseña", [(await health(A.API, adminU)).mail === undefined, JSON.stringify(h0).includes("clave-secreta-123")], [true, false]);
  t("antes de enviar nada, el panel dice a qué correo sale y que falta probar", [/Sale por tu correo v\*\*\*@stikebikeshop\.com/.test(emailCheck(h0).detail), /Todav[ií]a no se ha enviado/.test(emailCheck(h0).detail), emailCheck(h0).ok], [true, true, false]);
  const t1 = await post(A.API, owner, { action: "test_email" });
  t("el correo de prueba sale por SMTP y se marca como confiable", [t1.json.ok, t1.json.via, t1.json.reliable, t1.json.smtpConfigured], [true, "smtp", true, true]);
  t("el hosting (mail) NO se usó", hostingMails(A.cap), 0);
  const m1 = smtp.inbox[0], p1 = parseEml(m1.data);
  t("el servidor de correo recibió el mensaje: remitente = la cuenta, destinatario = el dueño, por conexión segura y con sesión iniciada", [m1.from, m1.to, m1.secure, m1.authedAs], ["ventas@stikebikeshop.com", ["jparra375@gmail.com"], true, "ventas@stikebikeshop.com"]);
  t("armado como lo quiere Gmail: texto + HTML, fecha, Message-ID del dominio, remitente con nombre, ninguna línea de más de 998 caracteres", [/multipart\/alternative/.test(p1.type), !!p1.parts["text/plain"] && !!p1.parts["text/html"], p1.date !== "", /^<[0-9a-f]+@stikebikeshop\.com>$/.test(p1.msgId), p1.from, p1.maxLine <= 998], [true, true, true, true, "Stike Bike Shop <ventas@stikebikeshop.com>", true]);
  t("el asunto con acentos y raya se lee bien y el cuerpo dice lo mismo en texto y en HTML", [p1.subject, p1.to, /Si lees esto/.test(p1.parts["text/plain"]), /<h2>/.test(p1.parts["text/html"])], ["Prueba de correo — Stike Bike Shop", "jparra375@gmail.com", true, true]);
  const h1 = emailCheck(await health(A.API, owner));
  t("el panel lo marca ✔ «por tu correo (SMTP)»", [h1.ok, /✔ por tu correo \(SMTP\)/.test(h1.detail)], [true, true]);

  console.log("\nVarios destinatarios y contraseñas de aplicación de Google");
  await post(A.API, owner, { key: "OWNER_NOTIFY_EMAIL", value: "jparra375@gmail.com, socio@gmail.com" });   // esto manda el aviso del cambio de destinatarios
  const nBefore = smtp.inbox.length;
  await post(A.API, owner, { action: "test_email" });
  const mm = smtp.inbox[nBefore];
  t("el aviso llega a los dos (un solo mensaje con los dos destinatarios)", [mm.to, parseEml(mm.data).to], [["jparra375@gmail.com", "socio@gmail.com"], "jparra375@gmail.com, socio@gmail.com"]);
  const gm = await smtpMock({ mode: "ssl", user: "dueno@gmail.com", pass: "abcdefghijklmnop" }); mocks.push(gm);
  const rApp = await post(A.API, owner, { action: "smtp_save", host: "127.0.0.1", port: gm.port, user: "dueno@gmail.com", pass: "abcd efgh ijkl mnop" });
  t("la «contraseña de aplicación» de Google con sus espacios (4 grupos) se acepta: el servidor recibe las 16 letras juntas", [rApp.code, gm.logins[gm.logins.length - 1].pass], [200, "abcdefghijklmnop"]);
  await post(A.API, owner, { action: "smtp_save", ...good });   // se vuelve a la cuenta del dominio

  console.log("\nSi la cuenta falla, el panel dice por qué y el aviso no se pierde");
  const reject = await smtpMock({ mode: "ssl", rejectFrom: true }); mocks.push(reject);
  const B = await startPhp({ SMTP_SECURE: "ssl", SMTP_HOST: "127.0.0.1", SMTP_PORT: String(reject.port), SMTP_USER: "ventas@stikebikeshop.com", SMTP_PASS: "clave-secreta-123" });
  const ownerB = await loginAt(B.API, "owner");
  const hB = await health(B.API, ownerB);
  t("una cuenta puesta en el servidor (api/config.local.php o variables) también funciona, y el panel dice que viene del servidor", [hB.mail.smtp.configured, hB.mail.smtp.source], [true, "servidor"]);
  const tB = await post(B.API, ownerB, { action: "test_email" });
  t("remitente rechazado por el servidor de correo: lo explica y se usa el hosting como respaldo", [tB.json.ok, tB.json.via, tB.json.reliable, tB.json.smtpError.code, /mismo correo con el que se inicia sesi/.test(tB.json.smtpError.detail), hostingMails(B.cap)], [true, "mail", false, "smtp_sender_rejected", true, 1]);
  const eB = emailCheck(await health(B.API, ownerB));
  t("el panel marca ✕ y cuenta que el envío principal falló y se usó el hosting", [eB.ok, /El env[ií]o principal fall[oó] y se us[oó] el correo del hosting/.test(eB.detail), /no acept[oó] el remitente/.test(eB.detail)], [false, true, true]);
  const rej = await smtpMock({ mode: "ssl", rejectRcpt: ["jparra375@gmail.com"] }); mocks.push(rej);
  const C = await startPhp({ SMTP_SECURE: "ssl", SMTP_HOST: "127.0.0.1", SMTP_PORT: String(rej.port), SMTP_USER: "ventas@stikebikeshop.com", SMTP_PASS: "clave-secreta-123" });
  const tC = await post(C.API, await loginAt(C.API, "owner"), { action: "test_email" });
  t("si el servidor rechaza al destinatario: dice cuál y se usa el hosting", [tC.json.via, tC.json.smtpError.code, /jparra375@gmail\.com/.test(tC.json.smtpError.detail)], ["mail", "smtp_recipient_rejected", true]);
  const deadPort = await freePort();
  const D = await startPhp({ SMTP_SECURE: "ssl", SMTP_HOST: "127.0.0.1", SMTP_PORT: String(deadPort), SMTP_USER: "ventas@stikebikeshop.com", SMTP_PASS: "clave-secreta-123", STIKE_MAIL_EXIT: "1" });
  const o1 = JSON.parse((await phpEval(`echo json_encode(stike_send_owner_mail("Nueva venta X", "<p>hola</p>", ["kind" => "venta"]));`, { STORAGE_DIR: D.storage, STIKE_MAIL_CAPTURE: D.cap, STIKE_MAIL_EXIT: "1", SMTP_SECURE: "ssl", SMTP_HOST: "127.0.0.1", SMTP_PORT: String(deadPort), SMTP_USER: "ventas@stikebikeshop.com", SMTP_PASS: "clave-secreta-123" })).out);
  t("sin servidor de correo y sin hosting: el aviso de venta queda guardado para reintentar, con el motivo", [o1.error, o1.queued, o1.smtpError.code], ["email_failed", true, "smtp_unreachable"]);
  const nIn = smtp.inbox.length;
  const flush = await phpEval(`echo stike_mail_outbox_flush();`, { STORAGE_DIR: D.storage, STIKE_MAIL_CAPTURE: D.cap, SMTP_SECURE: "ssl", SMTP_HOST: "127.0.0.1", SMTP_PORT: String(smtp.port), SMTP_USER: "ventas@stikebikeshop.com", SMTP_PASS: "clave-secreta-123" });
  const late = smtp.inbox[nIn];
  t("cuando la cuenta vuelve a responder, el aviso guardado sale solo, con la nota «se reenvió»", [flush.out, late && /Nueva venta X/.test(parseEml(late.data).subject), late && /se reenvió porque el primer envío falló/.test(parseEml(late.data).parts["text/html"])], ["1", true, true]);

  console.log("\nOrden de envío: Resend primero, luego tu correo, y el hosting al final");
  const E = await startPhp({ SMTP_SECURE: "ssl", RESEND_API_KEY: "re_falsa_para_prueba_1234567890", SMTP_HOST: "127.0.0.1", SMTP_PORT: String(smtp.port), SMTP_USER: "ventas@stikebikeshop.com", SMTP_PASS: "clave-secreta-123" });
  const ownerE = await loginAt(E.API, "owner");
  const s0 = smtp.inbox.length, r0 = resendMails.length;
  const e1 = await post(E.API, ownerE, { action: "test_email" });
  t("con Resend funcionando, sale por Resend y no se toca tu correo", [e1.json.via, resendMails.length - r0, smtp.inbox.length - s0], ["resend", 1, 0]);
  resendMode = "down";
  const e2 = await post(E.API, ownerE, { action: "test_email" });
  t("si Resend falla, sale por tu correo (SMTP) y se explica lo de Resend", [e2.json.via, e2.json.reliable, e2.json.resendError.code, smtp.inbox.length - s0, hostingMails(E.cap)], ["smtp", true, "resend_down", 1, 0]);
  const eE = emailCheck(await health(E.API, ownerE));
  t("el panel sigue en ✔ (salió por tu correo) y cuenta que Resend falló", [eE.ok, /El env[ií]o principal fall[oó] y se us[oó] tu correo \(SMTP\)/.test(eE.detail)], [true, true]);
  resendMode = "ok";

  console.log("\nQuitar la cuenta guardada");
  const clr = await post(A.API, owner, { action: "smtp_clear" });
  t("«Quitar lo guardado aquí» borra servidor, puerto, correo y contraseña", [clr.json.cleared, savedKeys().filter(k => k !== undefined).sort().join(",")], [true, ""]);
  const tA = await post(A.API, owner, { action: "test_email" });
  t("sin cuenta ni Resend, el aviso sale por el hosting y el panel dice que no es confiable", [tA.json.via, tA.json.reliable, tA.json.smtpConfigured, hostingMails(A.cap)], ["mail", false, false, 1]);

  console.log("\nSTARTTLS (puerto 587): la conexión empieza normal y se vuelve segura");
  const st = await smtpMock({ mode: "starttls" }); mocks.push(st);
  const F = await startPhp({ SMTP_SECURE: "starttls" });
  const ownerF = await loginAt(F.API, "owner");
  const rSt = await post(F.API, ownerF, { action: "smtp_save", host: "127.0.0.1", port: st.port, user: "ventas@stikebikeshop.com", pass: "clave-secreta-123" });
  t("se guarda tras subir a TLS y entrar a la cuenta", [rSt.code, rSt.json.secure], [200, "starttls"]);
  await post(F.API, ownerF, { action: "test_email" });
  t("y el aviso viaja por la conexión ya segura (nunca contraseña ni mensaje en texto plano)", [st.inbox.length, st.inbox[0] && st.inbox[0].secure, st.inbox[0] && st.inbox[0].authedAs], [1, true, "ventas@stikebikeshop.com"]);
  const nt = await smtpMock({ mode: "plain" }); mocks.push(nt);
  const G = await startPhp({ SMTP_SECURE: "starttls" });
  const rNt = await post(G.API, await loginAt(G.API, "owner"), { action: "smtp_save", host: "127.0.0.1", port: nt.port, user: "ventas@stikebikeshop.com", pass: "clave-secreta-123" });
  t("un servidor que no ofrece conexión segura se rechaza: la contraseña no viaja en claro", [rNt.code, rNt.json.error, nt.logins.length], [502, "smtp_no_tls", 0]);

  console.log("\nProtecciones: el panel no puede usarse para tocar servidores internos");
  const H = await startPhp({ STIKE_SMTP_INSECURE: "0" });
  const ownerH = await loginAt(H.API, "owner");
  const goodH = { action: "smtp_save", user: "ventas@stikebikeshop.com", pass: "x-clave-1234" };
  t("solo los puertos de correo seguro (465, 587, 2525)", (await post(H.API, ownerH, { ...goodH, host: "smtp.hostinger.com", port: 22 })).json.error, "invalid_port");
  t("un servidor de la red interna o de la propia máquina (127.0.0.1) se rechaza", (await post(H.API, ownerH, { ...goodH, host: "127.0.0.1", port: 465 })).json.error, "invalid_host");
  t("también uno que se llame localhost o apunte a una dirección privada", [(await post(H.API, ownerH, { ...goodH, host: "localhost", port: 465 })).json.error, (await post(H.API, ownerH, { ...goodH, host: "192.168.1.10", port: 587 })).json.error], ["invalid_host", "invalid_host"]);
} finally {
  for (const p of procs) p.kill();
  for (const m of mocks) await m.close();
  google.close(); resend.close();
  rmSync(WORK, { recursive: true, force: true });
}
console.log(fail ? `\n${fail} falla(s)` : "\nTodo bien");
process.exit(fail ? 1 : 0);
