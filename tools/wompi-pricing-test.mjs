/* =========================================================================
   Prueba del calculo de precio en el servidor (vercel-wompi-api/lib/pricing.js).

     node tools/wompi-pricing-test.mjs

   Sin dependencias. Cada caso existe porque equivocarse aca es plata real:
   un monto menor al verdadero (el cliente paga de menos) o mayor (le
   cobramos de mas). Si toca pricing.js o las constantes de envio de
   carrito.html, corre esto.
   ========================================================================= */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const P = require(fileURLToPath(new URL('../vercel-wompi-api/lib/pricing.js', import.meta.url)));

let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FALLA'} ${label}${ok ? '' : `  -> dio ${JSON.stringify(got)}, esperaba ${JSON.stringify(want)}`}`);
};
const code = (fn) => { try { fn(); return null; } catch (e) { return e.code || `otro: ${e.message}`; } };

const cat = [
  { slug: 'barato',  n: 'Barato',  price: 100000 },
  { slug: 'caro',    n: 'Caro',    price: 1850000 },
  { slug: 'borrador', n: 'Borrador', price: 50000, published: false },
  { slug: 'sin-precio', n: 'Sin precio', price: 0 },
];

console.log('\nEl monto sale del catalogo');
const a = P.priceOrder(cat, [{ slug: 'barato', qty: 2 }]);
t('2 x 100.000 = subtotal 200.000', a.subtotal, 200000);
t('bajo el umbral cobra envio',     a.shipping, P.SHIP_COST);
t('total = subtotal + envio',       a.total, 200000 + P.SHIP_COST);
t('centavos = total x 100',         a.amountInCents, (200000 + P.SHIP_COST) * 100);

console.log('\nEnvio gratis (umbral inclusivo, igual que carrito.html)');
t('justo en el umbral -> gratis',  P.priceOrder(cat, [{ slug: 'barato', qty: 3 }]).shipping, 0);
t('un peso debajo -> cobra envio', P.priceOrder([{ slug: 'x', n: 'x', price: P.FREE_SHIP - 1 }], [{ slug: 'x', qty: 1 }]).shipping, P.SHIP_COST);
t('producto caro -> gratis',       P.priceOrder(cat, [{ slug: 'caro', qty: 1 }]).total, 1850000);

console.log('\nVarias lineas');
const m = P.priceOrder(cat, [{ slug: 'barato', qty: 1 }, { slug: 'barato', qty: 1, size: 'M' }, { slug: 'caro', qty: 1 }]);
t('suma todas las lineas', m.subtotal, 100000 + 100000 + 1850000);
t('devuelve una linea por item', m.lines.length, 3);

console.log('\nLo que mande el navegador no cuenta');
const trucado = P.priceOrder(cat, [{ slug: 'caro', qty: 1, price: 1, unitPrice: 1, total: 1, amount_in_cents: 100 }]);
t('precio trucado en el item se ignora', trucado.total, 1850000);

console.log('\nRechaza lo que no cuadra');
t('carrito vacio',            code(() => P.priceOrder(cat, [])), 'empty_order');
t('items no es lista',        code(() => P.priceOrder(cat, null)), 'empty_order');
t('slug que no existe',       code(() => P.priceOrder(cat, [{ slug: 'fantasma', qty: 1 }])), 'unknown_product');
t('borrador (published:false)', code(() => P.priceOrder(cat, [{ slug: 'borrador', qty: 1 }])), 'unknown_product');
t('producto sin precio',      code(() => P.priceOrder(cat, [{ slug: 'sin-precio', qty: 1 }])), 'product_without_price');
t('cantidad 0',               code(() => P.priceOrder(cat, [{ slug: 'barato', qty: 0 }])), 'invalid_qty');
t('cantidad negativa',        code(() => P.priceOrder(cat, [{ slug: 'caro', qty: -1 }])), 'invalid_qty');
t('cantidad decimal',         code(() => P.priceOrder(cat, [{ slug: 'barato', qty: 1.5 }])), 'invalid_qty');
t('cantidad como texto',      code(() => P.priceOrder(cat, [{ slug: 'barato', qty: '1' }])), 'invalid_qty');
t('cantidad sobre el tope',   code(() => P.priceOrder(cat, [{ slug: 'barato', qty: P.MAX_QTY + 1 }])), 'invalid_qty');
t('item sin slug',            code(() => P.priceOrder(cat, [{ qty: 1 }])), 'invalid_item');
t('demasiadas lineas',        code(() => P.priceOrder(cat, Array.from({ length: P.MAX_LINES + 1 }, () => ({ slug: 'barato', qty: 1 })))), 'too_many_lines');

console.log('\nCatalogo real (assets/js/products-data.js)');
const real = P.parseCatalog(readFileSync(fileURLToPath(new URL('../assets/js/products-data.js', import.meta.url)), 'utf8'));
t('se lee y trae productos', real.length > 0, true);
const publicados = real.filter(p => p.published !== false);
t('todo producto publicado tiene precio entero > 0',
  publicados.filter(p => !Number.isInteger(p.price) || p.price <= 0).map(p => p.slug), []);
t('un publicado real se puede cobrar', code(() => P.priceOrder(real, [{ slug: publicados[0].slug, qty: 1 }])), null);
t('catalogo ilegible -> error claro', code(() => P.parseCatalog('<html>404</html>')), 'catalog_parse_failed');

/* ---- El endpoint completo (wompi-sign.js), con el catalogo real servido
        desde un servidor local para no depender de la red ---------------- */
console.log('\nEndpoint wompi-sign (peticion simulada)');
const { createServer } = await import('node:http');
const { createHash } = await import('node:crypto');
const catalogText = readFileSync(fileURLToPath(new URL('../assets/js/products-data.js', import.meta.url)), 'utf8');
const srv = createServer((_, r) => r.end(catalogText));
await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
process.env.CATALOG_URL = `http://127.0.0.1:${srv.address().port}/products-data.js`;
process.env.WOMPI_INTEGRITY_SECRET = 'test_integrity_secreto_de_prueba';
delete process.env.ALLOWED_ORIGINS;
const sign = require(fileURLToPath(new URL('../vercel-wompi-api/api/wompi-sign.js', import.meta.url)));

const call = async (method, body, headers = {}) => {
  const res = { code: 200, headers: {}, body: null,
    setHeader(k, v) { this.headers[k] = v; }, status(n) { this.code = n; return this; },
    json(o) { this.body = o; return this; }, end() { return this; } };
  await sign({ method, body, headers }, res);
  return res;
};
const caro = publicados.reduce((a, p) => (p.price > a.price ? p : a));
const REF = 'stike-1700000000000-abc123';

const ok = await call('POST', { reference: REF, items: [{ slug: caro.slug, qty: 1 }] });
t('pedido valido -> 200', ok.code, 200);
t('monto = precio del catalogo (+ envio si aplica)', ok.body.amount_in_cents, P.priceOrder(real, [{ slug: caro.slug, qty: 1 }]).amountInCents);
t('la firma ata ESE monto',
  ok.body.signature,
  createHash('sha256').update(`${REF}${ok.body.amount_in_cents}COP${process.env.WOMPI_INTEGRITY_SECRET}`).digest('hex'));

const ataque = await call('POST', { reference: REF, amount_in_cents: 100, total: 1, items: [{ slug: caro.slug, qty: 1 }] });
t('ATAQUE: amount_in_cents:100 se ignora', ataque.body.amount_in_cents, ok.body.amount_in_cents);
t('ATAQUE: la firma no cambia con el monto falso', ataque.body.signature, ok.body.signature);
t('solo monto, sin items -> rechazado', (await call('POST', { reference: REF, amount_in_cents: 100000, currency: 'COP' })).code, 400);
t('producto inexistente -> 400', (await call('POST', { reference: REF, items: [{ slug: 'fantasma', qty: 1 }] })).code, 400);
t('referencia con caracteres raros -> 400', (await call('POST', { reference: 'x; DROP', items: [{ slug: caro.slug, qty: 1 }] })).code, 400);
t('GET no esta permitido -> 405', (await call('GET', null)).code, 405);
t('sin ALLOWED_ORIGINS responde *', ok.headers['Access-Control-Allow-Origin'], '*');

process.env.ALLOWED_ORIGINS = 'https://stikebikeshop.com';
const propio = await call('POST', { reference: REF, items: [{ slug: caro.slug, qty: 1 }] }, { origin: 'https://stikebikeshop.com' });
const ajeno = await call('POST', { reference: REF, items: [{ slug: caro.slug, qty: 1 }] }, { origin: 'https://otro-sitio.com' });
t('CORS: origen permitido se refleja', propio.headers['Access-Control-Allow-Origin'], 'https://stikebikeshop.com');
t('CORS: origen ajeno no recibe permiso', ajeno.headers['Access-Control-Allow-Origin'], undefined);
srv.close();

console.log(`\n  ${pass} pasaron, ${fail} fallaron\n`);
process.exit(fail ? 1 : 0);
