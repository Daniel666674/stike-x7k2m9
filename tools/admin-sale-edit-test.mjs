/* =========================================================================
   Panel > Ventas: (1) CORREGIR el precio de una venta ya registrada y
   (2) registrar la venta de un producto que NO esta en la pagina.

   Pedido del equipo de la tienda: «cuando genero la venta me equivoco con el precio y no se
   puede editar» y «si el producto no esta en la pagina, poder registrarlo ahi mismo, una sola
   vez, sin crearlo». Se prueba con un GitHub simulado que lleva la cuenta de las versiones
   (sha) de data/sales-log.json y data/audit-log.json, y que anota todo lo que se escribe:
   asi se ve que NO se toca el catalogo ni el stock.

     python3 -m http.server 8143   (en la raiz del repo)
     node tools/admin-sale-edit-test.mjs
   ========================================================================= */
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(process.env.PW_MODULES || "/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const ROOT = process.cwd(), B = "http://localhost:8143";
let fail = 0;
const t = (l, ok, x = "") => { if (!ok) fail++; console.log((ok ? "ok    " : "FALLA ") + l + (ok ? "" : "  -> " + x)); };
const br = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const wait = ms => new Promise(r => setTimeout(r, ms));

const now = Date.now();
const iso = ms => new Date(now - ms).toISOString();
const GRIPS = { ts: iso(3 * 3600e3), slug: "grips-odi-soft-negros", name: "Grips ODI Soft Negros", size: null, color: null, qty: 1, unitPrice: 150000, total: 150000, admin: "tienda@test.com", source: "tienda" };
const DISC = { ts: iso(2 * 3600e3), slug: "grips-odi-soft-negros", name: "Grips ODI Soft Negros", size: null, color: null, qty: 2, unitPrice: 60000, total: 110000, discount: 10000, admin: "tienda@test.com", source: "tienda", invoice: 3790, payment: "Efectivo" };
const ONLINE = { ts: iso(3600e3), slug: "grips-odi-soft-negros", name: "Grips ODI Soft Negros", qty: 1, unitPrice: 60000, total: 60000, source: "wompi", orderRef: "stike-1-aaaa", wompiId: "txn-1", admin: "Wompi (ref stike-1-aaaa)", customerEmail: "c@x.com", shipping: { name: "Cliente", phone: "3001112233", address: "Calle 1", city: "Bogota" }, shippingAck: true };
const EVIL = `<img src=x onerror="window.__pwned=1">`;

/* GitHub simulado: lo que se lee, lo que se escribe y las versiones (sha). */
async function open(role, { sales = [GRIPS, DISC], conflictOnce = false, online = [ONLINE] } = {}) {
  const page = await br.newPage({ viewport: { width: 1300, height: 1100 } });
  const errs = []; page.on("pageerror", e => errs.push(e.message));
  const dialogs = []; page.on("dialog", d => { dialogs.push(d.message()); d.dismiss(); });
  const st = { files: { "data/sales-log.json": { text: JSON.stringify(sales), sha: "sha1" }, "data/audit-log.json": { text: "[]", sha: "aud1" }, "data/stock-applied.json": { text: JSON.stringify(["wompi:stike-1-aaaa"]), sha: "led1" } }, puts: [], n: 1, conflictOnce, onlineSales: online };
  await page.route("**/api/admin-login", r => r.fulfill({ json: { email: role + "@test.com", role } }));
  await page.route("**/api/admin-health", r => r.fulfill({ json: { ok: true, ready: true, checks: [] } }));
  await page.route("**/api/sales", r => r.fulfill({ json: st.onlineSales }));
  await page.route("**/api/gh?**", r => {
    const path = new URL(r.request().url()).searchParams.get("path"), method = r.request().method();
    if (method === "GET") {
      if (st.files[path]) return r.fulfill({ json: { sha: st.files[path].sha, content: Buffer.from(st.files[path].text).toString("base64") } });
      const f = ROOT + "/" + path;
      return fs.existsSync(f) ? r.fulfill({ json: { sha: "s", content: fs.readFileSync(f).toString("base64") } }) : r.fulfill({ status: 404, json: {} });
    }
    const body = r.request().postDataJSON(), text = Buffer.from(body.content || "", "base64").toString("utf8");
    st.puts.push({ path, message: body.message, text, sha: body.sha });
    if (path === "data/sales-log.json" && st.conflictOnce) { st.conflictOnce = false; return r.fulfill({ status: 409, json: { message: "conflict" } }); }
    if (st.files[path]) {
      if (body.sha !== st.files[path].sha) return r.fulfill({ status: 409, json: { message: "sha" } });
      st.files[path] = { text, sha: "sha" + (++st.n) };
      return r.fulfill({ json: { content: { sha: st.files[path].sha }, commit: { sha: "c" } } });
    }
    return r.fulfill({ json: { content: { sha: "n" }, commit: { sha: "c" } } });
  });
  await page.goto(B + "/admin.html", { waitUntil: "networkidle" }); await page.waitForTimeout(800);
  await page.evaluate(() => switchPanel("ventas"));
  await page.waitForSelector("#sales-tbody tr[data-sale-idx]");
  const log = () => JSON.parse(st.files["data/sales-log.json"].text);
  const salePuts = () => st.puts.filter(p => p.path === "data/sales-log.json");
  const catalogPuts = () => st.puts.filter(p => /products-data|data\/costs|producto\//.test(p.path));
  const rowOf = txt => page.locator("#sales-tbody tr", { hasText: txt }).first();
  const status = () => page.locator("#status-box").innerText();
  return { page, errs, dialogs, st, log, salePuts, catalogPuts, rowOf, status };
}

/* ============================================================ 1. CORREGIR UNA VENTA ============================================================ */
console.log("\nCorregir el precio de una venta ya registrada");
{
  const { page, errs, st, log, salePuts, catalogPuts, status } = await open("staff");
  // fila de la venta de $150.000 (la mas vieja de las dos de tienda)
  await page.locator("#sales-tbody tr", { hasText: "$150.000" }).first().click();
  await page.waitForSelector("#confirm-modal .sale-prod");
  t("en el detalle de una venta de tienda aparece «Corregir venta»", (await page.locator("#sd-edit").count()) === 1 && /Corregir venta/.test(await page.locator("#sd-edit").innerText()));
  await page.click("#sd-close"); await wait(100);
  await page.locator("#sales-tbody tr", { hasText: "Wompi" }).first().click();
  await page.waitForSelector("#confirm-modal .sale-prod");
  const detail = await page.locator("#confirm-modal").innerText();
  t("en una venta ONLINE (Wompi) no hay botón de corregir: refleja lo que el cliente pagó", /Pago \(Wompi\)/i.test(detail) && (await page.locator("#sd-edit").count()) === 0, detail.slice(0, 200));
  await page.click("#sd-close"); await wait(100);

  await page.locator("#sales-tbody tr", { hasText: "$150.000" }).first().click();
  await page.waitForSelector("#confirm-modal .sale-prod");
  await page.click("#sd-edit"); await page.waitForSelector("#se-price");
  const m0 = await page.locator("#confirm-modal").innerText();
  t("el formulario trae el precio actual y explica que de una venta del catálogo solo se corrige el precio (la cantidad ya descontó stock)", (await page.locator("#se-price").inputValue()) === "150000" && /solo el precio/.test(m0) && /ya se descontó el stock/.test(m0) && (await page.locator("#se-qty").count()) === 0, m0);
  t("«Guardar corrección» está apagado mientras no se cambie nada", await page.locator("#se-save").isDisabled());
  await page.fill("#se-price", "0");
  t("un precio de 0 se rechaza con un mensaje claro", /más de \$0/.test(await page.locator("#se-msg").innerText()) && await page.locator("#se-save").isDisabled());
  await page.fill("#se-price", "");
  t("sin precio tampoco se puede guardar", await page.locator("#se-save").isDisabled());
  await page.fill("#se-price", "105000");
  t("al escribir el precio nuevo muestra cómo queda el total (antes → ahora) y habilita guardar", /\$150\.000/.test(await page.locator("#se-diff").innerText()) && /\$105\.000/.test(await page.locator("#se-diff").innerText()) && !(await page.locator("#se-save").isDisabled()));
  await page.click("#se-cancel"); await wait(150);
  t("«Cancelar» vuelve al detalle sin escribir nada", (await page.locator("#sd-edit").count()) === 1 && st.puts.length === 0);

  await page.click("#sd-edit"); await page.fill("#se-price", "105000");
  await page.click("#se-save");
  await page.waitForSelector("#confirm-modal .sale-prod");
  await wait(500);
  const sp = salePuts();
  t("se escribió el historial de ventas UNA vez", sp.length === 1, String(sp.length));
  const arr = log(), fixed = arr.find(s => s.ts === GRIPS.ts), other = arr.find(s => s.ts === DISC.ts);
  t("la venta quedó con el precio y el total nuevos", fixed.unitPrice === 105000 && fixed.total === 105000, JSON.stringify(fixed));
  t("lo demás de esa venta no cambió (producto, cantidad, vendedor, origen)", fixed.slug === GRIPS.slug && fixed.qty === 1 && fixed.admin === "tienda@test.com" && fixed.source === "tienda" && fixed.name === GRIPS.name);
  t("las otras ventas quedaron igual y no se perdió ninguna", arr.length === 2 && JSON.stringify(other) === JSON.stringify(DISC));
  const e1 = fixed.edits && fixed.edits[0];
  t("la corrección queda anotada en la propia venta: quién (correo de la sesión), cuándo y antes → después", !!e1 && e1.by === "staff@test.com" && !isNaN(Date.parse(e1.ts)) && JSON.stringify(e1.changes.unitPrice) === "[150000,105000]" && JSON.stringify(e1.changes.total) === "[150000,105000]", JSON.stringify(e1));
  t("el mensaje del commit dice que es una corrección de venta", /Corrección de venta/.test(sp[0].message), sp[0].message);
  const aud = JSON.parse(st.files["data/audit-log.json"].text);
  t("también queda en Auditoría: «Corrigió una venta …» con el antes y el después", aud.length === 1 && /Corrigió una venta/.test(aud[0].summary) && /\$150\.000 → \$105\.000/.test(aud[0].summary) && aud[0].admin === "staff@test.com" && aud[0].saleEdit === true, JSON.stringify(aud));
  t("NO se tocó el catálogo ni el stock", catalogPuts().length === 0, JSON.stringify(catalogPuts().map(p => p.path)));
  const m1 = await page.locator("#confirm-modal").innerText();
  t("al guardar se muestra el detalle ya corregido, con la sección «Correcciones» (quién y qué cambió)", /\$105\.000/.test(m1) && /Correcciones/i.test(m1) && /staff@test\.com/.test(m1) && /Precio: \$150\.000 → \$105\.000/.test(m1), m1);
  t("el aviso de abajo dice que la venta quedó corregida", /Venta corregida/.test(await status()), await status());
  await page.click("#sd-close"); await wait(150);
  const row = await page.locator("#sales-tbody tr", { hasText: "$105.000" }).first().innerText();
  t("el historial muestra el total nuevo y la etiqueta «corregida»", /corregida/i.test(row) && /\$105\.000/.test(row), row);
  await page.evaluate(() => switchPanel("auditoria")); await wait(150);
  t("en la pestaña Auditoría aparece la corrección", /Corrigió una venta/.test(await page.locator("#audit-tbody").innerText()));
  t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
  await page.close();
}

console.log("\nCorrección con descuento y factura");
{
  const { page, log, st } = await open("owner");
  await page.locator("#sales-tbody tr", { hasText: "$110.000" }).first().click();
  await page.waitForSelector("#confirm-modal .sale-prod");
  await page.click("#sd-edit"); await page.waitForSelector("#se-price");
  const m = await page.locator("#confirm-modal").innerText();
  t("avisa del descuento que se mantiene y de la factura impresa que ya no coincidirá", /descuento de \$10\.000/.test(m) && /factura Nº 3790/.test(m) && /no va a coincidir/.test(m), m);
  await page.fill("#se-price", "50000");
  t("el total nuevo respeta el descuento: 2 × $50.000 − $10.000 = $90.000", /\$110\.000/.test(await page.locator("#se-diff").innerText()) && /\$90\.000/.test(await page.locator("#se-diff").innerText()), await page.locator("#se-diff").innerText());
  await page.click("#se-save"); await page.waitForSelector("#confirm-modal .sale-prod"); await wait(400);
  const fixed = log().find(s => s.ts === DISC.ts);
  t("queda unitPrice 50.000, total 90.000, el descuento y la factura intactos", fixed.unitPrice === 50000 && fixed.total === 90000 && fixed.discount === 10000 && fixed.invoice === 3790 && fixed.payment === "Efectivo", JSON.stringify(fixed));
  // un precio tan bajo que el descuento pasaría del subtotal: el descuento se recorta (nunca total negativo)
  await page.click("#sd-edit"); await page.fill("#se-price", "1000");
  await page.click("#se-save"); await page.waitForSelector("#confirm-modal .sale-prod"); await wait(400);
  const f2 = log().find(s => s.ts === DISC.ts);
  t("si el descuento ya no cabe en el subtotal se recorta y el total nunca queda negativo", f2.total === 0 && f2.discount === 2000 && f2.edits.length === 2, JSON.stringify(f2));
  await page.close();
}

console.log("\nChoques con otra persona");
{
  // 1) alguien escribió el historial justo antes: el panel reintenta con la versión nueva y no pierde lo que escribió el otro
  const { page, log, salePuts, st } = await open("owner", { conflictOnce: true });
  await page.locator("#sales-tbody tr", { hasText: "$150.000" }).first().click();
  await page.waitForSelector("#confirm-modal .sale-prod");
  await page.click("#sd-edit"); await page.fill("#se-price", "140000");
  // mientras tanto otra persona anota una venta nueva en el historial (el sha cambia)
  const other = { ts: iso(1000), slug: "otro", name: "Otra venta", size: null, color: null, qty: 1, unitPrice: 9000, total: 9000, admin: "otro@test.com", source: "tienda" };
  st.files["data/sales-log.json"] = { text: JSON.stringify([...log(), other]), sha: "sha-otro" };
  await page.click("#se-save"); await page.waitForSelector("#confirm-modal .sale-prod"); await wait(900);
  const arr = log();
  t("tras el choque (409) reintenta con la versión más nueva: la corrección queda y la venta de la otra persona NO se pierde", arr.length === 3 && arr.find(s => s.ts === GRIPS.ts).unitPrice === 140000 && arr.some(s => s.ts === other.ts), JSON.stringify(arr.map(s => s.unitPrice)));
  t("fueron dos intentos de escritura (el primero chocó)", salePuts().length === 2, String(salePuts().length));
  await page.close();
}
{
  // 2) otra persona ya cambió ESA venta mientras se editaba: no se pisa su cambio
  const { page, log, salePuts, st } = await open("owner");
  await page.locator("#sales-tbody tr", { hasText: "$150.000" }).first().click();
  await page.waitForSelector("#confirm-modal .sale-prod");
  await page.click("#sd-edit"); await page.fill("#se-price", "140000");
  st.files["data/sales-log.json"] = { text: JSON.stringify(log().map(s => s.ts === GRIPS.ts ? { ...s, unitPrice: 120000, total: 120000 } : s)), sha: "sha-otro" };
  await page.click("#se-save"); await wait(700);
  t("si esa venta ya la cambió otra persona, avisa «cambió mientras la editabas» y NO escribe", /cambió mientras la editabas/.test(await page.locator("#se-msg").innerText()) && salePuts().length === 0, await page.locator("#se-msg").innerText());
  t("y el formulario sigue abierto para poder cerrarlo (los botones no quedan trabados)", !(await page.locator("#se-cancel").isDisabled()));
  await page.close();
}

/* ============================================================ 2. VENTA DE UN PRODUCTO QUE NO ESTA EN LA PAGINA ============================================================ */
console.log("\nRegistrar una venta de un producto que no está en la página");
{
  const { page, errs, st, log, salePuts, catalogPuts, status, rowOf } = await open("staff");
  t("debajo del buscador hay un enlace «¿El producto no está en la página? Registrar una venta de otro producto»", /no está en la página/i.test(await page.locator("#offcat-link").innerText()) && (await page.locator("#offcat").isHidden()));
  await page.click("#offcat-open");
  t("al abrirlo se ve el formulario (qué se vendió, cantidad, precio) y se esconde la búsqueda de la página", (await page.locator("#offcat").isVisible()) && (await page.locator("#sale-catalog-part").isHidden()) && (await page.locator("#offcat-name").isVisible()));
  t("explica que no se crea el producto ni se descuenta stock", /No se crea el producto en la tienda ni se descuenta stock/.test(await page.locator("#offcat").innerText()));
  t("la factura sigue disponible debajo (mismos campos que siempre)", await page.locator("#sale-inv").isVisible());
  await page.locator("#sale-inv").uncheck();

  await page.click("#btn-registrar-offcat");
  t("registrar sin llenar nada pide qué se vendió y no escribe nada", /Escribe qué se vendió/.test(await page.locator("#offcat-msg").innerText()) && st.puts.length === 0);
  await page.fill("#offcat-name", "Cadena usada");
  await page.fill("#offcat-qty", "0");
  await page.fill("#offcat-price", "15000");
  await page.click("#btn-registrar-offcat");
  t("cantidad 0: lo dice y no escribe", /cantidad tiene que ser/.test(await page.locator("#offcat-msg").innerText()) && st.puts.length === 0);
  await page.fill("#offcat-qty", "2"); await page.fill("#offcat-price", "");
  await page.click("#btn-registrar-offcat");
  t("sin precio: lo dice y no escribe", /precio de venta/.test(await page.locator("#offcat-msg").innerText()) && st.puts.length === 0);
  await page.fill("#offcat-price", "15000");
  t("el total se calcula en vivo (2 × $15.000 = $30.000)", (await page.locator("#offcat-total").innerText()) === "$30.000");

  await page.click("#btn-registrar-offcat"); await wait(800);
  const sp = salePuts();
  t("se escribió el historial UNA vez", sp.length === 1, String(sp.length));
  const e = log().find(s => s.name === "Cadena usada");
  t("la venta queda como «fuera de la página»: producto aparte, cantidad, precio, total, vendedor y origen tienda", !!e && e.offCatalog === true && e.slug === "fuera-de-catalogo" && e.qty === 2 && e.unitPrice === 15000 && e.total === 30000 && e.admin === "staff@test.com" && e.source === "tienda" && e.size === null && e.color === null, JSON.stringify(e));
  t("no lleva factura ni forma de pago (se desmarcó «Generar factura»)", e && e.invoice === undefined && e.payment === undefined);
  t("las ventas anteriores quedaron intactas", log().length === 3 && JSON.stringify(log()[0]) === JSON.stringify(GRIPS));
  t("NO se creó ningún producto ni se tocó el stock (ningún cambio al catálogo)", catalogPuts().length === 0, JSON.stringify(catalogPuts().map(p => p.path)));
  t("el aviso dice que quedó registrada y que no se descontó stock", /Venta registrada: 2x Cadena usada/.test(await status()) && /no se creó en la tienda ni se descontó stock/.test(await status()), await status());
  t("el formulario vuelve a la búsqueda normal y queda limpio", (await page.locator("#offcat").isHidden()) && (await page.locator("#sale-catalog-part").isVisible()) && (await page.locator("#offcat-name").inputValue()) === "" && (await page.locator("#offcat-qty").inputValue()) === "1");
  const row = await rowOf("Cadena usada").innerText();
  t("en el historial sale con la etiqueta «fuera de la página» y el total", /fuera de la página/i.test(row) && /\$30\.000/.test(row), row);
  t("y se puede buscar por «fuera de la página»", await (async () => { await page.fill("#sales-q", "fuera de la pagina"); await wait(200); const n = await page.locator("#sales-tbody tr[data-sale-idx]").count(); await page.fill("#sales-q", ""); await wait(100); return n === 1; })());
  await rowOf("Cadena usada").click(); await page.waitForSelector("#confirm-modal .sale-prod");
  const d = await page.locator("#confirm-modal").innerText();
  t("el detalle dice «Producto que no está en la página (no se descontó stock)»", /no está en la página \(no se descontó stock\)/.test(d), d);
  t("tiene «Corregir venta»", (await page.locator("#sd-edit").count()) === 1);

  console.log("\nCorregir una venta de otro producto (nombre, cantidad y precio)");
  await page.click("#sd-edit"); await page.waitForSelector("#se-price");
  t("aquí sí se puede cambiar el nombre y la cantidad (no hay stock de por medio)", (await page.locator("#se-name").inputValue()) === "Cadena usada" && (await page.locator("#se-qty").inputValue()) === "2");
  await page.fill("#se-name", "Cadena KMC usada"); await page.fill("#se-qty", "3"); await page.fill("#se-price", "12000");
  t("el total nuevo se ve en vivo (3 × $12.000 = $36.000)", /\$36\.000/.test(await page.locator("#se-diff").innerText()), await page.locator("#se-diff").innerText());
  await page.click("#se-save"); await page.waitForSelector("#confirm-modal .sale-prod"); await wait(500);
  const e2 = log().find(s => s.name === "Cadena KMC usada");
  t("queda con el nombre, la cantidad y el precio nuevos, y los tres cambios anotados", !!e2 && e2.qty === 3 && e2.unitPrice === 12000 && e2.total === 36000 && e2.offCatalog === true && JSON.stringify(Object.keys(e2.edits[0].changes).sort()) === JSON.stringify(["name", "qty", "total", "unitPrice"]), JSON.stringify(e2));
  t("sigue sin tocarse el catálogo", catalogPuts().length === 0);
  t("sin errores de JavaScript", errs.length === 0, errs.join(" | "));
  await page.close();
}

console.log("\nAyudas al escribir");
{
  const { page, st } = await open("staff");
  // 1) lo que escriben se parece a algo que SI esta en la pagina
  await page.click("#offcat-open");
  await page.fill("#offcat-name", "grips odi soft");
  await wait(150);
  const sim = await page.locator("#offcat-similar").innerText();
  t("si lo escrito se parece a un producto de la página, avisa para que no se salte el descuento de stock", (await page.locator("#offcat-similar").isVisible()) && /en la página sí hay/.test(sim) && /Grips ODI/i.test(sim) && /se descuente el stock/.test(sim), sim);
  await page.click("#offcat-back"); await wait(200);
  t("«búscalo en la página» vuelve a la búsqueda con lo escrito ya puesto", (await page.locator("#sale-catalog-part").isVisible()) && (await page.locator("#sale-q").inputValue()) === "grips odi soft" && (await page.locator("#sale-results .sr-row, #sale-results [data-i]").count()) > 0);
  // 2) la busqueda no encuentra nada: ofrece registrarlo como otro producto
  await page.fill("#sale-q", "zzqxwv pieza rara"); await wait(200);
  const empty = await page.locator("#sale-results").innerText();
  t("si el buscador no encuentra nada, ofrece «Registrar … como venta de otro producto»", /No encontré/.test(empty) && /como venta de otro producto/.test(empty), empty);
  await page.locator("#sale-results [data-offcat]").dispatchEvent("mousedown");
  await wait(200);
  t("y al pulsarlo abre el formulario con el nombre ya escrito y el cursor en el precio", (await page.locator("#offcat").isVisible()) && (await page.locator("#offcat-name").inputValue()) === "zzqxwv pieza rara" && (await page.evaluate(() => document.activeElement && document.activeElement.id)) === "offcat-price");
  await page.click("#offcat-close"); await wait(100);
  t("«Volver a buscar en la página» regresa sin escribir nada", (await page.locator("#sale-catalog-part").isVisible()) && st.puts.length === 0);
  await page.close();
}

console.log("\nCon factura");
{
  const { page, log, catalogPuts } = await open("owner");
  await page.click("#offcat-open");
  await page.fill("#offcat-name", "Armado de bicicleta"); await page.fill("#offcat-qty", "1"); await page.fill("#offcat-price", "80000");
  await page.fill("#sale-c-name", "Cliente de Prueba"); await page.fill("#sale-c-disc", "5000");
  const [popup] = await Promise.all([page.waitForEvent("popup"), page.click("#btn-registrar-offcat")]);
  await wait(900);
  const e = log().find(s => s.name === "Armado de bicicleta");
  t("con «Generar factura» la venta lleva número de factura, forma de pago y descuento", !!e && e.invoice === 3791 && e.payment === "Efectivo" && e.discount === 5000 && e.total === 75000, JSON.stringify(e));
  await popup.waitForLoadState().catch(() => {});
  const html = await popup.content();
  t("se abre la factura con el nombre del producto, el cliente y el total", /Factura 3791/.test(html) && /Armado de bicicleta/.test(html) && /Cliente de Prueba/.test(html) && /\$75\.000/.test(html));
  t("sin un «código» inventado: en la columna CÓDIGO no sale «fuera-de-catalogo»", !/fuera-de-catalogo/.test(html));
  t("sin tocar el catálogo", catalogPuts().length === 0);
  await popup.close(); await page.close();
}

console.log("\nKPIs: lo vendido fuera de la página no inventa un margen");
{
  const OFF = { ts: iso(30 * 60e3), slug: "fuera-de-catalogo", name: "Pieza especial", size: null, color: null, qty: 1, unitPrice: 200000, total: 200000, admin: "tienda@test.com", source: "tienda", offCatalog: true };
  const { page } = await open("owner", { sales: [GRIPS, OFF], online: [] });
  await page.evaluate(() => switchPanel("kpis")); await wait(300);
  const k = await page.locator("#panel-kpis").innerText();
  t("los ingresos cuentan la venta de otro producto ($150.000 + $200.000)", /\$350\.000/.test(k), k.slice(0, 300));
  t("el margen NO la incluye y lo dice («sin 1 venta de otros productos»)", /sin 1 venta de otros productos/i.test(k), k.slice(0, 600));
  const top = await page.locator("#top-products-tbody").innerText();
  t("en «Top productos» sale con su nombre, la etiqueta y margen «—» (no hay costo)", /Pieza especial/.test(top) && /fuera de la página/i.test(top), top);
  const byCat = await page.locator("#kpi-by-cat").innerText();
  t("en el desglose por categoría cae en «Fuera de la página»", /Fuera de la página/.test(byCat), byCat);
  await page.close();
}

console.log("\nNingún nombre escrito a mano se ejecuta como código");
{
  const { page, log, st } = await open("owner");
  await page.click("#offcat-open");
  await page.fill("#offcat-name", EVIL); await page.fill("#offcat-qty", "1"); await page.fill("#offcat-price", "1000");
  await page.locator("#sale-inv").uncheck();
  await page.click("#btn-registrar-offcat"); await wait(800);
  const row = await page.locator("#sales-tbody tr", { hasText: "onerror" }).first().innerText();
  t("en el historial el nombre se ve como texto, tal cual", row.includes("<img src=x"), row);
  await page.click("#btn-notif"); await wait(200);
  t("en la campana de ventas recientes también es texto", (await page.locator("#notif-panel").innerText()).includes("<img src=x"));
  await page.click("#btn-notif");
  await page.evaluate(() => switchPanel("kpis")); await wait(200);
  t("en «Top productos» también", (await page.locator("#top-products-tbody").innerText()).includes("<img src=x"));
  await page.evaluate(() => switchPanel("ventas")); await wait(100);
  await page.locator("#sales-tbody tr", { hasText: "onerror" }).first().click(); await page.waitForSelector("#confirm-modal .sale-prod");
  await page.click("#sd-edit"); await page.fill("#se-price", "2000"); await page.click("#se-save"); await page.waitForSelector("#confirm-modal .sale-prod"); await wait(500);
  await page.click("#sd-close");
  await page.evaluate(() => switchPanel("auditoria")); await wait(200);
  t("y en Auditoría (la corrección de esa venta)", (await page.locator("#audit-tbody").innerText()).includes("<img src=x"));
  t("ningún script del nombre se ejecutó en ninguna pantalla", (await page.evaluate(() => window.__pwned)) === undefined);
  await page.close();
}

console.log("\nOtros roles");
{
  const { page } = await open("admin");
  t("el rol «admin» también ve «Corregir venta» y el formulario de otro producto", (await page.locator("#offcat-open").count()) === 1);
  await page.close();
  const o = await open("owner", { sales: [] }).catch(e => ({ err: e.message }));
  if (o.page) { t("con el historial vacío el formulario de otro producto igual está disponible", (await o.page.locator("#offcat-open").count()) === 1); await o.page.close(); }
}

await br.close();
console.log(fail ? `\n${fail} falla(s)` : "\nTodo bien");
process.exit(fail ? 1 : 0);
