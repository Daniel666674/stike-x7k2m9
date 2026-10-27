/* =========================================================================
   Prueba de la compresion de fotos del panel con fotos de FONDO BLANCO y pieza
   delgada (un tenedor de perfil, una cadena): antes se rechazaban con "No se pudo
   procesar la foto" porque la revision de "dibujo en blanco" solo miraba 9 puntos.

     python3 -m http.server 8143   (en la raiz del repo)
     node tools/photo-white-bg-test.mjs
   ========================================================================= */
import { createRequire } from "node:module";
const require = createRequire(process.env.PW_MODULES || "/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const B = "http://localhost:8143";
const br = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
let fail = 0;
const t = (l, ok, x = "") => { if (!ok) fail++; console.log((ok ? "ok    " : "FALLA ") + l + (ok ? "" : "  -> " + x)); };

const page = await br.newPage({ viewport: { width: 1300, height: 900 } });
const errs = []; page.on("pageerror", e => errs.push(e.message));
await page.route("**/api/admin-login", r => r.fulfill({ json: { email: "x@test.com", role: "owner" } }));
await page.route("**/api/admin-health", r => r.fulfill({ json: { ok: true } }));
await page.route("**/api/sales", r => r.fulfill({ json: [] }));
await page.route("**/api/gh?**", r => r.fulfill({ status: 404, json: {} }));
await page.goto(B + "/admin.html", { waitUntil: "networkidle" });
await page.waitForTimeout(800);

const res = await page.evaluate(async () => {
  const mkFile = (w, h, draw, type = "image/jpeg") => new Promise(res => {
    const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d");
    draw(g, w, h); c.toBlob(b => res(new File([b], "foto." + (type === "image/png" ? "png" : "jpg"), { type })), type, 0.95);
  });
  const white = (g, w, h) => { g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); };
  /* Los 9 puntos que miraba la revision vieja: esquinas, medios de los bordes y centro. */
  const oldCheck = (ctx, w, h) => {
    const mx = w >> 1, my = h >> 1, rx = w - 1, ry = h - 1;
    const pts = [[0, 0], [mx, 0], [rx, 0], [0, my], [mx, my], [rx, my], [0, ry], [mx, ry], [rx, ry]];
    let first = null;
    for (const [x, y] of pts) { const d = ctx.getImageData(x, y, 1, 1).data, k = d.join(); if (first === null) first = k; else if (k !== first) return true; }
    return false;
  };
  const out = {};
  // 1) fondo blanco + una pieza delgada (6 px) lejos de los 9 puntos: como un tenedor de perfil
  const fork = await mkFile(1200, 1200, (g, w, h) => { white(g, w, h); g.fillStyle = "#111"; g.fillRect(403, 100, 6, 1000); g.fillRect(300, 1000, 200, 8); });
  const c1 = document.createElement("canvas"); c1.width = 1200; c1.height = 1200; const g1 = c1.getContext("2d"); g1.fillStyle = "#fff"; g1.fillRect(0, 0, 1200, 1200); g1.fillStyle = "#111"; g1.fillRect(403, 100, 6, 1000); g1.fillRect(300, 1000, 200, 8);
  out.oldCheckRejects = !oldCheck(g1, 1200, 1200);
  out.newCheckAccepts = canvasLooksReal(g1, 1200, 1200);
  try { const b = await compressImageFile(fork); out.forkOk = b.type === "image/jpeg" && b.size > 1000; out.forkSize = b.size; } catch (e) { out.forkErr = e.message; }
  // 2) una sola linea de 1 px de ancho
  const hair = await mkFile(1000, 1000, (g, w, h) => { white(g, w, h); g.fillStyle = "#000"; g.fillRect(777, 0, 1, 1000); });
  try { const b = await compressImageFile(hair); out.hairOk = b.size > 500; } catch (e) { out.hairErr = e.message; }
  // 3) imagen realmente uniforme (en blanco): se sigue rechazando
  const blank = await mkFile(800, 800, white);
  try { await compressImageFile(blank); out.blankRejected = false; } catch (e) { out.blankRejected = /No se pudo procesar la foto/.test(e.message); }
  // 4) PNG recortado (transparente) con pieza delgada: el fondo sale BLANCO, no negro
  const cut = await mkFile(1000, 1000, (g) => { g.fillStyle = "#222"; g.fillRect(500, 50, 8, 900); }, "image/png");
  try { const b = await compressImageFile(cut); const img = await createImageBitmap(b); const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d"); g.drawImage(img, 0, 0); const p = g.getImageData(10, 10, 1, 1).data; out.cutBg = [p[0], p[1], p[2]]; } catch (e) { out.cutErr = e.message; }
  // 5) foto grande: se reduce a 1600 como siempre
  const big = await mkFile(4000, 3000, (g, w, h) => { white(g, w, h); g.fillStyle = "#c00"; g.fillRect(1000, 800, 1500, 1200); });
  try { const b = await compressImageFile(big); const img = await createImageBitmap(b); out.bigDims = [img.width, img.height]; } catch (e) { out.bigErr = e.message; }
  // 6) la revision acepta una foto con un solo pixel distinto
  const c6 = document.createElement("canvas"); c6.width = 500; c6.height = 500; const g6 = c6.getContext("2d"); g6.fillStyle = "#fff"; g6.fillRect(0, 0, 500, 500);
  out.uniform = canvasLooksReal(g6, 500, 500);
  g6.fillStyle = "#fefefe"; g6.fillRect(321, 499, 1, 1);
  out.onePixel = canvasLooksReal(g6, 500, 500);
  return out;
});

t("el caso reproduce el fallo: la revisión VIEJA (9 puntos) rechazaba esta foto de fondo blanco", res.oldCheckRejects === true);
t("la revisión nueva la acepta (mira la foto completa)", res.newCheckAccepts === true);
t("una foto de fondo blanco con una pieza delgada (tenedor) se comprime a JPEG", res.forkOk === true, res.forkErr || String(res.forkSize));
t("hasta una línea de 1 píxel de ancho cuenta como detalle", res.hairOk === true, res.hairErr);
t("una imagen realmente uniforme (en blanco) se sigue rechazando", res.blankRejected === true);
t("una imagen uniforme no pasa la revisión, un píxel distinto sí", res.uniform === false && res.onePixel === true);
t("un PNG recortado (fondo transparente) sale con fondo BLANCO, no negro", Array.isArray(res.cutBg) && res.cutBg.every(v => v > 245), JSON.stringify(res.cutBg) + (res.cutErr || ""));
t("una foto grande se reduce a 1600 px como siempre", Array.isArray(res.bigDims) && Math.max(...res.bigDims) === 1600 && res.bigDims[0] / res.bigDims[1] > 1.3, JSON.stringify(res.bigDims) + (res.bigErr || ""));
t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));

await br.close();
console.log(fail ? `\n${fail} falla(s)` : "\nTodo bien");
process.exit(fail ? 1 : 0);
