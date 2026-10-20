/* =========================================================================
   Prueba del puente del panel a GitHub (api/gh.php) con videos: levanta el
   servidor embebido de PHP, un Google falso (para iniciar sesion) y un
   GitHub falso (para ver que le llega).

     node tools/gh-proxy-test.mjs

   Necesita `php` en el PATH. No toca la red ni llaves reales.
   Cubre lo que el panel NO puede garantizar solo: que un video suba, que
   no entre un archivo que no sea MP4 ni uno gigante, que el rol "tienda"
   no pueda escribir videos, y que subir un video lento no se corte.
   ========================================================================= */
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

if (spawnSync("php", ["-v"]).status !== 0) { console.log("sin php: se omite la prueba de api/gh.php"); process.exit(0); }
const ROOT = fileURLToPath(new URL("..", import.meta.url));
let fail = 0;
const t = (l, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++; console.log(`  ${ok ? "ok  " : "FALLA"} ${l}${ok ? "" : `  -> dio ${JSON.stringify(got)}, esperaba ${JSON.stringify(want)}`}`); };
const freePort = () => new Promise(res => { const s = createNetServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
const listen = handler => new Promise(res => { const s = createServer(handler); s.listen(0, "127.0.0.1", () => res(s)); });

/* Google falso: el "credential" es el nombre de la persona. */
const WHO = { owner: "jparra375@gmail.com", staff: "kevinarevalo1996@gmail.com" };
const google = await listen((req, res) => {
  const tok = new URL(req.url, "http://x").searchParams.get("id_token");
  if (!WHO[tok]) { res.statusCode = 400; return res.end("{}"); }
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ aud: "752305520255-7e2abc762p3saer5sube25jh9rt9jle7.apps.googleusercontent.com", iss: "https://accounts.google.com", email: WHO[tok], email_verified: "true", exp: String(Math.floor(Date.now() / 1000) + 3600) }));
});

/* GitHub falso: anota lo que llega; `delayMs` simula una subida lenta. */
const seen = []; let delayMs = 0;
const github = await listen((req, res) => {
  const chunks = []; req.on("data", c => chunks.push(c));
  req.on("end", () => {
    const raw = Buffer.concat(chunks).toString();
    let body = null; try { body = raw ? JSON.parse(raw) : null; } catch {}
    seen.push({ method: req.method, url: req.url, body });
    setTimeout(() => { res.statusCode = req.method === "PUT" ? 201 : 200; res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ content: { sha: "abc123" }, commit: { sha: "c1" } })); }, delayMs);
  });
});

const port = await freePort();
const proc = spawn("php", ["-S", `127.0.0.1:${port}`, "-t", ROOT], {
  env: { ...process.env, GITHUB_TOKEN: "ghp_falso", ADMIN_API_KEY: "k".repeat(32), STIKE_GITHUB_API: `http://127.0.0.1:${github.address().port}`, STIKE_GOOGLE_TOKENINFO: `http://127.0.0.1:${google.address().port}`, STIKE_INSECURE_COOKIE: "1", NO_PROXY: "*", no_proxy: "*" },
  stdio: "ignore",
});
for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port}/api/admin-login.php`); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
const API = `http://127.0.0.1:${port}/api`;

async function login(who) {
  const r = await fetch(`${API}/admin-login.php`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credential: who }) });
  return (r.headers.get("set-cookie") || "").split(";")[0];
}
async function gh(cookie, method, path, body) {
  const r = await fetch(`${API}/gh.php?path=${encodeURIComponent(path)}`, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { code: r.status, json: await r.json().catch(() => null) };
}
const fakeMp4 = bytes => { const b = Buffer.alloc(bytes); b.writeUInt32BE(24, 0); b.write("ftypisom", 4); return b; };
const put = (cookie, path, buf, extra = {}) => gh(cookie, "PUT", path, { message: "prueba", content: buf.toString("base64"), ...extra });

try {
  const owner = await login("owner"), staff = await login("staff");

  console.log("\nSin sesión");
  t("sin sesión: 401", (await put(null, "assets/video/products/a.mp4", fakeMp4(100))).code, 401);

  console.log("\nSube un video (dueño)");
  let n = seen.length;
  const mp4 = fakeMp4(2 * 1024 * 1024);
  const r1 = await put(owner, "assets/video/products/a1b2-c3.mp4", mp4);
  t("PUT del mp4 -> 201", r1.code, 201);
  const sent = seen[n];
  t("GitHub recibe el PUT en la ruta del video, rama del sitio", [sent.method, sent.url, sent.body.branch], ["PUT", "/repos/Daniel666674/stike-x7k2m9/contents/assets/video/products/a1b2-c3.mp4", "claude/sweet-albattani-ti0w0e"]);
  t("el contenido llega exacto", Buffer.from(sent.body.content, "base64").equals(mp4), true);
  t("el commit lleva el correo de la sesión (lo pone el servidor)", /^\[jparra375@gmail\.com\]/.test(sent.body.message), true);
  n = seen.length;
  t("la vista previa (.jpg) de un video también sube", (await put(owner, "assets/video/products/a1b2-c3.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xd9]))).code, 201);
  n = seen.length;
  t("se puede borrar un video", (await gh(owner, "DELETE", "assets/video/products/a1b2-c3.mp4", { message: "borrar", sha: "abc123" })).code, 200);
  t("y GitHub recibe el DELETE", seen[n].method, "DELETE");

  console.log("\nLo que NO debe entrar");
  n = seen.length;
  t("texto con extensión .mp4 -> 400, no es un MP4", (await put(owner, "assets/video/products/falso.mp4", Buffer.from("esto no es un video, es texto"))).code, 400);
  const big = await put(owner, "assets/video/products/enorme.mp4", fakeMp4(13 * 1024 * 1024));
  t("13 MB -> 413, demasiado grande", big.code, 413);
  t("nada de eso llegó a GitHub", seen.length, n);
  for (const bad of ["assets/video/products/a.webm", "assets/video/products/a.mov", "assets/video/products/sub/a.mp4", "assets/video/products/../../api/x.mp4", "assets/video/a.mp4", "assets/video/products/a.php", "assets/video/products/a.mp4.php"]) {
    t(`ruta no permitida (${bad}) -> 403`, (await put(owner, bad, fakeMp4(100))).code, 403);
  }
  t("el catálogo, las fichas y las fotos siguen permitidos", [
    (await gh(owner, "GET", "assets/js/products-data.js")).code, (await put(owner, "assets/img/products/x.jpg", Buffer.from([1]))).code,
  ], [200, 201]);

  console.log("\nRol «tienda» (staff)");
  n = seen.length;
  t("no puede subir videos", (await put(staff, "assets/video/products/a1b2-c3.mp4", fakeMp4(100))).code, 403);
  t("ni borrarlos", (await gh(staff, "DELETE", "assets/video/products/a1b2-c3.mp4", { message: "x", sha: "abc" })).code, 403);
  t("GitHub no recibió nada de la tienda", seen.length, n);

  console.log("\nSubida lenta");
  delayMs = 17000;
  const t0 = Date.now();
  const slow = await put(owner, "assets/video/products/lento.mp4", fakeMp4(1024 * 1024));
  t("un video que tarda 17 s en subir NO se corta (el límite de 15 s era para JSON)", slow.code, 201);
  console.log(`        (tardó ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
} finally {
  proc.kill(); google.close(); github.close();
}
console.log(fail ? `\n${fail} falla(s)` : "\nTodo bien");
process.exit(fail ? 1 : 0);
