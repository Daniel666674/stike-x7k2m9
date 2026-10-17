/* =========================================================================
   Prueba del "carrito sano" (stikeSanitizeCart en assets/js/data.js).

     node tools/cart-test.mjs

   Sin dependencias. El carrito vive en el navegador y puede quedar viejo:
   producto despublicado o renombrado, talla agotada, cantidad absurda. El
   servidor rechaza todo eso al cobrar; esta funcion lo arregla ANTES, y
   avisa al cliente que cambio. Cada caso es un "Error al iniciar el pago"
   que el cliente ya no ve.
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

const catalog = [
  { slug: 'plano', n: 'Plano', price: 50000, units: 5 },
  { slug: 'sin-registro', n: 'Sin registro', price: 50000 },
  { slug: 'agotado', n: 'Agotado', price: 50000, units: 0 },
  { slug: 'sin-precio', n: 'Sin precio', price: 0, units: 3 },
  { slug: 'camiseta', n: 'Camiseta', price: 80000, sizes: [{ v: 'M', u: 2 }, { v: 'L', u: 0 }], colors: [{ v: 'Negro', u: 4 }, { v: 'Blanco', u: 1 }] },
  { slug: 'solo-talla', n: 'Solo talla', price: 60000, sizes: [{ v: 'S', u: 3 }] },
];
const S = (cart) => D.stikeSanitizeCart(cart, catalog);

console.log('\nUn carrito bueno no se toca');
const ok = S([{ slug: 'plano', qty: 2 }, { slug: 'camiseta', qty: 1, size: 'M', color: 'Negro' }]);
t('sin cambios', [ok.changed, ok.notes], [false, []]);
t('devuelve las mismas lineas', ok.cart.length, 2);

console.log('\nProductos que ya no estan');
const gone = S([{ slug: 'ya-no-existe', qty: 1 }, { slug: 'plano', qty: 1 }]);
t('se quita el que no existe y se avisa', [gone.cart.map(r => r.slug), gone.notes.length, gone.changed], [['plano'], 1, true]);
t('un borrador (no esta en el catalogo visible) tambien', S([{ slug: 'borrador', qty: 1 }]).cart, []);

console.log('\nAgotado / sin precio');
t('agotado -> se quita y dice por que', [S([{ slug: 'agotado', qty: 1 }]).cart, /se agotó/.test(S([{ slug: 'agotado', qty: 1 }]).notes[0])], [[], true]);
t('sin precio -> se quita (el servidor no lo cobraria)', S([{ slug: 'sin-precio', qty: 1 }]).cart, []);
t('talla agotada -> se quita', S([{ slug: 'camiseta', qty: 1, size: 'L', color: 'Negro' }]).cart, []);
t('color agotado en esa combinacion -> se quita', S([{ slug: 'camiseta', qty: 2, size: 'M', color: 'Blanco' }]).cart[0].qty, 1);

console.log('\nCantidades');
t('mas que el stock -> se baja al stock', S([{ slug: 'plano', qty: 9 }]).cart[0].qty, 5);
t('y avisa', S([{ slug: 'plano', qty: 9 }]).notes.length, 1);
t('tope del servidor (20) cuando el stock no esta registrado', S([{ slug: 'sin-registro', qty: 500 }]).cart[0].qty, 20);
t('cantidad 0, negativa o texto -> 1', [S([{ slug: 'plano', qty: 0 }]).cart[0].qty, S([{ slug: 'plano', qty: -3 }]).cart[0].qty, S([{ slug: 'plano', qty: '2' }]).cart[0].qty], [1, 1, 1]);
t('el stock manda por talla y color (min)', S([{ slug: 'camiseta', qty: 5, size: 'M', color: 'Negro' }]).cart[0].qty, 2);

console.log('\nTalla y color');
t('producto con tallas pero la linea no trae talla -> se quita', S([{ slug: 'camiseta', qty: 1, color: 'Negro' }]).cart, []);
t('talla que ya no existe -> se quita', S([{ slug: 'camiseta', qty: 1, size: 'XXL', color: 'Negro' }]).cart, []);
const spurious = S([{ slug: 'plano', qty: 1, size: 'M', color: 'Rojo' }]);
t('talla/color de mas en un producto sin variantes -> se limpia, sin molestar al cliente', [spurious.cart, spurious.notes], [[{ slug: 'plano', qty: 1 }], []]);

console.log('\nBasura en el almacenamiento');
t('null -> carrito vacio', D.stikeSanitizeCart(null, catalog).cart, []);
t('objeto en vez de lista -> vacio', D.stikeSanitizeCart({ a: 1 }, catalog).cart, []);
t('filas sin forma -> se descartan', D.stikeSanitizeCart([null, 5, 'x', {}], catalog).cart, []);

console.log(`\n  ${pass} pasaron, ${fail} fallaron\n`);
process.exit(fail ? 1 : 0);
