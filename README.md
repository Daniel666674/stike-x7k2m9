# Stike Bike Shop — tienda BMX (Bogotá) + panel admin

Sitio para **Stike Bike Shop**, tienda BMX de Bogotá, con la identidad
**"Rueda Duro"**: fondo gris oscuro con textura de concreto, titulares en
Archivo ancho y pesado con relieve, voz "de calle" en Barlow Condensed
cursiva, y la **menta del logo (#52F0D8)** como único acento (contornos con
brillo, CTA, estados activos). Tokens en `:root` y la capa completa del
diseño al final de `assets/css/styles.css` (sección "RUEDA DURO").
Logo oficial en `assets/img/logo-stike.png` / `.webp`.

**Videos del home:** los paneles con marco menta del inicio son `<video>`.
Para activarlos, subir los `.mp4` a `assets/video/` y poner la ruta en
`STIKE_HOME_VIDEOS` al final de `index.html` (vacío = se ve la foto).

100% estático (HTML/CSS/JS sin frameworks ni build step) y con un panel
admin (`admin.html`) que habla directo con GitHub — **GitHub es el
backend**, no hay servidor ni base de datos.

> **Las reglas del motor** (qué se puede vender, qué se ve, cómo se publica)
> están en **[MOTOR.md](MOTOR.md)**, incluida la lista de en qué se aparta
> del motor de catálogo del que salió esta arquitectura. Si vas a tocar
> stock, visibilidad o la generación de fichas, ese es el documento.

> Cobra con **Wompi** (hoy en **sandbox**, no mueve plata real; ver
> "Pagos con Wompi" más abajo) y confirma el envío por WhatsApp. El carrito
> funciona con `localStorage`; el monto que se cobra lo calcula un servidor,
> nunca el navegador.

## ✨ Qué incluye

- **Multi-página**, 100% estático:
  - `index.html` — Home (hero, categorías, destacados, promo, marcas, comunidad)
  - `tienda.html` — Catálogo con **filtros** (categoría, marca, precio),
    **subcategorías**, **ordenamiento** y **búsqueda** (`?cat=`, `?sub=`, `?brand=`, `?q=`)
  - `producto/<slug>.html` — Una página **generada** por producto (galería,
    talla/color con stock real, cantidad, specs); `producto.html?id=` viejo
    redirige a la nueva URL
  - `carrito.html` — Carrito con cantidades, envío gratis y checkout por WhatsApp
  - `marcas.html`, `contacto.html`, `nosotros.html`, `armar.html` (configurador), `blog*.html`
  - `admin.html` — Panel de inventario (ver abajo)
  - `fate/` — Sitio de marca de **Fate BMX Colombia**. **No es una tienda**:
    es su propio sitio, blanco y negro, sin carrito ni precios, y no carga
    nada del CSS/JS de Stike. Todo lo suyo vive dentro de `fate/`
    (`fate/assets/{css,js,fonts,img}`), así que se puede llevar a otro
    dominio tal cual. Páginas: `fate/index.html` (home), `fate/tienda.html`
    (la **colección**: se llama así por la URL heredada, pero es un
    escaparate con enlaces "Disponible en Stike" y "Consultar" por WhatsApp),
    `fate/blog.html` (historias) y los tres artículos `historia-fate`,
    `taller-fate` y `riders-fate`. Tokens de diseño en `:root` de
    `fate/assets/css/fate.css` (solo neutros: no agregar color de acento);
    tipografía Instrument Serif + Instrument Sans, autoalojada. La colección
    es HTML a mano (no sale de `products-data.js`): una pieza nueva es un
    `<article class="item">` nuevo en `fate/tienda.html`. Las fotos de
    `fate/assets/img/` están pasadas a escala de grises y fondo blanco puro
    (el emblema es PNG negro sobre transparente). Enlazado desde `marcas.html`
    y el home de Stike; `marca-fate.html` viejo redirige acá.
- **Catálogo** en `assets/js/products-data.js` (`window.STIKE_PRODUCTS`, JS
  plano no JSON, para poder incluirlo con `<script src>` sin fetch/CORS).
  Cada producto puede tener **tallas y/o colores como pools de stock
  independientes** (ver `SIZE_CATEGORIES` en `assets/js/data.js`); si tiene
  ambos, la cantidad vendible de una combinación es el mínimo de las dos.
- **Textos editables** (hero de home + título/subtítulo de cada categoría)
  en `data/site-content.json`, editables desde el panel admin, aplicados por
  presencia de clave (ver pestaña "Contenido del sitio").

## 🔐 Panel admin (`admin.html`)

App de una sola página, sin build, que lee y escribe directo la API de
contenidos de GitHub (`assets/js/products-data.js`, `producto/*.html`,
`sitemap.xml`, y los archivos internos en `data/`).

- **Acceso**: ⚠️ **pendiente** — hoy entra directo, sin login, y las firmas
  de commit/ventas/auditoría usan un `session.email` fijo en `admin.js`. Lo
  único que realmente controla quién puede *publicar* es el token de GitHub
  (siguiente punto), y sin token el panel muestra datos de ejemplo, no los
  reales. Falta conectar Google Sign-In contra lista blanca: los campos ya
  están en `assets/js/site.js` (`OAUTH_CLIENT_ID`, `ADMIN_EMAILS`,
  `OWNER_EMAILS`) y mientras `ADMIN_EMAILS` esté vacío el panel se comporta
  como hasta hoy. `OWNER_EMAILS` es el segundo nivel: quién ve costos y
  márgenes (el código de roles ya existe, hoy todos entran como dueño).
- **Token de GitHub**: cada admin pega su propio Personal Access Token
  (fine-grained, permiso *Contents: Read and write* sobre este repo) en la
  pestaña "Configuración". Se guarda solo en `localStorage` de ese
  navegador, nunca se publica.
- **Rama de publicación**: `CONFIG.branch` en `admin.js` (hoy
  `main`, la misma que dispara el deploy a GitHub
  Pages — ver `.github/workflows/deploy.yml`).
- **Costos internos**: `data/costs.json` (nunca se publica en
  `products-data.js` ni aparece en la ficha de ningún producto). Desde el
  workflow de deploy, ese archivo y `data/sales-log.json` y
  `data/audit-log.json` **se excluyen del sitio publicado**, y un paso del
  workflow falla el deploy si alguna de esas rutas responde 200 en vivo.
  `data/site-content.json` sí queda público a propósito: el sitio lo
  consulta en vivo para los textos editables.
  Ojo: el repositorio es **público**, así que esos archivos siguen siendo
  legibles en github.com. Excluirlos del deploy cierra una puerta, no las
  dos — ver la nota al final de [MOTOR.md](MOTOR.md#5-publicar).
- **Reglas de correctitud** (uniqueness de slug/SKU en dos pasadas, nombres
  de foto aleatorios, merge de 3 vías campo por campo al publicar,
  reintento con backoff en conflictos 409, validación completa antes de
  publicar) están documentadas como comentarios en `admin.js`.
- **Editor de fotos**: el ✎ en cada miniatura del grid de fotos (dentro del
  editor de un producto) abre `assets/js/photo-editor.js` — girar 90°,
  voltear, recortar (arrastrando el cuadro), brillo/contraste/saturación,
  "Auto" de brillo (nivela la exposición de esta foto contra un valor
  estándar, para que varias fotos con distinta luz queden parejas) y
  "Emparejar fondo blanco" (mismo algoritmo que `tools/whiten-bg.mjs`,
  corrido en el navegador). Funciona igual para una foto recién agregada
  que para una ya publicada: al guardar, queda en el mismo lugar que
  ocupaba una foto nueva (`pendingUploads`) y se sube al publicar, como
  cualquier otro cambio sin guardar todavía.

## ▶️ Cómo verlo

```bash
# desde la carpeta del repo:
python3 -m http.server 8000
# abre http://localhost:8000/
```

Las páginas llevan `<base href="/">` (el sitio vive en la raíz de
`stikebikeshop.com`), así que se sirve directo desde esta carpeta. Si alguna
vez `BASE_PATH` en `assets/js/site.js` vuelve a ser un subdirectorio, hay que
servir desde el directorio que lo contiene (y correr `node tools/build-pages.mjs`).
`tools/wompi-dev-server.mjs` lo hace solo: sirve bajo la ruta base de `site.js`.
Este servidor no corre el PHP de los pagos; para probarlo, `php -S`.

`admin.html` funciona igual en local, pero para cargar o publicar necesita
un token de GitHub real con acceso de escritura a este repo.

## 🛠️ Personalizar

- **Dominio y URL del sitio:** `assets/js/site.js`. Cambiar `DOMAIN` y
  `BASE_PATH` y correr `node tools/build-pages.mjs` reescribe las 52 fichas,
  el sitemap, el robots.txt y el `<base href>` de todas las páginas. Es el
  único lugar donde vive el dominio; no lo escribas a mano en ningún HTML.
- **Datos de contacto / redes:** `STIKE_CONFIG` al inicio de `assets/js/app.js`.
  (El número de WhatsApp está también en `site.js`, porque lo usan las fichas
  generadas; `tools/build-pages.mjs` se niega a generar si los dos no
  coinciden.)
- **Reglas de stock y visibilidad:** bloque `MOTOR DE STOCK` en
  `assets/js/data.js`. Después de tocarlo, `node tools/stock-test.mjs`.
- **Categorías, marcas, tallas obligatorias, códigos de SKU:**
  `assets/js/data.js` (`STIKE_CATEGORIES`, `STIKE_BRANDS`, `SIZE_CATEGORIES`,
  `SKU_CAT_CODES`).
- **Catálogo:** editable a mano en `assets/js/products-data.js`, pero el
  flujo real es el panel admin (mantiene slugs/SKUs únicos, sube fotos,
  regenera las páginas de producto y el sitemap).
- **Fondo blanco parejo en fotos de producto:** las tarjetas y la ficha
  pintan la plaqueta de blanco puro (`assets/css/styles.css`) porque las
  fotos de repuestos son cutouts de estudio con fondo blanco. Una foto de
  celular sobre papel (como las de ropa) trae el papel gris/tinturado,
  viñeteado y a veces el doblez del papel como una sombra dura, y de foto
  a foto el blanco no queda igual. `npm install` (una sola vez, instala
  `sharp`) y despues `node tools/whiten-bg.mjs <foto.jpg>...` lo corrige:
  ajusta de forma robusta una superficie de color por el marco exterior
  (descartando puntos del marco que en realidad son prenda), clasifica
  cada pixel por que tan lejos esta de esa superficie y limpia esa
  clasificación con morfología (cierre + apertura) para que un doblez de
  papel — una línea delgada — desaparezca sin comerse texto o bordado
  claro de la prenda — un bloque sólido. El fondo confirmado se funde a un
  blanco EXACTO e idéntico en todas las fotos; si el marco no resulta
  creíble (la prenda llega casi hasta el borde, sin fondo real que medir),
  la foto se deja intacta en vez de arruinarla. `--preview` escribe
  `foto.preview.jpg` en vez de pisar el original. El mismo algoritmo corre
  en el navegador dentro del editor de fotos del panel (ver el punto
  siguiente).
- **Colores / tipografía / estilos:** variables CSS en `assets/css/styles.css` (`:root`).
- **Textos del hero/categorías:** pestaña "Contenido del sitio" en el admin,
  o directo en `data/site-content.json`.

## 🚀 Deploy

**Hoy** (demo): GitHub Pages. `.github/workflows/deploy.yml` publica todo el
repo en cada push a la rama configurada usando `actions/deploy-pages`; no hace
falta ningún secret, solo que "GitHub Actions" esté seleccionado como fuente en
Settings → Pages.

**Destino final: Hostinger, en `stikebikeshop.com`** (ya aplicado en
`assets/js/site.js`). GitHub sigue siendo el lugar donde se edita (el panel admin
publica ahí) y de donde sale el HTML generado; Hostinger solo sirve el resultado y
corre el PHP de los pagos. `.github/workflows/deploy-hostinger.yml` corre en cada
publicación del panel: arma una copia limpia (sin costos, ventas, herramientas ni
el backend de Vercel; la lista está en `tools/stage-hostinger.sh`) y la sube por
FTP. Tarda uno o dos minutos desde que se publica hasta que se ve en el sitio.
El workflow de GitHub Pages (`deploy.yml`) quedó solo manual: con la ruta base `/`
dejaría la demo sin estilos.

`.htaccess` es la configuración de Hostinger (HTTPS y sin `www`, rutas `/api/…`,
archivos internos bloqueados, cacheo de 1 año immutable en JS/CSS/imágenes/video,
HTML sin cache, CSP con Wompi). GitHub Pages no lo lee, así que en la demo no
hace nada. El cache-busting real es el query
string `?v=N` en cada referencia a un archivo compartido; si editás el
CONTENIDO de `styles.css`/`data.js`/`app.js`/etc. acordate de subir ese
número en todos los HTML que lo referencian, si no los visitantes con
cache del navegador siguen viendo la versión vieja.

> Esto sigue siendo **a mano** y es el footgun que queda en pie:
> `tools/build-pages.mjs` no toca esos números. Automatizarlo (sellar el
> `?v=` con un hash del contenido del archivo, en el momento del deploy) es
> un cambio chico y pendiente; hoy la mitigación es acordarse, y que un
> visitante nuevo nunca ve el problema.

## 💳 Pagos con Wompi

Hoy en **sandbox** (no mueve plata real). Pasar a plata real es cambiar llaves y
un par de configuraciones, no código: ver "Salir a producción".

**Cómo funciona.**

1. El carrito manda al servidor los productos (`slug` + cantidad + talla/color) y
   los datos de envío, **nunca un monto**.
2. El servidor calcula el total con los precios del catálogo publicado (subtotal +
   envío, gratis desde $300.000), **guarda el pedido** y firma ese monto con el
   secreto de integridad de Wompi. El navegador abre el widget de Wompi con eso.
3. Cuando Wompi aprueba el pago, la venta se registra por **dos caminos** que no
   se pisan (idempotente por referencia): el regreso del cliente a
   `pago-resultado.html` (`wompi-order`) y el **webhook** de Wompi
   (`wompi-events`), que funciona aunque el cliente pague y cierre la pestaña.
   Ninguno confía en lo que diga el navegador: se le pregunta a Wompi con la llave
   privada y la venta sale del pedido guardado en el paso 2.
4. Cada venta queda en **tres lugares**: el servidor de Hostinger
   (`ventas.jsonl`), el **correo al dueño** y el **panel admin** (pestaña
   Ventas, que las lee de Hostinger).

**Dónde viven los datos de los clientes.** En una carpeta `stike-private/` al lado
de `public_html` en Hostinger (fuera de lo que sirve el sitio) y en el correo al
dueño. **Nunca en este repositorio**, que es público. Ventas marcadas con ⚠ en el
panel: el monto cobrado no coincide con el pedido, o Wompi aprobó un pago del que
no hay pedido guardado; el correo lo avisa y hay que confirmarlo a mano.

**Archivos.**

- `api/` (Hostinger, PHP): `wompi-sign.php`, `wompi-order.php`, `wompi-events.php`,
  `sales.php` (lo lee el panel, exige clave), `wompi-status.php`, y `_lib.php`
  (lo compartido). Las constantes de envío (`FREE_SHIP`, `SHIP_COST`) están en
  `carrito.html`, `api/_lib.php` y `vercel-wompi-api/lib/pricing.js`: si se
  cambian, cambiarlas en los tres.
- `vercel-wompi-api/` (demo en GitHub Pages): backend temporal en Vercel que
  existe porque Pages no corre PHP. Se borra cuando el sitio viva en Hostinger.
  **Nunca poner llaves de producción en Vercel.**
- `assets/js/wompi.js` elige solo el backend: en `stikebikeshop.com` usa el PHP del
  mismo sitio, en cualquier otro dominio usa Vercel.
- Pruebas (todas sin red ni llaves reales):
  `node tools/wompi-pricing-test.mjs` (38, cálculo de precio y ataque de monto
  falso), `node tools/hostinger-api-test.mjs` (49, los endpoints PHP con un Wompi y
  un Resend falsos; necesita `php`) y `node tools/admin-online-sales-test.mjs`
  (21, el panel con ventas de dos fuentes; necesita `npm install playwright`) y
  `node tools/domain-flip-test.mjs` (12, el cambio de dominio de ida y vuelta en
  una copia: que no queden URL con la ruta vieja de GitHub Pages).

**Salir a producción (en este orden).**

1. **Hostinger:** el dominio `stikebikeshop.com` agregado al plan Business como su
   propio sitio, con SSL activo y PHP 8.x. La primera vez el sitio se sube como ZIP
   en el asistente de hPanel y las fotos por el Administrador de archivos.
2. **Datos legales:** completar `legalName` y `nit` en `STIKE_CONFIG`
   (`assets/js/app.js`); hoy las páginas de términos y privacidad muestran
   `[NIT — completar]`. La cuenta de producción de Wompi se activa en
   comercios.wompi.co a nombre del negocio.
3. **Secretos del servidor:** crear `public_html/api/config.local.php` con el
   Administrador de archivos (nunca en el repo), primero con las llaves de
   **sandbox**:

   ```php
   <?php return [
     'WOMPI_INTEGRITY_SECRET' => 'test_integrity_...',
     'WOMPI_PRIVATE_KEY'      => 'prv_test_...',
     'ADMIN_API_KEY'          => '<una clave larga al azar, mínimo 24 caracteres>',
     'RESEND_API_KEY'         => 're_...',               // opcional, ver nota
     'OWNER_NOTIFY_EMAIL'     => 'dueno@correo.com',     // opcional
   ];
   ```
   `ADMIN_API_KEY` se inventa (por ejemplo con un generador de contraseñas) y se
   pega una vez en el panel, pestaña Configuración → "Clave del servidor de
   ventas". Sin `RESEND_API_KEY` el correo sale con el `mail()` del hosting, que
   puede caer en spam; con Resend (gratis, resend.com) llega confiable, y para
   enviar desde `@stikebikeshop.com` hay que verificar el dominio ahí.
4. **Login del panel en el dominio nuevo:** en Google Cloud Console → APIs y
   servicios → Credenciales → el ID de cliente OAuth de `site.js`
   (`OAUTH_CLIENT_ID`) → "Orígenes autorizados de JavaScript", agregar
   `https://stikebikeshop.com`. Sin eso Google rechaza el inicio de sesión en
   `https://stikebikeshop.com/admin.html` (`origin_mismatch`) y el panel no abre.
5. **Publicación automática:** en hPanel → Archivos → Cuentas FTP crear una cuenta
   cuya carpeta sea la `public_html` **de stikebikeshop.com** (no la de otro sitio
   del plan: sobrescribiría archivos). En GitHub → Settings → Secrets and
   variables → Actions agregar `FTP_SERVER`, `FTP_USERNAME` y `FTP_PASSWORD`
   (y `FTP_SERVER_DIR` si hace falta). Correr una vez a mano Actions →
   "Publish to Hostinger" → Run workflow con **dry_run** marcado (solo lista lo
   que subiría) y, si la lista es la esperada, otra vez sin marcarlo.
6. **Verificar en el dominio real:** el sitio carga; `https://stikebikeshop.com/data/costs.json`
   responde 403 o 404 (no el archivo); `https://stikebikeshop.com/api/sales` sin
   clave responde 401; "Pagar ahora" abre Wompi y la consola del navegador no
   muestra líneas `Refused to…` (si las hay, dicen qué host agregar al CSP del
   `.htaccess`); el panel abre con Google y publica un cambio de prueba que llega
   al sitio en un par de minutos.
7. **Prueba en sandbox sobre el dominio final** con una tarjeta de prueba de
   Wompi: la venta aparece en el panel y llega el correo.
8. **Producción:** poner las llaves `prod` en `api/config.local.php`;
   `WOMPI_PUBLIC_KEY` (`pub_prod_…`) en `assets/js/wompi.js` y subir su `?v=` en
   `carrito.html` y `pago-resultado.html`; en el panel de Wompi (Desarrolladores)
   configurar la **URL de eventos** `https://stikebikeshop.com/api/wompi-events`
   (exactamente así: con https y sin `www`, una redirección perdería el aviso).
9. **Prueba real** con un pedido pequeño y tarjeta propia; verificar panel y
   correo, y devolver el pago desde el panel de Wompi.
10. **Limpieza:** borrar el proyecto `stike-wompi-api` de Vercel y la carpeta
    `vercel-wompi-api/`. (`data/sales-log.json` ya quedó en `[]`: las ventas de
    prueba del sandbox se vaciaron al cambiar de dominio.)

**Lo que no está resuelto ni probado:**

- **Stock:** una venta online no descuenta unidades (la venta a mano del panel sí).
  El servidor valida que el producto exista, esté publicado y tenga precio. Hoy lo
  cubre la confirmación por WhatsApp.
- **Sin probar en el hosting real:** el `.htaccess` (redirecciones, rutas `/api/…`,
  bloqueos), el CSP contra el widget de Wompi, la subida por FTP a Hostinger
  (la acción solo borra lo que ella misma subió, así que `api/config.local.php`,
  que no está en el repo, no se toca) y la entrega de `mail()`. Todo esto se
  verifica en los pasos 5 a 7.
- **Respaldos:** `ventas.jsonl` vive solo en Hostinger (más el correo de cada
  venta). No está confirmado que los respaldos automáticos del plan incluyan
  carpetas fuera de `public_html`: verificarlo en hPanel o descargar la carpeta
  `stike-private/` cada cierto tiempo. Si se prefiere dentro de `public_html`,
  `STORAGE_DIR` en `config.local.php` lo permite (se bloquea el acceso web solo).
- **Webhook sin checksum:** `wompi-events.php` no valida el checksum del evento a
  propósito (explicación en el archivo): le pregunta a Wompi por la transacción,
  así que un evento falso no registra nada.

## 🗂️ Estructura

```
bmxstore/
├── index.html  tienda.html  carrito.html  marcas.html
├── contacto.html  nosotros.html  armar.html  blog*.html
├── admin.html  admin.js  admin-sw.js       ← panel de inventario
├── _template.html                          ← plantilla de producto/<slug>.html
├── producto/<slug>.html                    ← una página generada por producto
├── MOTOR.md                                ← las reglas del motor
├── tools/                                  ← build y pruebas (Node, no van al sitio)
│   ├── build-pages.mjs      regenera fichas/sitemap/robots/<base href>
│   ├── stock-test.mjs       19 casos del motor de stock, sin dependencias
│   ├── e2e-test.mjs         24 casos en navegador real (Playwright)
│   └── photo-test.mjs       el PNG transparente (Playwright)
├── data/
│   ├── costs.json          (interno, nunca se publica al sitio)
│   ├── sales-log.json      (ventas, append-only)
│   ├── audit-log.json      (auditoría de publicaciones, append-only)
│   └── site-content.json   (textos editables del sitio)
└── assets/
    ├── css/styles.css
    └── js/{site.js, products-data.js, data.js, app.js, pdp.js, pdp-render.js, animations.js}
```

---
**Antes de operar con el negocio:** conectar el acceso al panel (Google
Sign-In, ver arriba), completar los datos legales (`legalName` y `nit` en
`STIKE_CONFIG`, hoy con placeholders visibles en las páginas de términos y
privacidad) y revisar que los costos de `data/costs.json` sean los reales.
