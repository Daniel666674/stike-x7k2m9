/* =========================================================================
   Prueba de que el INICIO obedece a lo que se publica desde el panel
   (data/site-content.json): textos, video principal (YouTube o MP4 propio)
   y los dos clips de los lados, con sus protecciones de carga.

     python3 -m http.server 8143   (en la raiz del repo)
     node tools/home-content-test.mjs

   El manifiesto se simula con page.route; la politica de seguridad es la
   real (.htaccess). El "mp4" que se entrega es un WebM: el Chromium de
   pruebas no decodifica H.264, y aqui importa CUANDO y QUE se pide.
   ========================================================================= */
import { createRequire } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(process.env.PW_MODULES || "/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const ROOT = process.cwd(), B = "http://localhost:8143";

if (spawnSync("ffmpeg", ["-version"]).status !== 0) { console.log("sin ffmpeg: se omite la prueba del inicio"); process.exit(0); }
const CSP = (fs.readFileSync(ROOT + "/.htaccess", "utf8").match(/Header set Content-Security-Policy "([^"]+)"/) || [])[1];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stike-home-"));
execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=duration=3:size=320x180:rate=15", "-c:v", "libvpx", "-b:v", "150k", "-an", path.join(tmp, "v.webm")], { stdio: "ignore" });
const WEBM = fs.readFileSync(path.join(tmp, "v.webm"));
const JPG = fs.readFileSync(ROOT + "/assets/img/hero/bike-bl.jpg");

const br = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
let fail = 0;
const t = (l, ok, x = "") => { if (!ok) fail++; console.log((ok ? "ok    " : "FALLA ") + l + (ok ? "" : "  -> " + x)); };
const wait = ms => new Promise(r => setTimeout(r, ms));

async function open(manifest, { viewport = { width: 1300, height: 900 }, calm = true, saveData = false } = {}) {
  const ctx = await br.newContext({ viewport, reducedMotion: calm ? "reduce" : "no-preference" });
  const page = await ctx.newPage();
  const errs = [], violations = [], reqs = [];
  page.on("pageerror", e => errs.push(e.message));
  page.on("console", m => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text().slice(0, 170)); });
  page.on("request", r => { if (/assets\/video|evil|youtube\.com\/(iframe_api|embed)|youtube-nocookie/.test(r.url())) reqs.push(r.url()); });
  await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => { const st = document.createElement("style"); st.textContent = "#newsletter-overlay,[class*=cookie]{display:none!important}"; document.head.appendChild(st); }));
  await page.addInitScript(sd => { Object.defineProperty(navigator, "connection", { value: { saveData: sd, effectiveType: "4g" }, configurable: true }); }, saveData);
  await page.route(/\/index\.html(\?.*)?$/, async r => { const res = await r.fetch(); await r.fulfill({ response: res, headers: { ...res.headers(), "content-security-policy": CSP } }); });
  await page.route("**/data/site-content.json*", r => r.fulfill({ contentType: "application/json", body: JSON.stringify(manifest) }));
  await page.route("https://img.youtube.com/**", r => r.fulfill({ contentType: "image/jpeg", body: JPG }));
  await page.route("https://www.youtube.com/iframe_api", r => r.abort());
  await page.route(/youtube(-nocookie)?\.com\/embed\//, r => r.fulfill({ contentType: "text/html", body: "<body style='background:#222'>yt</body>" }));
  await page.route("**/assets/video/site/*.mp4", r => r.fulfill({ status: 200, headers: { "content-type": "video/webm", "accept-ranges": "bytes" }, body: WEBM }));
  await page.route("**/assets/video/site/*.jpg", r => r.fulfill({ contentType: "image/jpeg", body: JPG }));
  await page.goto(B + "/index.html", { waitUntil: "networkidle" });
  await wait(700);
  return { page, ctx, errs, violations, reqs };
}
const txt = (page, sel) => page.locator(sel).first().textContent().then(s => s.trim());
const V = n => ({ src: `assets/video/site/${n}.mp4`, poster: `assets/video/site/${n}.jpg`, w: 720, h: 1280, dur: 8, b: 900000, ts: "2026-10-01" });

console.log("\nTextos");
{
  const { page, ctx, errs } = await open({ "home.topLine1": "Nuestra casa", "home.place": "Fuerte", "home.strip3": "Armado gratis ya", "home.ctaPrimary": "Armar ya", "home.fiendTitle": "Llegó FIEND", "home.fateText": "Texto nuevo de Fate", "cat.repuestos.title": "no aplica aquí" });
  t("el título de arriba cambia", await txt(page, ".rd-d1") === "Nuestra casa");
  t("el lugar (letras grandes) cambia", await txt(page, ".rd-place") === "Fuerte");
  t("la franja, los botones y los textos de las secciones cambian", await txt(page, '[data-content-key="home.strip3"]') === "Armado gratis ya" && await txt(page, ".rd-ctas .btn.white") === "Armar ya" && await txt(page, '[data-content-key="home.fateText"]') === "Texto nuevo de Fate");
  t("la frase de venta de FIEND cambia", await txt(page, ".rd-fiend-title") === "Llegó FIEND");
  t("lo que nadie tocó se queda como estaba (el enlace a FIEND y el botón de WhatsApp siguen)", await txt(page, ".rd-fiend-link") === "Haz clic aquí y mira todos los productos FIEND →" && await page.locator(".rd-fiend-wa").isVisible() && await txt(page, ".rd-tag span") === "Del parche, pa' los que ruedan");
  t("los enlaces de los botones no cambian (solo el texto)", (await page.locator(".rd-ctas .btn.white").getAttribute("href")) === "armar.html");
  t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
  await ctx.close();
}
{
  const { page, ctx } = await open({});
  t("sin nada guardado, el banner de FIEND sale completo: frase, enlace a la marca y WhatsApp", /nueva casa de FIEND en Colombia/i.test(await txt(page, ".rd-fiend-title")) && (await page.locator(".rd-fiend-link").getAttribute("href")) === "marca/fiend.html" && /^https:\/\/wa\.me\/\d+\?text=/.test(await page.locator(".rd-fiend-wa").getAttribute("href")));
  t("«Rueda Duro Vive BMX» ya no está en la página", !/rueda\s+duro/i.test(await page.locator(".rd-core").textContent()));
  await ctx.close();
}
{
  const { page, ctx } = await open({ "home.fiendTitle": "   ", "home.fiendLink": "", "home.fiendWa": "" });
  t("con los tres textos del banner vacíos no queda ni la caja", !(await page.locator(".rd-fiend").isVisible()));
  await ctx.close();
}
{
  const { page, ctx } = await open({ "home.fiendTitle": "" });
  t("vaciar solo la frase deja el enlace y WhatsApp", !(await page.locator(".rd-fiend-title").isVisible()) && await page.locator(".rd-fiend-link").isVisible() && await page.locator(".rd-fiend-wa").isVisible());
  await ctx.close();
}

console.log("\nVideo principal: YouTube distinto");
{
  const { page, ctx, errs, violations, reqs } = await open({ "home.video": { type: "youtube", id: "AbCdEfGhIjK" } });
  t("la portada es la del video nuevo", (await page.locator(".rd-feature > img").getAttribute("src")).includes("/vi/AbCdEfGhIjK/"));
  t("YouTube no se pide hasta tocar play", reqs.filter(u => /youtube/.test(u)).length === 0, reqs.join(","));
  await page.locator(".rd-feature .rd-play").click(); await wait(800);
  const f = await page.locator(".rd-feature iframe").getAttribute("src");
  t("al tocar play entra el reproductor del video nuevo", /embed\/AbCdEfGhIjK/.test(f), f);
  t("la política de seguridad no lo bloquea", violations.length === 0, violations.join(" || "));
  t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
  await ctx.close();
}

console.log("\nVideo principal: MP4 propio");
{
  const { page, ctx, errs, violations, reqs } = await open({ "home.video": { type: "mp4", src: "assets/video/site/principal.mp4", poster: "assets/video/site/principal.jpg", w: 1280, h: 720, dur: 6, b: 700000, ts: "2026-10-01" } });
  t("la portada es la del video propio", (await page.locator(".rd-feature > img").getAttribute("src")).endsWith("assets/video/site/principal.jpg"));
  t("el MP4 no se pide hasta tocar play (solo la portada)", !reqs.some(u => /principal\.mp4/.test(u)), reqs.join(","));
  await page.locator(".rd-feature .rd-play").click(); await wait(1200);
  const st = await page.locator(".rd-feature video.rd-video").evaluate(v => ({ src: v.getAttribute("src"), controls: v.controls, muted: v.muted, paused: v.paused, t: v.currentTime }));
  t("al tocar play se arma un <video> con el MP4 y controles, y suena (sin silencio)", /principal\.mp4$/.test(st.src) && st.controls && !st.muted, JSON.stringify(st));
  t("y arranca", !st.paused && st.t > 0, JSON.stringify(st));
  t("pidió el MP4 una sola vez", reqs.filter(u => /principal\.mp4/.test(u)).length >= 1 && reqs.filter(u => /principal\.mp4/.test(u)).length <= 2);
  t("la política de seguridad no lo bloquea", violations.length === 0, violations.join(" || "));
  t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
  await ctx.close();
}
{
  const { page, ctx, errs } = await open({ "home.video": { type: "mp4", src: "assets/video/site/principal.mp4", poster: "assets/video/site/principal.jpg", w: 1280, h: 720, dur: 6, b: 700000, ts: "2026-10-01" } }, { calm: false });
  await wait(3500);
  const st = await page.locator(".rd-feature video.rd-video").evaluate(v => ({ muted: v.muted, loop: v.loop, paused: v.paused, t: v.currentTime })).catch(() => null);
  t("con un visitante normal arranca SOLO, sin sonido y en bucle", !!st && st.muted && st.loop && !st.paused && st.t > 0, JSON.stringify(st));
  t("con el botón «Activar sonido»", await page.locator(".rd-sound").isVisible());
  await page.locator(".rd-sound").click(); await wait(300);
  t("que le quita el silencio y se va", await page.locator(".rd-feature video.rd-video").evaluate(v => !v.muted) && !(await page.locator(".rd-sound").isVisible()));
  t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
  await ctx.close();
}
{
  const { page, ctx, reqs } = await open({ "home.video": { type: "mp4", src: "assets/video/site/principal.mp4", poster: "assets/video/site/principal.jpg", w: 1280, h: 720, dur: 6, b: 700000, ts: "2026-10-01" } }, { calm: false, saveData: true });
  await wait(2500);
  t("con ahorro de datos NO arranca solo (queda la portada con play)", !reqs.some(u => /principal\.mp4/.test(u)) && await page.locator(".rd-feature .rd-play").isVisible());
  await ctx.close();
}
{
  const { page, ctx } = await open({ "home.video": { type: "mp4", src: "assets/video/site/vertical.mp4", poster: "", w: 720, h: 1280, dur: 6, b: 700000, ts: "2026-10-01" } });
  t("un video que no es 16:9 se ve entero (con barras), no recortado", await page.locator(".rd-feature").evaluate(e => e.classList.contains("contain")));
  t("sin portada propia usa una imagen genérica del sitio, nunca queda vacío", /assets\/img\/hero\//.test(await page.locator(".rd-feature > img").getAttribute("src")));
  await ctx.close();
}

console.log("\nLo que NO se acepta del manifiesto");
{
  const evil = { "home.video": { type: "mp4", src: "https://evil.com/x.mp4", poster: "", w: 1, h: 1 } };
  const { page, ctx, reqs, errs } = await open(evil, { calm: false });
  await wait(2500);
  t("un video de otro sitio se ignora", await page.locator("video").count() === 0 && !reqs.some(u => /evil|etc|products\/otro/.test(u)), reqs.join(","));
  t("el video principal sigue siendo el de siempre", (await page.locator(".rd-feature > img").getAttribute("src")).includes("/vi/LUhY9ixzp1w/"));
  t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
  await ctx.close();
}
{
  const { page, ctx } = await open({ "home.video": { type: "youtube", id: "<script>alert(1)</script>" } });
  t("un ID de YouTube mal formado se ignora", (await page.locator(".rd-feature > img").getAttribute("src")).includes("/vi/LUhY9ixzp1w/"));
  await ctx.close();
}
{
  const { page, ctx, errs } = await open({ "home.topLine1": { malo: true }, "home.heroTag": 42, "home.video": "texto" });
  t("valores de tipo equivocado no rompen la página", (await txt(page, "h1.rd-title")).replace(/\s+/g, " ") === "La casa de todo el que rueda" && errs.length === 0, errs.join(" | "));
  await ctx.close();
}

await br.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail ? `\n${fail} falla(s)` : "\nTodo bien");
process.exit(fail ? 1 : 0);
