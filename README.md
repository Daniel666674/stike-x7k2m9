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
  - `carrito.html` — Carrito con cantidades; el envío NO se cobra (se cotiza por WhatsApp y lo paga el cliente) y checkout por WhatsApp o Wompi
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
el backend de Vercel; la lista está en `tools/stage-hostinger.sh`) y la deja en la
rama `hostinger-deploy` (`tools/publish-hostinger.sh`) y le avisa a `api/sync.php`,
**el servidor de Hostinger baja ese commit de GitHub** y actualiza el sitio: no hay
contraseñas FTP, y el único secret en GitHub es el token del aviso. Tarda uno o dos
minutos desde que se publica hasta que se ve en el sitio. (Se probó subir por FTP
desde GitHub Actions y Hostinger corta la conexión de datos —`ECONNRESET`— con FTP y
con FTPS; y el "Git" de hPanel no llegó a conectar.) La primera instalación y el
`SYNC_TOKEN` están en el paso 5 de "Salir a producción". El instalador de un solo
archivo es `tools/instalar-hostinger.php`.
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

El servidor decide si cobra en **sandbox** (no mueve plata real) o en
**producción** según las llaves de `api/config.local.php`; el código es el mismo.
Cambiar de uno a otro es cambiar esas llaves: ver "Salir a producción".

**Cómo funciona.**

1. El carrito manda al servidor los productos (`slug` + cantidad + talla/color) y
   los datos de envío, **nunca un monto**.
2. El servidor calcula el total con los precios del catálogo publicado (**solo los
   productos: el envío no se cobra en el pago**), **guarda el pedido** y firma ese monto
   con el secreto de integridad de Wompi. El navegador abre el widget de Wompi con eso.
   **El envío** se calcula para cada pedido (ciudad, peso, transportadora), se le comparte
   al cliente por WhatsApp y **corre por su cuenta**: el carrito lo explica (aviso, línea
   «Se cotiza por WhatsApp» y una casilla obligatoria que el servidor anota como
   `shippingAck`), la página de pago exitoso le da un botón de WhatsApp con la ciudad, el
   correo de nueva venta dice «el envío NO se cobró» con un botón de WhatsApp al cliente,
   y el detalle de la venta en el panel trae lo mismo. Las páginas `envios.html`,
   `terminos.html`, las preguntas frecuentes y las fichas dicen lo mismo; no hay tarifa
   fija ni «gratis desde» en ningún lado (tampoco en los datos de Google).
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
  (lo compartido). El monto a cobrar (solo productos) lo calculan igual
  `carrito.html`, `api/_lib.php` y `vercel-wompi-api/lib/pricing.js`: si se cambia
  la regla, cambiarla en los tres.
- `vercel-wompi-api/` (demo en GitHub Pages): backend temporal en Vercel que
  existe porque Pages no corre PHP. Se borra cuando el sitio viva en Hostinger.
  **Nunca poner llaves de producción en Vercel.**
- `assets/js/wompi.js` elige solo el backend: en `stikebikeshop.com` usa el PHP del
  mismo sitio (y abre el widget con la llave pública que el servidor le devuelve,
  de `config.local.php`); en cualquier otro dominio usa Vercel.
- Pruebas (todas sin red ni llaves reales):
  `node tools/wompi-pricing-test.mjs` (38, cálculo de precio y ataque de monto
  falso), `node tools/hostinger-api-test.mjs` (56, los endpoints PHP con un Wompi y
  un Resend falsos; necesita `php`) y `node tools/admin-online-sales-test.mjs`
  (21, el panel con ventas de dos fuentes; necesita `npm install playwright`) y
  `node tools/sync-test.mjs` (29, la actualización desde GitHub con un GitHub falso; necesita
  `php` y `git`) y `node tools/domain-flip-test.mjs` (12, el cambio de dominio de ida y vuelta en
  una copia: que no queden URL con la ruta vieja de GitHub Pages).

**Salir a producción (en este orden).**

1. **Hostinger:** el dominio `stikebikeshop.com` agregado al plan Business como su
   propio sitio, con SSL activo y PHP 8.x. La primera vez el sitio se sube como ZIP
   en el asistente de hPanel y las fotos por el Administrador de archivos.
2. **Datos legales y de contacto:** `legalName`, `nit`, `email` y `address` ya están
   en `STIKE_CONFIG` (`assets/js/app.js`) y los muestran las páginas de términos,
   privacidad y contacto (el correo y la dirección también van en los datos
   estructurados de `index.html`). Si cambian (por ejemplo al constituir una
   S.A.S.), se editan ahí y se sube el `?v=` de `app.js` en todas las páginas. El
   mapa de `contacto.html` sigue apuntando a "Venecia, Bogotá" (nivel barrio);
   cuando se confirme en Google Maps el pin de la dirección exacta, se cambia el
   `q=` del mapa. La cuenta de Wompi de producción ya está activa
   (comercios.wompi.co).
3. **Secretos del servidor:** crear `public_html/api/config.local.php` con el
   Administrador de archivos (nunca en el repo; hay una plantilla lista con los
   campos), primero con las llaves de **sandbox**:

   ```php
   <?php return [
     'WOMPI_PUBLIC_KEY'       => 'pub_test_...',
     'WOMPI_PRIVATE_KEY'      => 'prv_test_...',
     'WOMPI_INTEGRITY_SECRET' => 'test_integrity_...',
     'ADMIN_API_KEY'          => '<una clave larga al azar, mínimo 24 caracteres>',
     'SYNC_TOKEN'             => '<otra clave larga al azar, mínimo 24: la de la publicación automática>',
     'RESEND_API_KEY'         => 're_...',               // opcional; mejor pegarla en el panel (ver nota)
     'OWNER_NOTIFY_EMAIL'     => '<correo de quien recibe las ventas>',  // opcional; también se cambia en el panel
   ];
   ```
   Las llaves de Wompi están en su panel, Desarrolladores → Llaves (en la pestaña
   Sandbox o Producción). **Las tres tienen que ser del mismo ambiente**: si no,
   el servidor se niega a firmar y dice por qué. Cada casilla tiene su propio
   prefijo (`pub_…`, `prv_…`, `test_integrity_…`/`prod_integrity_…`); si pegas la
   llave privada o el secreto de **Eventos** donde va el de **Integridad**, el
   servidor lo rechaza y lo dice. Si en el pago Wompi muestra **«signature: La
   firma es inválida»**, casi siempre es el secreto de integridad: en Wompi →
   Desarrolladores → Secretos para integración técnica → **Integridad** (del mismo
   ambiente y comercio que la llave pública) y compara con lo que muestra el panel
   (Configuración → «Secreto de integridad»: ambiente, largo y últimas 4 letras).
   Los espacios, saltos de línea y comillas pegados con la llave se ignoran.
   **Sin tocar archivos del servidor:** el dueño y el desarrollador pueden pegar el
   secreto de integridad (y el de eventos) en el panel, pestaña **Configuración →
   «Secreto de integridad de Wompi»**. Se valida al instante (que sea el de
   integridad y del mismo ambiente que la llave pública), se guarda en la carpeta
   de datos fuera del sitio (`runtime-config.json`) y **prevalece** sobre
   `config.local.php` y sobre las variables del hosting; «Quitar lo guardado aquí»
   vuelve a lo del servidor. Las llaves pública y privada solo se cambian en el
   servidor (cambiarlas redirige el dinero).

   **Salir a producción (cobros reales) — lista:**
   1. Las tres llaves de la pestaña **Producción** de Wompi: `pub_prod_…` y `prv_prod_…`
      en `api/config.local.php`, y el secreto `prod_integrity_…` (panel → Configuración).
      Si en `config.local.php` quedó un `WOMPI_API_BASE` del ensayo en sandbox, se ignora
      solo (con llaves de producción siempre se le pregunta a `production.wompi.co`).
   2. En Wompi, pestaña **Producción** → Desarrolladores → *URL de eventos*:
      `https://stikebikeshop.com/api/wompi-events` (la de sandbox no vale para pagos reales).
      Opcional: el secreto `prod_events_…` (panel → Configuración).
   3. Panel → Configuración → «Pagos y servidor» en ✔ (incluye: Wompi reconoce la llave
      pública y el comercio está activo). «Eventos de
      Wompi» se marca con la primera compra.
   4. Compra real de prueba con el producto más barato y tarjeta propia: «¡Pago exitoso!»,
      correo de nueva venta, aparece en Ventas, baja el stock, y «Eventos de Wompi» en ✔.
   5. Anular esa compra desde el panel de Wompi.
   **Si un cliente pagó y la venta no aparece:** panel → Configuración → «Buscar pagos sin registrar»
   (también corre solo al abrir el panel). Necesita la **llave privada** correcta del servidor: si Wompi
   la rechaza (401), pégala en «Llave privada de Wompi» (se comprueba con Wompi antes de guardarla).
   El cobro y la confirmación de cada pago NO dependen de esa llave.
   Si el cobro se cae por configuración, el dueño recibe un correo de alerta (máximo uno
   cada 6 horas) y los clientes ven la opción de pedir por WhatsApp.
   `ADMIN_API_KEY` se inventa y se
   pega una vez en el panel, pestaña Configuración → "Clave del servidor de
   ventas". **Correo de aviso de cada venta:** sin cuenta de correo propia ni Resend el correo sale
   con el `mail()` del hosting, que casi nunca llega a Gmail (cae en spam o se pierde, y PHP dice
   «enviado» igual). No hace falta editar archivos: panel → Configuración → **«Correo de aviso
   de cada venta»** (dueño y desarrollador), con tres formas a elegir:
   **A) Un correo del propio dominio por SMTP** (sin crear cuentas en servicios nuevos): se crea
   una cuenta de correo en hPanel (p. ej. `ventas@stikebikeshop.com`) y se escribe servidor
   (`smtp.hostinger.com`), puerto (465; 587 también sirve), correo y contraseña. El servidor entra a la
   cuenta ANTES de guardar (conexión segura + usuario y contraseña) y la contraseña se guarda
   cifrada y no vuelve a mostrarse. Gmail también sirve (`smtp.gmail.com`, 465 y una «contraseña de
   aplicación»). **B) Resend** (gratis, resend.com): se pega la llave (se comprueba con Resend y se
   guarda cifrada); con el remitente de pruebas (`onboarding@resend.dev`) solo se entrega al correo
   con el que se creó la cuenta de Resend; para enviar a cualquier correo y desde `@stikebikeshop.com`
   hay que verificar el dominio en Resend (registros DNS en hPanel). **C) Tu cuenta de Gmail por la API
   de Google Cloud** (sin Hostinger ni Resend): en console.cloud.google.com se crea un proyecto, se
   habilita **Gmail API**, se configura la pantalla de consentimiento (Externo, permiso `gmail.send`) y
   se **publica la app** (si queda en «Pruebas», Google anula el permiso a los 7 días), y se crea un **ID
   de cliente de OAuth tipo «Aplicación web»** con la URI de regreso `https://stikebikeshop.com/api/gmail-callback`
   (el panel la muestra lista para copiar). El panel guarda el ID y el secreto de cliente cifrados; **«Guardar
   y conectar con Google»** lleva a Google, la cuenta acepta el permiso de ENVIAR correos (no puede leer
   la bandeja; Google avisa «no verificó esta aplicación» porque es una app propia: Avanzado → Ir a Stike) y
   Google devuelve a `api/gmail-callback`, que cambia el código por el permiso permanente (`refresh_token`),
   lo guarda cifrado y vuelve al panel mandando un correo de prueba. Esa dirección es pública a propósito,
   así que solo sirve con un `state` de un solo uso (10 minutos) que creó una sesión de dueño o desarrollador;
   no muestra nunca un token. Cada envío pide un token de acceso de 1 hora (`messages.send`, MIME en base64url).
   Si Google anula el permiso (cambias la contraseña de esa cuenta, o la app seguía en «Pruebas»), el
   panel lo dice y basta con volver a pulsar «Conectar con Google». «Desconectar» también le pide a Google
   que anule el permiso. Además: a quién le llega (uno o
   varios; a los anteriores les avisa del cambio) y el remitente de Resend. «Enviar correo de prueba»
   explica el motivo exacto si algo falla. Orden de envío: Resend → Gmail (API de Google) → tu correo
   (SMTP) → `mail()` del hosting (armado en base64 con texto + HTML; no garantiza nada). El panel muestra a quién le llega,
   por dónde sale y el resultado del último envío (`last-mail.json`); si ningún camino pudo enviar un
   aviso de venta, queda en `outbox/` y se reintenta solo (2 min, 4, 8… hasta 1 h, durante 48 h).
   Por seguridad el panel solo acepta los puertos 465, 587 y 2525 y rechaza servidores de la red
   interna. Pruebas: `node tools/smtp-mail-test.mjs` (servidor SMTP falso con TLS y STARTTLS),
   `node tools/gmail-api-test.mjs` (Google OAuth y Gmail API falsos; necesita `php`) y
   `node tools/admin-email-ui-test.mjs` (el formulario del panel; con `python3 -m http.server 8143`).
4. **Login del panel en el dominio nuevo:** en Google Cloud Console → APIs y
   servicios → Credenciales → el ID de cliente OAuth de `site.js`
   (`OAUTH_CLIENT_ID`) → "Orígenes autorizados de JavaScript", agregar
   `https://stikebikeshop.com`. Sin eso Google rechaza el inicio de sesión en
   `https://stikebikeshop.com/admin.html` (`origin_mismatch`) y el panel no abre.
5. **Publicación automática (el servidor se actualiza solo desde GitHub):** el "Git"
   de hPanel no conectó en la práctica, así que el sitio se instala y se actualiza
   con `api/sync.php`.
   - **Primera vez:** subir `tools/instalar-hostinger.php` a `public_html` con el
     Administrador de archivos, abrir `https://stikebikeshop.com/instalar-hostinger.php` y
     pulsar el botón; el servidor baja la rama `hostinger-deploy` y se borra solo.
   - **Después:** poner `SYNC_TOKEN` (una clave larga al azar, mínimo 24) en
     `api/config.local.php` y **la misma** en GitHub → Settings → Secrets and variables →
     Actions → secret `HOSTINGER_SYNC_TOKEN`. Desde ahí cada publicación del panel hace
     que el workflow actualice la rama y le avise a `/api/sync`, que baja ese commit,
     reemplaza lo que cambió, borra lo que ya no está en el repo (solo lo que el mismo
     sync instaló antes) y nunca toca `api/config.local.php`. Sin el secret el workflow
     solo actualiza la rama.
   - Si algún día el Git de hPanel funciona, se puede conectar a la rama
     `hostinger-deploy` en lugar de esto (el `.htaccess` bloquea `.git/`).
6. **Verificar en el dominio real:** el sitio carga; `https://stikebikeshop.com/data/costs.json`
   responde 403 o 404 (no el archivo); `https://stikebikeshop.com/api/sales` sin
   clave responde 401; "Pagar ahora" abre Wompi y la consola del navegador no
   muestra líneas `Refused to…` (si las hay, dicen qué host agregar al CSP del
   `.htaccess`); el panel abre con Google y publica un cambio de prueba que llega
   al sitio en un par de minutos.
7. **Prueba en sandbox sobre el dominio final** con una tarjeta de prueba de
   Wompi: la venta aparece en el panel y llega el correo. (Si quiere probar
   también el aviso por webhook, en el panel de Wompi, pestaña Sandbox, poner la
   misma URL de eventos del paso siguiente.)
8. **Producción:** en `api/config.local.php` cambiar las tres líneas de Wompi por las
   de **producción** (`pub_prod_…`, `prv_prod_…`, `prod_integrity_…`); no hay nada
   que cambiar en el código ni que volver a publicar. En el panel de Wompi, pestaña
   Producción (Desarrolladores), configurar la **URL de eventos**
   `https://stikebikeshop.com/api/wompi-events` (exactamente así: con https y sin
   `www`, una redirección perdería el aviso).
9. **Prueba real** con un pedido pequeño y tarjeta propia; verificar panel y
   correo, y devolver el pago desde el panel de Wompi.
10. **Limpieza:** borrar el proyecto `stike-wompi-api` de Vercel y la carpeta
    `vercel-wompi-api/`. (`data/sales-log.json` ya quedó en `[]`: las ventas de
    prueba del sandbox se vaciaron al cambiar de dominio.)

**Lo que no está resuelto ni probado:**

- **Stock:** una venta online descuenta las unidades sola (el servidor lo hace en
  `products-data.js` por GitHub y lo anota en `data/stock-applied.json` para no
  descontar dos veces; si falla, el panel lo concilia al abrirse). El servidor
  valida que el producto exista, esté publicado y tenga precio.
- **Ventas del mostrador (panel → Ventas):** además de vender un producto del catálogo (descuenta
  stock), **«¿El producto no está en la página? Registrar una venta de otro producto»** anota una venta
  de algo que no está en el catálogo (nombre, cantidad y precio): no crea el producto ni toca el stock, queda
  marcada `offCatalog` en `data/sales-log.json` (con `slug: "fuera-de-catalogo"`), sale en el historial, los
  ingresos y la factura, y **no entra al margen** (no hay costo). **«Corregir venta»** (en el detalle de una
  venta de tienda) cambia el **precio unitario** (y, en las de otro producto, el nombre y la cantidad; en
  las del catálogo la cantidad no se toca porque ya descontó stock): se lee la versión más reciente del
  historial, se cambia solo esa venta y queda anotado quién, cuándo y antes → después, en la propia venta
  (`edits`) y en Auditoría. Las ventas online (Wompi) no se editan. Pruebas: `node tools/admin-sale-edit-test.mjs`.
- **Sin probar en el hosting real:** el `.htaccess` (redirecciones, rutas `/api/…`,
  bloqueos), el CSP contra el widget de Wompi, el `ZipArchive`/`curl` del PHP de
  Hostinger y que su firewall deje pasar la llamada desde GitHub a `/api/sync` (la
  primera publicación lo muestra) y la entrega de `mail()`. Todo esto se verifica en los pasos 5 a 7.
- **Respaldos:** `ventas.jsonl` vive solo en Hostinger (más el correo de cada
  venta). No está confirmado que los respaldos automáticos del plan incluyan
  carpetas fuera de `public_html`: verificarlo en hPanel o descargar la carpeta
  `stike-private/` cada cierto tiempo. Si se prefiere dentro de `public_html`,
  `STORAGE_DIR` en `config.local.php` lo permite (se bloquea el acceso web solo).
- **Eventos de Wompi:** si está el secreto de eventos (panel → Configuración),
  `wompi-events.php` verifica el checksum de cada aviso y, con firma válida, registra
  la venta con los datos del propio evento; sin ese secreto, o con firma falsa, no
  registra nada por confianza: solo si Wompi confirma la transacción al consultarla.

## 📈 Analítica y medición (GA4, WhatsApp, Search Console)

**En el sitio** (`assets/js/analytics.js`, cargado en todas las páginas, incluida la web de Fate):

- **Google Analytics 4**: se activa pegando el **ID de medición** (`G-XXXXXXXXXX`) en `data/analytics.json` →
  `ga4MeasurementId` (público, no es un secreto) y publicando. Vacío = GA4 apagado. Manda los eventos de comercio
  electrónico del esquema de GA4: `view_item_list`, `select_item`, `view_item`, `add_to_cart`, `remove_from_cart`,
  `view_cart`, `begin_checkout`, `purchase` (solo con el pago **aprobado**, una vez por referencia, con `transaction_id`),
  `payment_failed`, `checkout_error`, `search`, `generate_lead`, `share`, `page_not_found` y `contact_click` (teléfono,
  correo, mapa, Instagram, Facebook, TikTok).
- **Clics a WhatsApp** (`whatsapp_click`): se mide TODO enlace a `wa.me` o `api.whatsapp.com` y los que abre el código con
  `window.open`. Cada evento dice **dónde** estaba el botón (`link_location`: `floating_button`, `header`, `menu`, `footer`,
  `product_page`, `cart`, `build`, `payment_result`, `contact_page`, `home`, `fate`, `form_fallback`…) y en qué tipo de página
  (`page_type`); en una ficha lleva el producto y su precio, en el carrito el valor. **Nunca viaja el texto del mensaje**
  (puede traer nombre, teléfono o dirección): del enlace solo se usa el número de la tienda. «Compartir por WhatsApp»
  (`wa.me/?text=`) es otro evento (`share`), no un contacto. En GA4 conviene marcar `whatsapp_click` como **evento clave** (antes
  «conversión») y registrar `link_location` y `page_type` como **dimensiones personalizadas** (alcance de evento).
- **Contador propio** (`api/track.php`, datos en `analytics/fp-AAAA-MM-DD.json` dentro de la carpeta de datos del servidor):
  cuenta en el servidor, SIN cookies, SIN IP y SIN identificadores, las visitas, los clics a WhatsApp, lo agregado al
  carrito, `begin_checkout`, las búsquedas y los formularios, por día, lugar, página, producto, dispositivo y hora (hora de
  Colombia). Sirve de **respaldo cuando un bloqueador de anuncios tapa Google** y para comparar cifras. Se conserva 400
  días; límite de 120 eventos por minuto y por IP; los mapas se topan en 400 claves.
- **Consentimiento**: respeta el aviso de cookies (`stike:consent`). «Rechazar opcionales», «No rastrear» (DNT) y Global
  Privacy Control apagan GA4 y el contador propio. `consentMode` en `data/analytics.json`: `"opt_out"` (por defecto: mide hasta
  que la persona rechace) o `"opt_in"` (espera a que acepte). No se cuentan las visitas del equipo (`?stike_internal=1`, y
  cualquier navegador que abra el panel), las de la vista previa del panel, las de robots ni las de otro dominio (localhost).
- **Probar**: abrir cualquier página con `?stike_debug=1` imprime cada evento en la consola (`window.__stikeAnalytics.log`) y
  GA4 los marca como depuración (aparecen en *Admin → DebugView*).
- La CSP (`.htaccess`) deja pasar solo `*.googletagmanager.com`, `*.google-analytics.com`, `*.analytics.google.com` y
  `stats.g.doubleclick.net`. Las políticas `cookies.html` y `privacidad.html` describen la medición.
- Pruebas: `node tools/analytics-site-test.mjs` (navegador, con Google simulado; `python3 -m http.server 8143`) y
  `node tools/analytics-track-test.mjs` (el contador propio con PHP real).

### Pestaña «Analítica» del panel (solo roles con finanzas)

Menú **Analítica** (`admin-analytics.js`, se carga aparte la primera vez que se abre; lo entrega `admin.php?f=an` solo a
dueño, desarrollador, administrador y asistente: los datos incluyen ingresos; tienda y diseño/contenido no lo reciben). Lee
todo de `api/analytics.php` y dibuja a mano (SVG/HTML, sin librerías) con la paleta validada de la guía dataviz. Selector de
periodo (hoy, 7, 28, 90 días) y «Actualizar»; cada gráfico tiene su **tabla equivalente** («Ver tabla») y se puede recorrer
con el teclado. Todo texto que viene de los datos (rutas, búsquedas, nombres) se escapa: nunca se inserta como HTML.

| Pestaña | Qué muestra |
|---|---|
| **Resumen** | 8 fichas con su cambio frente al periodo anterior (visitantes, sesiones, clics a WhatsApp, carrito, compras, ingresos Wompi, visitas que compran, tiempo), sesiones por día contra el periodo anterior, «Lo que se nota» (resumen en palabras), embudo (sesiones → producto → carrito → pago → compra, y WhatsApp como alternativa), acciones clave y una comparación **Google Analytics vs. contador propio** |
| **WhatsApp** | Clics por día, **desde qué botón**, en qué tipo de página, qué **productos** y páginas generan más chats, **a qué hora** escriben (mapa de calor día × hora), aparato y fuente de la visita |
| **Cómo llegan** | Canales (con interacción, WhatsApp, compras e ingresos), fuente/medio, páginas de entrada y qué canal trae más chats |
| **Qué ven** | Productos más vistos (vistas, carrito, compras, ingresos; ordenable), «Para revisar» (muy vistos sin carrito, o al carrito sin compra), categorías, marcas, búsquedas en la tienda, páginas 404 y páginas más vistas |
| **Quiénes** | Aparatos, nuevos y recurrentes, ciudades y mapa de calor de sesiones |
| **Google (SEO)** | Search Console: clics, apariciones, CTR, posición, tendencia, búsqueda por marca o no, consultas, **oportunidades** (posición 4-20), páginas, aparatos, países y estado del sitemap (el dueño/desarrollador puede enviarlo) |
| **En vivo** | Personas en el sitio ahora (30 min), páginas, acciones y ciudades; se actualiza solo cada 30 s mientras se mira y se detiene al salir |
| **Conexión** | Lista de lo que está listo, «Probar conexión» punto por punto, formularios de la medición del sitio y de la conexión con Google, guía paso a paso y cómo probar el seguimiento |

Si Google todavía no está conectado (o falla), **Resumen y WhatsApp se llenan con el contador propio** y las demás pestañas
muestran una tarjeta con lo que hay que hacer; un error de Google nunca tumba toda la pestaña.

**Conectar Google (una sola vez, ~15 min)** — el panel lee con una **cuenta de servicio** de Google Cloud (no pide permisos de
persona ni caduca):

1. Google Cloud → proyecto → habilitar **Google Analytics Data API** y **Google Search Console API**.
2. IAM y administración → Cuentas de servicio → crear `stike-analitica` (sin roles) → Claves → Agregar clave → **JSON**.
3. Panel → Analítica → **Conexión** → pegar el contenido del JSON (solo ahí: nunca por chat, correo ni repositorio), el ID de
   propiedad de GA4 (solo números) y la propiedad de Search Console (`sc-domain:stikebikeshop.com` o la URL con `/`).
4. GA4 → Administrar → Acceso a la propiedad → agregar el correo de la cuenta (termina en `.iam.gserviceaccount.com`) con rol
   **Lector**. Search Console → Configuración → Usuarios y permisos → el mismo correo, permiso **Completo** (con «Restringido» se
   lee pero no se puede enviar el sitemap).
5. «Guardar y probar» y luego «Probar conexión»: cada punto en ✔. En GA4, una vez: marcar `whatsapp_click` como evento clave y
   crear las dimensiones personalizadas `link_location` y `page_type` (alcance Evento).

La llave se valida, se guarda **cifrada** (AES-256-GCM, `runtime-config.json` fuera de la web) y **nunca vuelve al navegador**: el
panel solo muestra el correo de la cuenta y el proyecto. El **ID de medición** (`G-…`), el modo de permiso y el token de
verificación de Search Console se editan en el mismo lugar y se publican en `data/analytics.json` por `api/gh.php` (solo dueño
y desarrollador pueden escribirlo; `tools/build-seo.mjs` pone el token como `<meta name="google-site-verification">` en el inicio).
Los resultados buenos de Google se guardan unos minutos en `analytics-cache/` (carpeta de datos; no se sirve ni se versiona).

Pruebas: `node tools/admin-analytics-test.mjs` (la pestaña con Google, GitHub y roles simulados; `python3 -m http.server 8143`;
`AN_SHOTS=carpeta` guarda capturas), `node tools/analytics-google-test.mjs` (PHP real contra un Google simulado que verifica la
firma RS256, la cifra de la llave y los permisos por rol, incluida la puerta `admin.php?f=an`).

## 🔒 Seguridad: dónde viven los secretos

- **Nunca en el repositorio.** Las llaves y secretos (Wompi, `GITHUB_TOKEN`,
  `ADMIN_API_KEY`, `SYNC_TOKEN`, Resend) viven solo en el servidor
  (`api/config.local.php`, fuera de git) y en los *secrets* de GitHub Actions.
  `tools/secrets-scan-test.mjs` revisa todo el repo con los patrones de
  `tools/secret-patterns.txt` (llaves `prv_…`, secretos de integridad/eventos,
  tokens de GitHub, Resend, PEM…); `tools/stage-hostinger.sh` usa los mismos
  patrones y **frena la publicación** si algo así llega a la copia que se sube.
- **Lo que se pega en el panel** (secreto de integridad, de eventos, llave privada)
  se guarda **cifrado** (AES-256-GCM) en la carpeta de datos del servidor, fuera de
  `public_html`. La clave de cifrado sale de `ADMIN_SESSION_SECRET` / `ADMIN_API_KEY`
  del servidor: si alguna vez se cambia, lo guardado deja de poder leerse (el cobro
  sigue con lo de `config.local.php` y el panel avisa qué hay que pegar otra vez).
  Lo guardado antes en texto plano se cifra solo al abrir el panel. La llave
  **pública** no se cambia desde el panel (redirige el dinero).
- **Nada se devuelve completo:** ninguna respuesta de la API trae un secreto; el
  panel solo muestra ambiente, largo y últimas 4 letras para compararlo a ojo con
  Wompi. Los errores de PHP no se imprimen (van al log del servidor).
- **Archivos internos bloqueados** (`.htaccess` y copia a Hostinger): `data/costs.json`,
  `sales-log.json`, `audit-log.json`, `stock-applied.json`, el código de `api/` que no
  es un endpoint, archivos ocultos y respaldos (`.env`, `*.bak`, `*.sql`…), la carpeta
  de datos del servidor y `tools/`. `tools/secrets-scan-test.mjs` lo comprueba.
- **Repositorio privado recomendado.** Con el repo público cualquiera puede leer
  `data/costs.json` (costos y márgenes), `sales-log.json`, `audit-log.json` y los
  correos de `api/_admin.php`. Se puede volver privado sin romper la publicación:
  `api/sync.php` baja el código con `GITHUB_TOKEN` cuando el archivo anónimo falla
  (GitHub → Settings → Danger Zone → *Change visibility*; después de cambiarlo,
  publicar algo y mirar en Actions que «Publish to Hostinger» siga en verde). La
  demo de GitHub Pages deja de verse.

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
│   ├── sales-log.json      (ventas; una corrección queda anotada en la venta: `edits`)
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
