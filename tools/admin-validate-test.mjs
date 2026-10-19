/* =========================================================================
   Prueba de "Publicar cambios" del admin: la validacion NO debe bloquear por
   problemas que no tienen que ver con lo que la persona editó.

     python3 -m http.server 8143   (en la raiz del repo)
     node tools/admin-validate-test.mjs

   validateCatalog() revisa el catalogo COMPLETO antes de publicar. Si alguien
   deja un producto mal (por ejemplo un borrador sin foto, o un precio base que
   no es el mas bajo), CUALQUIER publicacion queda bloqueada con una lista de
   "No se puede publicar" que no tiene que ver con el cambio. Esta prueba:
     1. hace un cambio cualquiera sobre el catalogo REAL y publica: no debe
        salir la lista de errores;
     2. comprueba las reglas sobre productos sueltos.
   ========================================================================= */
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(process.env.PW_MODULES || "/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const ROOT = process.cwd(), B = "http://localhost:8143";
const br = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
let fail = 0;
const t = (l, ok, x = "") => { if (!ok) fail++; console.log((ok ? "ok    " : "FALLA ") + l + (ok ? "" : "  -> " + x)); };
const page = await br.newPage({ viewport: { width: 1300, height: 900 } });
const errs = []; page.on("pageerror", e => errs.push(e.message));
page.on("dialog", d => d.accept());
await page.route("**/api/admin-login", r => r.fulfill({ json: { email: "x@test.com", role: "owner" } }));
await page.route("**/api/admin-health", r => r.fulfill({ json: { ok: true } }));
await page.route("**/api/sales", r => r.fulfill({ json: [] }));
await page.route("**/api/gh?**", r => { const path = new URL(r.request().url()).searchParams.get("path"); const f = ROOT + "/" + path; if (r.request().method() !== "GET") return r.fulfill({ json: { content: { sha: "n" }, commit: { sha: "c" } } }); return fs.existsSync(f) ? r.fulfill({ json: { sha: "s", content: fs.readFileSync(f).toString("base64") } }) : r.fulfill({ status: 404, json: {} }); });
await page.goto(B + "/admin.html", { waitUntil: "networkidle" }); await page.waitForTimeout(800);

console.log("\nEl catalogo real");
const real = await page.evaluate(() => validateCatalog(JSON.parse(JSON.stringify(window.STIKE_PRODUCTS))));
t("se puede publicar (0 errores)", real.length === 0, real.join(" | "));

console.log("\nPublicar un cambio cualquiera");
await page.fill("#p-search", "Timón Fiend Reynolds"); await page.waitForTimeout(300);
await page.locator('[data-edit="timon-fiend-reynolds"]').first().click(); await page.waitForTimeout(300);
await page.fill("#ed-price", "351000"); await page.dispatchEvent("#ed-price", "input");
await page.locator("#ed-save").click(); await page.waitForTimeout(300);
t("el botón Publicar cambios se activa", await page.locator("#btn-publish").isEnabled());
await page.locator("#btn-publish").click(); await page.waitForTimeout(1500);
t("NO sale la lista 'No se puede publicar'", (await page.locator("#validation-errors").count()) === 0, await page.locator("#validation-errors").innerText().catch(() => ""));

console.log("\nReglas sobre productos sueltos");
const base = { slug: "x", sku: "X-1", n: "X", brand: "B", cat: "repuestos", sub: "Marcos", price: 1000, units: 1, imgs: ["a.jpg"], published: true };
const v = o => page.evaluate(p => validateCatalog([p]), Object.assign({}, base, o));
t("un producto completo pasa", (await v({})).length === 0);
t("un borrador sin foto NO bloquea", (await v({ imgs: [], published: false })).length === 0);
t("un publicado sin foto SI bloquea", (await v({ imgs: [] })).some(e => /falta la foto/.test(e)));
t("una opción más barata que el base bloquea", (await v({ colors: [{ v: "A", u: 1 }, { v: "B", u: 1, price: 500 }], units: undefined })).some(e => /más bajo/.test(e)));
t("base = el más bajo pasa", (await v({ colors: [{ v: "A", u: 1, price: 1500 }, { v: "B", u: 1 }], units: undefined })).length === 0);

t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
await br.close();
console.log(fail ? `\n${fail} falla(s)` : "\nTodo bien");
process.exit(fail ? 1 : 0);
