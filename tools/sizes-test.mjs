/* Prueba de productos agrupados por medida (dientes, largo) x color. Servir el repo en :8143 (python3 -m http.server 8143): node tools/sizes-test.mjs */
import { createRequire } from "node:module";
const require = createRequire(process.env.PW_MODULES || "/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const B = "http://localhost:8143";
const br = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await br.newPage({ viewport: { width: 1200, height: 900 } });
const errs = []; page.on("pageerror", e => errs.push(e.message));
let fail = 0; const t = (l, ok, x = "") => { if (!ok) fail++; console.log((ok ? "ok    " : "FALLA ") + l + (ok ? "" : "  -> " + x)); };
const dis = async (sel) => page.locator(sel).isDisabled();

// Omicron: Dientes x Color
await page.goto(`${B}/producto/plato-fiend-omicron.html`, { waitUntil: "networkidle" });
t("etiqueta 'Dientes'", /DIENTES/i.test(await page.locator('[data-variant="size"] .size-label').innerText()));
t("botones 25T y 28T con texto", (await page.locator("#size-options").innerText()).replace(/\s+/g, " ").trim() === "25T 28T", await page.locator("#size-options").innerText());
t("2 circulos de color", await page.locator("#color-options .color-opt").count() === 2);
await page.locator('#size-options [data-size="28T"]').click();
await page.locator("#color-options .color-opt").nth(0).click();
t("28T + cromado: se puede agregar", await page.locator("#add-to-cart, [data-add-cart], .btn.cyan").first().isEnabled());

// Omicron Guard: solo existen 26T cromado y 28T negro
await page.goto(`${B}/producto/plato-fiend-omicron-guard.html`, { waitUntil: "networkidle" });
await page.locator('#size-options [data-size="26T"]').click();
t("26T: solo queda el color cromado", await dis('#color-options [data-color="Negro"]') && !(await dis('#color-options [data-color="Cromado"]')));
await page.locator('#color-options [data-color="Cromado"]').click();
t("al elegir cromado, 28T se desactiva", await dis('#size-options [data-size="28T"]'));

// Marco con medida + color
await page.goto(`${B}/producto/marco-fiend-shapershifter-320.html`, { waitUntil: "networkidle" });
t("marco: etiqueta Medida", /MEDIDA/i.test(await page.locator('[data-variant="size"] .size-label').innerText()));
await page.locator('#color-options [data-color="Gris mate"]').click();
t("gris mate: solo la medida 20.75", await dis('#size-options [data-size="20.5"]') && !(await dis('#size-options [data-size="20.75"]')));
await page.locator('#color-options [data-color="Gris mate"]').click().catch(() => {});

// Marco Fate: solo medidas
await page.goto(`${B}/producto/marco-fate-namaste-v2.html`, { waitUntil: "networkidle" });
t("Fate: medidas 20.4 y 20.75", (await page.locator("#size-options").innerText()).replace(/\s+/g, " ").trim() === "20.4 20.75");
t("Fate: sin selector de color", await page.locator("#color-options").count() === 0);

// Poste
await page.goto(`${B}/producto/poste-pivotal-optimus.html`, { waitUntil: "networkidle" });
t("poste: Corto / Largo", (await page.locator("#size-options").innerText()).replace(/\s+/g, " ").trim() === "Corto Largo");
t("poste: etiqueta Largo", /LARGO/i.test(await page.locator('[data-variant="size"] .size-label').innerText()));

// Mensaje al agregar sin elegir
await page.goto(`${B}/producto/plato-fiend-omicron.html`, { waitUntil: "networkidle" });
await page.locator("button:has-text('Agregar al carrito')").first().click();
t("sin elegir: pide los dientes", /dientes/i.test(await page.locator("#size-req").innerText()), await page.locator("#size-req").innerText());

// redirect de una ficha vieja
await page.goto(`${B}/producto/plato-fiend-omicron-28t.html`, { waitUntil: "networkidle" });
t("enlace viejo -> ficha agrupada", page.url().endsWith("/producto/plato-fiend-omicron.html"), page.url());
await page.goto(`${B}/producto/plato-fiend-omicron-cromado-25t.html`, { waitUntil: "networkidle" });
t("enlace viejo (cadena) -> ficha agrupada", page.url().endsWith("/producto/plato-fiend-omicron.html"), page.url());

// tienda: una sola tarjeta por producto
await page.goto(`${B}/tienda.html?cat=repuestos&sub=Platos`, { waitUntil: "networkidle" });
const names = await page.locator(".card .title a").allTextContents();
t("tienda: Omicron aparece una vez", names.filter(n => /omicron/i.test(n)).length === 2, names.filter(n => /omicron/i.test(n)).join(" | "));
t("sin errores JS", errs.length === 0, errs.join("|"));
await br.close(); process.exit(fail ? 1 : 0);
