/* =========================================================================
   Prueba de api/admin-config.php (corregir el secreto de integridad de Wompi
   desde el panel) y de lo que protege al cobro: levanta el servidor embebido
   de PHP con la configuracion MALA que tenia el sitio (la llave PRIVADA en la
   casilla del secreto de integridad) y comprueba que se arregla desde el
   panel, que solo el dueno y el desarrollador pueden, que lo pegado se valida
   y nunca se devuelve, y que el cobro empieza a firmar con el secreto nuevo.

     node tools/admin-config-test.mjs

   Necesita `php` en el PATH. No toca la red ni llaves reales.
   ========================================================================= */
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, existsSync, statSync, readdirSync, rmSync, writeFileSync, copyFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

if (spawnSync("php", ["-v"]).status !== 0) { console.log("sin php: se omite la prueba de api/admin-config.php"); process.exit(0); }
const ROOT = fileURLToPath(new URL("..", import.meta.url));
let fail = 0;
const t = (l, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++; console.log(`  ${ok ? "ok  " : "FALLA"} ${l}${ok ? "" : `  -> dio ${JSON.stringify(got)}, esperaba ${JSON.stringify(want)}`}`); };
const freePort = () => new Promise(res => { const s = createNetServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
const listen = handler => new Promise(res => { const s = createServer(handler); s.listen(0, "127.0.0.1", () => res(s)); });

const WHO = { owner: "jparra375@gmail.com", developer: "daniel.f.acosta96@gmail.com", admin: "yeimy.hernandez.corredor@gmail.com", staff: "kevinarevalo1996@gmail.com", editor: "crystaldonkey18@gmail.com" };
const google = await listen((req, res) => {
  const tok = new URL(req.url, "http://x").searchParams.get("id_token");
  if (!WHO[tok]) { res.statusCode = 400; return res.end("{}"); }
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ aud: "752305520255-7e2abc762p3saer5sube25jh9rt9jle7.apps.googleusercontent.com", iss: "https://accounts.google.com", email: WHO[tok], email_verified: "true", exp: String(Math.floor(Date.now() / 1000) + 3600) }));
});

/* Wompi simulado: reconoce la llave publica del comercio y, con la llave privada, dice 404 para una transaccion que no existe. */
const mails = [];          // correos que Resend "acepto" (lo que mando el servidor)
let resendMode = "ok";     // ok | sandbox | unverified | badkey | down  (como contesta Resend al enviar)
let resendPosts = 0;       // cuantas veces se intento enviar por Resend
const resend = await listen((req, res) => {
  const c = []; req.on("data", d => c.push(d));
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    const auth = req.headers.authorization || "";
    const send = (code, obj) => { res.statusCode = code; res.end(JSON.stringify(obj)); };
    if (req.method === "GET" && req.url === "/domains") {   // para comprobar una llave antes de guardarla
      if (auth === "Bearer re_restringida_solo_enviar_123456") return send(401, { statusCode: 401, name: "restricted_api_key", message: "This API key is restricted to only send emails" });
      if (auth === "Bearer re_llave_rechazada_por_resend_123") return send(403, { statusCode: 403, name: "invalid_api_key", message: "API key is invalid" });
      if (auth === "Bearer re_llave_completa_con_dominio_123456") return send(200, { object: "list", data: [{ id: "d1", name: "stikebikeshop.com", status: "verified" }, { id: "d2", name: "otro.com", status: "pending" }] });
      return send(200, { object: "list", data: [] });
    }
    if (req.method === "POST" && req.url === "/emails") {
      resendPosts++;
      const body = JSON.parse(Buffer.concat(c).toString() || "{}");
      if (resendMode === "down") return send(500, { statusCode: 500, name: "application_error", message: "Internal server error" });
      if (resendMode === "badkey") return send(403, { statusCode: 403, name: "invalid_api_key", message: "API key is invalid" });
      if (resendMode === "sandbox") return send(403, { statusCode: 403, name: "validation_error", message: "You can only send testing emails to your own email address (otro.dueno@gmail.com). To send emails to other recipients, please verify a domain at resend.com/domains, and change the `from` address to an email using this domain." });
      if (resendMode === "unverified") return send(403, { statusCode: 403, name: "validation_error", message: "The stikebikeshop.com domain is not verified. Please, add and verify your domain on https://resend.com/domains" });
      mails.push({ ...body, _auth: auth });
      return send(200, { id: "em_" + mails.length });
    }
    send(404, {});
  });
});

/* sendmail falso: lo que PHP mail() entregaria al servidor de correo del hosting queda guardado en un archivo (.eml) para revisarlo. */
const CAPTURE = mkdtempSync(join(tmpdir(), "stike-sendmail-"));
const FAKE_SENDMAIL = join(CAPTURE, "fake-sendmail.sh");
writeFileSync(FAKE_SENDMAIL, ["#!/bin/sh", 'd="${STIKE_MAIL_CAPTURE:-' + CAPTURE + '}"', 'f="$d/mail-$(date +%s%N)-$$"', 'echo "$@" > "$f.args"', 'cat > "$f.eml"', 'exit ${STIKE_MAIL_EXIT:-0}'].join("\n") + "\n");
chmodSync(FAKE_SENDMAIL, 0o755);
const captured = dir => readdirSync(dir).filter(f => f.endsWith(".eml")).sort().map(f => ({ eml: readFileSync(join(dir, f), "utf8"), args: existsSync(join(dir, f.replace(/\.eml$/, ".args"))) ? readFileSync(join(dir, f.replace(/\.eml$/, ".args")), "utf8") : "" }));
const parseEml = raw => {
  const txt = raw.replace(/\r\n/g, "\n");
  const [head, ...rest] = txt.split("\n\n"); const body = rest.join("\n\n");
  const unfolded = head.replace(/\n[ \t]+/g, " ");
  const hdr = n => (unfolded.match(new RegExp("^" + n + ":\\s*(.*)$", "im")) || [])[1] || "";
  const words = s => s.replace(/=\?UTF-8\?B\?([^?]*)\?=\s*/gi, (_, b) => Buffer.from(b, "base64").toString("utf8"));
  const bound = (hdr("Content-Type").match(/boundary="([^"]+)"/) || [])[1];
  const parts = {};
  if (bound) for (const p of body.split("--" + bound)) { const m = p.match(/Content-Type:\s*([^;\s]+)[\s\S]*?\n\n([\s\S]*)$/i); if (m) parts[m[1]] = Buffer.from(m[2].replace(/\s+/g, ""), "base64").toString("utf8"); }
  return { subject: words(hdr("Subject")), from: words(hdr("From")), to: hdr("To"), msgId: hdr("Message-ID"), date: hdr("Date"), type: hdr("Content-Type"), parts, maxLine: Math.max(...txt.split("\n").map(l => l.length)) };
};
const txns = {};          // id -> transaccion (como la devuelve Wompi)
let getByIdDown = false;  // simula que "consultar por id" falla (lo que paso con el pago real)
let listPublic = false;   // simula que Wompi atiende la lista por referencia SIN pedir llave
const wompi = await listen((req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.url.startsWith("/merchants/")) return res.end(JSON.stringify({ data: { name: "Stike Bike Shop SAS", active: true } }));
  if (req.url.startsWith("/transactions?")) {   // lista por referencia: pide la llave privada
    if (!listPublic && req.headers.authorization !== "Bearer prv_test_demo1234") { res.statusCode = 401; return res.end("{}"); }
    const ref = new URL(req.url, "http://x").searchParams.get("reference");
    return res.end(JSON.stringify({ data: Object.values(txns).filter(x => x.reference === ref), meta: {} }));
  }
  if (req.url.startsWith("/transactions/")) {
    if (getByIdDown) { res.statusCode = 502; return res.end("{}"); }
    const x = txns[decodeURIComponent(req.url.split("/transactions/")[1])];
    if (!x) { res.statusCode = 404; return res.end("{}"); }
    return res.end(JSON.stringify({ data: x }));
  }
  res.statusCode = 404; res.end("{}");
});

const STORAGE = mkdtempSync(join(tmpdir(), "stike-cfg-"));
const baseEnv = {
  ...process.env, GITHUB_TOKEN: "ghp_falso", ADMIN_API_KEY: "k".repeat(32), STORAGE_DIR: STORAGE,
  STIKE_GOOGLE_TOKENINFO: `http://127.0.0.1:${google.address().port}`, STIKE_INSECURE_COOKIE: "1", NO_PROXY: "*", no_proxy: "*",
  WOMPI_PUBLIC_KEY: "pub_test_demo1234", WOMPI_PRIVATE_KEY: "prv_test_demo1234",
  WOMPI_API_BASE: `http://127.0.0.1:${wompi.address().port}`, RESEND_API_KEY: "re_falsa", RESEND_API_BASE: `http://127.0.0.1:${resend.address().port}`,
  WOMPI_INTEGRITY_SECRET: "prv_test_la_privada_pegada_donde_no_iba",   // <- el error real del sitio
};
async function startPhp(extra = {}) {
  const port = await freePort();
  const proc = spawn("php", ["-d", `sendmail_path=${FAKE_SENDMAIL} -t -i`, "-S", `127.0.0.1:${port}`, "-t", ROOT], { env: { ...baseEnv, ...extra }, stdio: "ignore" });
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port}/api/admin-login.php`); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
  return { proc, API: `http://127.0.0.1:${port}/api` };
}
/* Corre una linea de PHP con _lib.php cargado (async: el Resend simulado vive en este mismo proceso y tiene que poder contestar). */
const phpEval = (code, env = {}) => new Promise(res => {
  const p = spawn("php", ["-d", `sendmail_path=${FAKE_SENDMAIL} -t -i`, "-r", `require "api/_lib.php"; ${code}`], { cwd: ROOT, env: { ...baseEnv, ...env } });
  let out = "", err = ""; p.stdout.on("data", d => { out += d; }); p.stderr.on("data", d => { err += d; });
  p.on("close", status => res({ status, out: out.trim(), err: err.trim() }));
});
const srv = await startPhp();
const rate = await startPhp({ STIKE_SIGN_RATE_LIMIT: "3", STORAGE_DIR: mkdtempSync(join(tmpdir(), "stike-rate-")) });
const { API } = srv;

async function login(who) {
  const r = await fetch(`${API}/admin-login.php`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credential: who }) });
  return (r.headers.get("set-cookie") || "").split(";")[0];
}
const cfg = (cookie, body, headers = {}) => fetch(`${API}/admin-config.php`, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: JSON.stringify(body) }).then(async r => ({ code: r.status, json: await r.json().catch(() => null), raw: "" }));
const order = ref => ({ reference: ref, items: [{ slug: "cana-shadow-finest-negra-topload", qty: 1 }], shipping: { name: "Prueba", phone: "300", address: "Calle 1", city: "Bogota" } });
const sign = (api, ref) => fetch(`${api}/wompi-sign.php`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(order(ref)) }).then(async r => ({ code: r.status, json: await r.json().catch(() => null) }));

try {
  const owner = await login("owner"), dev = await login("developer"), adminU = await login("admin"), staff = await login("staff"), editor = await login("editor");
  const GOOD = "test_integrity_AbCdEfGh12345678";

  console.log("\nEl cobro hoy (configuración mala del sitio)");
  const bad = await sign(API, "stike-1700000000001-aaaaaaaa");
  t("la llave privada en la casilla de integridad: el cobro se niega", [bad.code, bad.json.error], [500, "server_misconfigured"]);
  t("y el mensaje dice qué está mal (parece la llave PRIVADA)", /PRIVADA/.test(bad.json.detail) && /INTEGRIDAD/.test(bad.json.detail), true);
  t("al dueño le llega UN correo de alerta: «el pago en línea no está funcionando»", [mails.length, /no est/.test(mails[0] && mails[0].subject), /PRIVADA/.test(mails[0] && mails[0].html)], [1, true, true]);
  await sign(API, "stike-1700000000009-zzzzzzzz");
  t("otro cliente que lo intenta no dispara otro correo (máximo uno cada 6 horas)", mails.length, 1);

  console.log("\nEl panel cuando el secreto está mal (no debe decir «sandbox» sin saberlo)");
  const h0 = await fetch(`${API}/admin-health.php`, { headers: { Cookie: owner } }).then(r => r.json());
  const c0 = id => (h0.checks || []).find(c => c.id === id) || {};
  t("«Modo producción» no afirma «todavía en sandbox»: dice que no se puede confirmar", [/Todav[ií]a en sandbox/.test(c0("wompi_prod").detail), /no se puede confirmar/.test(c0("wompi_prod").detail)], [false, true]);
  t("y enseña lo que tiene cada llave: pública y privada de pruebas, secreto de integridad ✕ (parece la privada)", [/Llave pública: pruebas/.test(c0("wompi_prod").detail), /Llave privada: pruebas/.test(c0("wompi_prod").detail), /Secreto de integridad: ✕ está mal \(lo que hay parece la llave PRIVADA\)/.test(c0("wompi_prod").detail)], [true, true, true]);
  const prodBad = await startPhp({ WOMPI_PUBLIC_KEY: "pub_prod_demo1234", WOMPI_PRIVATE_KEY: "prv_prod_demo1234", WOMPI_INTEGRITY_SECRET: "prv_prod_la_privada_pegada_donde_no_iba" });
  const h1 = await fetch(`${prodBad.API}/admin-health.php`, { headers: { Cookie: owner } }).then(r => r.json());
  const c1 = id => (h1.checks || []).find(c => c.id === id) || {};
  t("con llaves de PRODUCCIÓN y el secreto mal: dice «Llave pública: producción» y «Llave privada: producción»", [/Llave pública: producción/.test(c1("wompi_prod").detail), /Llave privada: producción/.test(c1("wompi_prod").detail)], [true, true]);
  t("y los eventos se piden en la pestaña PRODUCCIÓN (no «Sandbox»)", [/pestaña PRODUCCIÓN/.test(c1("wompi_last_event").detail), /Sandbox/.test(c1("wompi_last_event").detail)], [true, false]);
  prodBad.proc.kill();

  console.log("\nQuién puede cambiarlo");
  t("sin sesión: 401", (await cfg(null, { key: "WOMPI_INTEGRITY_SECRET", value: GOOD })).code, 401);
  t("tienda (staff): 403", (await cfg(staff, { key: "WOMPI_INTEGRITY_SECRET", value: GOOD })).code, 403);
  t("diseño (editor): 403", (await cfg(editor, { key: "WOMPI_INTEGRITY_SECRET", value: GOOD })).code, 403);
  t("administrador: 403 (solo dueño y desarrollador)", (await cfg(adminU, { key: "WOMPI_INTEGRITY_SECRET", value: GOOD })).code, 403);
  t("desde otro sitio web (Origin ajeno): 403", (await cfg(owner, { key: "WOMPI_INTEGRITY_SECRET", value: GOOD }, { Origin: "https://malo.example.com" })).code, 403);
  t("nada de eso guardó algo", existsSync(join(STORAGE, "runtime-config.json")), false);

  console.log("\nLo que se rechaza al pegar");
  const r1 = await cfg(owner, { key: "WOMPI_INTEGRITY_SECRET", value: "prv_test_otra_llave_privada_larga" });
  t("la llave privada en vez del secreto -> 400 y lo identifica", [r1.code, r1.json.error, /PRIVADA/.test(r1.json.detail)], [400, "wrong_kind", true]);
  t("sin devolver lo que se pegó", JSON.stringify(r1.json).includes("otra_llave_privada"), false);
  const r2 = await cfg(owner, { key: "WOMPI_INTEGRITY_SECRET", value: "test_events_AbCdEfGh12345678" });
  t("el secreto de EVENTOS en la casilla de integridad -> 400 y lo identifica", [r2.code, /EVENTOS/.test(r2.json.detail)], [400, true]);
  const r3 = await cfg(owner, { key: "WOMPI_INTEGRITY_SECRET", value: "prod_integrity_AbCdEfGh12345678" });
  t("de producción con llave pública de sandbox -> 400 wrong_environment", [r3.code, r3.json.error, /SANDBOX/.test(r3.json.detail) && /PRODUCCI/.test(r3.json.detail)], [400, "wrong_environment", true]);
  t("vacío -> 400", (await cfg(owner, { key: "WOMPI_INTEGRITY_SECRET", value: "   " })).code, 400);
  t("la llave PÚBLICA no se puede cambiar desde el panel (cambiarla redirige el dinero) -> 400", (await cfg(owner, { key: "WOMPI_PUBLIC_KEY", value: "pub_test_nueva_larga_12345" })).json.error, "invalid_key");
  t("nada de eso guardó algo", existsSync(join(STORAGE, "runtime-config.json")), false);

  console.log("\nSe corrige desde el panel");
  const ok = await cfg(owner, { key: "WOMPI_INTEGRITY_SECRET", value: `  "${GOOD}"\n` });
  t("el dueño pega el secreto correcto (con espacios y comillas de más) -> 200", [ok.code, ok.json.ok, ok.json.environment, ok.json.tail, ok.json.length], [200, true, "test", "5678", GOOD.length]);
  t("la respuesta nunca trae el secreto", JSON.stringify(ok.json).includes(GOOD), false);
  const file = join(STORAGE, "runtime-config.json");
  t("queda guardado en la carpeta de datos (fuera del sitio), solo legible por el servidor", [existsSync(file), (statSync(file).mode & 0o077) === 0], [true, true]);
  t("quién y cuándo lo guardó queda anotado", JSON.parse(readFileSync(file, "utf8")).WOMPI_INTEGRITY_SECRET.by, "jparra375@gmail.com");

  const ref = "stike-1700000000002-bbbbbbbb";
  const good = await sign(API, ref);
  t("el cobro vuelve a firmar (200)", good.code, 200);
  t("y la firma usa el secreto nuevo, no la llave privada mal puesta", good.json.signature, createHash("sha256").update(`${ref}${good.json.amount_in_cents}COP${GOOD}`).digest("hex"));
  t("devuelve la llave pública y el monto del catálogo", [good.json.public_key, good.json.amount_in_cents], ["pub_test_demo1234", 31000000]);

  console.log("\nEl desarrollador también puede, y se puede deshacer");
  const GOOD2 = "test_integrity_ZzZzZzZz98765432";
  t("el desarrollador cambia el secreto -> 200", (await cfg(dev, { key: "WOMPI_INTEGRITY_SECRET", value: GOOD2 })).code, 200);
  const ref2 = "stike-1700000000003-cccccccc";
  const g2 = await sign(API, ref2);
  t("el cobro firma con el último", g2.json.signature, createHash("sha256").update(`${ref2}${g2.json.amount_in_cents}COP${GOOD2}`).digest("hex"));
  t("«Quitar lo guardado» -> 200", (await cfg(owner, { key: "WOMPI_INTEGRITY_SECRET", clear: true })).json.cleared, true);
  t("y vuelve a valer lo del servidor (que está mal: el cobro se niega otra vez)", (await sign(API, "stike-1700000000004-dddddddd")).json.error, "server_misconfigured");

  console.log("\nProducción: lo que se comprueba desde el panel");
  await cfg(owner, { key: "WOMPI_INTEGRITY_SECRET", value: GOOD });   // el secreto bueno otra vez (el apartado anterior lo quitó)
  const hh = await fetch(`${API}/admin-health.php`, { headers: { Cookie: owner } }).then(r => r.json());
  const chk = id => (hh.checks || []).find(c => c.id === id) || {};
  t("Wompi reconoce la llave pública y muestra el nombre del comercio", [chk("wompi_reach").ok, /Stike Bike Shop SAS/.test(chk("wompi_reach").detail)], [true, true]);
  t("Wompi acepta la llave privada (se prueba con la lista de transacciones, que sí la usa; la consulta de UNA transacción es pública y no sirve para saberlo)", chk("wompi_private").ok, true);
  t("«de dónde salen las llaves» dice que el secreto viene del panel", /integridad: guardado desde el panel/.test(chk("wompi_source").detail), true);
  t("los eventos de Wompi: todavía ninguno -> ✕ con la instrucción de dónde ponerlo", [chk("wompi_last_event").ok, /URL de eventos/.test(chk("wompi_last_event").detail)], [false, true]);
  // el secreto de EVENTOS tambien se pega desde el panel; un evento con firma mala se rechaza y queda anotado
  t("el dueño guarda el secreto de eventos desde el panel", (await cfg(owner, { key: "WOMPI_EVENTS_SECRET", value: "test_events_AbCdEfGh12345678" })).code, 200);
  const evBad = await fetch(`${API}/wompi-events.php`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "transaction.updated", data: { transaction: { id: "txn-1", reference: "stike-1700000000002-bbbbbbbb", status: "APPROVED" } }, signature: { properties: ["transaction.id"], checksum: "malo" }, timestamp: 1 }) });
  t("un evento con firma falsa se rechaza (401)", evBad.status, 401);
  const hh2 = await fetch(`${API}/admin-health.php`, { headers: { Cookie: owner } }).then(r => r.json());
  const ev2 = (hh2.checks || []).find(c => c.id === "wompi_last_event") || {};
  t("y el panel avisa que llegó un aviso con firma NO válida (revisar el secreto de eventos), sin tomarlo por un evento real", [ev2.ok, /Todav[ií]a no ha llegado ninguno v[aá]lido/.test(ev2.detail), /1 aviso\(s\) con firma no v[aá]lida/.test(ev2.detail), /secreto de eventos/.test(ev2.detail)], [false, true, true, true]);
  t("el panel NUNCA devuelve ningún secreto", JSON.stringify(hh2).includes(GOOD) || JSON.stringify(hh2).includes("AbCdEfGh12345678"), false);

  console.log("\nProducción: el servidor de Wompi correcto según las llaves");
  const base = (priv, apiBase) => spawnSync("php", ["-r", `require "api/_lib.php"; echo stike_wompi_api_base(${JSON.stringify(priv)});`], { cwd: ROOT, env: { ...process.env, STORAGE_DIR: STORAGE, ...(apiBase ? { WOMPI_API_BASE: apiBase } : {}) } }).stdout.toString();
  t("llaves de producción -> production.wompi.co", base("prv_prod_x"), "https://production.wompi.co/v1");
  t("llaves de pruebas -> sandbox.wompi.co", base("prv_test_x"), "https://sandbox.wompi.co/v1");
  t("un WOMPI_API_BASE de sandbox que se quedó del ensayo, con llaves de producción, se IGNORA (si no, ningún pago real se podría confirmar)", base("prv_prod_x", "https://sandbox.wompi.co/v1"), "https://production.wompi.co/v1");
  t("y al revés (base de producción con llaves de pruebas) también", base("prv_test_x", "https://production.wompi.co/v1"), "https://sandbox.wompi.co/v1");
  t("un Wompi simulado de las pruebas locales sí se respeta", base("prv_test_x", "http://127.0.0.1:9999/"), "http://127.0.0.1:9999");

  console.log("\nUn cliente pagó y la venta no quedó registrada (lo que pasó en producción)");
  const salesOf = async () => (await fetch(`${API}/sales.php`, { headers: { Cookie: owner } }).then(r => r.json()));
  const mailsBefore = mails.length;
  const R9 = "stike-1700000000090-iiiiiiii";
  t("el cliente firma su pedido (queda guardado en el servidor)", (await sign(API, R9)).code, 200);
  const pendingFile = join(STORAGE, "pending", R9 + ".json");
  const pend9 = JSON.parse(readFileSync(pendingFile, "utf8")); pend9.createdAt = new Date(Date.now() - 10 * 60000).toISOString();
  (await import("node:fs")).writeFileSync(pendingFile, JSON.stringify(pend9));   // hace 10 minutos
  txns["txn-real-1"] = { id: "txn-real-1", reference: R9, status: "APPROVED", amount_in_cents: 31000000, currency: "COP" };
  getByIdDown = true;   // y la consulta por id de Wompi falla (la página dijo «No pudimos confirmar el pago»)
  const browser = await fetch(`${API}/wompi-order.php`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reference: R9, wompiId: "txn-real-1" }) });
  t("la página de resultado NO puede confirmar (Wompi no responde por id)", browser.status >= 500, true);
  t("y la venta no está registrada", (await salesOf()).filter(x => x.orderRef === R9).length, 0);
  t("ni salió correo", mails.length, mailsBefore);
  t("staff no puede usar «Buscar pagos sin registrar» (403)", (await fetch(`${API}/wompi-reconcile.php`, { method: "POST", headers: { Cookie: staff, "Content-Type": "application/json" }, body: "{}" })).status, 403);
  t("sin sesión: 401", (await fetch(`${API}/wompi-reconcile.php`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 401);
  const rec = await fetch(`${API}/wompi-reconcile.php`, { method: "POST", headers: { Cookie: owner, "Content-Type": "application/json" }, body: "{}" }).then(r => r.json());
  t("«Buscar pagos sin registrar»: Wompi lo tiene APROBADO por referencia -> se registra", [rec.ok, rec.recovered.length, rec.recovered[0] && rec.recovered[0].reference], [true, 1, R9]);
  t("lo que devuelve la venta no lleva a quién se le avisó ni por qué falla un correo (esa misma respuesta sale al navegador del cliente)", rec.recovered[0].result.email, { sent: "resend" });
  const sale9 = (await salesOf()).filter(x => x.orderRef === R9);
  t("la venta aparece en el panel (Ventas) con los datos del pedido", [sale9.length, sale9[0] && sale9[0].shipping.name, sale9[0] && sale9[0].wompiId, sale9[0] && sale9[0].source], [1, "Prueba", "txn-real-1", "wompi"]);
  t("sale el correo «Nueva venta» al dueño", [mails.length - mailsBefore, /Nueva venta/.test(mails[mails.length - 1].subject), /Prueba/.test(mails[mails.length - 1].html)], [1, true, true]);
  t("el pedido pendiente se limpia", existsSync(pendingFile), false);
  const rec2 = await fetch(`${API}/wompi-reconcile.php`, { method: "POST", headers: { Cookie: owner, "Content-Type": "application/json" }, body: "{}" }).then(r => r.json());
  t("repetirlo no duplica la venta ni manda otro correo", [rec2.recovered.length, (await salesOf()).filter(x => x.orderRef === R9).length, mails.length - mailsBefore], [0, 1, 1]);

  console.log("\nEl aviso de Wompi (evento firmado) registra la venta aunque la consulta por id falle");
  const R10 = "stike-1700000000091-jjjjjjjj";
  await sign(API, R10);
  const ts10 = 1700000999, EVS = "test_events_AbCdEfGh12345678";
  const evt = (secret) => ({ event: "transaction.updated", data: { transaction: { id: "txn-real-2", reference: R10, status: "APPROVED", amount_in_cents: 31000000 } }, environment: "prod", timestamp: ts10, signature: { properties: ["transaction.id", "transaction.status", "transaction.amount_in_cents"], checksum: createHash("sha256").update(`txn-real-2APPROVED31000000${ts10}${secret}`).digest("hex") } });
  const post = (b) => fetch(`${API}/wompi-events.php`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(async r => ({ code: r.status, json: await r.json().catch(() => null) }));
  const evFalso = await post(evt("otro_secreto"));
  t("evento con firma falsa -> 401 y NO registra", [evFalso.code, (await salesOf()).filter(x => x.orderRef === R10).length], [401, 0]);
  const evValido = await post(evt(EVS));
  t("evento con firma válida -> 200 y se registra con sus propios datos (sin consultar a Wompi)", [evValido.code, evValido.json.recorded], [200, 1]);
  t("la venta está en el panel y salió el correo", [(await salesOf()).filter(x => x.orderRef === R10).length, mails.length - mailsBefore], [1, 2]);
  await post(evt("otro_secreto_mas"));   // alguien prueba la dirección DESPUÉS del evento real
  const hh3 = await fetch(`${API}/admin-health.php`, { headers: { Cookie: owner } }).then(r => r.json());
  const ev3 = (hh3.checks || []).find(c => c.id === "wompi_last_event") || {};
  t("un aviso falso posterior NO tapa el último evento real: sigue ✔ «venta_registrada» y solo se anota cuántos falsos llegaron (3 hasta ahora)", [ev3.ok, /venta_registrada/.test(ev3.detail), /3 aviso\(s\) con firma no v[aá]lida/.test(ev3.detail)], [true, true, true]);
  getByIdDown = false;

  console.log("\nCorreo de prueba desde el panel");
  const te = await cfg(owner, { action: "test_email" });
  t("el dueño envía un correo de prueba -> ok, por Resend, a su correo (enmascarado)", [te.code, te.json.ok, te.json.via, /^j\*\*\*@/.test(te.json.to)], [200, true, "resend", true]);
  t("llega al servidor de correo", /Prueba de correo/.test(mails[mails.length - 1].subject), true);
  t("staff no puede (403)", (await cfg(staff, { action: "test_email" })).code, 403);

  console.log("\nLlave privada: se corrige desde el panel y se comprueba con Wompi");
  t("una llave que no es la privada (el secreto de integridad) -> 400", (await cfg(owner, { key: "WOMPI_PRIVATE_KEY", value: GOOD })).json.error, "wrong_kind");
  t("una privada de producción con la pública de pruebas -> 400 wrong_environment", (await cfg(owner, { key: "WOMPI_PRIVATE_KEY", value: "prv_prod_AbCdEfGh12345678" })).json.error, "wrong_environment");
  const rej = await cfg(owner, { key: "WOMPI_PRIVATE_KEY", value: "prv_test_otra_llave_larga_que_wompi_rechaza" });
  t("una llave que WOMPI RECHAZA (401) -> 400 key_rejected, y NO se guarda", [rej.code, rej.json.error, /RECHAZ/.test(rej.json.detail), JSON.parse(readFileSync(join(STORAGE, "runtime-config.json"), "utf8")).WOMPI_PRIVATE_KEY], [400, "key_rejected", true, undefined]);
  t("el mensaje nunca devuelve la llave", JSON.stringify(rej.json).includes("otra_llave_larga"), false);
  t("staff no puede cambiarla (403)", (await cfg(staff, { key: "WOMPI_PRIVATE_KEY", value: "prv_test_demo1234" })).code, 403);
  const okPrv = await cfg(owner, { key: "WOMPI_PRIVATE_KEY", value: " prv_test_demo1234 " });
  t("la que Wompi acepta -> 200 y se guarda", [okPrv.code, okPrv.json.ok, okPrv.json.tail], [200, true, "1234"]);
  const hp = await fetch(`${API}/admin-health.php`, { headers: { Cookie: owner } }).then(r => r.json());
  t("el panel dice que Wompi acepta la llave privada y de dónde sale", [(hp.checks.find(c => c.id === "wompi_private") || {}).ok, /privada: guardado desde el panel/.test((hp.checks.find(c => c.id === "wompi_source") || {}).detail)], [true, true]);

  console.log("\nLa llave privada del servidor está MAL (401): lo que pasó en producción");
  const STORAGE2 = mkdtempSync(join(tmpdir(), "stike-cfg2-"));
  const badKey = await startPhp({ STORAGE_DIR: STORAGE2, WOMPI_INTEGRITY_SECRET: GOOD, WOMPI_PRIVATE_KEY: "prv_test_mala_llave_larga" });
  const hb = await fetch(`${badKey.API}/admin-health.php`, { headers: { Cookie: owner } }).then(r => r.json());
  const pb = (hb.checks || []).find(c => c.id === "wompi_private") || {};
  t("el panel lo avisa: «Wompi RECHAZÓ la llave privada» (y dice que los cobros no se afectan)", [pb.ok, /RECHAZ/.test(pb.detail), /no se afectan/.test(pb.detail)], [false, true, true]);
  t("el cobro sigue firmando (ya no depende de esa llave)", (await sign(badKey.API, "stike-1700000000092-kkkkkkkk")).code, 200);
  await sign(badKey.API, "stike-1700000000093-llllllll");
  for (const r of ["stike-1700000000092-kkkkkkkk", "stike-1700000000093-llllllll"]) {
    const f = join(STORAGE2, "pending", r + ".json"); const d = JSON.parse(readFileSync(f, "utf8")); d.createdAt = new Date(Date.now() - 20 * 60000).toISOString(); (await import("node:fs")).writeFileSync(f, JSON.stringify(d));
  }
  txns["txn-real-3"] = { id: "txn-real-3", reference: "stike-1700000000092-kkkkkkkk", status: "APPROVED", amount_in_cents: 31000000, currency: "COP" };
  const r401 = await fetch(`${badKey.API}/wompi-reconcile.php`, { method: "POST", headers: { Cookie: owner, "Content-Type": "application/json" }, body: "{}" }).then(r => r.json());
  t("«Buscar pagos sin registrar» con la llave mala: un solo aviso claro (wompi_key_rejected) y no insiste pedido por pedido", [r401.errors.length, r401.errors[0].error, r401.errors[0].detail, r401.checked], [1, "wompi_key_rejected", "401", 1]);
  listPublic = true;   // Wompi atiende la lista por referencia sin pedir llave: la llave mala deja de importar
  const rPub = await fetch(`${badKey.API}/wompi-reconcile.php`, { method: "POST", headers: { Cookie: owner, "Content-Type": "application/json" }, body: "{}" }).then(r => r.json());
  t("si la lista es pública, se recupera la venta AUNQUE la llave privada esté mal (se consulta primero sin llave)", [rPub.recovered.length, rPub.recovered[0] && rPub.recovered[0].wompiId, rPub.errors.length], [1, "txn-real-3", 0]);
  listPublic = false;
  badKey.proc.kill(); rmSync(STORAGE2, { recursive: true, force: true });

  console.log("\nLo guardado desde el panel va CIFRADO en el disco (si alguien ve la carpeta de datos, no ve las llaves)");
  const rawCfg = readFileSync(file, "utf8");
  const SECRETS_IN_FILE = ["AbCdEfGh12345678", "ZzZzZzZz98765432", "prv_test_demo1234", "test_integrity_", "test_events_"];
  t("el archivo guardado NO contiene ningún secreto en texto (ni integridad, ni eventos, ni llave privada)", SECRETS_IN_FILE.filter(s => rawCfg.includes(s)), []);
  const sealed = JSON.parse(rawCfg);
  t("cada secreto va cifrado (AES-256-GCM) y sigue diciendo quién y cuándo lo guardó", ["WOMPI_INTEGRITY_SECRET", "WOMPI_EVENTS_SECRET", "WOMPI_PRIVATE_KEY"].map(k => [sealed[k].enc, typeof sealed[k].ct, typeof sealed[k].tag, "value" in sealed[k], sealed[k].by]), Array(3).fill(["v1", "string", "string", false, "jparra375@gmail.com"]));
  t("la respuesta al guardar avisa que quedó cifrado (y sigue sin traer el secreto)", [okPrv.json.encrypted, JSON.stringify(okPrv.json).includes("prv_test_demo1234")], [true, false]);
  await cfg(owner, { key: "WOMPI_PRIVATE_KEY", value: "prv_test_demo1234" });   // el mismo valor otra vez
  t("el mismo secreto guardado dos veces no se ve igual en el disco (cada guardado usa su propio vector)", JSON.parse(readFileSync(file, "utf8")).WOMPI_PRIVATE_KEY.ct !== sealed.WOMPI_PRIVATE_KEY.ct, true);
  const hs = await fetch(`${API}/admin-health.php`, { headers: { Cookie: owner } }).then(r => r.text());
  t("el estado del panel nunca muestra un secreto completo (solo las últimas 4 letras y el largo), ni la clave interna", ["test_integrity_AbCdEfGh12345678", "test_events_AbCdEfGh12345678", "prv_test_demo1234", "ghp_falso", "k".repeat(32)].filter(s => hs.includes(s)), []);

  const refEnc = "stike-1700000000094-nnnnnnnn";
  const gEnc = await sign(API, refEnc);
  t("y el cobro sigue firmando con lo cifrado (se descifra al usarlo)", gEnc.json.signature, createHash("sha256").update(`${refEnc}${gEnc.json.amount_in_cents}COP${GOOD}`).digest("hex"));

  // Lo que se guardó con la versión anterior (texto plano) tiene que seguir funcionando.
  const STORAGE3 = mkdtempSync(join(tmpdir(), "stike-cfg3-"));
  writeFileSync(join(STORAGE3, "runtime-config.json"), JSON.stringify({ WOMPI_INTEGRITY_SECRET: { value: GOOD2, by: "jparra375@gmail.com", at: "2026-01-01T00:00:00Z" } }));
  const legacy = await startPhp({ STORAGE_DIR: STORAGE3 });
  const refLg = "stike-1700000000095-oooooooo";
  const gLg = await sign(legacy.API, refLg);
  t("un secreto guardado ANTES (texto plano, formato anterior) sigue funcionando", [gLg.code, gLg.json.signature], [200, createHash("sha256").update(`${refLg}${gLg.json && gLg.json.amount_in_cents}COP${GOOD2}`).digest("hex")]);
  // Al abrir el panel, lo que quedó en texto plano se cifra solo (nadie tiene que volver a pegarlo) y sigue funcionando.
  writeFileSync(join(STORAGE3, "last-event.json"), JSON.stringify({ at: new Date().toISOString(), result: "firma_invalida", reference: null, status: null }));   // así lo anotaba la versión anterior
  const ownerL = await fetch(`${legacy.API}/admin-login.php`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credential: "owner" }) }).then(r => (r.headers.get("set-cookie") || "").split(";")[0]);
  const hl = await fetch(`${legacy.API}/admin-health.php`, { headers: { Cookie: ownerL } }).then(r => r.json());
  const rawL = readFileSync(join(STORAGE3, "runtime-config.json"), "utf8"), entL = JSON.parse(rawL).WOMPI_INTEGRITY_SECRET;
  t("al abrir el panel, lo guardado en texto plano se CIFRA solo: ya no queda el secreto en el archivo (y conserva quién lo guardó)", [rawL.includes("ZzZzZzZz98765432"), entL.enc, entL.by, "value" in entL], [false, "v1", "jparra375@gmail.com", false]);
  t("el panel lo dice: «Cifrados en el servidor»", [(hl.checks.find(c => c.id === "wompi_panel_encrypted") || {}).ok, /Cifrados en el servidor/.test((hl.checks.find(c => c.id === "wompi_panel_encrypted") || {}).detail)], [true, true]);
  const refL2 = "stike-1700000000097-qqqqqqqq", gL2 = await sign(legacy.API, refL2);
  t("y el cobro sigue firmando con el mismo secreto después de cifrarlo", gL2.json.signature, createHash("sha256").update(`${refL2}${gL2.json && gL2.json.amount_in_cents}COP${GOOD2}`).digest("hex"));
  const evL = hl.checks.find(c => c.id === "wompi_last_event") || {};
  t("un last-event.json del formato anterior con «firma_invalida» no se toma por un evento real", [evL.ok, /Todav[ií]a no ha llegado ninguno v[aá]lido/.test(evL.detail), /aviso\(s\) con firma no v[aá]lida/.test(evL.detail)], [false, true, true]);
  legacy.proc.kill(); rmSync(STORAGE3, { recursive: true, force: true });

  // Si cambia la clave interna del servidor (ADMIN_API_KEY), lo cifrado ya no se puede leer: el cobro NO se rompe (usa la
  // configuración del servidor) y el panel avisa qué hay que pegar otra vez.
  const STORAGE4 = mkdtempSync(join(tmpdir(), "stike-cfg4-"));
  copyFileSync(file, join(STORAGE4, "runtime-config.json"));
  const SERVER_SECRET = "test_integrity_ServidorEnv000001";
  const rotated = await startPhp({ STORAGE_DIR: STORAGE4, ADMIN_API_KEY: "z".repeat(32), WOMPI_INTEGRITY_SECRET: SERVER_SECRET });
  const ownerR = await fetch(`${rotated.API}/admin-login.php`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credential: "owner" }) }).then(r => (r.headers.get("set-cookie") || "").split(";")[0]);
  const hr = await fetch(`${rotated.API}/admin-health.php`, { headers: { Cookie: ownerR } }).then(r => r.json());
  const ur = (hr.checks || []).find(c => c.id === "wompi_panel_unreadable") || {};
  t("con otra clave interna: el panel avisa que lo guardado ya no se puede leer y cuáles hay que pegar otra vez", [ur.ok, /WOMPI_INTEGRITY_SECRET/.test(ur.detail), /WOMPI_EVENTS_SECRET/.test(ur.detail), /WOMPI_PRIVATE_KEY/.test(ur.detail)], [false, true, true, true]);
  t("y «de dónde salen las llaves» ya no dice «guardado desde el panel» para el de integridad", /integridad: guardado desde el panel/.test(((hr.checks || []).find(c => c.id === "wompi_source") || {}).detail), false);
  const refRot = "stike-1700000000096-pppppppp";
  const gRot = await sign(rotated.API, refRot);
  t("el cobro NO se rompe: firma con el secreto de la configuración del servidor", [gRot.code, gRot.json.signature], [200, createHash("sha256").update(`${refRot}${gRot.json && gRot.json.amount_in_cents}COP${SERVER_SECRET}`).digest("hex")]);
  const reSave = await fetch(`${rotated.API}/admin-config.php`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: ownerR }, body: JSON.stringify({ key: "WOMPI_INTEGRITY_SECRET", value: GOOD }) }).then(r => r.json());
  const hr2 = await fetch(`${rotated.API}/admin-health.php`, { headers: { Cookie: ownerR } }).then(r => r.json());
  const ur2 = (hr2.checks || []).find(c => c.id === "wompi_panel_unreadable") || {};
  t("al pegar de nuevo uno, ese se cifra con la clave nueva y deja de avisar; los otros dos siguen pendientes", [reSave.ok, reSave.encrypted, /WOMPI_INTEGRITY_SECRET/.test(ur2.detail), /WOMPI_EVENTS_SECRET/.test(ur2.detail)], [true, true, false, true]);
  rotated.proc.kill(); rmSync(STORAGE4, { recursive: true, force: true });

  console.log("\nCorreo de aviso de cada venta: sin Resend sale por el hosting (no confiable) y el panel lo dice");
  const STORAGE6 = mkdtempSync(join(tmpdir(), "stike-cfg6-")), CAP6 = mkdtempSync(join(tmpdir(), "stike-cap6-"));
  const mailSrv = await startPhp({ STORAGE_DIR: STORAGE6, RESEND_API_KEY: "", STIKE_MAIL_CAPTURE: CAP6 });
  const M = mailSrv.API;
  const loginAt = async (api, who) => (await fetch(`${api}/admin-login.php`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credential: who }) })).headers.get("set-cookie").split(";")[0];
  const ownerM = await loginAt(M, "owner"), adminM = await loginAt(M, "admin"), staffM = await loginAt(M, "staff");
  const cfgM = (cookie, body) => fetch(`${M}/admin-config.php`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) }).then(async r => ({ code: r.status, json: await r.json().catch(() => null) }));
  const healthM = async cookie => fetch(`${M}/admin-health.php`, { headers: { Cookie: cookie } }).then(r => r.json());
  const emailCheck = h => (h.checks || []).find(c => c.id === "email") || {};
  const cfgFileM = join(STORAGE6, "runtime-config.json");

  const hm0 = await healthM(ownerM), em0 = emailCheck(hm0);
  t("sin llave de Resend: ✕, dice «SIN Resend», a quién le llega (enmascarado) y que todavía no se envió ninguno", [em0.ok, /SIN Resend/.test(em0.detail), /Le llega a: j\*\*\*@gmail\.com/.test(em0.detail), /Todav[ií]a no se ha enviado/.test(em0.detail)], [false, true, true, true]);
  t("el dueño recibe el bloque «mail» para el formulario (destinatarios completos, Resend sin configurar); el administrador no", [hm0.mail.recipients, hm0.mail.resend.configured, (await healthM(adminM)).mail === undefined], [["jparra375@gmail.com"], false, true]);
  const t0 = await cfgM(ownerM, { action: "test_email" });
  t("el correo de prueba sale por el correo del hosting y dice que NO es confiable", [t0.json.ok, t0.json.via, t0.json.reliable, t0.json.resendConfigured], [true, "mail", false, false]);
  const cap0 = captured(CAP6);
  t("el hosting recibió un mensaje", cap0.length, 1);
  const p0 = parseEml(cap0[0].eml);
  t("armado como lo quiere Gmail: texto + HTML, fecha, Message-ID, remitente del dominio, ninguna línea de más de 998 caracteres", [/multipart\/alternative/.test(p0.type), !!p0.parts["text/plain"] && !!p0.parts["text/html"], p0.date !== "", /^<[0-9a-f]+@stikebikeshop\.com>$/.test(p0.msgId), p0.from, p0.maxLine <= 998], [true, true, true, true, "Stike Bike Shop <pedidos@stikebikeshop.com>", true]);
  t("el asunto con acentos y raya se lee bien, el destinatario es el dueño y el sobre (-f) lleva el remitente del dominio", [p0.subject, p0.to, /-fpedidos@stikebikeshop\.com/.test(cap0[0].args)], ["Prueba de correo — Stike Bike Shop", "jparra375@gmail.com", true]);
  t("el texto y el HTML dicen lo mismo", [/Si lees esto/.test(p0.parts["text/plain"]), /<h2>/.test(p0.parts["text/html"])], [true, true]);
  const hm1 = emailCheck(await healthM(ownerM));
  t("el panel anota el envío por el hosting y avisa que eso no garantiza que llegue", [hm1.ok, /correo del hosting \(el servidor lo acept/.test(hm1.detail)], [false, true]);

  console.log("\nLa llave de Resend se pega en el panel: se comprueba con Resend y se guarda cifrada");
  t("staff no puede (403)", (await cfgM(staffM, { key: "RESEND_API_KEY", value: "re_llave_completa_con_dominio_123456" })).code, 403);
  t("lo que no es una llave de Resend -> 400 wrong_kind", (await cfgM(ownerM, { key: "RESEND_API_KEY", value: "prv_test_otra_cosa_muy_larga_123" })).json.error, "wrong_kind");
  const rk1 = await cfgM(ownerM, { key: "RESEND_API_KEY", value: "re_llave_rechazada_por_resend_123" });
  t("una llave que Resend RECHAZA -> 400 key_rejected, y no se guarda", [rk1.code, rk1.json.error, existsSync(cfgFileM) && "RESEND_API_KEY" in JSON.parse(readFileSync(cfgFileM, "utf8"))], [400, "key_rejected", false]);
  const rk2 = await cfgM(ownerM, { key: "RESEND_API_KEY", value: " re_restringida_solo_enviar_123456 " });
  t("una llave de solo envío (la recomendada) se acepta aunque no pueda ver dominios", [rk2.code, rk2.json.ok, rk2.json.restricted, rk2.json.tail], [200, true, true, "3456"]);
  const rk3 = await cfgM(ownerM, { key: "RESEND_API_KEY", value: "re_llave_completa_con_dominio_123456" });
  t("una llave completa se acepta y dice qué dominios tiene verificados", [rk3.code, rk3.json.ok, rk3.json.restricted, (rk3.json.domains || []).filter(d => d.status === "verified").map(d => d.name)], [200, true, false, ["stikebikeshop.com"]]);
  t("la respuesta nunca trae la llave y en el disco va cifrada", [JSON.stringify(rk3.json).includes("re_llave_completa"), readFileSync(cfgFileM, "utf8").includes("re_llave_completa"), JSON.parse(readFileSync(cfgFileM, "utf8")).RESEND_API_KEY.enc], [false, false, "v1"]);

  console.log("\nCon Resend: el correo sale por Resend, con la llave guardada, y el panel lo confirma");
  resendMode = "ok";
  const t1 = await cfgM(ownerM, { action: "test_email" });
  const last1 = mails[mails.length - 1];
  t("el correo de prueba sale por Resend y es confiable", [t1.json.ok, t1.json.via, t1.json.reliable], [true, "resend", true]);
  t("Resend recibió la llave guardada, el destinatario, el remitente de pruebas y también la versión en texto", [last1._auth, last1.to, last1.from, /Si lees esto/.test(last1.text || "")], ["Bearer re_llave_completa_con_dominio_123456", ["jparra375@gmail.com"], "Stike Bike Shop <onboarding@resend.dev>", true]);
  const hm2 = await healthM(ownerM), em2 = emailCheck(hm2);
  t("el panel lo marca ✔: «Sale por Resend» y «✔ por Resend»", [em2.ok, /Sale por Resend/.test(em2.detail), /✔ por Resend/.test(em2.detail)], [true, true, true]);
  t("y al formulario le dice que la llave existe, viene del panel y termina en …3456, sin devolverla", [hm2.mail.resend, JSON.stringify(hm2).includes("re_llave_completa")], [{ configured: true, source: "panel", tail: "3456", length: 36 }, false]);

  console.log("\nResend se niega a enviar: el panel explica exactamente por qué");
  resendMode = "sandbox";
  const nCap = captured(CAP6).length;
  const t2 = await cfgM(ownerM, { action: "test_email" });
  t("con el remitente de pruebas y un destinatario ajeno a la cuenta: Resend dice «solo a tu propio correo»; se intenta por el hosting y la respuesta lo dice", [t2.json.ok, t2.json.via, t2.json.reliable, t2.json.resendError.code, /otro\.dueno@gmail\.com/.test(t2.json.resendError.detail), /verifica stikebikeshop\.com/.test(t2.json.resendError.detail)], [true, "mail", false, "sandbox_only", true, true]);
  t("el hosting recibió el mensaje de respaldo", captured(CAP6).length, nCap + 1);
  const em3 = emailCheck(await healthM(ownerM));
  t("el panel marca ✕ y cuenta que Resend falló y se usó el hosting, con el motivo", [em3.ok, /Resend falló y se usó el del hosting/.test(em3.detail), /otro\.dueno@gmail\.com/.test(em3.detail)], [false, true, true]);
  resendMode = "badkey";
  t("llave que Resend ya no acepta (la borraron): «RECHAZÓ la llave»", (await cfgM(ownerM, { action: "test_email" })).json.resendError.code, "key_rejected");
  resendMode = "down";
  t("Resend caído (500): «tuvo un problema» y sale por el hosting", (await cfgM(ownerM, { action: "test_email" })).json.resendError.code, "resend_down");

  console.log("\nA quién le llega: uno o varios correos, y a los de antes les avisan del cambio");
  resendMode = "ok";
  t("algo que no es un correo -> 400", (await cfgM(ownerM, { key: "OWNER_NOTIFY_EMAIL", value: "no es un correo" })).json.error, "wrong_kind");
  t("staff no puede (403)", (await cfgM(staffM, { key: "OWNER_NOTIFY_EMAIL", value: "x@y.co" })).code, 403);
  const nMailsBefore = mails.length;
  const rc1 = await cfgM(ownerM, { key: "OWNER_NOTIFY_EMAIL", value: "otro.dueno@gmail.com,  socio@gmail.com ; otro.dueno@GMAIL.com" });
  t("varios correos (coma, punto y coma, repetidos o con mayúsculas) quedan limpios y sin repetir", [rc1.code, rc1.json.value, rc1.json.count], [200, "otro.dueno@gmail.com, socio@gmail.com", 2]);
  const chg = mails.slice(nMailsBefore).find(m => /Cambió el correo/.test(m.subject));
  t("a los de antes y a los nuevos les llega el aviso del cambio (quién lo hizo, antes y ahora)", [chg && chg.to.slice().sort(), chg && /jparra375@gmail\.com/.test(chg.html) && /socio@gmail\.com/.test(chg.html) && /jparra375@gmail\.com/.test(chg.html)], [["jparra375@gmail.com", "otro.dueno@gmail.com", "socio@gmail.com"], true]);
  await cfgM(ownerM, { action: "test_email" });
  t("el aviso de venta le llega a los dos", mails[mails.length - 1].to, ["otro.dueno@gmail.com", "socio@gmail.com"]);
  t("el formulario recibe los correos completos", (await healthM(ownerM)).mail.recipients, ["otro.dueno@gmail.com", "socio@gmail.com"]);
  await cfgM(ownerM, { key: "OWNER_NOTIFY_EMAIL", value: "dueno@correo.com" });
  t("un correo de ejemplo (dueno@correo.com) se marca: «parece un correo de EJEMPLO»", /parece un correo de EJEMPLO/.test(emailCheck(await healthM(ownerM)).detail), true);
  t("«Quitar lo guardado aquí» vuelve al correo del servidor (por defecto, el del dueño)", [(await cfgM(ownerM, { key: "OWNER_NOTIFY_EMAIL", clear: true })).json.cleared, (await healthM(ownerM)).mail.recipients], [true, ["jparra375@gmail.com"]]);

  console.log("\nDesde qué remitente sale");
  t("algo que no es un remitente -> 400", (await cfgM(ownerM, { key: "RESEND_FROM", value: "esto no" })).json.error, "wrong_kind");
  const rf1 = await cfgM(ownerM, { key: "RESEND_FROM", value: '  "Stike Bike Shop" <ventas@stikebikeshop.com> ' });
  t("«Nombre <correo>» se acepta y queda limpio", [rf1.code, rf1.json.value, rf1.json.usesTestSender], [200, "Stike Bike Shop <ventas@stikebikeshop.com>", false]);
  await cfgM(ownerM, { action: "test_email" });
  t("Resend envía desde ese remitente", mails[mails.length - 1].from, "Stike Bike Shop <ventas@stikebikeshop.com>");
  resendMode = "unverified";
  const t3 = await cfgM(ownerM, { action: "test_email" });
  t("si el dominio no está verificado en Resend: lo dice y explica qué hacer (registros DNS + Verify)", [t3.json.resendError.code, /Verify/.test(t3.json.resendError.detail)], ["domain_not_verified", true]);
  resendMode = "ok";
  t("el remitente de pruebas de Resend se reconoce como tal", (await cfgM(ownerM, { key: "RESEND_FROM", value: "onboarding@resend.dev" })).json.usesTestSender, true);
  await cfgM(ownerM, { key: "RESEND_FROM", clear: true });
  t("quitar la llave guardada deja al servidor sin Resend (en este servidor de pruebas no hay otra)", [(await cfgM(ownerM, { key: "RESEND_API_KEY", clear: true })).json.cleared, (await cfgM(ownerM, { action: "test_email" })).json.resendConfigured], [true, false]);
  mailSrv.proc.kill();

  console.log("\nSi ningún camino puede enviar, el aviso de venta se guarda y se reintenta solo");
  const STORAGE7 = mkdtempSync(join(tmpdir(), "stike-cfg7-")), CAP7 = mkdtempSync(join(tmpdir(), "stike-cap7-"));
  const envDown = { STORAGE_DIR: STORAGE7, STIKE_MAIL_CAPTURE: CAP7, STIKE_MAIL_EXIT: "1", RESEND_API_KEY: "re_falsa_para_cli_1234567890" };
  const outboxN = () => existsSync(join(STORAGE7, "outbox")) ? readdirSync(join(STORAGE7, "outbox")).filter(f => f.endsWith(".json")).length : 0;
  const lastMail = () => JSON.parse(readFileSync(join(STORAGE7, "last-mail.json"), "utf8"));
  resendMode = "down";
  const o1 = JSON.parse((await phpEval(`echo json_encode(stike_send_owner_mail("Nueva venta X", "<p>hola</p>", ["kind" => "venta"]));`, envDown)).out);
  t("Resend caído y el hosting también: el aviso falla, queda guardado para reintentar y se anota el motivo", [o1.error, o1.queued, outboxN(), lastMail().venta.ok, lastMail().venta.error], ["email_failed", true, 1, false, "resend_down"]);
  const o2 = JSON.parse((await phpEval(`echo json_encode(stike_send_owner_mail("Prueba", "<p>hola</p>", ["kind" => "prueba", "noQueue" => true]));`, envDown)).out);
  t("una prueba o una alerta que falla NO se guarda para reenviar (quien la pidió está mirando)", [o2.error, o2.queued, outboxN()], ["email_failed", false, 1]);
  const posts0 = resendPosts;
  await phpEval(`echo stike_mail_outbox_flush();`, envDown);
  const posts1 = resendPosts;
  await phpEval(`echo stike_mail_outbox_flush();`, envDown);
  t("si el reintento también falla, espera antes de volver a intentar (no martilla a Resend)", [posts1 - posts0, resendPosts - posts1, outboxN()], [1, 0, 1]);
  resendMode = "ok";
  const pending = join(STORAGE7, "outbox", readdirSync(join(STORAGE7, "outbox"))[0]);
  const pj = JSON.parse(readFileSync(pending, "utf8")); pj.lastTry = 0; writeFileSync(pending, JSON.stringify(pj));   // pasó el tiempo de espera
  const flushed = await phpEval(`echo stike_mail_outbox_flush();`, { ...envDown, STIKE_MAIL_EXIT: "0" });
  const late = mails[mails.length - 1];
  t("cuando Resend vuelve, el aviso guardado sale solo (con la nota «se reenvió») y la bandeja queda vacía", [flushed.out, late.subject, /se reenvió porque el primer envío falló/.test(late.html), outboxN(), lastMail().venta.ok, lastMail().venta.via], ["1", "Nueva venta X", true, 0, true, "resend"]);
  resendMode = "down";
  const a1 = await phpEval(`echo json_encode(stike_alert_owner("pago_caido", "Pago caído", "detalle"));`, envDown);
  const postsA = resendPosts;
  const a2 = await phpEval(`echo json_encode(stike_alert_owner("pago_caido", "Pago caído", "detalle"));`, envDown);
  t("la alerta de «el pago no funciona» que no pudo salir NO se da por enviada: el próximo intento vuelve a avisar (no espera 6 horas)", [a1.out, a2.out, resendPosts > postsA], ["false", "false", true]);
  resendMode = "ok";
  const a3 = await phpEval(`echo json_encode(stike_alert_owner("pago_caido", "Pago caído", "detalle"));`, { ...envDown, STIKE_MAIL_EXIT: "0" });
  const postsB = resendPosts;
  const a4 = await phpEval(`echo json_encode(stike_alert_owner("pago_caido", "Pago caído", "detalle"));`, { ...envDown, STIKE_MAIL_EXIT: "0" });
  t("cuando sí sale, no se repite (como máximo uno cada 6 horas)", [a3.out, a4.out, resendPosts - postsB], ["true", "false", 0]);
  rmSync(STORAGE6, { recursive: true, force: true }); rmSync(STORAGE7, { recursive: true, force: true }); rmSync(CAP6, { recursive: true, force: true }); rmSync(CAP7, { recursive: true, force: true });

  console.log("\nProtecciones del cobro");
  await cfg(owner, { key: "WOMPI_INTEGRITY_SECRET", value: GOOD });
  const dup = await sign(API, ref);
  t("una referencia que ya tiene pedido guardado no se pisa (409)", [dup.code, dup.json.error], [409, "reference_in_use"]);
  const pend = JSON.parse(readFileSync(join(STORAGE, "pending", ref + ".json"), "utf8"));
  t("y el pedido original queda intacto", [pend.shipping.name, pend.amountInCents], ["Prueba", 31000000]);
  // limite por IP (servidor aparte con limite de 3)
  await fetch(`${rate.API}/admin-login.php`);
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await sign(rate.API, `stike-17000000001${i}0-eeeeeeee`)).code);
  t("después de 3 firmas seguidas desde la misma IP, las siguientes dan 429 (mismo límite 40/10 min en el sitio)", codes.slice(3).every(c => c === 429), true);
  t("las primeras 3 pasan el límite (no son 429)", codes.slice(0, 3).every(c => c !== 429), true);
  t("la carpeta de datos no deja archivos sueltos (.tmp)", readdirSync(STORAGE).filter(f => f.endsWith(".tmp")).length, 0);
} finally {
  srv.proc.kill(); rate.proc.kill(); google.close(); wompi.close(); resend.close();
  rmSync(STORAGE, { recursive: true, force: true });
}
console.log(fail ? `\n${fail} falla(s)` : "\nTodo bien");
process.exit(fail ? 1 : 0);
