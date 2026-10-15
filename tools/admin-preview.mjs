/* =========================================================================
   Vista previa del panel admin sin servidor PHP ni GitHub.

     node tools/admin-preview.mjs [carpeta-salida] [ancho]

   Sirve el sitio con tools/wompi-dev-server.mjs, simula la sesion, api/gh,
   api/sales y api/admin-health con datos de ejemplo, y toma una captura de
   cada pestaña. Sirve para revisar el diseño antes de publicar.
   ========================================================================= */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = process.argv[2] || join(ROOT, '.preview');
const WIDTH = Number(process.argv[3] || 1440);
mkdirSync(OUT, { recursive: true });

const port = await new Promise(res => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const server = spawn('node', [join(ROOT, 'tools/wompi-dev-server.mjs'), String(port)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));

const catalogText = readFileSync(join(ROOT, 'assets/js/products-data.js'), 'utf8');
global.window = {};
new Function('window', catalogText)(global.window);
const PRODUCTS = global.window.STIKE_PRODUCTS;

// Ventas de ejemplo de los ultimos 45 dias, sobre productos reales del catalogo.
const sales = [];
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const now = Date.now();
for (let i = 0; i < 70; i++) {
  const p = PRODUCTS[Math.floor(rnd() * PRODUCTS.length)];
  const qty = rnd() < 0.8 ? 1 : 2;
  const online = rnd() < 0.35;
  const s = {
    ts: new Date(now - rnd() * 45 * 864e5).toISOString(), slug: p.slug, name: p.n,
    size: null, color: null, qty, unitPrice: p.price, total: p.price * qty,
    admin: online ? 'Wompi (ref R' + i + ')' : 'jparra375@gmail.com',
  };
  if (online) Object.assign(s, { source: 'wompi', orderRef: 'R' + i, shipping: { name: 'Cliente ' + i, phone: '3001112233', address: 'Calle 1 # 2-3', city: 'Bogotá', notes: '' } });
  else Object.assign(s, { invoice: 3782 + i, payment: rnd() < 0.5 ? 'Efectivo' : 'Nequi' });
  sales.push(s);
}
sales.sort((a, b) => (a.ts < b.ts ? -1 : 1));
const gh = sales.filter(s => !s.source), online = sales.filter(s => s.source);

const b64 = s => Buffer.from(s, 'utf8').toString('base64');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('pageerror:', e.message));
await page.route(/accounts\.google\.com|fonts\.(googleapis|gstatic)\.com/, r => r.abort());
await page.route('**/api/admin-login', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ email: 'jparra375@gmail.com', role: 'owner' }) }));
await page.route('**/api/sales', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(online) }));
await page.route('**/api/admin-health', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ready: false, eventsUrl: 'https://stikebikeshop.com/api/wompi-events', checks: [
  { id: 'wompi_keys', ok: true, label: 'Llaves de Wompi', detail: 'Producción (cobros reales)' },
  { id: 'wompi_reach', ok: true, label: 'Wompi reconoce la llave pública', detail: 'OK' },
  { id: 'wompi_prod', ok: true, label: 'Modo producción', detail: 'Las ventas se cobran de verdad' },
  { id: 'github', ok: true, label: 'GitHub (catálogo y stock)', detail: 'OK' },
  { id: 'storage', ok: true, label: 'Registro de ventas en el servidor', detail: 'OK' },
  { id: 'email', ok: false, label: 'Correo de cada venta (Resend)', detail: 'Opcional' },
  { id: 'https', ok: false, label: 'HTTPS', detail: 'Requerido por Wompi' },
] }) }));
await page.route('**/api/gh?**', route => {
  const path = new URL(route.request().url()).searchParams.get('path');
  const file = text => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ sha: 'sha-' + path, content: b64(text) }) });
  if (route.request().method() !== 'GET') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ content: { sha: 'nuevo' } }) });
  if (path === 'assets/js/products-data.js') return file(catalogText);
  if (path === 'data/sales-log.json') return file(JSON.stringify(gh));
  if (path === 'data/costs.json' || path === 'data/site-content.json') return file('{}');
  return file('[]');
});

await page.goto(`http://127.0.0.1:${port}/admin.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
for (const panel of ['productos', 'ventas', 'kpis', 'auditoria', 'contenido', 'config']) {
  await page.click(`.navbtn[data-panel="${panel}"]`);
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, `${WIDTH}-${panel}.png`), fullPage: panel !== 'productos' });
}
// Editor de producto (primera tarjeta) y venta rapida.
await page.click('.navbtn[data-panel="productos"]');
const card = page.locator('[data-edit], .pcard, .product-card').first();
if (await card.count()) { await card.click().catch(() => {}); await page.waitForTimeout(600); await page.screenshot({ path: join(OUT, `${WIDTH}-editor.png`) }); }
await browser.close();
server.kill();
console.log('capturas en', OUT);
