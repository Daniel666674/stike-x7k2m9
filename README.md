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

> Vende por WhatsApp: no hay pasarela de pago. El carrito funciona con
> `localStorage` y el checkout arma un mensaje de WhatsApp con el pedido.

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
# desde el directorio que CONTIENE bmxstore/, no desde adentro:
python3 -m http.server 8000
# abre http://localhost:8000/bmxstore/
```

Tiene que ser así porque las páginas llevan `<base href="/bmxstore/">` (el
sitio vive en un subdirectorio en GitHub Pages). Servido desde adentro, los
`assets/` dan 404 y la página carga sin JavaScript ni estilos. Cuando el
sitio pase a su dominio propio, `BASE_PATH` en `assets/js/site.js` pasa a
`"/"` y se sirve desde adentro con normalidad.

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

Esto es una demo sin hosting propio: **GitHub Pages es el único deploy
real**. `.github/workflows/deploy.yml` publica todo el repo en cada push a
la rama configurada (hoy `main`) usando
`actions/deploy-pages`; no hace falta ningún secret, solo que "GitHub
Actions" esté seleccionado como fuente en Settings → Pages del repo (ya
lo estaba, porque el sitio ya vivía en
`https://daniel666674.github.io/bmxstore/` antes de este cambio).

`.htaccess` queda en el repo como referencia de la configuración
(cacheo de 1 año immutable en JS/CSS/imágenes/video, HTML sin cache, CSP)
que aplicaría si algún día esto se muda a un hosting real tipo Apache —
GitHub Pages no lee `.htaccess` ni permite headers custom, así que hoy no
está activo. El cache-busting real que SÍ aplica en Pages es el query
string `?v=N` en cada referencia a un archivo compartido; si editás el
CONTENIDO de `styles.css`/`data.js`/`app.js`/etc. acordate de subir ese
número en todos los HTML que lo referencian, si no los visitantes con
cache del navegador siguen viendo la versión vieja.

> Esto sigue siendo **a mano** y es el footgun que queda en pie:
> `tools/build-pages.mjs` no toca esos números. Automatizarlo (sellar el
> `?v=` con un hash del contenido del archivo, en el momento del deploy) es
> un cambio chico y pendiente; hoy la mitigación es acordarse, y que un
> visitante nuevo nunca ve el problema.

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
