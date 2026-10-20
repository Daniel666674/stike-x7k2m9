/* =========================================================================
   Prueba del video de YouTube del inicio (index.html, recuadro grande):
   al tocar play tiene que aparecer el reproductor, no una caja negra.

     python3 -m http.server 8143   (en la raiz del repo)
     node tools/youtube-home-test.mjs

   El servidor de pruebas no aplica .htaccess, asi que la prueba LEE la politica
   de seguridad (Content-Security-Policy) de ese archivo y se la pone a la
   pagina: si falta un host de YouTube en .htaccess, el navegador bloquea y
   esta prueba falla igual que fallaria en el hosting. YouTube va simulado
   (este entorno no sale a internet): solo importa que el navegador DEJE cargar.
   ========================================================================= */
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(process.env.PW_MODULES || "/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const ROOT = process.cwd(), B = "http://localhost:8143";
const br = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
let fail = 0;
const t = (l, ok, x = "") => { if (!ok) fail++; console.log((ok ? "ok    " : "FALLA ") + l + (ok ? "" : "  -> " + x)); };
const wait = ms => new Promise(r => setTimeout(r, ms));

const htaccess = fs.readFileSync(ROOT + "/.htaccess", "utf8");
const CSP = (htaccess.match(/Header set Content-Security-Policy "([^"]+)"/) || [])[1];
const VIDEO_ID = (fs.readFileSync(ROOT + "/index.html", "utf8").match(/FEATURE_YOUTUBE_ID = "([^"]+)"/) || [])[1];

/* Una API de YouTube de mentira: crea el iframe como lo hace la real. */
const FAKE_API = `
window.YT = { PlayerState: { PLAYING: 1 }, Player: function (id, o) {
  var el = document.getElementById(id), f = document.createElement("iframe");
  f.id = id; f.src = "https://www.youtube.com/embed/" + o.videoId + "?enablejsapi=1&autoplay=1";
  f.allow = "autoplay; encrypted-media"; el.replaceWith(f);
  setTimeout(function () { o.events && o.events.onReady && o.events.onReady({ target: { setPlaybackQuality: function () {}, playVideo: function () {} } }); }, 50);
} };
setTimeout(function () { window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady(); }, 20);`;

async function open({ api = "ok", embed = "ok", viewport = { width: 1300, height: 900 } } = {}) {
  const ctx = await br.newContext({ viewport });
  const page = await ctx.newPage();
  const errs = [], violations = [], requests = [];
  page.on("pageerror", e => errs.push(e.message));
  page.on("console", m => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text().slice(0, 160)); });
  page.on("request", r => { if (/youtube/.test(r.url())) requests.push(r.url()); });
  await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => { const st = document.createElement("style"); st.textContent = "[class*=cookie],#newsletter-overlay{display:none!important}"; document.head.appendChild(st); }));
  /* La pagina sale con la politica de seguridad real, como en el hosting. */
  await page.route(/\/(index\.html)?$/, async r => {
    if (!/localhost:8143\/(index\.html)?$/.test(r.request().url())) return r.continue();
    const res = await r.fetch();
    await r.fulfill({ response: res, headers: { ...res.headers(), "content-security-policy": CSP } });
  });
  await page.route("https://img.youtube.com/**", r => r.fulfill({ contentType: "image/jpeg", body: Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64") }));
  await page.route("https://www.youtube.com/iframe_api", r => api === "down" ? r.abort() : api === "hang" ? null : r.fulfill({ contentType: "application/javascript", body: FAKE_API }));
  await page.route(/https:\/\/www\.youtube(-nocookie)?\.com\/embed\/.*/, r => embed === "blocked" ? r.abort() : r.fulfill({ contentType: "text/html", body: "<!doctype html><title>youtube</title><body style='background:#222'>reproductor</body>" }));
  await page.goto(B + "/index.html", { waitUntil: "networkidle" });
  await wait(300);
  return { page, ctx, errs, violations, requests };
}
const frameInfo = page => page.evaluate(() => { const f = document.querySelector(".rd-feature iframe"); return f ? { src: f.src, w: f.getBoundingClientRect().width, h: f.getBoundingClientRect().height } : null; });

t("la prueba encontró la política de seguridad y el ID del video", !!CSP && !!VIDEO_ID, `${!!CSP} ${VIDEO_ID}`);

console.log("\nAntes de tocar play");
{
  const { page, ctx, requests } = await open();
  t("se ve la portada y el botón de play", await page.locator(".rd-feature > img").isVisible() && await page.locator(".rd-feature .rd-play").isVisible());
  t("YouTube no se pide hasta que se toca (la portada es una imagen)", !requests.some(u => /iframe_api|embed/.test(u)), requests.join(","));
  await ctx.close();
}

console.log("\nAl tocar play (con la política de seguridad real)");
{
  const { page, ctx, errs, violations, requests } = await open();
  await page.locator(".rd-feature .rd-play").click();
  await wait(1200);
  const f = await frameInfo(page);
  t("el navegador NO bloquea nada de YouTube", violations.length === 0, violations.join(" || "));
  t("se carga el script de la API de YouTube", requests.some(u => /youtube\.com\/iframe_api/.test(u)), requests.join(","));
  t("aparece el reproductor (iframe de YouTube con el ID del video)", !!f && f.src.includes(`/embed/${VIDEO_ID}`), JSON.stringify(f));
  t("el reproductor llena el recuadro (no queda una caja negra de 0 px)", !!f && f.w > 300 && f.h > 150, JSON.stringify(f));
  t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
  await ctx.close();
}

console.log("\nSi la API de YouTube no carga (bloqueador de anuncios, red lenta)");
{
  const { page, ctx, violations, requests } = await open({ api: "down" });
  await page.locator(".rd-feature .rd-play").click();
  await wait(5500);
  const f = await frameInfo(page);
  t("igual aparece el video, con un iframe simple de YouTube", !!f && /youtube(-nocookie)?\.com\/embed\//.test(f.src) && f.src.includes(VIDEO_ID), JSON.stringify(f));
  t("sin que el navegador bloquee el iframe", violations.length === 0, violations.join(" || "));
  t("y queda un enlace «Verlo en YouTube» por si nada de eso funciona", await page.locator(".rd-feature .rd-yt-link").count() === 1 && (await page.locator(".rd-feature .rd-yt-link").getAttribute("href")).includes(VIDEO_ID));
  await ctx.close();
}

console.log("\nMientras carga no se ve una caja negra");
{
  const { page, ctx } = await open({ api: "hang" });
  await page.locator(".rd-feature .rd-play").click();
  await wait(600);
  t("se ve la portada con un indicador de carga", await page.locator(".rd-feature > img").isVisible() && await page.evaluate(() => getComputedStyle(document.querySelector(".rd-feature"), "::after").content !== "none"));
  t("el botón de play ya no se ve (para no tocarlo dos veces)", !(await page.locator(".rd-feature .rd-play").isVisible()));
  await wait(6500);
  const f = await frameInfo(page);
  t("si la API se cuelga, a los 6 s entra el iframe simple", !!f && f.src.includes("youtube-nocookie.com/embed/" + VIDEO_ID), JSON.stringify(f));
  t("y la portada se quita al estar listo el reproductor", !(await page.locator(".rd-feature > img").isVisible()));
  await ctx.close();
}

console.log("\nSi nada de YouTube carga: hay salida");
{
  const { page, ctx } = await open({ api: "down", embed: "blocked" });
  await page.locator(".rd-feature .rd-play").click();
  await wait(1000);
  t("al principio el enlace no estorba", !(await page.locator(".rd-feature .rd-yt-link").isVisible()));
  await wait(7000);
  t("a los 7 s aparece «Verlo en YouTube»", await page.locator(".rd-feature .rd-yt-link").isVisible(), "no visible");
  t("y lleva al video correcto", (await page.locator(".rd-feature .rd-yt-link").getAttribute("href")) === `https://www.youtube.com/watch?v=${VIDEO_ID}`);
  await ctx.close();
}

console.log("\nCelular");
{
  const { page, ctx, violations } = await open({ viewport: { width: 390, height: 800 } });
  await page.locator(".rd-feature .rd-play").click();
  await wait(1200);
  const f = await frameInfo(page);
  t("el reproductor cabe en el ancho del celular", !!f && f.w > 250 && f.w <= 391, JSON.stringify(f));
  t("sin bloqueos", violations.length === 0, violations.join(" || "));
  await ctx.close();
}

await br.close();
console.log(fail ? `\n${fail} falla(s)` : "\nTodo bien");
process.exit(fail ? 1 : 0);
