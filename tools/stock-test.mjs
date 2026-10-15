/* =========================================================================
   Prueba del motor de stock de Stike.

     node tools/stock-test.mjs

   Sin dependencias: corre con Node pelado. Cada caso de aca existe porque
   equivocarse ahi tiene consecuencia real en el sitio -- mercancia marcada
   como agotada cuando esta en la vitrina, un borrador visible, o una
   cantidad que deja comprar mas de lo que hay. Si toca data.js, corre esto.
   ========================================================================= */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const D = require(fileURLToPath(new URL('../assets/js/data.js', import.meta.url)));

let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FALLA'} ${label}${ok ? '' : `  -> dio ${JSON.stringify(got)}, esperaba ${JSON.stringify(want)}`}`);
};

console.log('\nDesconocido no es cero');
t('sin units registradas -> vendible null', D.stikeSellable({ n: 'x' }), null);
t('sin units registradas -> NO agotado',    D.stikeIsOut({ n: 'x' }), false);
t('units: 0 -> agotado',                    D.stikeIsOut({ units: 0 }), true);
t('units: 3 -> no agotado',                 D.stikeIsOut({ units: 3 }), false);

console.log('\nCombinacion minima (dos bodegas independientes)');
const dos = { sizes: [{ v: 'S', u: 0 }, { v: 'M', u: 7 }], colors: [{ v: 'Negro', u: 2 }, { v: 'Blanco', u: 0 }] };
t('mejor combinacion M+Negro = min(7,2) = 2', D.stikeSellable(dos), 2);
t('M + Negro -> 2',   D.stikeStockFor(dos, 'M', 'Negro'), 2);
t('S + Negro -> 0 (la talla manda)', D.stikeStockFor(dos, 'S', 'Negro'), 0);
t('M + Blanco -> 0 (el color manda)', D.stikeStockFor(dos, 'M', 'Blanco'), 0);
t('sin elegir -> null (falta elegir)', D.stikeStockFor(dos, null, null), null);
t('no esta agotado: hay una combinacion viva', D.stikeIsOut(dos), false);

const sinCombo = { sizes: [{ v: 'S', u: 5 }], colors: [{ v: 'Negro', u: 0 }] };
t('talla con stock pero unico color en 0 -> agotado', D.stikeIsOut(sinCombo), true);

console.log('\nUna sola dimension');
t('tallas: mejor talla, no la suma', D.stikeSellable({ sizes: [{ v: 'S', u: 1 }, { v: 'M', u: 4 }] }), 4);
t('todas las tallas en 0 -> agotado', D.stikeIsOut({ sizes: [{ v: 'S', u: 0 }, { v: 'M', u: 0 }] }), true);
t('colores: mejor color', D.stikeSellable({ colors: [{ v: 'a', u: 2 }, { v: 'b', u: 9 }] }), 9);

console.log('\nVisibilidad (la diferencia de Stike)');
t('borrador -> invisible',            D.stikeIsVisible({ published: false, units: 5 }), false);
t('publicado -> visible',             D.stikeIsVisible({ published: true, units: 5 }), true);
t('sin campo published -> visible',   D.stikeIsVisible({ units: 5 }), true);
t('AGOTADO SIGUE VISIBLE',            D.stikeIsVisible({ units: 0 }), true);

console.log('\nEl contador del panel muestra el dato crudo');
t('suma cruda de tallas', D.stikeTotalStock({ sizes: [{ v: 'S', u: 1 }, { v: 'M', u: 4 }] }), 5);

console.log('\nCombinaciones talla x color (p.combos)');
const tee = { sizes: [{ v: 'M', u: 2 }, { v: 'L', u: 1 }], colors: [{ v: 'Blanco', u: 2 }, { v: 'Negro', u: 1 }],
  combos: [{ s: 'M', c: 'Blanco', u: 1 }, { s: 'L', c: 'Blanco', u: 1 }, { s: 'M', c: 'Negro', u: 1 }, { s: 'L', c: 'Negro', u: 0 }] };
t('combo existente',                   D.stikeStockFor(tee, 'L', 'Blanco'), 1);
t('combo en 0 aunque L y Negro tengan stock por separado', D.stikeStockFor(tee, 'L', 'Negro'), 0);
t('falta elegir una de las dos -> null', D.stikeStockFor(tee, 'M', null), null);
t('total = suma de la tabla',          D.stikeTotalStock(tee), 3);
t('vendible = mejor combinacion',      D.stikeSellable(tee), 1);
t('todo en 0 -> agotado',              D.stikeIsOut({ ...tee, combos: tee.combos.map(r => ({ ...r, u: 0 })) }), true);
t('sin combos sigue el minimo de las pools', D.stikeStockFor({ sizes: tee.sizes, colors: tee.colors }, 'L', 'Negro'), 1);

console.log('\nColor redondo: tono segun el nombre');
t('negro brillante -> negro',          D.stikeColorStyle('Negro brillante'), '#16171a');
t('dos tonos -> mitades',              /^linear-gradient\(90deg,#2563c9 0 50%,#d4202c 50% 100%\)$/.test(D.stikeColorStyle('Azul/Rojo')), true);
t('cromado -> degradado',              /gradient/.test(D.stikeColorStyle('Cromado')), true);

console.log('\nPrecio por opcion (stikePriceFor / stikePriceRange)');
const timon = { price: 350000, colors: [{ v: 'Negro', u: 4 }, { v: 'Cromado', u: 3, price: 400000 }] };
t('color con precio propio',             D.stikePriceFor(timon, null, 'Cromado'), 400000);
t('color sin precio propio -> base',     D.stikePriceFor(timon, null, 'Negro'), 350000);
t('sin elegir -> base',                  D.stikePriceFor(timon, null, null), 350000);
t('rango: desde 350k hasta 400k',        D.stikePriceRange(timon), { min: 350000, max: 400000, varies: true });
t('etiqueta de tarjeta "Desde"',         D.stikePriceLabel(timon).startsWith('Desde'), true);
t('producto sin variantes con precio: no varia', D.stikePriceRange({ price: 90000, units: 2 }).varies, false);
const peg = { price: 15000, sizes: [{ v: '4.3', u: 10 }, { v: '4.5', u: 400, price: 20000 }] };
t('medida con precio propio',            D.stikePriceFor(peg, '4.5', null), 20000);
t('el color manda sobre la medida',      D.stikePriceFor({ price: 100, sizes: [{ v: 'A', u: 1, price: 500 }], colors: [{ v: 'X', u: 1, price: 300 }] }, 'A', 'X'), 300);
t('WhatsApp sin elegir dice "desde"',    D.stikeWaText({ ...timon, n: 'T', units: undefined }, {}).includes('desde $350.000'), true);
t('WhatsApp con color lleva SU precio',  D.stikeWaText({ ...timon, n: 'T' }, { color: 'Cromado' }).includes('$400.000'), true);

console.log(`\n  ${pass} pasaron, ${fail} fallaron\n`);
process.exit(fail ? 1 : 0);
