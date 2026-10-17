/* =========================================================================
   Prueba de que TODOS los productos se pueden cobrar bien.

     node tools/checkout-catalog-test.mjs

   Necesita `php` en el PATH. Levanta el PHP embebido (el mismo api/wompi-sign
   que corre en Hostinger, con llaves falsas y carpeta temporal) y, para cada
   producto publicado y cada combinacion de talla/color que el sitio deja
   elegir, comprueba que:

     - si el sitio dice "hay stock", el servidor firma el cobro y el monto es
       EXACTAMENTE el precio que el cliente ve (mismo motor que data.js);
     - si el sitio dice "agotado" o "falta elegir", el servidor NO firma;
     - pedir mas unidades de las que hay se rechaza.

   Un producto que el cliente puede meter al carrito pero el servidor rechaza
   es justo el "Error al iniciar el pago" que no se ve hasta que alguien paga.
   Corre esto despues de subir productos o tocar data.js / api/_lib.php.
   ========================================================================= */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const D = require(join(ROOT, 'assets/js/data.js'));
const P = require(join(ROOT, 'vercel-wompi-api/lib/pricing.js'));

const FREE_SHIP = 300000, SHIP_COST = 18000;
const SHIP = { name: 'Cliente Prueba', phone: '3001112233', address: 'Calle 1 # 2-3', city: 'Bogota', notes: '' };

const freePort = () => new Promise(res => { const s = createNetServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const STORAGE = mkdtempSync(join(tmpdir(), 'stike-cat-'));
const port = await freePort();
const proc = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', ROOT], {
  env: {
    ...process.env, STORAGE_DIR: STORAGE, NO_PROXY: '*', no_proxy: '*',
    WOMPI_PUBLIC_KEY: 'pub_test_falsa', WOMPI_PRIVATE_KEY: 'prv_test_falsa', WOMPI_INTEGRITY_SECRET: 'test_integrity_falso',
  },
  stdio: 'ignore',
});
for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port}/api/sales.php`); break; } catch { await new Promise(r => setTimeout(r, 100)); } }

let n = 0;
const sign = async (items) => {
  const r = await fetch(`http://127.0.0.1:${port}/api/wompi-sign.php`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reference: `stike-${String(++n).padStart(6, '0')}-catalogo`, items, shipping: SHIP }),
  });
  return { code: r.status, body: await r.json().catch(() => null) };
};

const catalog = P.parseCatalog(readFileSync(join(ROOT, 'assets/js/products-data.js'), 'utf8')).filter(p => p.published !== false);
const bad = [];
let combos = 0, buyable = 0, blocked = 0, noPrice = [];

try {
  for (const p of catalog) {
    const sizes = (p.sizes && p.sizes.length) ? p.sizes.map(x => x.v) : [null];
    const colors = (p.colors && p.colors.length) ? p.colors.map(x => x.v) : [null];
    for (const s of sizes) for (const c of colors) {
      combos++;
      const stock = D.stikeCartStock(p, s, c);                // null = sin registrar (no bloquea)
      const price = D.stikePriceFor(p, s, c);
      const sellable = stock === null || stock >= 1;
      const priced = Number.isInteger(price) && price > 0;
      const tag = `${p.slug} [${[s, c].filter(Boolean).join(' / ') || 'unico'}]`;
      const r = await sign([{ slug: p.slug, qty: 1, size: s, color: c }]);
      // El carrito del navegador (stikeSanitizeCart) tiene que dejar pasar exactamente lo que el servidor firma.
      const kept = D.stikeSanitizeCart([{ slug: p.slug, qty: 1, ...(s ? { size: s } : {}), ...(c ? { color: c } : {}) }], catalog).cart.length === 1;
      if (kept !== (r.code === 200)) bad.push(`${tag}: el carrito ${kept ? 'lo deja' : 'lo quita'} pero el servidor responde ${r.code}`);
      if (sellable && priced) {
        buyable++;
        const want = (price >= FREE_SHIP ? price : price + SHIP_COST) * 100;
        if (r.code !== 200) bad.push(`${tag}: el sitio lo deja comprar pero el servidor responde ${r.code} ${r.body && r.body.error}`);
        else if (r.body.amount_in_cents !== want) bad.push(`${tag}: el cliente ve ${price} y el servidor cobra ${r.body.amount_in_cents / 100 - (price >= FREE_SHIP ? 0 : SHIP_COST)}`);
        // si hay stock registrado, pedir uno mas debe rechazarse
        if (r.code === 200 && stock !== null && stock <= 20) {
          const over = await sign([{ slug: p.slug, qty: stock + 1, size: s, color: c }]);
          if (over.code !== 409) bad.push(`${tag}: pedir ${stock + 1} con ${stock} en stock respondio ${over.code}, esperaba 409`);
        }
      } else {
        blocked++;
        if (r.code === 200) bad.push(`${tag}: el sitio dice ${priced ? 'agotado' : 'sin precio'} pero el servidor FIRMO el cobro`);
        if (!priced) noPrice.push(tag);
      }
    }
  }
} finally {
  proc.kill();
  rmSync(STORAGE, { recursive: true, force: true });
}

console.log(`\n  ${catalog.length} productos publicados, ${combos} combinaciones talla/color`);
console.log(`  ${buyable} se pueden comprar (el servidor firma el mismo monto que ve el cliente)`);
console.log(`  ${blocked} bloqueadas (agotadas o sin precio) y el servidor tambien las rechaza`);
if (noPrice.length) console.log(`  ATENCION: ${noPrice.length} combinaciones publicadas sin precio valido:\n    ${noPrice.slice(0, 15).join('\n    ')}`);
if (bad.length) { console.log(`\n  FALLAN ${bad.length}:`); bad.slice(0, 40).forEach(b => console.log('   - ' + b)); process.exit(1); }
console.log('\n  ok: todo el catalogo se puede cobrar\n');
