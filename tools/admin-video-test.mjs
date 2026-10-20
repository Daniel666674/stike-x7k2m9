/* =========================================================================
   Prueba de videos de producto en el PANEL (admin.html): el editor revisa el
   archivo antes de aceptarlo, muestra los requisitos, sube el video y su
   imagen de vista previa al publicar, y borra del repo los que se quitan.

     python3 -m http.server 8143   (en la raiz del repo)
     node tools/admin-video-test.mjs

   Usa videos reales hechos con ffmpeg (si no hay, se omite). GitHub va
   simulado: se miran las peticiones que el panel le haria.
   ========================================================================= */
import { createRequire } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(process.env.PW_MODULES || "/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const ROOT = process.cwd(), B = "http://localhost:8143";

if (spawnSync("ffmpeg", ["-version"]).status !== 0) { console.log("sin ffmpeg: se omite la prueba de videos del panel"); process.exit(0); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stike-adminvideo-"));
const mk = (name, v = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-b:v", "1M"], { size = "1280x720", rate = 30, secs = 6 } = {}) => {
  const out = path.join(tmp, name);
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", `testsrc2=duration=${secs}:size=${size}:rate=${rate}`, ...v, "-an", "-movflags", "+faststart", out], { stdio: "ignore" });
  return out;
};
const good1 = mk("uno.mp4"), good2 = mk("dos.mp4"), good3 = mk("tres.mp4");
const hevc = mk("hevc.mp4", ["-c:v", "libx265", "-tag:v", "hvc1", "-pix_fmt", "yuv420p", "-b:v", "1M", "-x265-params", "log-level=none"]);
const fps60 = mk("fps60.mp4", ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-b:v", "1M"], { rate: 60 });

const br = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
let fail = 0;
const t = (l, ok, x = "") => { if (!ok) fail++; console.log((ok ? "ok    " : "FALLA ") + l + (ok ? "" : "  -> " + x)); };
const wait = ms => new Promise(r => setTimeout(r, ms));

/* Catalogo "remoto": el real, con videos ya publicados en dos productos. */
const MARK = "window.STIKE_PRODUCTS = ";
const raw = fs.readFileSync(ROOT + "/assets/js/products-data.js", "utf8");
const HEADER = raw.slice(0, raw.indexOf(MARK));
const catalog = JSON.parse(raw.slice(raw.indexOf(MARK) + MARK.length, raw.lastIndexOf(";")));
const pub = catalog.filter(p => p.published !== false && !(p.videos && p.videos.length));
const [A, Bp, C] = pub.slice(0, 3);
const oldVideo = n => ({ src: `assets/video/products/old${n}.mp4`, poster: `assets/video/products/old${n}.jpg`, w: 1280, h: 720, dur: 6, b: 748042, ts: "2026-10-01" });
Bp.videos = [oldVideo(1)];
C.videos = [oldVideo(2)];
const remoteCatalogText = HEADER + MARK + JSON.stringify(catalog, null, 2) + ";\n";

async function open() {
  const page = await br.newPage({ viewport: { width: 1300, height: 900 } });
  const errs = []; page.on("pageerror", e => errs.push(e.message));
  page.on("dialog", d => d.accept());
  const calls = []; page._calls = calls;
  await page.route("**/api/admin-login", r => r.fulfill({ json: { email: "x@test.com", role: "owner" } }));
  await page.route("**/api/admin-health", r => r.fulfill({ json: { ok: true } }));
  await page.route("**/api/sales", r => r.fulfill({ json: [] }));
  await page.route("**/api/gh?**", async r => {
    const req = r.request(), p = new URL(req.url()).searchParams.get("path");
    if (req.method() === "GET") {
      if (p === "assets/js/products-data.js") return r.fulfill({ json: { sha: "cat", content: Buffer.from(remoteCatalogText).toString("base64") } });
      if (/^assets\/video\/products\/old\d\.(mp4|jpg)$/.test(p)) return r.fulfill({ json: { sha: "sha-" + p, content: "" } });
      const f = ROOT + "/" + p;
      return fs.existsSync(f) ? r.fulfill({ json: { sha: "sha-" + p, content: fs.readFileSync(f).toString("base64") } }) : r.fulfill({ status: 404, json: {} });
    }
    calls.push({ method: req.method(), path: p, body: req.postDataJSON() });
    return r.fulfill({ json: { content: { sha: "new" }, commit: { sha: "c" } } });
  });
  await page.goto(B + "/admin.html", { waitUntil: "networkidle" });
  await wait(900);
  return { page, errs, calls };
}
const openEditor = async (page, p) => {
  await page.fill("#p-search", p.n.slice(0, 30)); await wait(300);
  await page.locator(`[data-edit="${p.slug}"]`).first().click(); await wait(350);
};
const msg = page => page.locator("#ed-video-msg").innerText();
const rows = page => page.locator("#ed-videos .vid-row").count();
const sendVideo = async (page, file) => { await page.setInputFiles("#ed-video-input", file); await wait(900); };

console.log("\nEl editor muestra los requisitos");
{
  const { page, errs } = await open();
  await openEditor(page, A);
  const req = await page.locator("#ed-video-req").innerText();
  t("hay una tarjeta de requisitos visible", /Requisitos de cada video/i.test(req));
  t("dice formato MP4 / H.264", /MP4/.test(req) && /H\.264/.test(req));
  t("dice el peso máximo (10 MB) y el ideal (5 MB)", /10 MB/.test(req) && /5 MB/.test(req));
  t("dice la duración (30 segundos)", /30\s+segundos/i.test(req));
  t("dice el tamaño (1280×720 y vertical 720×1280)", /1280×720/.test(req) && /720×1280/.test(req));
  t("dice 30 cuadros por segundo y Fast Start", /30 por segundo/.test(req) && /Fast Start/i.test(req));
  t("explica el cliente no descarga el video hasta tocarlo", /no se descarga/i.test(req));
  t("trae el comando de ffmpeg y los pasos de HandBrake", /ffmpeg -i/.test(await page.locator("#ed-video-req").evaluate(e => e.textContent)) && /HandBrake/.test(await page.locator("#ed-video-req").evaluate(e => e.textContent)));
  t("dice cuántos videos hay ya en la tienda y el tope recomendado", /En la tienda hay 2 videos/.test(req) && /100 videos/.test(req) && /400 MB/.test(req), req.slice(-400));
  t("sin videos todavía", /Sin videos todavía/.test(await page.locator("#ed-videos").innerText()) && await rows(page) === 0);
  t("la zona 'Agregar video' acepta solo MP4", (await page.locator("#ed-video-input").getAttribute("accept")).includes("mp4"));
  t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
  await page.close();
}

console.log("\nRechaza lo que no sirve (y dice cómo arreglarlo)");
{
  const { page, errs } = await open();
  await openEditor(page, A);
  await sendVideo(page, hevc);
  t("HEVC -> error con el ajuste del iPhone, y no se agrega", /HEVC/.test(await msg(page)) && /Más compatible/.test(await msg(page)) && await rows(page) === 0, await msg(page));
  await sendVideo(page, fps60);
  t("60 fps -> error", /60 cuadros/.test(await msg(page)) && await rows(page) === 0, await msg(page));
  await page.setInputFiles("#ed-video-input", { name: "clip.mov", mimeType: "video/quicktime", buffer: fs.readFileSync(good1) });
  await wait(300);
  t(".mov -> pide MP4 y no lo lee", /\.MOV/.test(await msg(page)) && /MP4/.test(await msg(page)) && await rows(page) === 0, await msg(page));
  await page.setInputFiles("#ed-video-input", { name: "falso.mp4", mimeType: "video/mp4", buffer: Buffer.from("no soy un video ".repeat(100)) });
  await wait(300);
  t("un .mp4 que no es video -> error claro", /no es un MP4 válido/.test(await msg(page)) && await rows(page) === 0, await msg(page));
  t("el producto sigue sin videos", await page.evaluate(() => (editorDraft.videos || []).length) === 0);
  t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
  await page.close();
}

console.log("\nAcepta un video bueno, máximo 2, y se puede quitar");
{
  const { page, errs, calls } = await open();
  await openEditor(page, A);
  await sendVideo(page, good1);
  t("el video bueno entra y sale '✔ Cumple todo'", await rows(page) === 1 && /Cumple todo: 1280×720/.test(await msg(page)), await msg(page));
  t("sin audio se anota como ideal", /Sin audio/.test(await msg(page)));
  t("la fila dice 'Nuevo · se sube al publicar'", /Nuevo · se sube al publicar/.test(await page.locator("#ed-videos").textContent()));
  const d1 = await page.evaluate(() => editorDraft.videos[0]);
  t("guarda ruta, medidas, duración, peso y fecha", /^assets\/video\/products\/[\w-]+\.mp4$/.test(d1.src) && d1.w === 1280 && d1.h === 720 && d1.dur === 6 && d1.b > 100000 && /^\d{4}-\d\d-\d\d$/.test(d1.ts), JSON.stringify(d1));
  t("este navegador no decodifica H.264: avisa que usará la foto de portada", /foto de portada/.test(await page.locator("#ed-videos").innerText() + await msg(page)) && !d1.poster, JSON.stringify(d1));

  /* Segundo video, ya con imagen de vista previa (se simula la captura: Chromium de pruebas no decodifica H.264). */
  await page.evaluate(() => { window.__caps = 0; window.captureVideoFrame = async () => { window.__caps++; return new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9])], { type: "image/jpeg" }); }; });
  await sendVideo(page, good2);
  t("segundo video: dos filas", await rows(page) === 2);
  const d2 = await page.evaluate(() => editorDraft.videos[1]);
  t("con vista previa: guarda la ruta del .jpg con el mismo nombre", d2.poster === d2.src.replace(/\.mp4$/, ".jpg"), JSON.stringify(d2));
  t("hay un control para elegir el cuadro de la vista previa", await page.locator("#ed-videos [data-vid-frame]").count() === 1);
  await page.locator("#ed-videos [data-vid-frame]").evaluate(e => { e.value = "3"; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); });
  await wait(300);
  t("mover el control vuelve a sacar la imagen", await page.evaluate(() => window.__caps) === 2, String(await page.evaluate(() => window.__caps)));
  t("con 2 videos desaparece 'Agregar video'", !(await page.locator("#ed-video-drop").isVisible()));
  await sendVideo(page, good3);
  t("un tercero se rechaza con mensaje", /máximo/.test(await msg(page)) && await rows(page) === 2, await msg(page));

  await page.locator("[data-vid-rm]").first().click(); await wait(200);
  t("quitar un video lo saca de la lista y devuelve 'Agregar video'", await rows(page) === 1 && await page.locator("#ed-video-drop").isVisible());
  await sendVideo(page, good3);
  t("se puede agregar otro", await rows(page) === 2, await msg(page));

  /* Publicar: sube los mp4 y la vista previa ANTES de escribir el catalogo. */
  const mine = await page.evaluate(() => editorDraft.videos.map(v => ({ ...v })));
  await page.locator("#ed-save").click(); await wait(300);
  await page.locator("#btn-publish").click(); await wait(2500);
  const order = calls.map(c => c.method + " " + c.path);
  const idxCat = order.findIndex(x => x === "PUT assets/js/products-data.js");
  const mp4s = calls.filter(c => c.method === "PUT" && /\.mp4$/.test(c.path));
  const jpgs = calls.filter(c => c.method === "PUT" && /^assets\/video\/products\/.*\.jpg$/.test(c.path));
  t("sube los 2 mp4", mp4s.length === 2 && mine.every(v => mp4s.some(c => c.path === v.src)), order.join("\n"));
  const wantJpgs = mine.filter(v => v.poster).map(v => v.poster).sort();
  t("sube una vista previa por cada video que la tiene", wantJpgs.length === 2 && JSON.stringify(jpgs.map(j => j.path).sort()) === JSON.stringify(wantJpgs), JSON.stringify(jpgs.map(j => j.path)));
  t("los videos suben ANTES de escribir el catálogo", idxCat > 0 && calls.slice(0, idxCat).filter(c => /\.mp4$/.test(c.path)).length === 2, order.join(" | "));
  const sent = Buffer.from(mp4s[0].body.content, "base64"), orig = fs.readFileSync(mine[0].src === mp4s[0].path ? good2 : good3);
  const origs = [good2, good3].map(f => fs.readFileSync(f));
  t("el mp4 llega EXACTO, byte por byte", origs.some(o => o.equals(sent)), `${sent.length} bytes`);
  t("lleva mensaje de commit con el producto", /Video para/.test(mp4s[0].body.message), mp4s[0].body.message);
  const cat = calls[idxCat] && Buffer.from(calls[idxCat].body.content, "base64").toString();
  const parsed = cat && JSON.parse(cat.slice(cat.indexOf(MARK) + MARK.length, cat.lastIndexOf(";")));
  const saved = parsed && parsed.find(p => p.slug === A.slug);
  t("el catálogo guarda los 2 videos del producto", saved && saved.videos && saved.videos.length === 2 && saved.videos.every((v, i) => v.src === mine[i].src), JSON.stringify(saved && saved.videos));
  t("no se cuela nada de 'cost' ni campos internos", saved && !("cost" in saved));
  const page1 = calls.find(c => c.path === `producto/${A.slug}.html`);
  const html = page1 && Buffer.from(page1.body.content, "base64").toString();
  t("la ficha regenerada trae los botones de video (sin <video> ni descarga)", html && (html.match(/data-video-src=/g) || []).length === 3 && !/<video/i.test(html), html && (html.match(/data-video-src=/g) || []).length);
  t("y los datos estructurados VideoObject", html && /"@type":"VideoObject"/.test(html) && /"duration":"PT6S"/.test(html) && /"uploadDate":"\d{4}-\d\d-\d\d"/.test(html));
  const audit = calls.find(c => c.path === "data/audit-log.json");
  t("la auditoría cuenta los videos", audit && /2 video\(s\)/.test(Buffer.from(audit.body.content, "base64").toString()));
  t("estado de publicación: sin errores", !/No se pudo publicar/.test(await page.locator("#status-box").innerText()), await page.locator("#status-box").innerText());
  t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
  await page.close();
}

console.log("\nBorra de GitHub los videos que se quitan");
{
  const { page, errs, calls } = await open();
  await openEditor(page, Bp);
  t("el video ya publicado se ve como 'Publicado' con su peso", /Publicado/.test(await page.locator("#ed-videos").textContent()) && /0,7 MB/.test(await page.locator("#ed-videos").textContent()), await page.locator("#ed-videos").textContent());
  await page.locator("[data-vid-rm]").first().click(); await wait(200);
  await page.locator("#ed-save").click(); await wait(300);
  await page.locator("#btn-publish").click(); await wait(2500);
  const dels = calls.filter(c => c.method === "DELETE").map(c => c.path);
  t("al publicar borra el mp4 y su vista previa", dels.includes("assets/video/products/old1.mp4") && dels.includes("assets/video/products/old1.jpg"), dels.join(","));
  t("no toca los videos de otros productos", !dels.some(p => /old2/.test(p)), dels.join(","));
  const cat = calls.find(c => c.path === "assets/js/products-data.js");
  const txt = Buffer.from(cat.body.content, "base64").toString();
  const saved = JSON.parse(txt.slice(txt.indexOf(MARK) + MARK.length, txt.lastIndexOf(";"))).find(p => p.slug === Bp.slug);
  t("el catálogo ya no lista videos de ese producto", !saved.videos, JSON.stringify(saved.videos));
  t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
  await page.close();
}
{
  const { page, errs, calls } = await open();
  await openEditor(page, C);
  await page.locator("#ed-delete").click(); await wait(300);
  await page.locator("#btn-publish").click(); await wait(2500);
  const dels = calls.filter(c => c.method === "DELETE").map(c => c.path);
  t("eliminar un producto también borra sus videos", dels.includes("assets/video/products/old2.mp4") && dels.includes("assets/video/products/old2.jpg"), dels.join(","));
  t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
  await page.close();
}

console.log("\nCancelar no sube nada");
{
  const { page, errs, calls } = await open();
  await openEditor(page, A);
  await sendVideo(page, good1);
  t("hay un video pendiente", await rows(page) === 1);
  await page.locator("#ed-close").click(); await wait(200);
  t("al cerrar sin guardar se suelta de la memoria", await page.evaluate(() => pendingVideos.size) === 0);
  t("y no se publicó nada", calls.length === 0 && await page.locator("#btn-publish").isDisabled());
  t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
  await page.close();
}

await br.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail ? `\n${fail} falla(s)` : "\nTodo bien");
process.exit(fail ? 1 : 0);
