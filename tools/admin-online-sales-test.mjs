/* =========================================================================
   Prueba del panel admin con ventas de dos fuentes: GitHub (a mano) y el
   servidor de Hostinger (Wompi, api/sales.php).

     npm install playwright     (una vez; no queda en el repo)
     node tools/admin-online-sales-test.mjs

   Levanta tools/wompi-dev-server.mjs para servir el sitio y simula la API de
   GitHub y api/sales con page.route: no usa red ni llaves reales. Cubre lo
   que importa de la mezcla: que no se dupliquen ventas, que el panel no se
   rompa si el servidor no responde o la clave esta mal, y que una venta
   nueva aparezca sola.
   ========================================================================= */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const port = await new Promise(res => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const server = spawn('node', [join(ROOT, 'tools/wompi-dev-server.mjs'), String(port)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const B = `http://127.0.0.1:${port}/stike-x7k2m9`;

let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FALLA'} ${label}${ok ? '' : `  -> dio ${JSON.stringify(got)}, esperaba ${JSON.stringify(want)}`}`);
};

const KEY = 'clave-del-servidor-de-prueba-0123456789';
const SHIP = { name: 'Cliente Prueba', phone: '3001112233', address: 'Calle 1 # 2-3', city: 'Bogota', notes: '' };
const MANUAL = { ts: '2026-10-10T15:00:00.000Z', slug: 'prod-m', name: 'Venta de mostrador', size: null, color: null, qty: 1, unitPrice: 50000, total: 50000, admin: 'jparra375@gmail.com' };
const LEGACY = { ts: '2026-10-11T10:00:00.000Z', slug: 'prod-l', name: 'Wompi anterior', size: null, color: null, qty: 1, unitPrice: 20000, total: 20000, admin: 'Wompi (ref REF-OLD)', source: 'wompi', orderRef: 'REF-OLD', wompiId: '1', shipping: SHIP };
const LEGACY_EN_SERVIDOR = { ...LEGACY, ts: '2026-10-11T10:00:05.000Z' };   // la misma orden, registrada tambien alla
const NEW_A = { ts: '2026-10-13T09:00:00.000Z', slug: 'prod-a', name: 'Online A', size: 'M', color: null, qty: 2, unitPrice: 100000, total: 200000, admin: 'Wompi (ref REF-NEW)', source: 'wompi', orderRef: 'REF-NEW', wompiId: '2', shipping: SHIP };
const NEW_B = { ...NEW_A, ts: '2026-10-13T09:00:00.100Z', slug: 'prod-b', name: 'Online B', size: null, qty: 1, unitPrice: 30000, total: 30000, flag: 'amount_mismatch', paidInCents: 99900 };

const catalogText = readFileSync(join(ROOT, 'assets/js/products-data.js'), 'utf8');
const b64 = s => Buffer.from(s, 'utf8').toString('base64');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

/* opts.key: clave guardada en el navegador; opts.server: 'ok' | 'down'. */
async function openPanel(opts) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  const state = { online: opts.online ?? [NEW_A, NEW_B, LEGACY_EN_SERVIDOR], gh: [MANUAL, LEGACY], server: opts.server || 'ok', salesCalls: 0 };
  await page.addInitScript(({ key }) => {
    localStorage.setItem('stike_admin_pat', 'ghp_falso');
    if (key) localStorage.setItem('stike_admin_sales_key', key);
    sessionStorage.setItem('stike_admin_login_v1', JSON.stringify({ email: 'jparra375@gmail.com', ts: Date.now() }));
  }, { key: opts.key });
  await page.route(/accounts\.google\.com|fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await page.route('https://api.github.com/repos/**', route => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname.split('/contents/')[1]);
    const file = text => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ sha: 'sha-' + path, content: b64(text) }) });
    if (route.request().method() !== 'GET') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ content: { sha: 'nuevo' } }) });
    if (path === 'assets/js/products-data.js') return file(catalogText);
    if (path === 'data/sales-log.json') return file(JSON.stringify(state.gh));
    if (path === 'data/costs.json' || path === 'data/site-content.json') return file('{}');
    return file('[]');
  });
  await page.route('**/api/sales', route => {
    state.salesCalls++;
    const auth = route.request().headers()['authorization'];
    if (state.server === 'down') return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"internal_error"}' });
    if (auth !== `Bearer ${KEY}`) return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthorized"}' });
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(state.online) });
  });
  await page.goto(`${B}/admin.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /venta/.test(document.querySelector('#sales-count')?.textContent || ''), null, { timeout: 15000 });
  return { page, state, errs, rows: () => page.locator('#sales-tbody tr[data-sale-idx]').count(), note: () => page.locator('#sales-online-note').innerText(),
    names: () => page.locator('#sales-tbody tr[data-sale-idx] td:nth-child(2)').allInnerTexts() };
}

try {
  console.log('\nConectado: mezcla de las dos fuentes');
  let p = await openPanel({ key: KEY });
  t('4 ventas: 1 a mano + 1 anterior + 2 nuevas (la repetida no se duplica)', await p.rows(), 4);
  t('mas reciente primero', (await p.names()).slice(0, 2), ['Online B', 'Online A']);
  t('la nota dice que esta conectado', /conectadas/.test(await p.note()), true);
  t('sin errores de JavaScript', p.errs, []);
  await p.page.locator('.navbtn[data-panel="ventas"]').click();
  await p.page.locator('#sales-tbody tr[data-sale-idx]').first().click();
  const modal = await p.page.locator('#confirm-modal').innerText();
  t('el detalle muestra la direccion de envio', modal.includes('Calle 1 # 2-3'), true);
  t('el detalle avisa la bandera de revision', modal.includes('Revisar') && modal.includes('no coincide'), true);
  await p.page.context().close();

  console.log('\nSin clave: el panel funciona con lo de GitHub y lo dice');
  p = await openPanel({ key: null });
  t('solo las 2 de GitHub', await p.rows(), 2);
  t('no llama al servidor', p.state.salesCalls, 0);
  t('la nota pide conectar', /sin conectar/.test(await p.note()), true);
  await p.page.context().close();

  console.log('\nClave equivocada: no rompe nada');
  p = await openPanel({ key: 'otra-clave-que-no-es-la-correcta-123' });
  t('solo las 2 de GitHub', await p.rows(), 2);
  t('avisa en rojo que la clave no es valida', /la clave no es válida/.test(await p.note()), true);
  t('sin errores de JavaScript', p.errs, []);
  await p.page.context().close();

  console.log('\nServidor caido: no rompe nada');
  p = await openPanel({ key: KEY, server: 'down' });
  t('solo las 2 de GitHub', await p.rows(), 2);
  t('avisa que no pudo leer las online', /No se pudieron leer las ventas online/.test(await p.note()), true);
  await p.page.context().close();

  console.log('\nGuardar la clave desde Configuracion');
  p = await openPanel({ key: null });
  await p.page.locator('.navbtn[data-panel="config"]').click();
  await p.page.fill('#sales-key-input', KEY);
  await p.page.click('#btn-save-sales-key');
  await p.page.waitForFunction(() => document.querySelectorAll('#sales-tbody tr[data-sale-idx]').length === 4, null, { timeout: 10000 });
  t('al guardar la clave aparecen las ventas online', await p.rows(), 4);
  t('el estado de la clave dice conectado', /Conectado/.test(await p.page.locator('#sales-key-status').innerText()), true);
  t('la clave queda solo en este navegador', await p.page.evaluate(() => localStorage.getItem('stike_admin_sales_key')), KEY);
  await p.page.click('#btn-clear-sales-key');
  await p.page.waitForFunction(() => document.querySelectorAll('#sales-tbody tr[data-sale-idx]').length === 2, null, { timeout: 10000 });
  t('al borrar la clave vuelven solo las de GitHub', await p.rows(), 2);
  await p.page.context().close();

  console.log('\nVenta nueva mientras el panel esta abierto (polling)');
  p = await openPanel({ key: KEY });
  const antes = await p.rows();
  p.state.online = [...p.state.online, { ...NEW_A, ts: '2026-10-14T08:00:00.000Z', slug: 'prod-c', name: 'Online C', orderRef: 'REF-NEWER', total: 77000 }];
  await p.page.evaluate(() => pollSalesLog());
  t('aparece la nueva sin recargar', [await p.rows(), (await p.names())[0]], [antes + 1, 'Online C']);
  await p.page.evaluate(() => pollSalesLog());
  t('otro ciclo sin cambios no duplica', await p.rows(), antes + 1);
  t('sin errores de JavaScript', p.errs, []);
  await p.page.context().close();
} finally {
  await browser.close();
  server.kill();
}

console.log(`\n  ${pass} pasaron, ${fail} fallaron\n`);
process.exit(fail ? 1 : 0);
