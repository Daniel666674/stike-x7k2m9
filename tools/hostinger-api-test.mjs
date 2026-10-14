/* =========================================================================
   Prueba de los endpoints PHP de Hostinger (api/*.php) de punta a punta.

     node tools/hostinger-api-test.mjs

   Necesita `php` en el PATH. Levanta el servidor embebido de PHP contra la
   carpeta del repo, mas un Wompi falso y un Resend falso (los endpoints
   aceptan WOMPI_API_BASE y RESEND_API_BASE justo para esto), y guarda las
   ventas en una carpeta temporal. No toca la red ni llaves reales.

   Cada caso existe porque equivocarse ahi es plata o un cliente sin pedido:
   venta duplicada, venta perdida si el cliente cierra la pestana, cobro sin
   pedido guardado, o datos del cliente a la vista de cualquiera.
   ========================================================================= */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const P = require(join(ROOT, 'vercel-wompi-api/lib/pricing.js'));

let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FALLA'} ${label}${ok ? '' : `  -> dio ${JSON.stringify(got)}, esperaba ${JSON.stringify(want)}`}`);
};

const freePort = () => new Promise(res => { const s = createNetServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const listen = (handler) => new Promise(res => { const s = createServer(handler); s.listen(0, '127.0.0.1', () => res(s)); });

/* ---- Wompi falso: GET /transactions/:id ---- */
const txns = {};              // id -> { status, reference, amount_in_cents, customer_email } | 'down'
const wompi = await listen((req, r) => {
  const id = decodeURIComponent(req.url.split('/transactions/')[1] || '');
  if (req.headers.authorization !== 'Bearer prv_test_falsa') { r.statusCode = 401; return r.end('{}'); }
  const x = txns[id];
  if (x === 'down') { r.statusCode = 500; return r.end('{}'); }
  if (!x) { r.statusCode = 404; return r.end('{}'); }
  r.setHeader('Content-Type', 'application/json');
  r.end(JSON.stringify({ data: { id, ...x } }));
});
/* ---- Resend falso: POST /emails ---- */
const emails = [];
let resendFails = false;
const resend = await listen((req, r) => {
  let b = ''; req.on('data', c => (b += c)); req.on('end', () => {
    if (resendFails) { r.statusCode = 500; return r.end('{}'); }
    emails.push({ auth: req.headers.authorization, ...JSON.parse(b) }); r.end('{"id":"x"}');
  });
});

const STORAGE = mkdtempSync(join(tmpdir(), 'stike-test-'));
const KEY = 'k'.repeat(32);
const baseEnv = {
  ...process.env, WOMPI_PUBLIC_KEY: 'pub_test_desde_el_servidor', WOMPI_INTEGRITY_SECRET: 'test_integrity_falso', WOMPI_PRIVATE_KEY: 'prv_test_falsa',
  WOMPI_API_BASE: `http://127.0.0.1:${wompi.address().port}`, RESEND_API_KEY: 're_falsa',
  RESEND_API_BASE: `http://127.0.0.1:${resend.address().port}`, OWNER_NOTIFY_EMAIL: 'dueno@example.com',
  NO_PROXY: '*', no_proxy: '*',
};
const startPhp = async (env) => {
  const port = await freePort();
  const proc = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', ROOT], { env, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port}/api/sales.php`); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
  return { port, proc, url: `http://127.0.0.1:${port}/api` };
};
const A = await startPhp({ ...baseEnv, STORAGE_DIR: STORAGE, ADMIN_API_KEY: KEY });
const post = async (base, ep, body) => { const r = await fetch(`${base}/${ep}.php`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { code: r.status, body: await r.json().catch(() => null) }; };
const getSales = async (key) => { const r = await fetch(`${A.url}/sales.php`, { headers: key ? { Authorization: `Bearer ${key}` } : {} }); return { code: r.status, body: await r.json().catch(() => null) }; };

const real = P.parseCatalog(readFileSync(join(ROOT, 'assets/js/products-data.js'), 'utf8')).filter(p => p.published !== false);
const barato = real.reduce((a, p) => (p.price < a.price ? p : a));
const caro = real.reduce((a, p) => (p.price > a.price ? p : a));
const SHIP = { name: 'Cliente Prueba', phone: '3001112233', address: 'Calle 1 # 2-3', city: 'Bogota', notes: 'Timbre roto' };
const order = (ref, extra = {}) => ({ reference: ref, items: [{ slug: barato.slug, qty: 2, size: 'M', color: 'Negro' }, { slug: caro.slug, qty: 1 }], shipping: SHIP, customerEmail: 'cliente@example.com', ...extra });
const expectedCents = P.priceOrder(real, [{ slug: barato.slug, qty: 2 }, { slug: caro.slug, qty: 1 }]).amountInCents;
const approve = (id, ref, cents = expectedCents) => { txns[id] = { status: 'APPROVED', reference: ref, amount_in_cents: cents, customer_email: 'cliente@example.com' }; };

try {
  console.log('\nFirma: el servidor calcula el monto y guarda el pedido');
  const R1 = 'stike-1700000000001-aaaaaa';
  const s1 = await post(A.url, 'wompi-sign', order(R1, { amount_in_cents: 100 }));
  t('firma -> 200', s1.code, 200);
  t('monto = catalogo, no el del navegador', s1.body.amount_in_cents, expectedCents);
  t('devuelve la llave publica de la config del servidor (no una escrita en el JS)', s1.body.public_key, 'pub_test_desde_el_servidor');
  t('el pedido queda guardado (fuera del repo)', existsSync(join(STORAGE, 'pending', `${R1}.json`)), true);
  const pend = JSON.parse(readFileSync(join(STORAGE, 'pending', `${R1}.json`), 'utf8'));
  t('guarda a donde enviar', pend.shipping.address, 'Calle 1 # 2-3');
  t('guarda talla y color', [pend.lines[0].size, pend.lines[0].color], ['M', 'Negro']);
  t('sin datos de envio -> rechazado', (await post(A.url, 'wompi-sign', order('stike-1700000000002-bbbbbb', { shipping: undefined }))).body.error, 'missing_shipping');
  t('envio incompleto -> rechazado', (await post(A.url, 'wompi-sign', order('stike-1700000000002-bbbbbb', { shipping: { ...SHIP, address: '' } }))).body.error, 'missing_shipping');
  t('contrato viejo (solo monto) -> rechazado', (await post(A.url, 'wompi-sign', { reference: 'stike-1700000000003-cccccc', amount_in_cents: 100, currency: 'COP' })).body.error, 'empty_order');

  console.log('\nRegreso del navegador (wompi-order)');
  txns['txn-1001'] = { status: 'PENDING', reference: R1, amount_in_cents: expectedCents };
  t('pago PENDING -> no se registra', (await post(A.url, 'wompi-order', { reference: R1, wompiId: 'txn-1001' })).body.error, 'transaction_not_approved');
  t('sin ventas todavia', (await getSales(KEY)).body, []);
  txns['txn-1001'] = { status: 'APPROVED', reference: 'stike-OTRA-referencia', amount_in_cents: expectedCents };
  t('referencia que no coincide con Wompi -> rechazado', (await post(A.url, 'wompi-order', { reference: R1, wompiId: 'txn-1001' })).body.error, 'reference_mismatch');
  t('transaccion inexistente en Wompi -> 502', (await post(A.url, 'wompi-order', { reference: R1, wompiId: 'NOEXISTE' })).code, 502);
  approve('txn-1001', R1);
  const o1 = await post(A.url, 'wompi-order', { reference: R1, wompiId: 'txn-1001', items: [{ slug: 'trucado', qty: 99 }] });
  t('pago aprobado -> 200', o1.code, 200);
  t('registra las 2 lineas del pedido guardado (ignora lo del navegador)', o1.body.recorded, 2);
  const v1 = (await getSales(KEY)).body;
  t('el panel las puede leer', v1.map(s => s.slug), [barato.slug, caro.slug]);
  t('con datos de envio y referencia', [v1[0].shipping.name, v1[0].orderRef, v1[0].source, v1[0].wompiId], ['Cliente Prueba', R1, 'wompi', 'txn-1001']);
  t('con la fecha en formato ISO del panel', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v1[0].ts), true);
  t('sin bandera de revision', v1[0].flag, undefined);
  t('el pedido pendiente se limpia', existsSync(join(STORAGE, 'pending', `${R1}.json`)), false);
  t('sale 1 correo al dueno', [emails.length, emails[0].to], [1, ['dueno@example.com']]);
  t('el correo trae direccion y total pagado', [emails[0].html.includes('Calle 1 # 2-3'), emails[0].html.includes('Total pagado'), emails[0].html.includes('Timbre roto')], [true, true, true]);
  t('el correo usa la llave de Resend', emails[0].auth, 'Bearer re_falsa');

  console.log('\nIdempotencia (recargar la pagina / reintento)');
  const o1b = await post(A.url, 'wompi-order', { reference: R1, wompiId: 'txn-1001' });
  t('segunda vez -> alreadyRecorded', o1b.body.alreadyRecorded, true);
  t('no duplica la venta', (await getSales(KEY)).body.length, 2);
  t('no manda otro correo', emails.length, 1);

  console.log('\nWebhook: el cliente pago y cerro la pestana');
  const R2 = 'stike-1700000000010-dddddd';
  await post(A.url, 'wompi-sign', order(R2));
  approve('txn-1002', R2);
  const ev = (id, ref, status = 'APPROVED', event = 'transaction.updated') => ({ event, data: { transaction: { id, reference: ref, status } }, environment: 'test' });
  const e2 = await post(A.url, 'wompi-events', ev('txn-1002', R2));
  t('evento aprobado -> 200 y registra', [e2.code, e2.body.recorded], [200, 2]);
  t('la venta esta en el panel sin que el navegador volviera', (await getSales(KEY)).body.filter(s => s.orderRef === R2).length, 2);
  t('segundo correo', emails.length, 2);
  t('evento repetido -> no duplica', (await post(A.url, 'wompi-events', ev('txn-1002', R2))).body.alreadyRecorded, true);
  t('y no manda correo de nuevo', emails.length, 2);
  t('evento de otro tipo -> se ignora', (await post(A.url, 'wompi-events', ev('txn-1002', R2, 'APPROVED', 'nequi_token.updated'))).body.ignored, 'event');
  txns['txn-1003'] = { status: 'DECLINED', reference: 'stike-1700000000011-eeeeee', amount_in_cents: 1 };
  const e3 = await post(A.url, 'wompi-events', ev('txn-1003', 'stike-1700000000011-eeeeee', 'DECLINED'));
  t('pago rechazado -> 200, no registra', [e3.code, e3.body.ignored], [200, 'status']);
  t('evento con referencia basura -> 200 ignorado', (await post(A.url, 'wompi-events', ev('txn-1003', 'x; DROP'))).body.ignored, 'invalid_reference');
  t('evento falso (Wompi no conoce esa transaccion) -> Wompi reintenta', (await post(A.url, 'wompi-events', ev('FALSA', 'stike-1700000000012-ffffff'))).code, 502);
  txns['TDOWN'] = 'down';
  t('Wompi caido -> 5xx para que reintente', (await post(A.url, 'wompi-events', ev('TDOWN', 'stike-1700000000013-gggggg'))).code >= 500, true);
  t('ninguno de esos registro nada', (await getSales(KEY)).body.length, 4);

  console.log('\nPagos que no cuadran se registran marcados, nunca se pierden');
  const R4 = 'stike-1700000000020-hhhhhh';
  await post(A.url, 'wompi-sign', order(R4));
  approve('txn-1004', R4, expectedCents + 5000000);
  await post(A.url, 'wompi-order', { reference: R4, wompiId: 'txn-1004' });
  const f4 = (await getSales(KEY)).body.filter(s => s.orderRef === R4);
  t('monto distinto al pedido -> bandera amount_mismatch', f4[0].flag, 'amount_mismatch');
  t('el correo avisa que hay que revisar', emails[emails.length - 1].html.includes('Revisar a mano'), true);
  const R5 = 'stike-1700000000030-iiiiii';
  approve('txn-1005', R5, 4500000);
  const o5 = await post(A.url, 'wompi-order', { reference: R5, wompiId: 'txn-1005' });
  const f5 = (await getSales(KEY)).body.filter(s => s.orderRef === R5);
  t('pago aprobado sin pedido guardado -> se registra igual', [o5.code, f5.length, f5[0].flag, f5[0].total], [200, 1, 'no_pending_order', 45000]);
  t('el correo avisa que no hay pedido', emails[emails.length - 1].html.includes('sin pedido guardado'), true);

  console.log('\nUn correo caido no tumba la venta');
  const R6 = 'stike-1700000000040-jjjjjj';
  await post(A.url, 'wompi-sign', order(R6));
  approve('txn-1006', R6);
  resendFails = true;
  const o6 = await post(A.url, 'wompi-order', { reference: R6, wompiId: 'txn-1006' });
  resendFails = false;
  t('venta registrada aunque el correo falle', [o6.code, o6.body.email.error], [200, 'email_failed']);
  t('y esta en el panel', (await getSales(KEY)).body.filter(s => s.orderRef === R6).length, 2);

  console.log('\nQuien puede leer las ventas (datos de clientes)');
  t('sin clave -> 401', (await getSales(null)).code, 401);
  t('clave equivocada -> 401', (await getSales('x'.repeat(32))).code, 401);
  t('clave correcta -> 200', (await getSales(KEY)).code, 200);
  t('POST no esta permitido', (await post(A.url, 'sales', {})).code, 405);

  console.log('\nFallas de configuracion (no deben abrir nada ni filtrar rutas)');
  const archivo = join(STORAGE, 'un-archivo');
  writeFileSync(archivo, 'x');
  const B = await startPhp({ ...baseEnv, STORAGE_DIR: join(archivo, 'no-se-puede'), ADMIN_API_KEY: '' });
  const bs = await post(B.url, 'wompi-sign', order('stike-1700000000050-kkkkkk'));
  t('sin poder guardar el pedido NO se firma', [bs.code, bs.body.error], [500, 'storage_unavailable']);
  t('el error no filtra rutas del servidor', JSON.stringify(bs.body).includes(STORAGE), false);
  const bk = await fetch(`${B.url}/sales.php`, { headers: { Authorization: 'Bearer cualquier-cosa' } });
  t('sin ADMIN_API_KEY configurada, sales.php no responde datos', bk.status, 500);
  B.proc.kill();

  console.log('\nLlaves de Wompi: las tres del mismo ambiente, o no se firma');
  const withKeys = async (extra, ref) => {
    const srv = await startPhp({ ...baseEnv, STORAGE_DIR: STORAGE, ADMIN_API_KEY: KEY, ...extra });
    const r = await post(srv.url, 'wompi-sign', order(ref));
    srv.proc.kill();
    return r;
  };
  const mezcla = await withKeys({ WOMPI_PUBLIC_KEY: 'pub_prod_falsa' }, 'stike-1700000000060-llllll');
  t('publica de produccion con privada de sandbox -> se niega', [mezcla.code, mezcla.body.error], [500, 'server_misconfigured']);
  t('el mensaje explica por que y no filtra las llaves', [/mismo ambiente/.test(mezcla.body.detail), JSON.stringify(mezcla.body).includes('prv_test_falsa')], [true, false]);
  t('sin llave publica -> se niega', (await withKeys({ WOMPI_PUBLIC_KEY: '' }, 'stike-1700000000061-mmmmmm')).body.error, 'server_not_configured');
  t('llave con formato que no es de Wompi -> se niega', (await withKeys({ WOMPI_PUBLIC_KEY: 'cualquier-cosa' }, 'stike-1700000000062-nnnnnn')).body.error, 'server_misconfigured');
  const prod = await withKeys({ WOMPI_PUBLIC_KEY: 'pub_prod_falsa', WOMPI_PRIVATE_KEY: 'prv_prod_falsa', WOMPI_INTEGRITY_SECRET: 'prod_integrity_falso' }, 'stike-1700000000063-oooooo');
  t('juego completo de produccion -> firma bien', [prod.code, prod.body.public_key], [200, 'pub_prod_falsa']);
  t('y la firma usa el secreto de produccion', prod.body.signature, createHash('sha256').update(`stike-1700000000063-oooooo${prod.body.amount_in_cents}COPprod_integrity_falso`).digest('hex'));
} finally {
  A.proc.kill(); wompi.close(); resend.close();
  rmSync(STORAGE, { recursive: true, force: true });
}

console.log(`\n  ${pass} pasaron, ${fail} fallaron\n`);
process.exit(fail ? 1 : 0);
