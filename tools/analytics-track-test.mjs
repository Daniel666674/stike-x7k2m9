/* =========================================================================
   Contador propio de eventos (api/track.php + api/_track.php): conteos anonimos por dia.

   Se prueba con el PHP real (php -S) y una carpeta de datos temporal. Lo que se comprueba:
     - Siempre contesta 204 sin cuerpo; solo POST; descarta lo que no viene del propio sitio, robots y lo que no esta en las listas.
     - Cuenta bien (total, lugar, pagina, producto, dispositivo, hora en hora de Colombia) y suma varios dias.
     - No guarda IP, navegador ni ningun identificador, ni el texto de un mensaje.
     - Los terminos de busqueda se limpian (sin correos, telefonos ni enlaces); un atacante no puede inflar el disco.
     - Limite por IP.

     node tools/analytics-track-test.mjs     (necesita php)
   ========================================================================= */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";

const ROOT = process.cwd();
let fail = 0;
const t = (l, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++; console.log(`  ${ok ? "ok  " : "FALLA"} ${l}${ok ? "" : `  -> dio ${JSON.stringify(got)}, esperaba ${JSON.stringify(want)}`}`); };
if (spawnSync("php", ["-v"]).status !== 0) { console.log("sin php: se omite la prueba del contador propio"); process.exit(0); }
const wait = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
const WORK = mkdtempSync(join(tmpdir(), "stike-track-"));
const PHP = (spawnSync("php", ["-r", "echo PHP_BINARY;"]).stdout || "").toString().trim() || "php";

const procs = [];
async function startPhp(extra = {}) {
  const port = await freePort(), storage = mkdtempSync(join(WORK, "st-"));
  const env = { ...process.env, STORAGE_DIR: storage, SITE_URL: "https://stikebikeshop.com", ADMIN_API_KEY: "k".repeat(32), ...extra };
  const proc = spawn(PHP, ["-S", `127.0.0.1:${port}`, "-t", ROOT], { env, stdio: "ignore" });
  procs.push(proc);
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port}/api/track.php`); break; } catch { await wait(100); } }
  return { base: `http://127.0.0.1:${port}`, storage };
}
const UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";
const send = (S, body, { origin = "https://stikebikeshop.com", ua = UA, method = "POST", raw = null } = {}) =>
  fetch(`${S.base}/api/track.php`, { method, headers: { "Content-Type": "text/plain;charset=UTF-8", "User-Agent": ua, ...(origin ? { Origin: origin } : {}) }, body: method === "POST" ? (raw != null ? raw : JSON.stringify(body)) : undefined });
const dayFile = S => { const f = readdirSync(join(S.storage, "analytics")).filter(x => /^fp-\d{4}-\d{2}-\d{2}\.json$/.test(x)); return f.length ? JSON.parse(readFileSync(join(S.storage, "analytics", f[0]), "utf8")) : null; };
const files = S => existsSync(join(S.storage, "analytics")) ? readdirSync(join(S.storage, "analytics")) : [];

try {
  const S = await startPhp();

  console.log("\nRespuesta y método");
  let r = await send(S, { e: "whatsapp_click", l: "floating_button", t: "home", p: "/", d: "m" });
  t("un evento válido: 204 sin cuerpo", [r.status, await r.text()], [204, ""]);
  r = await send(S, null, { method: "GET" });
  t("GET: 405 (solo se acepta POST)", r.status, 405);
  r = await send(S, null, { raw: "esto no es json" });
  t("basura: igual 204 (no se le dice a nadie qué se descartó) y no se guarda", r.status, 204);

  console.log("\nSe cuenta lo bueno, con su lugar, página, producto, dispositivo y hora");
  await send(S, { e: "whatsapp_click", l: "product_page", t: "product", p: "/producto/grips-odi-soft-negros.html?x=1#y", s: "grips-odi-soft-negros", d: "d" });
  await send(S, { e: "whatsapp_click", l: "floating_button", t: "product", p: "/producto/grips-odi-soft-negros.html", s: "grips-odi-soft-negros", d: "m" });
  await send(S, { e: "page_view", t: "home", p: "/index.html", d: "d", r: "search" });
  await send(S, { e: "add_to_cart", t: "product", p: "/producto/x.html", s: "x", d: "m" });
  await send(S, { e: "begin_checkout", t: "cart", p: "/carrito.html", d: "d" });
  await send(S, { e: "contact_click", t: "contact", p: "/contacto.html", d: "d", m: "phone" });
  await send(S, { e: "generate_lead", t: "contact", p: "/contacto.html", d: "d", f: "newsletter" });
  const d = dayFile(S);
  t("hay un archivo por día con contadores por evento", Object.keys(d.ev).sort(), ["add_to_cart", "begin_checkout", "contact_click", "generate_lead", "page_view", "whatsapp_click"]);
  t("whatsapp_click: 3 clics (el primero y los dos de la ficha)", d.ev.whatsapp_click.n, 3);
  t("por lugar", d.ev.whatsapp_click.loc, { floating_button: 2, product_page: 1 });
  t("por página: sin la consulta ni el # (y «/index.html» cuenta como «/»)", [d.ev.whatsapp_click.path, d.ev.page_view.path], [{ "/": 1, "/producto/grips-odi-soft-negros.html": 2 }, { "/": 1 }]);
  t("por producto y por dispositivo", [d.ev.whatsapp_click.slug, d.ev.whatsapp_click.dev], [{ "grips-odi-soft-negros": 2 }, { m: 2, d: 1 }]);
  t("page_view guarda de dónde llegó la visita (tipo, no la dirección)", d.ev.page_view.ref, { search: 1 });
  t("contact_click y generate_lead guardan el método y el formulario", [d.ev.contact_click.m, d.ev.generate_lead.f], [{ phone: 1 }, { newsletter: 1 }]);
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Bogota", hour: "numeric", hour12: false }).format(new Date())) % 24;
  t("la hora va en hora de Colombia", Object.keys(d.ev.whatsapp_click.hour), [String(hour)]);
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Bogota" }).format(new Date());
  t("el nombre del archivo es el día de Colombia", files(S), [`fp-${today}.json`]);

  console.log("\nLo que NO se cuenta");
  const before = JSON.stringify(dayFile(S));
  for (const [name, body, opts] of [
    ["un evento que no existe", { e: "compra_falsa", t: "home", p: "/" }, {}],
    ["otro dominio como origen", { e: "page_view", t: "home", p: "/" }, { origin: "https://sitio-malo.example" }],
    ["un robot (Googlebot)", { e: "page_view", t: "home", p: "/" }, { ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" }],
    ["Lighthouse", { e: "page_view", t: "home", p: "/" }, { ua: "Mozilla/5.0 Chrome-Lighthouse" }],
    ["sin navegador (UA vacío)", { e: "page_view", t: "home", p: "/" }, { ua: "" }],
    ["curl", { e: "page_view", t: "home", p: "/" }, { ua: "curl/8.0" }],
    ["una búsqueda sin término", { e: "search", t: "catalog", p: "/tienda.html" }, {}],
    ["una búsqueda con un teléfono", { e: "search", q: "3001112233", t: "catalog", p: "/tienda.html" }, {}],
    ["un clic de contacto con método inventado", { e: "contact_click", m: "paloma", t: "home", p: "/" }, {}],
  ]) { const rr = await send(S, body, opts); if (rr.status !== 204) t(name + ": 204", rr.status, 204); }
  t("ninguno de esos cambió el contador", JSON.stringify(dayFile(S)), before);

  console.log("\nNo se guarda nada que identifique a alguien");
  const raw = readFileSync(join(S.storage, "analytics", files(S)[0]), "utf8");
  t("el archivo no tiene IP, navegador, origen, mensajes ni cookies", /127\.0\.0\.1|Mozilla|Chrome|Android|stikebikeshop\.com|Hola|cookie|ip"/i.test(raw), false);
  t("los valores raros se normalizan: lugar o página desconocidos caen en «other» o se ignoran", await (async () => {
    await send(S, { e: "whatsapp_click", l: "<script>alert(1)</script>", t: "home", p: "javascript:alert(1)", s: "../../etc/passwd", d: "x" });
    const x = dayFile(S).ev.whatsapp_click;
    return [x.n, x.loc.other, Object.keys(x.path).every(k => k.startsWith("/")), Object.keys(x.slug || {}).every(k => /^[a-z0-9-]+$/.test(k)), Object.keys(x.dev).every(k => ["m", "d"].includes(k))];
  })(), [4, 1, true, true, true]);

  console.log("\nBúsquedas internas");
  for (const q of ["Cadena  FIEND", "cadena fiend", "  grips   odi!! ", "pegs", "mi correo es a@b.com"]) await send(S, { e: "search", q, t: "catalog", p: "/tienda.html", d: "d" });
  const sq = dayFile(S).ev.search;
  t("el término se limpia (minúsculas, sin signos, espacios simples) y se agrupa", sq.q, { "cadena fiend": 2, "grips odi": 1, "pegs": 1, "mi correo es a b com": 1 });

  console.log("\nNadie puede inflar el disco");
  // Primero SIN limite por IP (solo en pruebas): 450 rutas distintas, pasadas las 400 se juntan en «_otros»
  const S2 = await startPhp({ STIKE_TRACK_RATE_LIMIT: "100000" });
  const burst = [];
  for (let i = 0; i < 450; i++) burst.push(send(S2, { e: "page_view", t: "other", p: "/ruta-" + i + ".html", d: "d" }));
  const rs = await Promise.all(burst);
  const limited = rs.filter(x => x.status === 204).length;
  const day2 = dayFile(S2);
  const keys = Object.keys(day2.ev.page_view.path);
  t("todos contestan 204", limited, 450);
  t("el mapa de rutas nunca pasa de 401 claves (400 + «_otros»): el resto se junta ahí y se cuenta igual", [keys.length, day2.ev.page_view.path._otros, day2.ev.page_view.n], [401, 50, 450]);
  const S4 = await startPhp();
  const rs4 = await Promise.all(Array.from({ length: 200 }, (_, i) => send(S4, { e: "page_view", t: "other", p: "/ruta-" + i + ".html", d: "d" })));
  t("con el límite normal (120 por minuto y por IP) se frena el resto, y todos igual contestan 204", [rs4.every(x => x.status === 204), dayFile(S4).ev.page_view.n], [true, 120]);

  console.log("\nSumar varios días (lo que lee el panel)");
  const S3 = await startPhp();
  const dir = join(S3.storage, "analytics");
  await send(S3, { e: "page_view", t: "home", p: "/", d: "d", r: "direct" });   // crea la carpeta
  const mk = (day, ev) => writeFileSync(join(dir, `fp-${day}.json`), JSON.stringify({ v: 1, day, ev }));
  mk("2026-11-01", { whatsapp_click: { n: 3, loc: { floating_button: 2, header: 1 }, hour: { "10": 3 } }, page_view: { n: 100, path: { "/": 60, "/tienda.html": 40 } } });
  mk("2026-11-02", { whatsapp_click: { n: 2, loc: { floating_button: 1, cart: 1 }, hour: { "10": 1, "15": 1 } }, page_view: { n: 80, path: { "/": 30, "/tienda.html": 50 } } });
  const out = spawnSync(PHP, ["-r", 'require "api/_track.php"; echo json_encode(stike_fp_summary("2026-11-01", "2026-11-03"));'], { cwd: ROOT, env: { ...process.env, STORAGE_DIR: S3.storage }, encoding: "utf8" });
  const sum = JSON.parse(out.stdout);
  t("suma los eventos de cada día y los de todo el rango", [sum.days["2026-11-01"].whatsapp_click, sum.days["2026-11-02"].whatsapp_click, sum.days["2026-11-03"], sum.ev.whatsapp_click.n, sum.ev.page_view.n], [3, 2, [], 5, 180]);
  t("suma también los desgloses (lugar, hora, ruta)", [sum.ev.whatsapp_click.loc, sum.ev.whatsapp_click.hour, sum.ev.page_view.path], [{ floating_button: 3, header: 1, cart: 1 }, { "10": 4, "15": 1 }, { "/": 90, "/tienda.html": 90 }]);
  t("dice cuál es el primer día con datos (para saber desde cuándo se cuenta)", sum.first, "2026-11-01");
} finally {
  for (const p of procs) p.kill();
  rmSync(WORK, { recursive: true, force: true });
}
console.log(fail ? `\n${fail} falla(s)` : "\nTodo bien");
process.exit(fail ? 1 : 0);
