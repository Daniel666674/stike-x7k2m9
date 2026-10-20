/* =========================================================================
   Prueba del video en la FICHA de producto (producto/<slug>.html):
   el MP4 no se pide hasta que el cliente lo toca, el reproductor abre y
   cierra limpio (suelta la descarga), y no se mezcla con la galeria de fotos.

     python3 -m http.server 8143   (en la raiz del repo)
     node tools/pdp-video-test.mjs

   La ficha se genera con el mismo PdpRender del sitio y se sirve en lugar
   de la real; el "mp4" que se entrega es un WebM de 3 s (el Chromium de
   pruebas no decodifica H.264, y aqui solo importa CUANDO y CUANTO se pide).
   ========================================================================= */
import { createRequire } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(process.env.PW_MODULES || "/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const own = createRequire(import.meta.url);
const PdpRender = own("../assets/js/pdp-render.js");
const SITE = own("../assets/js/site.js");
const ROOT = process.cwd(), B = "http://localhost:8143";

if (spawnSync("ffmpeg", ["-version"]).status !== 0) { console.log("sin ffmpeg: se omite la prueba del video en la ficha"); process.exit(0); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stike-pdpvideo-"));
const webm = path.join(tmp, "demo.webm");
execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=duration=3:size=320x180:rate=15", "-c:v", "libvpx", "-b:v", "150k", "-an", webm], { stdio: "ignore" });
const WEBM = fs.readFileSync(webm);

const br = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
let fail = 0;
const t = (l, ok, x = "") => { if (!ok) fail++; console.log((ok ? "ok    " : "FALLA ") + l + (ok ? "" : "  -> " + x)); };
const wait = ms => new Promise(r => setTimeout(r, ms));

const MARK = "window.STIKE_PRODUCTS = ";
const raw = fs.readFileSync(ROOT + "/assets/js/products-data.js", "utf8");
const catalog = JSON.parse(raw.slice(raw.indexOf(MARK) + MARK.length, raw.lastIndexOf(";")));
const withPhotos = catalog.filter(p => p.published !== false && p.imgs && p.imgs.length >= 3 && !p.sizes && !p.colors);
const prod = withPhotos[0];
const template = fs.readFileSync(ROOT + "/_template.html", "utf8");
const render = p => PdpRender.renderProductPage(p, template, { site: SITE, categoryName: "Prueba", whatsapp: SITE.whatsapp, placeholderImg: SITE.ogFallback }).replace(/<base href="[^"]*">/g, '<base href="/">');
const video = (o = {}) => ({ src: "assets/video/products/demo-uno.mp4", poster: "assets/video/products/demo-uno.jpg", w: 1280, h: 720, dur: 6, b: 700000, ts: "2026-10-01", ...o });

async function open(p, viewport = { width: 1300, height: 900 }) {
  const ctx = await br.newContext({ viewport });
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", e => errs.push(e.message));
  const reqs = []; page._reqs = reqs;
  page.on("request", r => reqs.push(r.url()));
  await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => { const st = document.createElement("style"); st.textContent = "[class*=cookie],#newsletter-overlay{display:none!important}"; document.head.appendChild(st); }));
  await page.route(`**/producto/${p.slug}.html`, r => r.fulfill({ contentType: "text/html; charset=utf-8", body: render(p) }));
  await page.route("**/assets/video/products/*.mp4", r => r.fulfill({ status: 200, headers: { "content-type": "video/webm", "accept-ranges": "bytes" }, body: WEBM }));
  await page.route("**/assets/video/products/*.jpg", r => r.fulfill({ contentType: "image/jpeg", body: fs.readFileSync(ROOT + "/" + p.imgs[0].replace(/^\//, "")) }));
  await page.goto(`${B}/producto/${p.slug}.html`, { waitUntil: "networkidle" });
  await wait(400);
  return { page, errs, reqs, ctx };
}
const mp4Reqs = reqs => reqs.filter(u => /\.mp4(\?|$)/.test(u)).length;

console.log("\nLa ficha con video: nada se descarga hasta tocar");
{
  const p = { ...prod, videos: [video()] };
  const { page, errs, reqs, ctx } = await open(p);
  t("hay una miniatura de video en la tira", await page.locator(".pdp-thumbs .vid-thumb").count() === 1);
  t("y un botón «Ver video» sobre la foto", await page.locator(".pdp-gallery .main .pdp-videobtn").count() === 1 && /Ver video/i.test(await page.locator(".pdp-videobtn").textContent()));
  t("la miniatura usa la imagen de vista previa, no el mp4", (await page.locator(".vid-thumb img").getAttribute("src")).endsWith("demo-uno.jpg"));
  t("NO hay ningún <video> en la página", await page.locator("video").count() === 0);
  await wait(800);
  t("0 peticiones al mp4 mientras el cliente no toca nada", mp4Reqs(reqs) === 0, reqs.filter(u => /\.mp4/.test(u)).join(","));
  t("tampoco existe el reproductor en el DOM todavía", await page.locator(".pdp-videobox").count() === 0);

  console.log("\nLa galería de fotos sigue igual");
  const nThumbs = await page.locator(".pdp-thumbs [data-thumb]").count();
  t("las fotos son las del producto (el video no cuenta como foto)", nThumbs === p.imgs.length, `${nThumbs} vs ${p.imgs.length}`);
  t("el contador dice 1 / N sin contar el video", (await page.locator(".pdp-count").textContent()).trim() === `1 / ${p.imgs.length}`, await page.locator(".pdp-count").textContent());
  const first = await page.locator("#main-img").getAttribute("src");
  await page.keyboard.press("ArrowRight"); await wait(150);
  t("la flecha → pasa a la foto siguiente", (await page.locator("#main-img").getAttribute("src")) !== first);

  console.log("\nAl tocar «Ver video»");
  await page.locator(".pdp-videobtn").click(); await wait(900);
  t("abre el reproductor", await page.locator(".pdp-videobox.open").count() === 1 && await page.locator(".pdp-videobox video").isVisible());
  t("recién ahora se pide el mp4 (una sola vez)", mp4Reqs(reqs) === 1, String(mp4Reqs(reqs)));
  t("el video tiene controles y arranca", await page.locator(".pdp-videobox video").evaluate(v => v.controls && v.readyState >= 1 && !v.paused && v.currentTime > 0));
  t("lleva la imagen de vista previa como poster", (await page.locator(".pdp-videobox video").getAttribute("poster") || "").endsWith("demo-uno.jpg"));
  t("el fondo no se desplaza", await page.evaluate(() => document.body.classList.contains("vb-lock")));
  const before = await page.locator("#main-img").getAttribute("src");
  await page.keyboard.press("ArrowRight"); await wait(150);
  t("con el video abierto las flechas NO cambian la foto de atrás", (await page.locator("#main-img").getAttribute("src")) === before);

  await page.keyboard.press("Escape"); await wait(250);
  t("Escape lo cierra", await page.locator(".pdp-videobox.open").count() === 0);
  t("al cerrar se quita el <video> (se suelta la descarga)", await page.locator("video").count() === 0);
  t("el scroll vuelve", await page.evaluate(() => !document.body.classList.contains("vb-lock")));
  t("el foco vuelve al botón que lo abrió", await page.evaluate(() => document.activeElement && document.activeElement.classList.contains("pdp-videobtn")));

  await page.locator(".vid-thumb").click(); await wait(500);
  t("se puede abrir desde la miniatura", await page.locator(".pdp-videobox.open video").count() === 1);
  await page.locator(".pdp-videobox .lb-close").click(); await wait(200);
  t("la ✕ lo cierra", await page.locator(".pdp-videobox.open").count() === 0);
  await page.locator(".vid-thumb").click(); await wait(400);
  await page.mouse.click(8, 450); await wait(200);
  t("tocar fuera lo cierra", await page.locator(".pdp-videobox.open").count() === 0);
  t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));

  console.log("\nDatos estructurados");
  const ld = JSON.parse(await page.locator('script[type="application/ld+json"]').first().textContent());
  const vo = ld["@graph"].filter(n => n["@type"] === "VideoObject");
  t("hay un VideoObject", vo.length === 1);
  t("con nombre, descripción, miniatura, fecha, duración y archivo", vo[0] && vo[0].name && vo[0].description && vo[0].thumbnailUrl[0].startsWith("http") && vo[0].uploadDate === "2026-10-01" && vo[0].duration === "PT6S" && vo[0].contentUrl.startsWith("http") && vo[0].contentUrl.endsWith("demo-uno.mp4"), JSON.stringify(vo[0]));
  t("y apunta al producto", vo[0] && vo[0].about && /#product$/.test(vo[0].about["@id"]));
  await ctx.close();
}

console.log("\nDos videos y uno vertical");
{
  const p = { ...prod, videos: [video(), video({ src: "assets/video/products/demo-dos.mp4", poster: "assets/video/products/demo-dos.jpg", w: 720, h: 1280 })] };
  const { page, errs, reqs, ctx } = await open(p);
  t("dos miniaturas de video, un solo botón sobre la foto", await page.locator(".vid-thumb").count() === 2 && await page.locator(".pdp-videobtn").count() === 1);
  t("las miniaturas se distinguen para lectores de pantalla", /video 1/i.test(await page.locator(".vid-thumb").nth(0).getAttribute("aria-label")) && /video 2/i.test(await page.locator(".vid-thumb").nth(1).getAttribute("aria-label")));
  await page.locator(".vid-thumb").nth(1).click(); await wait(700);
  const box = await page.locator(".pdp-videobox video").boundingBox();
  t("el vertical se ve vertical y cabe en pantalla", box.height > box.width && box.height <= 900 * 0.9 && Math.abs(box.width / box.height - 0.5625) < 0.02, JSON.stringify(box));
  t("pide el mp4 del segundo, no el del primero", reqs.some(u => u.includes("demo-dos.mp4")) && !reqs.some(u => u.includes("demo-uno.mp4")));
  t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
  await ctx.close();
}

console.log("\nCelular");
{
  const p = { ...prod, videos: [video()] };
  const { page, errs, reqs, ctx } = await open(p, { width: 390, height: 780 });
  t("sin desbordar a los lados", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await page.evaluate(() => document.documentElement.scrollWidth));
  t("0 peticiones al mp4 al cargar", mp4Reqs(reqs) === 0);
  await page.locator(".pdp-videobtn").click(); await wait(800);
  const box = await page.locator(".pdp-videobox video").boundingBox();
  t("el video cabe en el ancho del celular", box && box.x >= 0 && box.x + box.width <= 390.5 && box.width > 300, JSON.stringify(box));
  t("el botón de cerrar se alcanza", await page.locator(".pdp-videobox .lb-close").isVisible());
  await page.locator(".pdp-videobox .lb-close").click(); await wait(200);
  t("cierra", await page.locator(".pdp-videobox.open").count() === 0);
  t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
  await ctx.close();
}

console.log("\nProducto sin video: la ficha queda idéntica");
{
  const { page, errs, reqs, ctx } = await open({ ...prod });
  const html = await page.content();
  t("ni miniatura, ni botón, ni reproductor", await page.locator(".vid-thumb, .pdp-videobtn, .pdp-videobox").count() === 0 && !/data-video-src/.test(html));
  t("sin VideoObject", !/VideoObject/.test(html));
  t("ninguna petición de video", !reqs.some(u => /\/video\//.test(u)));
  t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
  await ctx.close();
}

await br.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail ? `\n${fail} falla(s)` : "\nTodo bien");
process.exit(fail ? 1 : 0);
