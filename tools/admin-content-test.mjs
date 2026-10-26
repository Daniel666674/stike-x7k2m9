/* =========================================================================
   Prueba de la pestaña "Contenido del sitio" del panel (admin.html):
   vista previa REAL del sitio dentro del panel, edición de textos en vivo,
   clic en el sitio -> elige el campo, y subir / cambiar / quitar los videos
   del inicio (video principal por link de YouTube o MP4 propio, y 2 clips).

     python3 -m http.server 8143   (en la raiz del repo)
     node tools/admin-content-test.mjs

   Las páginas salen con la política de seguridad REAL de .htaccess (se la
   pone la prueba, el servidor de pruebas no aplica .htaccess): si falta
   'self' en frame-src (la vista previa) o blob: en img/media-src (ver el
   video que aún no se sube), el navegador bloquea y la prueba falla igual
   que fallaría en el hosting. GitHub va simulado y se miran sus peticiones.
   ========================================================================= */
import { createRequire } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(process.env.PW_MODULES || "/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const ROOT = process.cwd(), B = "http://localhost:8143";

if (spawnSync("ffmpeg", ["-version"]).status !== 0) { console.log("sin ffmpeg: se omite la prueba del contenido del sitio"); process.exit(0); }
const CSP = (fs.readFileSync(ROOT + "/.htaccess", "utf8").match(/Header set Content-Security-Policy "([^"]+)"/) || [])[1];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stike-content-"));
const X264 = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-b:v", "1M"];
const mk = (name, { size = "1280x720", rate = 30, secs = 6, v = X264, audio = false } = {}) => {
  const out = path.join(tmp, name);
  const a = audio ? ["-f", "lavfi", "-i", `sine=duration=${secs}`, "-c:a", "aac"] : ["-an"];
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", `testsrc2=duration=${secs}:size=${size}:rate=${rate}`, ...(audio ? ["-f", "lavfi", "-i", `sine=duration=${secs}`] : []), ...v, ...(audio ? ["-c:a", "aac"] : ["-an"]), "-movflags", "+faststart", out], { stdio: "ignore" });
  return out;
};
const wide = mk("horizontal.mp4"), tall = mk("vertical.mp4", { size: "720x1280" }), tallAudio = mk("vertical-audio.mp4", { size: "720x1280", audio: true });
const hevc = mk("hevc.mp4", { v: ["-c:v", "libx265", "-tag:v", "hvc1", "-pix_fmt", "yuv420p", "-b:v", "1M", "-x265-params", "log-level=none"] });
const big = mk("1080p.mp4", { size: "1920x1080" });
const longVid = mk("largo-70s.mp4", { secs: 70, v: ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-b:v", "150k"] });
const yt480 = path.join(tmp, "yt.jpg");
execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=480x360:rate=1", "-frames:v", "1", yt480], { stdio: "ignore" });
const JPG = fs.readFileSync(ROOT + "/assets/img/hero/bike-bl.jpg");

const br = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
let fail = 0;
const t = (l, ok, x = "") => { if (!ok) fail++; console.log((ok ? "ok    " : "FALLA ") + l + (ok ? "" : "  -> " + x)); };
const wait = ms => new Promise(r => setTimeout(r, ms));

const MANIFEST0 = { "home.fiendTitle": "La nueva casa de FIEND, ya en Colombia" };   // lo que ya hay publicado
const OLD = n => ({ src: `assets/video/site/viejo${n}.mp4`, poster: `assets/video/site/viejo${n}.jpg`, w: 720, h: 1280, dur: 8, b: 900000, ts: "2026-10-01" });

async function open({ manifest = MANIFEST0, viewport = { width: 1500, height: 950 } } = {}) {
  const ctx = await br.newContext({ viewport });
  const page = await ctx.newPage();
  const errs = [], violations = [], calls = [];
  const remote = { text: JSON.stringify(manifest, null, 2) + "\n", ver: 1, files: new Set() };   // files: lo que el panel ya subió (GitHub lo recordaría)
  page.on("pageerror", e => errs.push(e.message));
  page.on("console", m => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text().slice(0, 170)); });
  page.on("dialog", d => d.accept());
  await page.route(/\.html(\?.*)?$/, async r => { const res = await r.fetch(); await r.fulfill({ response: res, headers: { ...res.headers(), "content-security-policy": CSP } }); });
  await page.route(/img\.youtube\.com\/vi\/([^/]+)\//, r => /NOEXISTE|zzzzzzzzzzz/.test(r.request().url()) ? r.fulfill({ status: 404, body: "" }) : r.fulfill({ contentType: "image/jpeg", body: fs.readFileSync(yt480) }));
  await page.route("**/api/admin-login", r => r.fulfill({ json: { email: "x@test.com", role: "owner" } }));
  await page.route("**/api/admin-health", r => r.fulfill({ json: { ok: true } }));
  await page.route("**/api/sales", r => r.fulfill({ json: [] }));
  await page.route("**/api/gh?**", async r => {
    const req = r.request(), p = new URL(req.url()).searchParams.get("path");
    if (req.method() === "GET") {
      if (p === "data/site-content.json") return r.fulfill({ json: { sha: "sc" + remote.ver, content: Buffer.from(remote.text).toString("base64") } });
      if (/^assets\/video\/site\/viejo\d\.(mp4|jpg)$/.test(p) || remote.files.has(p)) return r.fulfill({ json: { sha: "sha-" + p, content: "" } });
      const f = ROOT + "/" + p;
      return fs.existsSync(f) ? r.fulfill({ json: { sha: "sha-" + p, content: fs.readFileSync(f).toString("base64") } }) : r.fulfill({ status: 404, json: {} });
    }
    const body = req.postDataJSON();
    calls.push({ method: req.method(), path: p, body });
    if (req.method() === "PUT" && /^assets\/video\//.test(p)) remote.files.add(p);
    if (req.method() === "DELETE") remote.files.delete(p);
    if (req.method() === "PUT" && p === "data/site-content.json") { remote.text = Buffer.from(body.content, "base64").toString(); remote.ver++; }
    return r.fulfill({ json: { content: { sha: "new" }, commit: { sha: "c" } } });
  });
  await page.goto(B + "/admin.html", { waitUntil: "networkidle" });
  await wait(900);
  await page.locator('.navbtn[data-panel="contenido"]').click();
  await page.waitForSelector("[data-ct-input]", { timeout: 15000 });
  await page.waitForFunction(() => { const f = document.getElementById("ct-pv"); return f && f.contentDocument && f.contentDocument.documentElement.classList.contains("admin-preview") && ctFrameReady; }, null, { timeout: 15000 });
  await wait(500);
  const fr = page.frameLocator("#ct-pv");
  const published = () => JSON.parse(remote.text);
  return { page, ctx, errs, violations, calls, fr, remote, published };
}
const input = (page, key) => page.locator(`[data-ct-input="${key}"]`);
const bar = page => page.locator("#ct-status").textContent();
const stubPoster = page => page.evaluate(b64 => { window.__caps = 0; window.captureVideoFrame = async () => { window.__caps++; const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: "image/jpeg" }); }; }, JPG.toString("base64"));

console.log("\nSe abre el editor con la vista previa real");
{
  const { page, ctx, errs, violations, fr } = await open();
  const nFields = await page.locator("[data-ct-input]").count();
  t("el editor descubre los textos leyendo index.html (inicio + categorías de la tienda)", nFields >= 40, String(nFields));
  t("cada campo trae su etiqueta en español", await page.locator('label[for="ct-in-home.place"]').textContent() === "Lugar (letras grandes)");
  t("están los 6 grupos del inicio (incluido el banner de FIEND)", (await page.locator("[data-ct-group][data-ct-page=home] h3").allTextContents()).length === 6);
  t("la vista previa es el sitio de verdad (index.html en modo vista previa)", (await fr.locator("h1.rd-title").textContent()).replace(/\s+/g, " ").trim() === "La casa de todo el que rueda");
  t("sin avisos flotantes ni banner de cookies dentro de la vista previa", await fr.locator("#newsletter-overlay, .cookie-banner, [class*=cookie], .wa-float, .cart-float").count() === 0);
  t("la frase de FIEND que ya estaba guardada se ve en el campo y en la vista previa", (await input(page, "home.fiendTitle").inputValue()).startsWith("La nueva casa de FIEND, ya") && (await fr.locator(".rd-fiend-title").textContent()).startsWith("La nueva casa de FIEND, ya"));
  t("el banner de FIEND trae enlace y botón de WhatsApp en la vista previa", await fr.locator(".rd-fiend-link").isVisible() && await fr.locator(".rd-fiend-wa").isVisible());
  t("arranca sin cambios pendientes y con Publicar apagado", /Todo publicado/.test(await bar(page)) && await page.locator("#btn-save-content").isDisabled());
  t("la política de seguridad real deja cargar la vista previa dentro del panel", violations.length === 0, violations.join(" || "));
  t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
  await ctx.close();
}

console.log("\nTextos: se ven al instante, sin publicar");
{
  const { page, ctx, errs, fr } = await open();
  await input(page, "home.place").fill("Fuerte");
  t("al escribir, la vista previa cambia al instante", (await fr.locator(".rd-place").textContent()) === "Fuerte");
  t("la fila dice «Sin publicar» y el panel cuenta 1 cambio", await page.locator('[data-ct-field="home.place"] .ct-pill-unpub').isVisible() && /1 cambio sin publicar/i.test(await bar(page)));
  t("Publicar se enciende", await page.locator("#btn-save-content").isEnabled());
  t("muestra cuál era el original", /Original: «Bogotá — Venecia»/.test(await page.locator('[data-ct-field="home.place"] .ct-orig').textContent()));
  t("cuenta los caracteres y respeta el máximo", await input(page, "home.place").getAttribute("maxlength") === "28" && (await page.locator('[data-ct-field="home.place"] .ct-count').textContent()) === "6/28");
  await page.locator('[data-ct-restore="home.place"]').click();
  t("«↺ Original» devuelve el texto de siempre", (await fr.locator(".rd-place").textContent()) === "Bogotá — Venecia" && (await input(page, "home.place").inputValue()) === "Bogotá — Venecia" && /Todo publicado/.test(await bar(page)));
  await input(page, "home.ctaPrimary").fill("");
  t("un texto obligatorio que se deja vacío vuelve al original y lo avisa", (await fr.locator(".rd-ctas .btn.white").textContent()) === "Arma tu BMX" && await page.locator('[data-ct-field="home.ctaPrimary"] .ct-warn').isVisible());
  await input(page, "home.fiendTitle").fill("");
  t("la frase de FIEND (opcional) se puede dejar vacía: esa parte desaparece, el enlace y WhatsApp quedan", !(await fr.locator(".rd-fiend-title").isVisible()) && await fr.locator(".rd-fiend-wa").isVisible() && /1 cambio/.test(await bar(page)), await bar(page));
  await input(page, "home.boxLine2").fill("Texto largo ".repeat(20));
  t("un texto más largo que el máximo se corta", (await input(page, "home.boxLine2").inputValue()).length <= 110);
  t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
  await ctx.close();
}

console.log("\nVisual: resaltar y elegir desde la página");
{
  const { page, ctx, fr } = await open();
  await input(page, "home.place").focus();
  await wait(700);
  t("al entrar a un campo se resalta su lugar en la vista previa", await fr.locator(".rd-place.stike-hl").count() === 1);
  await fr.locator(".rd-tag").click();
  await wait(500);
  t("al hacer clic en un texto de la página, se elige ese campo en el editor", await page.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-ct-input")) === "home.heroTag");
  t("y la página no navega (el clic en un botón del sitio no se va a otra parte)", await (async () => { await fr.locator(".rd-ctas .btn").first().click(); await wait(400); return (await page.locator("#ct-pv").evaluate(f => f.contentWindow.location.pathname)).endsWith("index.html"); })());
  await fr.locator('[data-video="feature"] figcaption').click({ force: true }).catch(() => {});
  await wait(400);
  t("clic sobre el video elige su tarjeta de video (se destella)", await page.locator('[data-ct-media="home.video"].ct-flash').count() === 1);
  await page.locator('[data-ct-mode="phone"]').click();
  await wait(300);
  t("«Celular» muestra el sitio con ancho de celular (390 px)", await page.locator("#ct-pv").evaluate(f => f.style.width) === "390px");
  await page.locator('[data-ct-mode="desktop"]').click();
  t("«Computador» vuelve a 1280 px", await page.locator("#ct-pv").evaluate(f => f.style.width) === "1280px");
  await ctx.close();
}

console.log("\nPublicar textos");
{
  const { page, ctx, errs, calls, published, fr } = await open();
  await input(page, "home.topLine1").fill("La casa de los que");
  await input(page, "home.strip1").fill("Street");
  await page.locator("#btn-save-content").click();
  await page.waitForFunction(() => /Contenido publicado/.test(document.getElementById("status-box").textContent), null, { timeout: 15000 });
  const put = calls.find(c => c.method === "PUT" && c.path === "data/site-content.json");
  const m = published();
  t("escribe data/site-content.json con los dos textos nuevos", m["home.topLine1"] === "La casa de los que" && m["home.strip1"] === "Street", JSON.stringify(m));
  t("sin tocar lo que ya estaba (la frase de FIEND guardada sigue)", m["home.fiendTitle"] === MANIFEST0["home.fiendTitle"]);
  t("no se escriben claves de textos que nadie cambió", Object.keys(m).length === Object.keys(MANIFEST0).length + 2, Object.keys(m).join(","));
  t("deja constancia en la auditoría", calls.some(c => c.path === "data/audit-log.json" && /2 texto\(s\)/.test(Buffer.from(c.body.content, "base64").toString())));
  t("al terminar no queda nada pendiente", /Todo publicado/.test(await bar(page)) && await page.locator("#btn-save-content").isDisabled());
  t("el mensaje de estado es de éxito", !/No se pudo/.test(await page.locator("#status-box").innerText()));
  t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
  await ctx.close();
}
{
  const { page, ctx, calls, published } = await open();
  await input(page, "home.fiendTitle").fill("");            // quitar la frase guardada
  await page.locator("#btn-save-content").click();
  await page.waitForFunction(() => /Contenido publicado/.test(document.getElementById("status-box").textContent), null, { timeout: 15000 });
  t("vaciar la frase se publica como «vacío a propósito» y el sitio la esconde", published()["home.fiendTitle"] === "", JSON.stringify(published()));
  await ctx.close();
}

console.log("\nBanners de la tienda");
{
  const { page, ctx, errs, calls, published } = await open();
  await input(page, "cat.repuestos.title").fill("Todo para tu BMX");
  await wait(1500);
  t("al editar un banner, la vista previa salta a esa página de la tienda", (await page.locator("#ct-pv-page").inputValue()) === "cat:repuestos" && (await page.locator("#ct-pv").evaluate(f => f.contentWindow.location.search)).includes("cat=repuestos"));
  await input(page, "cat.repuestos.title").fill("Todo para tu BMX!");
  t("y muestra el título nuevo en la página de verdad", (await page.frameLocator("#ct-pv").locator("#page-title").textContent()) === "Todo para tu BMX!");
  await input(page, "cat.repuestos.subtitle").fill("Lo mejor de lo mejor");
  t("y el subtítulo aparece", (await page.frameLocator("#ct-pv").locator("#page-subtitle").textContent()) === "Lo mejor de lo mejor" && await page.frameLocator("#ct-pv").locator("#page-subtitle").isVisible());
  await page.locator("#btn-save-content").click();
  await page.waitForFunction(() => /Contenido publicado/.test(document.getElementById("status-box").textContent), null, { timeout: 15000 });
  t("se publican con las claves que ya lee la tienda", published()["cat.repuestos.title"] === "Todo para tu BMX!" && published()["cat.repuestos.subtitle"] === "Lo mejor de lo mejor", JSON.stringify(published()));
  t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
  await ctx.close();
}

console.log("\nVideo principal: link de YouTube");
{
  const { page, ctx, errs, violations, calls, published, fr } = await open();
  const card = '[data-ct-media="home.video"]';
  t("muestra el video de siempre, de YouTube, con su miniatura", /LUhY9ixzp1w/.test(await page.locator(card + " .ct-media-info").textContent()) && /Original/i.test(await page.locator(card + " .pill").first().textContent()));
  await page.locator(`${card} [data-ct-yt-toggle]`).click();
  await page.fill("#ct-yt-input", "esto no es un link");
  await page.locator(`${card} [data-ct-yt-apply]`).click();
  t("un link que no es de YouTube se rechaza con una explicación", /no parece un link de YouTube/.test(await page.locator(card + " .ct-media-msg").textContent()));
  await page.fill("#ct-yt-input", "https://www.youtube.com/watch?v=NOEXISTE001");
  await page.locator(`${card} [data-ct-yt-apply]`).click();
  await page.waitForFunction(() => /No encontré ese video/.test(document.querySelector('[data-ct-media="home.video"] .ct-media-msg').textContent));
  t("un video que YouTube no tiene se rechaza (público o no listado)", true);
  await page.fill("#ct-yt-input", "https://youtu.be/AbCdEfGhIjK?si=algo");
  await page.locator(`${card} [data-ct-yt-apply]`).click();
  await page.waitForFunction(() => /Video de YouTube listo/.test(document.querySelector('[data-ct-media="home.video"] .ct-media-msg').textContent));
  t("un link corto (youtu.be) se acepta y se lee el ID", /AbCdEfGhIjK/.test(await page.locator(card + " .ct-media-info").textContent()));
  t("la vista previa ya usa la portada del video nuevo", (await fr.locator('[data-video="feature"] > img').getAttribute("src")).includes("AbCdEfGhIjK"));
  t("la tarjeta dice que está sin publicar", /sin publicar/i.test(await page.locator(card + " .pill").first().textContent()));
  await page.locator("#btn-save-content").click();
  await page.waitForFunction(() => /Contenido publicado/.test(document.getElementById("status-box").textContent), null, { timeout: 15000 });
  t("se publica {type:youtube, id}", JSON.stringify(published()["home.video"]) === JSON.stringify({ type: "youtube", id: "AbCdEfGhIjK" }), JSON.stringify(published()["home.video"]));
  t("y no se sube ningún archivo", !calls.some(c => /assets\/video/.test(c.path)));
  await page.locator(`${card} [data-ct-revert]`).click();
  t("«Volver al video de siempre» lo regresa al original en la vista previa", (await fr.locator('[data-video="feature"] > img').getAttribute("src")).includes("LUhY9ixzp1w"));
  await page.locator("#btn-save-content").click();
  await page.waitForFunction(() => document.querySelectorAll("#status-box .st-head").length > 0 && /Contenido publicado/.test(document.getElementById("status-box").textContent) && /Todo publicado/.test(document.getElementById("ct-status").textContent), null, { timeout: 15000 });
  t("y se borra la clave al publicar", !("home.video" in published()), JSON.stringify(published()));
  t("la política de seguridad real no bloquea nada", violations.length === 0, violations.join(" || "));
  t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
  await ctx.close();
}

console.log("\nVideo principal: subir un MP4 propio");
{
  const { page, ctx, errs, violations, calls, published, fr } = await open();
  await stubPoster(page);
  const card = '[data-ct-media="home.video"]', up = card + " [data-ct-upload]";
  await page.setInputFiles(up, hevc); await wait(900);
  t("HEVC (iPhone) se rechaza y explica el ajuste", /HEVC/.test(await page.locator(card + " .ct-media-msg").textContent()) && /Más compatible/.test(await page.locator(card + " .ct-media-msg").textContent()));
  await page.setInputFiles(up, big); await wait(900);
  t("1080p se rechaza (máximo 1280×720)", /demasiado grande/.test(await page.locator(card + " .ct-media-msg").textContent()));
  await page.setInputFiles(up, longVid); await wait(900);
  t("más de 60 s se rechaza (el video principal admite hasta 60)", /máximo es 60 s/.test(await page.locator(card + " .ct-media-msg").textContent()), await page.locator(card + " .ct-media-msg").textContent());
  await page.setInputFiles(up, { name: "clip.mov", mimeType: "video/quicktime", buffer: fs.readFileSync(wide) }); await wait(400);
  t(".mov se rechaza pidiendo MP4", /MP4/.test(await page.locator(card + " .ct-media-msg").textContent()));
  t("nada de eso cambió la página", !!(await fr.locator('[data-video="feature"][data-kind="youtube"]').count()) && /Todo publicado/.test(await bar(page)));
  await page.setInputFiles(up, wide); await wait(1000);
  t("un MP4 horizontal bueno se acepta: «Cumple todo»", /Cumple todo: 1280×720/.test(await page.locator(card + " .ct-media-msg").textContent()), await page.locator(card + " .ct-media-msg").textContent());
  t("la tarjeta dice «Nuevo · se sube al publicar» y trae su portada", /Nuevo/i.test(await page.locator(card + " .pill").first().textContent()) && (await page.locator(card + " .ct-thumb img").getAttribute("src")).startsWith("blob:"));
  t("hay un control para elegir el cuadro de portada", await page.locator(card + " [data-ct-frame]").count() === 1);
  t("la vista previa ya usa el video nuevo (archivo local, sin subir)", await fr.locator('[data-video="feature"]').getAttribute("data-kind") === "mp4" && (await fr.locator('[data-video="feature"]').getAttribute("data-mp4")).startsWith("blob:"));
  await fr.locator("html").evaluate(() => { window.__seen = []; new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeName === "VIDEO") window.__seen.push(n.getAttribute("src") || n.src); }))).observe(document.querySelector('[data-video="feature"]'), { childList: true }); });
  await fr.locator(".rd-play").click(); await wait(300);
  const seen = await fr.locator("html").evaluate(() => window.__seen);
  t("el play de la vista previa arma el reproductor con el archivo local (blob:) y la política no lo bloquea", seen.length >= 1 && seen[0].startsWith("blob:") && violations.length === 0, JSON.stringify(seen) + " " + violations.join("||"));
  await page.locator("#btn-save-content").click();
  await page.waitForFunction(() => /Contenido publicado/.test(document.getElementById("status-box").textContent), null, { timeout: 25000 });
  const order = calls.map(c => c.method + " " + c.path);
  const idxManifest = order.findIndex(x => x === "PUT data/site-content.json");
  const mp4 = calls.find(c => c.method === "PUT" && /^assets\/video\/site\/.+\.mp4$/.test(c.path));
  const jpg = calls.find(c => c.method === "PUT" && /^assets\/video\/site\/.+\.jpg$/.test(c.path));
  t("sube el MP4 y su portada ANTES de escribir el manifiesto", !!mp4 && !!jpg && order.indexOf("PUT " + mp4.path) < idxManifest && order.indexOf("PUT " + jpg.path) < idxManifest, order.join(" | "));
  t("el MP4 llega byte por byte", Buffer.from(mp4.body.content, "base64").equals(fs.readFileSync(wide)));
  const v = published()["home.video"];
  t("el manifiesto guarda {type:mp4, src, poster, w, h, dur, b, ts}", v && v.type === "mp4" && v.src === mp4.path && v.poster === jpg.path && v.w === 1280 && v.h === 720 && v.dur === 6 && v.b > 100000 && /^\d{4}-\d\d-\d\d$/.test(v.ts), JSON.stringify(v));
  t("la tarjeta pasa a «Publicado» y la vista previa sigue viéndose (aunque el sitio aún no despliegue el archivo)", /Publicado/i.test(await page.locator(card + " .pill").first().textContent()) && (await fr.locator('[data-video="feature"]').getAttribute("data-mp4")).startsWith("blob:"));
  t("la auditoría cuenta el video", calls.some(c => c.path === "data/audit-log.json" && /1 video\(s\)/.test(Buffer.from(c.body.content, "base64").toString())));
  /* Reemplazarlo por otro: el anterior se borra del repositorio. */
  await page.setInputFiles(up, tall); await wait(1000);
  t("un video vertical en el recuadro grande avisa que se verá con barras", /barras negras/.test(await page.locator(card + " .ct-media-msg").textContent()));
  await page.locator("#btn-save-content").click();
  await page.waitForFunction(() => /Contenido publicado/.test(document.getElementById("status-box").textContent) && /Todo publicado/.test(document.getElementById("ct-status").textContent), null, { timeout: 25000 });
  const dels = calls.filter(c => c.method === "DELETE").map(c => c.path);
  t("al reemplazarlo, el video anterior y su portada se borran del repositorio", dels.includes(mp4.path) && dels.includes(jpg.path), dels.join(","));
  t("la política de seguridad real no bloquea nada", violations.length === 0, violations.join(" || "));
  t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
  await ctx.close();
}

console.log("\nDescartar y cuidados");
{
  const { page, ctx, fr } = await open();
  await input(page, "home.strip4").fill("Otra cosa");
  await stubPoster(page);
  await page.setInputFiles('[data-ct-media="home.video"] [data-ct-upload]', wide); await wait(1000);
  t("hay cambios de texto y de video sin publicar", /2 cambios/.test(await bar(page)), await bar(page));
  await page.locator("#btn-discard-content").click();
  await wait(900);
  t("«Descartar cambios» los quita: textos y videos vuelven a lo publicado", (await input(page, "home.strip4").inputValue()) === "Enviamos a todo el país" && /Todo publicado/.test(await bar(page)) && await page.locator('[data-ct-media="home.video"] .ct-media-info').textContent().then(x => /LUhY9ixzp1w/.test(x)));
  t("y la vista previa se recarga limpia", (await page.frameLocator("#ct-pv").locator('[data-content-key="home.strip4"]').textContent()) === "Enviamos a todo el país");
  await ctx.close();
}
{
  const { page, ctx } = await open();
  await stubPoster(page);
  await page.setInputFiles('[data-ct-media="home.video"] [data-ct-upload]', wide); await wait(1000);
  t("con cambios sin publicar, el menú lateral lo marca con un punto", await page.locator('.navbtn[data-panel="contenido"]').evaluate(b => b.classList.contains("has-dirty")));
  await ctx.close();
}

await br.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail ? `\n${fail} falla(s)` : "\nTodo bien");
process.exit(fail ? 1 : 0);
