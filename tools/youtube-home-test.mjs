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
const VIDEO_ID = (fs.readFileSync(ROOT + "/index.html", "utf8").match(/data-yt-id="([^"]+)"/) || [])[1];

/* Una API de YouTube de mentira: crea el iframe como lo hace la real y anota lo que se le pide (window.__yt).
   window.__ytBehavior = "blocked" simula un navegador que NO deja arrancar el video solo. */
const FAKE_API = `
window.__yt = { created: 0, vars: null, calls: [] };
window.YT = { PlayerState: { PLAYING: 1, PAUSED: 2 }, Player: function (id, o) {
  var log = function (c) { window.__yt.calls.push(c); };
  window.__yt.created++; window.__yt.vars = o.playerVars;
  var el = document.getElementById(id), f = document.createElement("iframe");
  f.id = id; f.src = "https://www.youtube.com/embed/" + o.videoId + "?enablejsapi=1&autoplay=1"; f.allow = "autoplay; encrypted-media"; el.replaceWith(f);
  var muted = !!(o.playerVars && o.playerVars.mute), state = -1;
  var t = {
    setPlaybackQuality: function () {}, mute: function () { muted = true; log("mute"); }, unMute: function () { muted = false; log("unMute"); },
    isMuted: function () { return muted; }, setVolume: function (v) { log("setVolume:" + v); }, getPlayerState: function () { return state; },
    playVideo: function () { log("play"); if (window.__ytBehavior !== "blocked") { state = 1; o.events.onStateChange({ data: 1, target: t }); } },
    pauseVideo: function () { log("pause"); state = 2; }, destroy: function () { log("destroy"); f.remove(); }
  };
  setTimeout(function () { o.events.onReady({ target: t }); }, 50);
} };
setTimeout(function () { window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady(); }, 20);`;

/* Por defecto SIN arranque automatico (movimiento reducido): las pruebas de "tocar play" siguen siendo las de siempre.
   auto: true = como un visitante normal; saveData / effectiveType simulan datos limitados; behavior "blocked" = el
   navegador no deja arrancar solo; holdIdle = el arranque automatico no corre hasta que la prueba lo suelte. */
async function open({ api = "ok", embed = "ok", viewport = { width: 1300, height: 900 }, auto = false, saveData = false, effectiveType = "4g", behavior = "plays", holdIdle = false } = {}) {
  const ctx = await br.newContext({ viewport, reducedMotion: auto ? "no-preference" : "reduce" });
  const page = await ctx.newPage();
  await page.addInitScript(({ saveData, effectiveType, behavior, holdIdle }) => {
    window.__ytBehavior = behavior;
    Object.defineProperty(navigator, "connection", { value: { saveData, effectiveType }, configurable: true });
    if (holdIdle) window.requestIdleCallback = cb => { window.__idleCb = cb; return 1; };
  }, { saveData, effectiveType, behavior, holdIdle });
  const errs = [], violations = [], requests = [];
  page.on("pageerror", e => errs.push(e.message));
  page.on("console", m => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text().slice(0, 160)); });
  const stamps = []; page._stamps = stamps;
  page.on("request", r => { if (/youtube/.test(r.url()) && !/img\.youtube\.com/.test(r.url())) { requests.push(r.url()); stamps.push({ url: r.url(), at: Date.now() }); } });
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
  return { page, ctx, errs, violations, requests, stamps };
}
const frameInfo = page => page.evaluate(() => { const f = document.querySelector(".rd-feature iframe"); return f ? { src: f.src, w: f.getBoundingClientRect().width, h: f.getBoundingClientRect().height } : null; });

t("la prueba encontró la política de seguridad y el ID del video", !!CSP && !!VIDEO_ID, `${!!CSP} ${VIDEO_ID}`);

console.log("\nDónde está el video: debajo del título, con el banner de FIEND debajo");
for (const [name, vp] of [["escritorio", { width: 1300, height: 900 }], ["celular", { width: 390, height: 800 }]]) {
  const { page, ctx } = await open({ viewport: vp });
  const pos = await page.evaluate(() => {
    const r = sel => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { top: b.top + scrollY, bottom: b.bottom + scrollY, w: b.width, h: b.height }; };
    return { top: r(".rd-title"), feat: r(".rd-core > .rd-feature"), fiend: r(".rd-fiend"), tag: r(".rd-tag"), box: r(".rd-box"), wompi: r(".rd-core .wompi-badge"),
      h1count: document.querySelectorAll("h1").length, h1text: (document.querySelector("h1") || {}).textContent, order: [...document.querySelector(".rd-core").children].map(e => e.className.split(" ")[0]),
      coreText: document.querySelector(".rd-core").textContent, oldSection: !!document.querySelector(".rd-media"), overflow: document.documentElement.scrollWidth - innerWidth,
      wompiCompact: !!document.querySelector(".rd-core .wompi-badge.compact"),
      link: (document.querySelector(".rd-fiend-link") || {}).getAttribute && document.querySelector(".rd-fiend-link").getAttribute("href"), wa: (document.querySelector(".rd-fiend-wa") || {}).href, waTxt: (document.querySelector(".rd-fiend-wa") || {}).textContent };
  });
  t(`${name}: «La casa de todo el que rueda» es el único h1 y va ARRIBA del video`, pos.h1count === 1 && /la\s+casa\s+de\s+todo\s+el\s+que\s+rueda/i.test(pos.h1text) && pos.top.bottom <= pos.feat.top + 1, JSON.stringify([pos.h1count, pos.h1text]));
  t(`${name}: el texto «Rueda Duro Vive BMX» ya no existe en el inicio`, !/rueda\s+duro/i.test(pos.coreText) && !/vive\s+bmx/i.test(pos.coreText), pos.coreText.slice(0, 120));
  t(`${name}: el orden es título, video, banner de FIEND`, pos.order[0] === "rd-title" && pos.order[1] === "rd-feature" && pos.order[2] === "rd-fiend", pos.order.join(","));
  t(`${name}: el banner de FIEND queda debajo del video y antes de la frase y la caja de texto`, pos.fiend.top >= pos.feat.bottom && pos.tag.top >= pos.fiend.bottom && pos.box.top >= pos.fiend.bottom);
  t(`${name}: el banner trae la frase de venta, el enlace a los productos FIEND y WhatsApp`, /nueva casa de FIEND en Colombia/i.test(await page.locator(".rd-fiend-title").textContent()) && pos.link === "marca/fiend.html" && /wa\.me\/\d+/.test(pos.wa) && /FIEND/.test(decodeURIComponent(pos.wa)) && /whatsapp/i.test(pos.waTxt), JSON.stringify([pos.link, pos.wa, pos.waTxt]));
  t(`${name}: Wompi queda más abajo que el video y el banner, y en versión compacta`, pos.wompi.top > pos.fiend.bottom && pos.wompiCompact);
  t(`${name}: el video es 16:9`, Math.abs(pos.feat.w / pos.feat.h - 16 / 9) < 0.05, String(pos.feat.w / pos.feat.h));
  t(`${name}: no existe la sección vieja del video más abajo`, !pos.oldSection && await page.locator("[data-video=feature]").count() === 1);
  t(`${name}: no se sale del ancho`, pos.overflow <= 1, String(pos.overflow));
  if (name === "escritorio") t("escritorio: el video se ve completo en la primera pantalla (sin bajar)", pos.feat.bottom < 900, String(pos.feat.bottom));
  await ctx.close();
}

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

console.log("\nArranque automático al cargar la página");
const yt = page => page.evaluate(() => window.__yt || { created: 0, vars: null, calls: [] });
{
  const { page, ctx, violations, stamps, errs } = await open({ auto: true });
  await wait(2500);
  const f = await frameInfo(page), y = await yt(page);
  t("el video arranca solo, sin tocar nada", !!f && f.src.includes(`/embed/${VIDEO_ID}`) && y.created === 1, JSON.stringify([f, y.created]));
  t("arranca SIN SONIDO (así lo exigen los navegadores)", y.vars && y.vars.mute === 1 && y.vars.autoplay === 1, JSON.stringify(y.vars));
  t("y en bucle, para que no salgan videos sugeridos al terminar", y.vars && y.vars.loop === 1 && y.vars.playlist === VIDEO_ID);
  t("aparece el botón «Activar sonido»", await page.locator(".rd-sound").isVisible());
  t("el botón de play desaparece (ya está sonando)", !(await page.locator(".rd-feature .rd-play").isVisible()));
  t("el navegador no bloquea nada de YouTube", violations.length === 0, violations.join(" || "));
  t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
  const loadEnd = await page.evaluate(() => performance.timeOrigin + performance.getEntriesByType("navigation")[0].loadEventEnd);
  t("YouTube se pide DESPUÉS de que la página terminó de cargar (no la frena)", stamps.length > 0 && stamps.every(x => x.at >= loadEnd - 5), `${stamps.length} peticiones; primera ${stamps[0] && stamps[0].at - loadEnd} ms después del load`);
  await page.locator(".rd-sound").click(); await wait(200);
  const y2 = await yt(page);
  t("«Activar sonido» le quita el silencio y sube el volumen", y2.calls.includes("unMute") && y2.calls.includes("setVolume:100"), y2.calls.join(","));
  t("y el botón se va", !(await page.locator(".rd-sound").isVisible()));
  await ctx.close();
}
{
  const { page, ctx } = await open({ auto: true });
  await wait(2500);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await wait(600);
  let y = await yt(page);
  t("si el video sale de la pantalla (y sigue mudo) se pausa", y.calls.includes("pause"), y.calls.join(","));
  const playsBefore = y.calls.filter(c => c === "play").length;
  await page.evaluate(() => window.scrollTo(0, 0));
  await wait(600);
  y = await yt(page);
  t("y al volver a verlo, sigue", y.calls.filter(c => c === "play").length === playsBefore + 1, y.calls.join(","));
  await ctx.close();
}
{
  const { page, ctx } = await open({ auto: true });
  await wait(2500);
  await page.locator(".rd-sound").click();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await wait(600);
  t("con el sonido activado NO se pausa al salir de la pantalla (lo decide la persona)", !(await yt(page)).calls.includes("pause"));
  await ctx.close();
}

console.log("\nCuándo NO arranca solo");
for (const [label, opts] of [["menos movimiento (accesibilidad)", { auto: false }], ["ahorro de datos activado", { auto: true, saveData: true }], ["conexión lenta (3G)", { auto: true, effectiveType: "3g" }], ["conexión muy lenta (2G)", { auto: true, effectiveType: "2g" }]]) {
  const { page, ctx, requests } = await open(opts);
  await wait(2800);
  t(`${label}: queda la portada con su botón de play`, await page.locator(".rd-feature .rd-play").isVisible() && await page.locator(".rd-feature > img").isVisible() && await page.locator(".rd-feature iframe").count() === 0);
  t(`${label}: no se pide nada a YouTube`, requests.length === 0, requests.join(","));
  await ctx.close();
}
{
  const { page, ctx } = await open({ auto: true, effectiveType: "4g" });
  await wait(2500);
  t("con 4G sí arranca", await page.locator(".rd-feature iframe").count() === 1);
  await ctx.close();
}

console.log("\nSi el navegador no deja arrancar solo");
{
  const { page, ctx } = await open({ auto: true, behavior: "blocked" });
  await wait(2500);
  t("primero lo intenta (hay reproductor)", await page.locator(".rd-feature iframe").count() === 1);
  await wait(6500);
  const y = await yt(page);
  t("a los 6 s sin arrancar, vuelve a la portada con su botón de play", await page.locator(".rd-feature .rd-play").isVisible() && await page.locator(".rd-feature iframe").count() === 0 && y.calls.includes("destroy"), y.calls.join(","));
  t("sin dejar restos (botón de sonido, enlace, clases)", await page.locator(".rd-sound, .rd-yt-link").count() === 0 && !(await page.evaluate(() => document.querySelector(".rd-feature").className.match(/playing|yt/))));
  await page.evaluate(() => { window.__ytBehavior = "plays"; });
  await page.locator(".rd-feature .rd-play").click(); await wait(600);
  const y2 = await yt(page);
  t("tocar play funciona, esta vez CON sonido", y2.created === 2 && !y2.vars.mute && !y2.vars.loop && await page.locator(".rd-feature iframe").count() === 1 && !(await page.locator(".rd-sound").count()), JSON.stringify(y2.vars));
  await ctx.close();
}

console.log("\nAlguien toca play antes del arranque automático");
{
  const { page, ctx } = await open({ auto: true, holdIdle: true });
  await wait(500);
  await page.locator(".rd-feature .rd-play").click(); await wait(500);
  await page.evaluate(() => window.__idleCb && window.__idleCb());
  await wait(1500);
  const y = await yt(page);
  t("queda UN solo reproductor, con sonido (el que pidió la persona)", y.created === 1 && !y.vars.mute, JSON.stringify([y.created, y.vars]));
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
