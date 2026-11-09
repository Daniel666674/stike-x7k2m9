/* =========================================================================
   Prueba de que NINGUN secreto vive en el repositorio ni llega al hosting.

     node tools/secrets-scan-test.mjs

   Que revisa:
     1. Ningun archivo del repo (versionado o nuevo sin ignorar) trae algo con
        forma de llave o secreto real: llaves privadas, secretos de integridad y
        de eventos de Wompi, tokens de GitHub, llaves de Resend/AWS/Google/Stripe/
        Slack, claves privadas PEM y claves puestas en un archivo de configuracion.
        Los patrones viven en tools/secret-patterns.txt (los usa tambien la
        guardia de tools/stage-hostinger.sh, que frena la publicacion).
     2. El escaner de verdad detecta lo que debe, y solo deja pasar los datos
        FALSOS de las pruebas (y solo dentro de tools/).
     3. Ningun archivo sensible esta versionado y .gitignore los cubre.
     4. .htaccess bloquea lo interno (datos, codigo del servidor, ocultos,
        respaldos) y deja pasar lo publico.
     5. La copia que se sube a Hostinger no trae datos del negocio ni secretos.

   Si algo falla, SOLO se muestra el archivo y la linea: nunca el valor, para no
   copiar un secreto a los registros. Necesita git y bash. No usa la red.
   ========================================================================= */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
let fail = 0;
const t = (l, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++; console.log(`  ${ok ? "ok  " : "FALLA"} ${l}${ok ? "" : `  -> dio ${JSON.stringify(got)}, esperaba ${JSON.stringify(want)}`}`); };
const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/* ---- los patrones (una expresion por linea) ---- */
const PATTERN_LINES = readFileSync(join(ROOT, "tools/secret-patterns.txt"), "utf8").split("\n").filter(Boolean);
const LABELS = ["llave privada de Wompi", "secreto de integridad o de eventos de Wompi", "token de GitHub", "token de GitHub (granular)", "llave de Resend", "clave privada (PEM)", "llave de AWS", "llave de Google", "llave de Stripe", "token de Slack", "clave puesta en un archivo de configuracion", "secreto de cliente de Google", "permiso permanente de Google", "token de acceso de Google"];
const PATTERNS = PATTERN_LINES.map((s, i) => ({ re: new RegExp(s, "g"), label: LABELS[i] || `patron ${i + 1}` }));

/* Datos FALSOS de las pruebas (nunca una llave real): solo valen dentro de tools/. */
const FAKE_FRAGMENTS = ["AbCdEfGh12345678", "ZzZzZzZz98765432", "ServidorEnv000001"];

/* Devuelve [{line, label, fake}] para un texto. Nunca devuelve el valor. */
function scanText(file, text) {
  const out = [];
  for (const { re, label } of PATTERNS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const line = text.slice(0, m.index).split("\n").length;
      const fake = file.startsWith("tools/") && FAKE_FRAGMENTS.some(f => m[0].includes(f));
      out.push({ line, label, fake });
    }
  }
  return out;
}
const isBinary = buf => buf.subarray(0, 8000).includes(0);

console.log("\nNingún archivo del repositorio trae una llave o secreto real");
const tracked = git("ls-files", "-z").split("\0").filter(Boolean);
const fresh = git("ls-files", "-z", "-o", "--exclude-standard").split("\0").filter(Boolean);   // archivos nuevos que todavia no se commitean
const files = [...new Set([...tracked, ...fresh])].filter(f => existsSync(join(ROOT, f)));
const hits = []; let fakes = 0, scanned = 0;
for (const f of files) {
  const abs = join(ROOT, f);
  let st; try { st = statSync(abs); } catch { continue; }
  if (!st.isFile() || st.size > 4 * 1024 * 1024) continue;
  const buf = readFileSync(abs);
  if (isBinary(buf)) continue;
  scanned++;
  for (const h of scanText(f, buf.toString("utf8"))) { if (h.fake) fakes++; else hits.push(`${f}:${h.line} (${h.label})`); }
}
t(`se revisaron ${scanned} archivos de texto y ninguno tiene una llave o secreto real`, hits, []);
console.log(`  (${fakes} dato(s) falso(s) conocido(s) de las pruebas, todos dentro de tools/)`);

console.log("\nEl escáner detecta lo que debe (los valores se arman aquí, no están escritos completos)");
const big = n => "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0".slice(0, n);
const samples = [
  ["llave privada de Wompi", `x = "prv_prod_${big(24)}"`],
  ["secreto de integridad", `WOMPI = "prod_integrity_${big(24)}"`],
  ["secreto de eventos", `ev: test_events_${big(20)}`],
  ["token de GitHub", `token ghp_${big(36)}`],
  ["token de GitHub granular", `github_pat_${big(40)}`],
  ["llave de Resend", `re_${big(8)}_${big(26)}`],
  ["clave privada PEM", "-----BEGIN RSA " + "PRIVATE KEY-----"],
  ["clave puesta en un archivo de configuración", `'ADMIN_API_KEY' => '${big(30)}'`],
  ["secreto de cliente de Google (OAuth)", `GOCSPX-${big(28)}`],
  ["permiso permanente de Google (refresh token)", `1//0${big(40)}`],
  ["token de acceso de Google", `ya29.${big(40)}`],
];
for (const [name, text] of samples) t(`detecta: ${name}`, scanText("api/x.php", text).filter(h => !h.fake).length > 0, true);
t("deja pasar los textos de ayuda con puntos suspensivos (prod_integrity_...)", scanText("api/_lib.php", "'WOMPI_INTEGRITY_SECRET' => 'prod_integrity_...', prv_prod_..., re_...").length, 0);
t("deja pasar los datos falsos de las pruebas SOLO dentro de tools/", [scanText("tools/x-test.mjs", "test_integrity_AbCdEfGh12345678").every(h => h.fake), scanText("api/x.php", "test_integrity_AbCdEfGh12345678").some(h => !h.fake)], [true, true]);
t("y un secreto real pegado dentro de un archivo de pruebas SÍ se detecta", scanText("tools/x-test.mjs", `prod_integrity_${big(30)}`).some(h => !h.fake), true);

console.log("\nNingún archivo sensible está versionado, y .gitignore los cubre");
const sensitiveTracked = tracked.filter(f => /(^|\/)(\.env(\..*)?|config\.local\.php|runtime-config\.json|last-event\.json|ventas\.jsonl|id_rsa|\.htpasswd)$|\.(pem|key|p12|pfx)$|^(pending|alerts|rate|outbox|oauth-state|analytics|analytics-cache|stike-private)\//.test(f));
t("ninguno de estos está en el repositorio: .env, api/config.local.php, runtime-config.json, ventas.jsonl, llaves .pem/.key, pending/", sensitiveTracked, []);
const ignored = p => spawnSync("git", ["check-ignore", "-q", p], { cwd: ROOT }).status === 0;
for (const p of ["api/config.local.php", ".env", ".env.production", "runtime-config.json", "last-event.json", "last-mail.json", "ventas.jsonl", "pending/stike-1.json", "outbox/aviso.json", "oauth-state/estado.json", "analytics/fp-2026-11-01.json", "analytics-cache/token-abc.json", "llave.pem", "servidor.key", "stike-private/ventas.jsonl"]) t(`.gitignore cubre ${p}`, ignored(p), true);

console.log("\n.htaccess bloquea lo interno y deja pasar lo público");
const hta = readFileSync(join(ROOT, ".htaccess"), "utf8");
const forbidRules = [...hta.matchAll(/^\s*RewriteRule\s+(\S+)\s+-\s+\[[^\]]*\bF\b[^\]]*\]/gm)].map(m => new RegExp(m[1]));
const blocked = p => forbidRules.some(re => re.test(p));
for (const p of ["data/costs.json", "data/sales-log.json", "data/audit-log.json", "data/stock-applied.json", "api/_lib.php", "api/_admin.php", "api/config.local.php", "api/config.local.php.bak", ".env", ".git/config", ".htpasswd", "tools/build-pages.mjs", "vercel-wompi-api/index.html", "bmx-builder/index.html", "README.md", "PROPOSAL.md", "runtime-config.json", "last-event.json", "last-bad-event.json", "last-mail.json", "ventas.jsonl", "pending/stike-1.json", "outbox/aviso.json", "oauth-state/estado.json", "analytics/fp-2026-11-01.json", "analytics-cache/token-abc.json", "fp-2026-11-01.json", "api/_track.php", "api/_google.php", "volcado.sql", "servidor.log", "llaves.txt~", "id_rsa.pem"]) t(`se niega: ${p}`, blocked(p), true);
for (const p of ["index.html", "tienda.html", "assets/js/app.js", "assets/img/products/x-1.jpg", "data/site-content.json", "sitemap.xml", "robots.txt", "llms.txt", ".well-known/security.txt", "api/wompi-sign.php", "api/sales.php", "producto/cana-fiend-ransom.html", "categoria/canas.html"]) t(`se permite: ${p}`, blocked(p), false);

console.log("\nEl código del panel solo sale por admin.php (con sesión)");
for (const [file, f] of [["admin.js", "js"], ["admin-analytics.js", "an"]]) t(`.htaccess manda ${file} a admin.php?f=${f}`, new RegExp("RewriteRule\\s+\\^" + file.replace(/[.-]/g, m => (m === "." ? "\\\\." : m)) + "\\$\\s+admin\\.php\\?f=" + f).test(hta) || hta.includes("RewriteRule ^" + file.replace(".", "\\.") + "$ admin.php?f=" + f), true);

console.log("\nLa copia que se sube a Hostinger no trae datos del negocio ni secretos");
const OUT = join(mkdtempSync(join(tmpdir(), "stike-stage-")), "out");
try {
  const r = spawnSync("bash", [join(ROOT, "tools/stage-hostinger.sh"), OUT], { cwd: ROOT, encoding: "utf8" });
  t("el armado de la copia termina bien", r.status, 0);
  for (const p of ["data/costs.json", "data/sales-log.json", "data/audit-log.json", "data/stock-applied.json", "api/config.local.php", "tools", "README.md", "vercel-wompi-api", ".git"]) t(`no está en la copia: ${p}`, existsSync(join(OUT, p)), false);
  for (const p of ["index.html", ".htaccess", "api/wompi-sign.php", "data/site-content.json"]) t(`sí está en la copia: ${p}`, existsSync(join(OUT, p)), true);
  const g = spawnSync("grep", ["-rIlE", "-f", join(ROOT, "tools/secret-patterns.txt"), OUT], { encoding: "utf8" });
  t("ni un archivo de la copia coincide con los patrones de secretos", [g.status, g.stdout.trim()], [1, ""]);
  // la guardia del armado de verdad frena la publicación: se prueba con el mismo grep sobre un archivo con un secreto armado aquí
  const planted = mkdtempSync(join(tmpdir(), "stike-planted-"));
  try {
    execFileSync("bash", ["-c", `printf '%s' "prod_integrity_${big(30)}" > "$1/a.txt"`, "_", planted]);
    const g2 = spawnSync("grep", ["-rIlE", "-f", join(ROOT, "tools/secret-patterns.txt"), planted], { encoding: "utf8" });
    t("la guardia del armado SÍ detecta un secreto metido en lo que se publica (grep con los mismos patrones)", [g2.status, g2.stdout.trim().endsWith("a.txt")], [0, true]);
  } finally { rmSync(planted, { recursive: true, force: true }); }
} finally { rmSync(join(OUT, ".."), { recursive: true, force: true }); }

console.log(fail ? `\n${fail} falla(s)` : "\nTodo bien");
process.exit(fail ? 1 : 0);
