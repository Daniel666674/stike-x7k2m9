/* =========================================================================
   Prueba de punta a punta del pago, en un navegador real y con el PHP real.

     node tools/checkout-e2e-test.mjs

   Necesita `php` y Playwright (npm install playwright; o el que ya trae el
   entorno). No toca la red ni llaves reales:
     - el sitio y /api/* los sirve el PHP embebido (mismo codigo de Hostinger),
       con la MISMA Content-Security-Policy que pone el .htaccess;
     - Wompi es falso: widget.js es un stub y la API de transacciones un
       servidor local que decide el estado (APPROVED / PENDING / DECLINED ...).

   Recorre lo que hace un cliente: elegir producto en la ficha -> carrito ->
   datos de envio -> Pagar ahora -> (Wompi) -> pagina de resultado, y comprueba
   que la venta solo se registra cuando Wompi dice APPROVED, una sola vez, que
   el cobro es el que muestra el carrito, y que cada falla se explica en vez de
   quedarse en un error mudo.
   ========================================================================= */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const D = require(join(ROOT, 'assets/js/data.js'));
const P = require(join(ROOT, 'vercel-wompi-api/lib/pricing.js'));
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = createRequire('/opt/node-tools/node_modules/')('playwright')); }
const EXE = process.env.STIKE_CHROMIUM || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const SHOTS = process.env.STIKE_SHOTS || '';   // carpeta opcional para capturas de pantalla

let pass = 0, fail = 0;
const t = (label, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FALLA'} ${label}${ok ? '' : `  -> ${extra}`}`);
};
const eq = (label, got, want) => t(label, JSON.stringify(got) === JSON.stringify(want), `dio ${JSON.stringify(got)}, esperaba ${JSON.stringify(want)}`);

const freePort = () => new Promise(res => { const s = createNetServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const listen = (handler) => new Promise(res => { const s = createServer(handler); s.listen(0, '127.0.0.1', () => res(s)); });

/* ---- Wompi falso (API de transacciones) y Resend falso ---- */
const txns = {};
const wompi = await listen((req, r) => {
  const id = decodeURIComponent(req.url.split('/transactions/')[1] || '');
  if (req.headers.authorization !== 'Bearer prv_test_falsa') { r.statusCode = 401; return r.end('{}'); }
  const x = txns[id];
  if (!x) { r.statusCode = 404; return r.end('{}'); }
  r.setHeader('Content-Type', 'application/json');
  r.end(JSON.stringify({ data: { id, currency: 'COP', ...x } }));
});
const emails = [];
const resend = await listen((req, r) => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => { emails.push(JSON.parse(b)); r.end('{"id":"x"}'); }); });

/* ---- sitio + API: PHP embebido con un router que imita el .htaccess ---- */
const htaccess = readFileSync(join(ROOT, '.htaccess'), 'utf8');
const CSP = (htaccess.match(/Header set Content-Security-Policy "([^"]+)"/) || [])[1];
if (!CSP) throw new Error('No encontre la Content-Security-Policy en .htaccess');
const WORK = mkdtempSync(join(tmpdir(), 'stike-e2e-'));
const STORAGE = join(WORK, 'private');
mkdirSync(STORAGE);
const SECRET = 'test_integrity_falso';
writeFileSync(join(WORK, 'router.php'), `<?php
$root = getenv("STIKE_ROOT");
$path = rawurldecode(parse_url($_SERVER["REQUEST_URI"], PHP_URL_PATH));
if (preg_match('#^/api/(wompi-sign|wompi-status|wompi-order|wompi-events)/?$#', $path, $m)) { require $root . "/api/" . $m[1] . ".php"; return true; }
$file = realpath($root . $path);
if ($file && is_dir($file)) $file = realpath($file . "/index.html");
if (!$file || strpos($file, $root) !== 0 || !is_file($file)) { http_response_code(404); echo "404"; return true; }
if (strtolower(pathinfo($file, PATHINFO_EXTENSION)) === "html") {
  header("Content-Type: text/html; charset=utf-8");
  header("Content-Security-Policy: " . getenv("STIKE_CSP"));
  readfile($file);
  return true;
}
return false;
`);
const port = await freePort();
const BASE = `http://127.0.0.1:${port}`;
const php = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', ROOT, join(WORK, 'router.php')], {
  env: {
    ...process.env, STIKE_ROOT: ROOT, STIKE_CSP: CSP, STORAGE_DIR: STORAGE, NO_PROXY: '*', no_proxy: '*',
    WOMPI_PUBLIC_KEY: 'pub_test_falsa', WOMPI_PRIVATE_KEY: 'prv_test_falsa', WOMPI_INTEGRITY_SECRET: SECRET,
    WOMPI_API_BASE: `http://127.0.0.1:${wompi.address().port}`,
    RESEND_API_KEY: 're_falsa', RESEND_API_BASE: `http://127.0.0.1:${resend.address().port}`, OWNER_NOTIFY_EMAIL: 'dueno@example.com',
  },
  stdio: 'ignore',
});
for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/index.html`); break; } catch { await new Promise(r => setTimeout(r, 100)); } }

const salesLog = () => existsSync(join(STORAGE, 'ventas.jsonl'))
  ? readFileSync(join(STORAGE, 'ventas.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const pendingExists = ref => existsSync(join(STORAGE, 'pending', `${ref}.json`));

/* ---- catalogo ---- */
const catalog = P.parseCatalog(readFileSync(join(ROOT, 'assets/js/products-data.js'), 'utf8')).filter(p => p.published !== false);
const FREE_SHIP = 300000, SHIP_COST = 18000;
const sellable = p => { const n = D.stikeSellable(p); return n === null || n > 0; };
const plain = catalog.filter(p => !(p.sizes && p.sizes.length) && !(p.colors && p.colors.length) && typeof p.units === 'number' && p.units >= 3);
const totalWithShip = sub => sub + (sub >= FREE_SHIP ? 0 : SHIP_COST);

/* ---- navegador ---- */
const browser = await chromium.launch({ executablePath: EXE });
const SHIP = { name: 'Cliente Prueba', phone: '3001112233', address: 'Calle 1 # 2-3', city: 'Bogota', notes: 'Timbre roto' };
const WIDGET_STUB = `window.WidgetCheckout = function (cfg) { window.__wompiCfg = cfg; this.open = function (cb) { window.__wompiOpened = true; window.__wompiCb = cb; }; };`;

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.problems = [];
  page.signCalls = 0;
  page.on('pageerror', e => page.problems.push('JS: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && /Content Security Policy|Refused to/i.test(m.text())) page.problems.push('CSP: ' + m.text()); });
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
    document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '[class*=cookie],#newsletter-overlay{display:none!important}'; document.head.appendChild(s); });
  });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await page.route('https://checkout.wompi.co/widget.js', r => {
    if (page.widgetMode === 'blocked') return r.abort();
    if (page.widgetMode === 'throws') return r.fulfill({ contentType: 'text/javascript', body: 'window.WidgetCheckout = function () { throw new Error("widget roto"); };' });
    return r.fulfill({ contentType: 'text/javascript', body: WIDGET_STUB });
  });
  page.redirectHits = [];
  await page.route('https://checkout.wompi.co/p/**', r => { page.redirectHits.push(r.request().url()); return r.fulfill({ contentType: 'text/html', body: '<h1>checkout.wompi.co (falso)</h1>' }); });
  page.on('request', rq => { if (rq.url().includes('/api/wompi-sign')) page.signCalls++; });
  return page;
}
const closePage = async page => { page.problems.push(...(await page.evaluate(() => (window.__csp || []).map(x => 'CSP: ' + x)).catch(() => []))); await page.context().close(); };
const cartOf = page => page.evaluate(() => JSON.parse(localStorage.getItem('stike_cart_v1') || '[]'));
const setCart = (page, cart) => page.evaluate(c => localStorage.setItem('stike_cart_v1', JSON.stringify(c)), cart);
async function fillShip(page) {
  await page.fill('#ship-name', SHIP.name); await page.fill('#ship-phone', SHIP.phone);
  await page.fill('#ship-address', SHIP.address); await page.fill('#ship-city', SHIP.city); await page.fill('#ship-notes', SHIP.notes);
}
async function addViaPdp(page, p) {
  await page.goto(`${BASE}/producto/${p.slug}.html`, { waitUntil: 'load' });
  await page.waitForSelector('#add-btn');
  const size = page.locator('#size-options .size-opt:not([disabled])').first();
  if (await size.count()) await size.click();
  const color = page.locator('#color-options .color-opt:not([disabled])').first();
  if (await color.count()) await color.click();
  await page.click('#add-btn');
}
const cartTotalFromScreen = async page => Number((await page.locator('.summary .line.total span').last().innerText()).replace(/[^\d]/g, ''));
async function openedConfig(page) {
  await page.waitForFunction(() => window.__wompiOpened === true, null, { timeout: 8000 });
  return page.evaluate(() => window.__wompiCfg);
}
const expectedSig = cfg => createHash('sha256').update(`${cfg.reference}${cfg.amountInCents}COP${SECRET}`).digest('hex');

try {
  /* ===================================================================== */
  console.log('\n1. Compra normal: ficha -> carrito -> Wompi (widget) -> resultado APPROVED');
  {
    const page = await newPage();
    const p = plain.reduce((a, x) => (x.price < a.price ? x : a));
    // Control: la prueba SI detecta una violacion de la CSP (si no, "sin errores de CSP" no probaria nada).
    await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
    await page.evaluate(() => fetch('https://tercero-no-permitido.example/x').catch(() => {}));
    await page.waitForTimeout(200);
    eq('control: un host no permitido SI dispara la CSP', (await page.evaluate(() => window.__csp)).length, 1);
    await page.evaluate(() => { window.__csp = []; });
    page.problems.length = 0;   // el control provoco esos avisos a proposito
    await addViaPdp(page, p);
    eq('la ficha agrega al carrito', (await cartOf(page)).map(r => [r.slug, r.qty]), [[p.slug, 1]]);
    await page.goto(`${BASE}/carrito.html`, { waitUntil: 'load' });
    eq('el carrito muestra el total con envio', await cartTotalFromScreen(page), totalWithShip(p.price));
    t('muestra los 5 medios de pago con Bancolombia (y sin Efecty)', (await page.locator('.summary .pay-chip').allInnerTexts().then(a => a.length === 5)) && !(await page.locator('.summary').innerText()).includes('Efecty') && (await page.locator('.summary').innerText()).includes('Bancolombia'));
    t('ya no hay codigo promo falso', (await page.locator('#promo').count()) === 0);
    await page.click('#pay-btn');   // sin datos de envio
    t('sin datos de envio no abre Wompi', (await page.evaluate(() => window.__wompiOpened)) !== true);
    await fillShip(page);
    await page.click('#pay-btn');
    const cfg = await openedConfig(page);
    eq('el widget recibe el monto del servidor = total del carrito', cfg.amountInCents, totalWithShip(p.price) * 100);
    eq('moneda COP', cfg.currency, 'COP');
    eq('la firma de integridad es sha256(ref + monto + COP + secreto)', cfg.signature.integrity, expectedSig(cfg));
    eq('llave publica la da el servidor', cfg.publicKey, 'pub_test_falsa');
    eq('vuelve a pago-resultado del propio sitio', cfg.redirectUrl, `${BASE}/pago-resultado.html`);
    t('el pedido queda guardado en el servidor antes de cobrar', pendingExists(cfg.reference));
    eq('todavia no hay venta (nadie ha pagado)', salesLog().length, 0);

    txns['txn-e2e-1'] = { status: 'APPROVED', reference: cfg.reference, amount_in_cents: cfg.amountInCents, customer_email: 'cliente@example.com' };
    await page.evaluate(() => window.__wompiCb({ transaction: { id: 'txn-e2e-1' } }));   // red de seguridad del widget
    await page.waitForURL(/pago-resultado\.html\?id=txn-e2e-1/);
    await page.waitForSelector('.co-success h3');
    eq('muestra pago exitoso', await page.locator('.co-success h3').textContent(), '¡Pago exitoso!');
    eq('el carrito del navegador queda vacio', await cartOf(page), []);
    await page.waitForFunction(() => true); await page.waitForTimeout(600);
    const sale = salesLog().filter(x => x.orderRef === cfg.reference);
    eq('la venta quedo registrada una sola vez, con el pedido guardado', sale.map(x => [x.slug, x.qty, x.total]), [[p.slug, 1, p.price]]);
    eq('con direccion y wompiId', [sale[0].shipping.address, sale[0].wompiId, sale[0].source], [SHIP.address, 'txn-e2e-1', 'wompi']);
    t('el pedido pendiente se limpia', !pendingExists(cfg.reference));
    eq('un correo al dueno', emails.length, 1);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.co-success h3'); await page.waitForTimeout(600);
    eq('recargar la pagina de resultado no duplica la venta', salesLog().filter(x => x.orderRef === cfg.reference).length, 1);
    eq('ni manda otro correo', emails.length, 1);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'resultado-aprobado.png') });
    await closePage(page);
    eq('sin errores de JS ni de CSP', page.problems, []);
  }

  /* ===================================================================== */
  console.log('\n2. PSE / Nequi: PENDING primero, APPROVED despues (la pagina espera y sigue sola)');
  {
    const page = await newPage();
    const p = plain[1];
    await setCart(await (async () => { await page.goto(`${BASE}/carrito.html`, { waitUntil: 'load' }); return page; })(), [{ slug: p.slug, qty: 1 }]);
    await page.reload({ waitUntil: 'load' });
    await fillShip(page);
    await page.click('#pay-btn');
    const cfg = await openedConfig(page);
    txns['txn-e2e-2'] = { status: 'PENDING', reference: cfg.reference, amount_in_cents: cfg.amountInCents };
    await page.goto(`${BASE}/pago-resultado.html?id=txn-e2e-2`, { waitUntil: 'load' });
    await page.waitForFunction(() => /Confirmando tu pago/.test(document.querySelector('.co-success h3')?.textContent || ''));
    t('mientras esta PENDING avisa que espera', true);
    eq('y NO registra nada ni vacia el carrito', [salesLog().filter(x => x.orderRef === cfg.reference).length, (await cartOf(page)).length], [0, 1]);
    txns['txn-e2e-2'].status = 'APPROVED';   // el banco confirma
    await page.waitForFunction(() => /Pago exitoso/.test(document.querySelector('.co-success h3')?.textContent || ''), null, { timeout: 15000 });
    t('al aprobarse, la misma pagina pasa a pago exitoso sin recargar', true);
    await page.waitForTimeout(600);
    eq('recien ahi se registra la venta', salesLog().filter(x => x.orderRef === cfg.reference).length, 1);
    await closePage(page);
    eq('sin errores de JS ni de CSP', page.problems, []);
  }

  /* ===================================================================== */
  console.log('\n3. Pago rechazado: no se cobra, no se registra, el carrito queda');
  {
    const page = await newPage();
    const p = plain[2];
    await page.goto(`${BASE}/carrito.html`, { waitUntil: 'load' });
    await setCart(page, [{ slug: p.slug, qty: 1 }]);
    await page.reload({ waitUntil: 'load' });
    await fillShip(page);
    await page.click('#pay-btn');
    const cfg = await openedConfig(page);
    const before = salesLog().length;
    for (const [i, st] of ['DECLINED', 'ERROR', 'VOIDED'].entries()) {
      txns[`txn-e2e-3${i}`] = { status: st, reference: cfg.reference, amount_in_cents: cfg.amountInCents };
      await page.goto(`${BASE}/pago-resultado.html?id=txn-e2e-3${i}`, { waitUntil: 'load' });
      await page.waitForFunction(() => /no se completó/.test(document.querySelector('.co-success h3')?.textContent || ''));
      t(`${st}: dice "El pago no se completó"`, true);
    }
    eq('no se registro ninguna venta', salesLog().length, before);
    eq('el carrito sigue intacto para reintentar', (await cartOf(page)).length, 1);
    await closePage(page);
    eq('sin errores de JS ni de CSP', page.problems, []);
  }

  /* ===================================================================== */
  console.log('\n4. El cliente paga y cierra la pestana: lo registra el webhook de Wompi');
  {
    const page = await newPage();
    const p = plain[3];
    await page.goto(`${BASE}/carrito.html`, { waitUntil: 'load' });
    await setCart(page, [{ slug: p.slug, qty: 2 }]);
    await page.reload({ waitUntil: 'load' });
    await fillShip(page);
    await page.click('#pay-btn');
    const cfg = await openedConfig(page);
    await page.close();   // cierra la pestana sin volver
    txns['txn-e2e-4'] = { status: 'APPROVED', reference: cfg.reference, amount_in_cents: cfg.amountInCents };
    const ev = await fetch(`${BASE}/api/wompi-events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'transaction.updated', data: { transaction: { id: 'txn-e2e-4', reference: cfg.reference, status: 'APPROVED' } } }) });
    eq('webhook -> 200', ev.status, 200);
    eq('la venta quedo con las 2 unidades y el envio', salesLog().filter(x => x.orderRef === cfg.reference).map(x => [x.qty, x.shipping.city]), [[2, 'Bogota']]);
    const ev2 = await fetch(`${BASE}/api/wompi-events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'transaction.updated', data: { transaction: { id: 'txn-e2e-4', reference: cfg.reference, status: 'APPROVED' } } }) });
    eq('Wompi reintenta el mismo evento: no duplica', [ev2.status, salesLog().filter(x => x.orderRef === cfg.reference).length], [200, 1]);
    await page.context().close();
  }

  /* ===================================================================== */
  console.log('\n5. Carrito viejo (producto que ya no existe, agotado, cantidad absurda): se arregla solo');
  {
    const page = await newPage();
    const ok = plain[4], stocked = plain[5];
    const agotado = catalog.find(p => !(p.sizes && p.sizes.length) && !(p.colors && p.colors.length) && p.units === 0);
    await page.goto(`${BASE}/carrito.html`, { waitUntil: 'load' });
    await setCart(page, [{ slug: 'producto-renombrado-que-ya-no-existe', qty: 1 }, ...(agotado ? [{ slug: agotado.slug, qty: 1 }] : []), { slug: stocked.slug, qty: 99 }, { slug: ok.slug, qty: 1 }]);
    await page.reload({ waitUntil: 'load' });
    t('muestra el aviso de que se ajusto el carrito', (await page.locator('.cart-notice').count()) === 1);
    const cap = Math.min(20, stocked.units);
    eq('quedan solo las lineas validas, con la cantidad topada', (await cartOf(page)).map(r => [r.slug, r.qty]), [[stocked.slug, cap], [ok.slug, 1]]);
    eq('las filas visibles coinciden con lo que se cobra', await page.locator('.cart-row').count(), 2);
    await fillShip(page);
    await page.click('#pay-btn');
    const cfg = await openedConfig(page);
    eq('y el pago abre con el total que se ve', cfg.amountInCents, totalWithShip(stocked.price * cap + ok.price) * 100);
    // el "+" no pasa del stock
    await page.goto(`${BASE}/carrito.html`, { waitUntil: 'load' });
    await setCart(page, [{ slug: stocked.slug, qty: cap }]);
    await page.reload({ waitUntil: 'load' });
    await page.click('[data-inc]');
    eq('el boton + no pasa del maximo', (await cartOf(page))[0].qty, cap);
    await closePage(page);
    eq('sin errores de JS ni de CSP', page.problems, []);
  }

  /* ===================================================================== */
  console.log('\n6. Cuando el pago no se puede iniciar, el cliente lo entiende');
  {
    const page = await newPage();
    const p = plain[6];
    await page.goto(`${BASE}/carrito.html`, { waitUntil: 'load' });
    await setCart(page, [{ slug: p.slug, qty: 1 }]);
    await page.reload({ waitUntil: 'load' });
    await fillShip(page);
    await page.route('**/api/wompi-sign', r => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"server_not_configured","detail":"falta WOMPI_PUBLIC_KEY"}' }));
    await page.click('#pay-btn');
    await page.waitForSelector('#pay-error:not([hidden])');
    const msg = await page.locator('#pay-error').innerText();
    t('explica que el pago en linea no esta disponible y da el codigo', /no está disponible/.test(msg) && /server_not_configured/.test(msg), msg);
    t('ofrece WhatsApp', (await page.locator('#pay-error a').getAttribute('href')).startsWith('https://wa.me/'));
    t('el detalle tecnico (llaves) no se le muestra al cliente', !/WOMPI_PUBLIC_KEY/.test(msg));
    t('el boton queda listo para reintentar', await page.locator('#pay-btn').isEnabled());
    await page.unroute('**/api/wompi-sign');
    await page.route('**/api/wompi-sign', r => r.abort());
    await page.click('#pay-btn');
    await page.waitForFunction(() => /No pudimos conectar/.test(document.getElementById('pay-error').textContent));
    t('sin internet / servidor caido: lo dice', true);
    await page.unroute('**/api/wompi-sign');
    await page.route('**/api/wompi-sign', r => r.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'out_of_stock', detail: p.slug }) }));
    await page.click('#pay-btn');
    await page.waitForFunction(() => /No hay suficientes unidades/.test(document.getElementById('pay-error').textContent));
    t('sin stock: nombra el producto', (await page.locator('#pay-error').innerText()).includes(p.n));
    await page.unroute('**/api/wompi-sign');
    await page.click('#pay-btn');
    await openedConfig(page);
    t('y cuando el servidor vuelve, el mismo boton cobra', true);
    await closePage(page);
    eq('sin errores de JS ni de CSP', page.problems.filter(x => !/Failed to load resource/.test(x)), []);
  }

  /* ===================================================================== */
  console.log('\n7. Si el widget de Wompi no carga, se cobra por la pagina de Wompi');
  for (const mode of ['blocked', 'throws']) {
    const page = await newPage();
    page.widgetMode = mode;
    const p = plain[7];
    await page.goto(`${BASE}/carrito.html`, { waitUntil: 'load' });
    await setCart(page, [{ slug: p.slug, qty: 1 }]);
    await page.reload({ waitUntil: 'load' });
    await fillShip(page);
    await page.click('#pay-btn');
    await page.waitForFunction(() => location.hostname === 'checkout.wompi.co', null, { timeout: 8000 });
    const u = new URL(page.url());
    eq(`[${mode}] llega a checkout.wompi.co/p/ con monto y firma`, [u.pathname, u.searchParams.get('amount-in-cents'), u.searchParams.get('currency'), u.searchParams.get('public-key')], ['/p/', String(totalWithShip(p.price) * 100), 'COP', 'pub_test_falsa']);
    eq(`[${mode}] la firma de integridad viaja`, u.searchParams.get('signature:integrity'), createHash('sha256').update(`${u.searchParams.get('reference')}${u.searchParams.get('amount-in-cents')}COP${SECRET}`).digest('hex'));
    eq(`[${mode}] y vuelve a pago-resultado`, u.searchParams.get('redirect-url'), `${BASE}/pago-resultado.html`);
    await page.context().close();
  }

  /* ===================================================================== */
  console.log('\n8. Doble clic en "Pagar ahora": un solo cobro');
  {
    const page = await newPage();
    const p = plain[8];
    await page.goto(`${BASE}/carrito.html`, { waitUntil: 'load' });
    await setCart(page, [{ slug: p.slug, qty: 1 }]);
    await page.reload({ waitUntil: 'load' });
    await fillShip(page);
    await page.dblclick('#pay-btn');
    await openedConfig(page);
    await page.waitForTimeout(400);
    eq('una sola firma pedida', page.signCalls, 1);
    await closePage(page);
  }

  /* ===================================================================== */
  console.log('\n9. Fichas de producto reales (todas las formas de variante) -> carrito -> pago');
  {
    const picks = [];
    const add = (label, f, n = 2) => catalog.filter(p => sellable(p) && f(p)).slice(0, n).forEach(p => picks.push([label, p]));
    add('sin variantes', p => !p.sizes && !p.colors && typeof p.units === 'number' && p.units >= 1);
    add('solo talla', p => p.sizes && !p.colors);
    add('solo color', p => p.colors && !p.sizes);
    add('talla y color', p => p.sizes && p.colors && !(p.combos && p.combos.length));
    add('tabla de combinaciones', p => p.combos && p.combos.length);
    add('precio por opcion', p => (p.colors || []).some(c => c.price > 0) || (p.sizes || []).some(z => z.price > 0));
    for (const [label, p] of picks) {
      const page = await newPage();
      await addViaPdp(page, p);
      const cart = await cartOf(page);
      if (cart.length !== 1) { t(`[${label}] ${p.slug}: la ficha agrega al carrito`, false, JSON.stringify(cart)); await closePage(page); continue; }
      const row = cart[0];
      await page.goto(`${BASE}/carrito.html`, { waitUntil: 'load' });
      await fillShip(page);
      const shown = await cartTotalFromScreen(page);
      await page.click('#pay-btn');
      let cfg;
      try { cfg = await openedConfig(page); } catch { cfg = null; }
      const expect = totalWithShip(D.stikePriceFor(p, row.size || null, row.color || null) * row.qty);
      t(`[${label}] ${p.slug} ${[row.size, row.color].filter(Boolean).join('/')}: ficha -> carrito -> Wompi cobra ${expect}`, cfg && cfg.amountInCents === expect * 100 && shown === expect, `pantalla ${shown}, widget ${cfg && cfg.amountInCents / 100}, esperado ${expect}; ${page.problems.join('|')}`);
      await closePage(page);
      if (page.problems.length) t(`[${label}] ${p.slug}: sin errores de JS ni CSP`, false, page.problems.join(' | '));
    }
  }

  /* ===================================================================== */
  console.log('\n10. TODO el catalogo en el carrito (en tandas): el carrito y el servidor dicen lo mismo');
  {
    const lines = [];
    for (const p of catalog) {
      const sizes = (p.sizes && p.sizes.length) ? p.sizes.map(x => x.v) : [null];
      const colors = (p.colors && p.colors.length) ? p.colors.map(x => x.v) : [null];
      for (const s of sizes) for (const c of colors) {
        const st = D.stikeCartStock(p, s, c);
        if ((st === null || st >= 1) && Number.isInteger(D.stikePriceFor(p, s, c)) && D.stikePriceFor(p, s, c) > 0) lines.push({ slug: p.slug, qty: 1, ...(s ? { size: s } : {}), ...(c ? { color: c } : {}) });
      }
    }
    const CHUNK = 40;
    let chunks = 0, lineCount = 0;
    const page = await newPage();
    await page.goto(`${BASE}/carrito.html`, { waitUntil: 'load' });
    for (let i = 0; i < lines.length; i += CHUNK) {
      const chunk = lines.slice(i, i + CHUNK);
      await setCart(page, chunk);
      await page.reload({ waitUntil: 'load' });
      await fillShip(page);
      const rows = await page.locator('.cart-row').count();
      const notice = await page.locator('.cart-notice').count();
      const sub = chunk.reduce((a, r) => a + D.stikePriceFor(catalog.find(p => p.slug === r.slug), r.size || null, r.color || null), 0);
      await page.evaluate(() => { window.__wompiOpened = false; });
      await page.click('#pay-btn');
      let cfg; try { cfg = await openedConfig(page); } catch { cfg = null; }
      const err = await page.locator('#pay-error:not([hidden])').count() ? await page.locator('#pay-error').innerText() : '';
      const good = rows === chunk.length && notice === 0 && cfg && cfg.amountInCents === totalWithShip(sub) * 100;
      t(`tanda ${++chunks}: ${chunk.length} lineas -> ${rows} filas, sin avisos, cobro ${totalWithShip(sub)}`, good, `filas ${rows}, avisos ${notice}, widget ${cfg && cfg.amountInCents / 100}, error "${err}"`);
      lineCount += chunk.length;
    }
    eq('se probaron todas las combinaciones comprables', lineCount, lines.length);
    await closePage(page);
    eq('sin errores de JS ni de CSP', page.problems, []);
  }

  /* ===================================================================== */
  console.log('\n11. Medios de pago y distintivo de Wompi en inicio, pie y carrito');
  for (const [name, vp] of [['escritorio', { width: 1440, height: 900 }], ['celular', { width: 390, height: 844 }]]) {
    const page = await newPage({ viewport: vp });
    await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const chips = await page.locator('.rd-pay .pay-chip').allInnerTexts();
    eq(`[${name}] inicio: 5 medios (Visa, Mastercard y PSE con logo; Nequi y Bancolombia en texto)`, [await page.locator('.rd-pay .pay-chip img').count(), chips.filter(x => x.trim()).map(x => x.trim())], [3, ['Nequi', 'Bancolombia']]);
    t(`[${name}] los logos cargan`, await page.evaluate(() => [...document.querySelectorAll('.rd-pay img, footer img[src*="/pay/"]')].every(i => i.complete && i.naturalWidth > 0)));
    t(`[${name}] sin scroll horizontal`, (await page.evaluate(() => document.documentElement.scrollWidth)) <= vp.width + 2);
    t(`[${name}] las cifras viejas ya no estan`, !/\+12K|\+800|24 HRS/i.test(await page.locator('body').innerText()));
    eq(`[${name}] pie: 5 medios + Wompi`, [await page.locator('footer .pay-chip').count(), await page.locator('footer .wompi-badge').count()], [5, 1]);
    if (SHOTS) {
      await page.locator('.rd-pay').scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await page.locator('.rd-pay').screenshot({ path: join(SHOTS, `hero-pago-${name}.png`) });
      await page.locator('footer.site-footer').scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await page.locator('footer.site-footer').screenshot({ path: join(SHOTS, `pie-${name}.png`) });
    }
    await closePage(page);
    eq(`[${name}] sin errores de JS ni de CSP`, page.problems, []);
  }
} finally {
  await browser.close();
  php.kill(); wompi.close(); resend.close();
  rmSync(WORK, { recursive: true, force: true });
}

console.log(`\n  ${pass} pasaron, ${fail} fallaron\n`);
process.exit(fail ? 1 : 0);
