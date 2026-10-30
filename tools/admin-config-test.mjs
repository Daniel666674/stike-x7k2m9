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
import { mkdtempSync, readFileSync, existsSync, statSync, readdirSync, rmSync } from "node:fs";
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

const STORAGE = mkdtempSync(join(tmpdir(), "stike-cfg-"));
const baseEnv = {
  ...process.env, GITHUB_TOKEN: "ghp_falso", ADMIN_API_KEY: "k".repeat(32), STORAGE_DIR: STORAGE,
  STIKE_GOOGLE_TOKENINFO: `http://127.0.0.1:${google.address().port}`, STIKE_INSECURE_COOKIE: "1", NO_PROXY: "*", no_proxy: "*",
  WOMPI_PUBLIC_KEY: "pub_test_demo1234", WOMPI_PRIVATE_KEY: "prv_test_demo1234",
  WOMPI_INTEGRITY_SECRET: "prv_test_la_privada_pegada_donde_no_iba",   // <- el error real del sitio
};
async function startPhp(extra = {}) {
  const port = await freePort();
  const proc = spawn("php", ["-S", `127.0.0.1:${port}`, "-t", ROOT], { env: { ...baseEnv, ...extra }, stdio: "ignore" });
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port}/api/admin-login.php`); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
  return { proc, API: `http://127.0.0.1:${port}/api` };
}
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
  t("una llave que no se puede cambiar desde el panel (la privada) -> 400", (await cfg(owner, { key: "WOMPI_PRIVATE_KEY", value: "prv_test_nueva_larga_12345" })).json.error, "invalid_key");
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
  srv.proc.kill(); rate.proc.kill(); google.close();
  rmSync(STORAGE, { recursive: true, force: true });
}
console.log(fail ? `\n${fail} falla(s)` : "\nTodo bien");
process.exit(fail ? 1 : 0);
