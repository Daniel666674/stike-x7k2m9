/* =========================================================================
   Prueba del armador (armar.html): pasos por pieza real, cantidades,
   compatibilidad, corazas por par, carrito y link compartido.

     python3 -m http.server 8143   (en la raiz del repo)
     node tools/armar-test.mjs

   Cada caso es una regla de "armar bien una BMX": si alguien la rompe, esta
   prueba se pone en rojo antes de que el cliente arme una bici que no encaja.
   ========================================================================= */
import { createRequire } from "node:module";
const require = createRequire(process.env.PW_MODULES || "/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const B = "http://localhost:8143";
const br = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
let fail = 0;
const t = (l, ok, x = "") => { if (!ok) fail++; console.log((ok ? "ok    " : "FALLA ") + l + (ok ? "" : "  -> " + x)); };

const page = await br.newPage({ viewport: { width: 1300, height: 900 } });
const errs = [];
page.on("pageerror", e => errs.push(e.message));
page.on("dialog", d => d.accept());
await page.addInitScript(() => {
  if (!sessionStorage.getItem("armar-test-init")) { sessionStorage.setItem("armar-test-init", "1"); try { localStorage.clear(); } catch (e) {} }
  document.addEventListener("DOMContentLoaded", () => { const st = document.createElement("style"); st.textContent = "[class*=cookie],#newsletter-overlay{display:none!important}"; document.head.appendChild(st); });
});
await page.goto(`${B}/armar.html`, { waitUntil: "networkidle" });

const ev = (fn, arg) => page.evaluate(fn, arg);
const bySlug = async (re) => ev(r => STIKE_PRODUCTS.find(p => new RegExp(r, "i").test(p.n)).slug, re);
/* Elige una pieza en un paso por el nombre (igual que un clic en la tarjeta). */
const pick = async (key, nameRe) => {
  const idx = await ev(k => ACTIVE_STEPS.findIndex(s => s.key === k), key);
  await ev(i => { current = i; renderAll(); }, idx);
  const slug = await bySlug(nameRe);
  await page.locator(`.boption[data-pick="${slug}"]`).first().click();
};
const warns = () => ev(() => compat(build).filter(w => w.level === "warn").map(w => w.text));
const reset = () => ev(() => { build = {}; skipped = {}; current = 0; renderAll(); });

console.log("\nLenguaje correcto");
const text = await page.locator("body").innerText();
t("la página dice Pegs, no 'tacos'", !/\btacos?\b/i.test(text), (text.match(/.{20}\btacos?\b.{20}/i) || [""])[0]);
t("la página no dice 'espigas'", !/espigas?/i.test(text));
t("la página no dice 'maza'", !/\bmazas?\b/i.test(text));
const labels = await ev(() => ACTIVE_STEPS.map(s => s.label));
t("hay Manzana delantera y trasera", labels.includes("Manzana delantera") && labels.includes("Manzana trasera"), labels.join("|"));
t("hay Caña (stem)", labels.includes("Caña (stem)"));
t("hay Pegs", labels.includes("Pegs"));
t("hay aro y coraza delanteros y traseros", ["Aro delantero", "Aro trasero", "Coraza delantera", "Coraza trasera"].every(l => labels.includes(l)));
t("hay caja de centro y bielas por separado", labels.includes("Caja de centro") && labels.includes("Bielas"));
t("hay 4 grupos de pasos", (await page.locator(".bgroup").count()) === 4);

console.log("\nCada paso trae solo piezas de ese tipo");
const wrong = await ev(() => {
  const bad = [];
  ACTIVE_STEPS.forEach(s => optionsFor(s).forEach(p => {
    if (s.key === "biela" && !/^(bielas|brazos)/i.test(p.n)) bad.push(s.key + ":" + p.n);
    if (s.key === "bb" && !/caja de centro|rodamiento/i.test(p.n)) bad.push(s.key + ":" + p.n);
    if (/^aro/.test(s.key) && !/^aro/i.test(p.n)) bad.push(s.key + ":" + p.n);
    if (/^cor/.test(s.key) && !/coraza/i.test(p.n)) bad.push(s.key + ":" + p.n);
    if (s.key === "silla" && !/^silla/i.test(p.n)) bad.push(s.key + ":" + p.n);
    if (s.key === "poste" && !/^poste/i.test(p.n)) bad.push(s.key + ":" + p.n);
    if (s.key === "pegs" && !/^peg/i.test(p.n)) bad.push(s.key + ":" + p.n);
  }));
  return bad;
});
t("ningún paso mezcla piezas", wrong.length === 0, wrong.join(" | "));

console.log("\nCompatibilidad");
await reset();
await pick("biela", "Bielas Fiend Segment 22mm");
await pick("bb", "Caja de Centro Demolition Bearing Kits 1024mm");
t("bielas 22 mm + caja 24 mm -> aviso", (await warns()).some(w => /22 mm/.test(w) && /24 mm/.test(w)), JSON.stringify(await warns()));
t("el aviso también sale arriba, junto a las piezas", await page.locator("#compat-top").isVisible() && /no encajan/.test(await page.locator("#compat-top").innerText()));
await pick("bb", "Caja de Centro Fiend Mid 22mm Ransom");
t("bielas 22 mm + caja 22 mm -> sin aviso", (await warns()).length === 0 && !(await page.locator("#compat-top").isVisible()), JSON.stringify(await warns()));
await reset();
await pick("biela", "Bielas Federal Vice");
await pick("bb", "Caja de Centro Fiend Mid 22mm Ransom");
t("bielas que ya traen caja -> nota, no error", (await ev(() => compat(build).some(w => w.level === "info" && /ya trae/.test(w.text)))) && (await warns()).length === 0);
await reset();
await pick("tenedor", "Tenedor Fiend Process IC V2 20mm");
await pick("manDel", "Manzana Delantera Optimus");
t("tenedor eje 20 mm + manzana delantera 3/8\" -> aviso", (await warns()).some(w => /eje/i.test(w)), JSON.stringify(await warns()));
await reset();
await pick("tenedor", "Tenedor Fiend Invest V2 26mm");
await pick("manDel", "Manzana Delantera Optimus");
t("tenedor 3/8\" + manzana 3/8\" -> sin aviso", (await warns()).length === 0, JSON.stringify(await warns()));
await reset();
await pick("corDel", "Coraza Innova Militar Camuflada 26x2.2");
t("coraza de 26\" -> aviso (la BMX rueda 20\")", (await warns()).some(w => /26/.test(w)), JSON.stringify(await warns()));
await reset();
await pick("plato", "Plato Fiend Reynolds 25T Sin Guardia");
await pick("manTra", "Manzana Trasera Federal Derecha Negra 9T");
t("plato 25T + piñón 9T -> muestra relación 2.78", await ev(() => compat(build).some(w => /2\.78/.test(w.text))));
await reset();
await pick("hgTra", "Protector de Manzana Trasera Odyssey Clutch V2");
await pick("manTra", "Manzana Trasera Federal Derecha Negra 9T");
t("protector Odyssey Clutch + manzana Federal -> aviso", (await warns()).some(w => /Odyssey/i.test(w)), JSON.stringify(await warns()));

console.log("\nCantidades y precio");
await reset();
await pick("pegs", "Peg Fiend Belmont Cromo 4.4mm");
const price = await ev(() => stikeFindProduct(build.pegs.slug).price);
t("2 pegs por defecto", (await ev(() => build.pegs.qty)) === 2);
t("el total multiplica por 2", (await ev(() => buildTotal())) === price * 2, String(await ev(() => buildTotal())));
await ev(() => { current = ACTIVE_STEPS.findIndex(s => s.key === "pegs"); renderAll(); });
await page.locator('[data-qty="4"]').click();
t("4 pegs -> total x4", (await ev(() => buildTotal())) === price * 4);
t("el resumen dice '4 ×'", /4 ×/.test(await page.locator("#build-list").innerText()));

console.log("\nCorazas que se venden por par");
await reset();
await pick("corDel", "Coraza Merritt Phantom 2.50 \\(Par\\)");
const pairState = await ev(() => ({ del: build.corDel && build.corDel.slug, tra: build.corTra && build.corTra.slug, dup: build.corTra && build.corTra.dup, total: buildTotal(), price: stikeFindProduct(build.corDel.slug).price }));
t("el par cubre delantera y trasera", pairState.del === pairState.tra && pairState.dup === true, JSON.stringify(pairState));
t("el par se cobra una sola vez", pairState.total === pairState.price, JSON.stringify(pairState));
await pick("corTra", "Coraza Innova Pro J-Box");
t("cambiar la trasera por otra coraza deja el par completo en la delantera", await ev(() => build.corDel && !build.corDel.dup && build.corTra.slug.includes("j-box")));
await reset();
await pick("corDel", "Coraza Merritt Phantom 2.50 \\(Par\\)");
await pick("corDel", "Coraza Innova Pro J-Box");
t("cambiar la delantera libera la trasera cubierta", await ev(() => !build.corTra));

console.log("\nInventario");
await reset();
const two = await ev(() => { const p = STIKE_PRODUCTS.filter(x => /^aro/i.test(x.n) && typeof x.units === "number" && x.units === 1)[0]; return p ? p.slug : null; });
if (two) {
  await ev(s => { build.aroDel = { slug: s }; build.aroTra = { slug: s }; renderAll(); }, two);
  t("el mismo aro en las dos ruedas con 1 en bodega -> aviso de inventario", (await warns()).some(w => /solo quedan 1/i.test(w)), JSON.stringify(await warns()));
} else console.log("      (sin aro de 1 unidad: se omite)");

console.log("\nAleatorio, carrito y link");
await reset();
await page.locator("#b-random").click();
const rnd = await ev(() => ({ warns: compat(build).filter(w => w.level === "warn").length, req: REQUIRED().length, have: chosenCount() }));
t("armar al azar elige todos los obligatorios", rnd.have === rnd.req, JSON.stringify(rnd));
t("armar al azar no genera avisos", rnd.warns === 0, JSON.stringify(rnd));
const url = await ev(() => buildShareURL());
const canon = o => JSON.stringify(o, (k, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v);
const before = await ev(() => JSON.stringify(build));
await page.goto(url, { waitUntil: "networkidle" });
const after = await ev(() => JSON.stringify(build));
t("el link compartido reconstruye la misma bici", canon(JSON.parse(after)) === canon(JSON.parse(before)), before.slice(0, 120) + " vs " + after.slice(0, 120));
await page.evaluate(() => { localStorage.removeItem("stike_cart_v1"); });
await reset();
await pick("pegs", "Peg Fiend Belmont Cromo 4.4mm");
await page.locator("#add-build").click();
await page.waitForTimeout(1200);
const cart = await page.evaluate(() => JSON.parse(localStorage.getItem("stike_cart_v1") || "[]"));
t("al meter todo al carrito van los 2 pegs", Array.isArray(cart) && cart.some(r => /peg-fiend-belmont/.test(r.slug) && r.qty === 2), JSON.stringify(cart).slice(0, 200));

t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
await br.close();
console.log(fail ? `\n${fail} falla(s)` : "\nTodo bien");
process.exit(fail ? 1 : 0);
