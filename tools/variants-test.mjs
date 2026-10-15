/* Prueba de variantes (colores redondos, tallas, combos, roles). Servir el repo en :8140 (python3 -m http.server 8140) y correr: node tools/variants-test.mjs */
import { createRequire } from "node:module";
const require = createRequire(process.env.PW_MODULES || "/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const B = "http://localhost:8140";
const br = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await br.newPage({ viewport: { width: 1200, height: 900 } });
const errs = []; page.on("pageerror", e => errs.push(e.message));
const t = (l, ok, extra="") => console.log((ok ? "ok    " : "FALLA ") + l + (ok ? "" : "  -> " + extra));

// 1. ficha con colores: circulos sin texto
await page.goto(`${B}/producto/pedales-demolition-trooper.html`, { waitUntil: "networkidle" });
const dots = await page.locator("#color-options .color-opt").count();
t("5 circulos de color", dots === 5, dots);
const txt = (await page.locator("#color-options").innerText()).trim();
t("los circulos no tienen texto visible", txt === "", JSON.stringify(txt));
const label = await page.locator("#color-options .color-opt").first().getAttribute("aria-label");
t("aria-label con el nombre", label === "Azul/Rojo", label);
const bg = await page.locator("#color-options .color-opt .dot-fill").first().evaluate(e => getComputedStyle(e).backgroundImage);
t("circulo partido en 2 tonos", /linear-gradient/.test(bg), bg);
const br0 = await page.locator("#color-options .color-opt .dot-fill").first().evaluate(e => getComputedStyle(e).borderRadius);
t("redondo (50%)", br0.includes("50%") || parseFloat(br0) >= 10, br0);
await page.locator("#color-options .color-opt").nth(1).click();
t("al elegir queda activo", await page.locator("#color-options .color-opt.active").count() === 1);
await page.screenshot({ path: "/tmp/claude-0/x/pdp-trooper.png", clip: { x: 560, y: 100, width: 640, height: 520 } });

// 2. camiseta con talla x color (combos)
await page.goto(`${B}/producto/camiseta-fate-bmx.html`, { waitUntil: "networkidle" });
const sizeTxt = await page.locator("#size-options").innerText();
t("tallas con texto (M, L)", /M/.test(sizeTxt) && /L/.test(sizeTxt), sizeTxt);
await page.locator("#color-options .color-opt").nth(1).click();   // Negro
const lDisabled = await page.locator('#size-options [data-size="L"]').isDisabled();
t("Negro: la talla L (sin stock en negro) se desactiva", lDisabled);
const mDisabled = await page.locator('#size-options [data-size="M"]').isDisabled();
t("Negro: la talla M sigue disponible", !mDisabled);
await page.locator("#color-options .color-opt").nth(0).click();   // Blanco
t("Blanco: la talla L se habilita", !(await page.locator('#size-options [data-size="L"]').isDisabled()));
t("sin errores JS", errs.length === 0, errs.join("|"));

// 3. redireccion
await page.goto(`${B}/producto/pedales-rant-trill-rojo.html`, { waitUntil: "networkidle" });
t("enlace viejo redirige a la ficha nueva", page.url().endsWith("/producto/pedales-rant-trill.html"), page.url());
t("la ficha nueva muestra 4 colores", await page.locator("#color-options .color-opt").count() === 4);

// 4. tienda: tarjetas con circulos
await page.goto(`${B}/tienda.html?cat=repuestos&sub=Pedales`, { waitUntil: "networkidle" });
const cards = await page.locator(".swatch-row.dots .cdot").count();
t("tarjetas muestran circulos de color", cards > 0, cards);
t("sin errores JS (tienda)", errs.length === 0, errs.join("|"));
await page.screenshot({ path: "/tmp/claude-0/x/tienda-pedales.png" });
await br.close();
