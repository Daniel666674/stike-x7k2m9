# El motor de catálogo de Stike

Cómo decide este sitio qué se puede vender, qué se ve y cómo se publica.
Escrito para dos lectores: quien tenga que mantener esto en seis meses, y
quien necesite explicarle al cliente por qué su sistema se comporta así.

La última sección es la importante si lo que buscas es **en qué se aparta
del motor original** del que salió esta arquitectura.

---

## 1. Las piezas

Tres, y ningún servidor propio.

```
Panel (admin.html) → commit a GitHub → GitHub Actions → sitio en vivo
```

- **Sitio estático.** HTML plano, sin framework, sin build step, sin npm. El
  catálogo vive en `assets/js/products-data.js` como JavaScript plano (no
  JSON) para poder cargarlo con `<script src>` sin `fetch` ni CORS.
- **Panel de administración.** Un archivo, `admin.html`, servido desde el
  mismo sitio. Escribe directo al repositorio con la API de contenidos de
  GitHub usando un token que el administrador pega una vez. No hay backend
  que mantener ni que pagar.
- **Despliegue.** `.github/workflows/deploy.yml` publica en cada push a la
  rama por defecto del repositorio.

> **El despliegue solo corre en la rama por defecto.** Trabajar en otra rama
> y no entender por qué el sitio no cambia es el error número uno. Hoy esa
> rama es `claude/sweet-albattani-ti0w0e` (sí, ese nombre es el de la rama
> por defecto del repo, no un descuido) y `CONFIG.branch` en `admin.js`
> apunta a la misma. Si se renombra una, hay que renombrar la otra.

## 2. Qué se cambia para mudar el sitio

Todo lo que depende del dominio sale de **`assets/js/site.js`**. Mudar el
sitio a su dominio propio es:

```bash
# 1. editar DOMAIN y BASE_PATH en assets/js/site.js
# 2.
node tools/build-pages.mjs
# 3. revisar el diff y publicar
```

Eso reescribe las 52 fichas de producto, el `sitemap.xml`, el `robots.txt` y
el `<base href>` de todas las páginas. **No hay que editar ningún HTML a
mano**, y ese es justamente el punto: antes el dominio estaba escrito a mano
en cinco archivos y en 101 `<head>`, y mudarlo era un find/replace a ciegas.

## 3. El motor de stock

Vive en el bloque `MOTOR DE STOCK` de `assets/js/data.js`. Está ahí y **no**
en `products-data.js` a propósito: el panel reescribe `products-data.js`
completo en cada publicación, así que cualquier regla que viviera ahí se
borraría sola.

Cuatro funciones, y son la única fuente: `assets/js/pdp-render.js` las
consume en vez de tener su propia copia (tenía una, y dos copias de la misma
regla terminan diciendo cosas distintas).

| Función | Qué contesta |
|---|---|
| `stikeTotalStock(p)` | Cuánto hay guardado, crudo. Es el número que ve el dueño y el conteo de la ficha. |
| `stikeSellable(p)` | Cuánto se puede vender **ahora**, en la mejor combinación. `null` = no hay stock registrado. |
| `stikeIsOut(p)` | `true` **solo** si sabemos con certeza que no queda nada vendible. |
| `stikeIsVisible(p)` | Qué puede mostrar el sitio: todo menos los borradores. |

### Regla 1 — Desconocido no es cero

Un producto al que todavía no le registraron unidades **no está agotado**: no
sabemos cuánto hay. `stikeSellable` devuelve `null` y `stikeIsOut` devuelve
`false`.

Antes se trataba como 0, y el sitio le ponía "Agotado" a mercancía que estaba
en la vitrina física.

### Regla 2 — Stock por combinación mínima

Talla y color son **dos bodegas independientes**, no una matriz por
combinación. Una camiseta talla M negra se puede vender hasta
`mín(stock de M, stock de negro)`.

```
sizes:  [{ v: "S", u: 0 }, { v: "M", u: 7 }]
colors: [{ v: "Negro", u: 2 }, { v: "Blanco", u: 0 }]

M + Negro  → 2      mín(7, 2)
S + Negro  → 0      la talla manda
M + Blanco → 0      el color manda
vendible   → 2      la mejor combinación posible
```

Sumar las pools mentiría: diría "hay 9" cuando hay 9 repartidas entre una
talla agotada y un color agotado. Al elegir una opción, el tope del selector
de cantidad se recalcula al stock de **esa** combinación.

### Regla 3 — El agotado no desaparece

`stikeIsVisible` esconde **solo los borradores**. Un agotado:

- se queda publicado y en su categoría, con su etiqueta "Agotado";
- se marca `OutOfStock` en los datos estructurados, así **conserva el
  posicionamiento que ya ganó en Google** — sacarlo del índice obliga a
  reconstruirlo en cada reposición;
- cambia el botón de "Comprar por WhatsApp" a **"Avísame cuando llegue"**,
  con el mensaje ya escrito. La visita se convierte en un contacto en vez de
  un rebote;
- sale del bloque de relacionados de otras fichas: recomendar algo que no se
  puede comprar gasta el espacio de algo que sí;
- **vuelve solo.** Al subir el stock, el producto vuelve a la venta sin que
  nadie toque nada.

El panel, en cambio, **nunca** esconde nada: muestra el catálogo completo,
con los borradores marcados como borrador y los agotados como agotados.

### Dónde se filtran los borradores

En **un solo lugar**: `data.js` deja el catálogo crudo en
`window.STIKE_ALL_PRODUCTS` y expone en `window.STIKE_PRODUCTS` solo lo
visible. Las ~30 vitrinas que leen el catálogo (tienda, las 23 landings de
parte, home, Fate, buscador, relacionados, carrito, el configurador) no
saben que existe un filtro.

El panel usa `STIKE_ALL_PRODUCTS`, porque ahí sí hay que ver los borradores.

## 4. Las fichas de producto

Una plantilla, `_template.html`, con marcadores `__MAYÚSCULAS__` que se
reemplazan por sustitución literal de texto. Sin motor de plantillas.

La función que las genera, `PdpRender.renderProductPage`
(`assets/js/pdp-render.js`), se usa en **dos** lugares que nunca deben
divergir, y por eso es una sola función y no dos copias:

1. `tools/build-pages.mjs`, en Node, cuando hay que regenerar todo.
2. `admin.html`, en el navegador, cada vez que se publica un cambio.

La ficha se hornea con el precio, el stock, las especificaciones y las
opciones de talla y color **ya resueltas en el HTML** (para SEO y para quien
llegue con JavaScript lento), y `assets/js/pdp.js` solo le agrega
interactividad encima: galería, selección de variante, compuerta de compra,
carrito.

**Los relacionados son la excepción:** se calculan al cargar, del catálogo
vivo. No se hornean.

### Compuerta de compra

Con variantes reales, el cliente no puede agregar al carrito sin elegir: el
botón sacude el selector y avisa "Elige una talla primero". Sin esa
compuerta llegan pedidos sin talla y hay que perseguir al cliente por
WhatsApp para preguntarle.

Las variantes agotadas salen `disabled` **desde el HTML**, no por
JavaScript.

## 5. Publicar

Un botón. En este orden:

1. **Fotos nuevas** → `assets/img/products/…`
2. **Videos nuevos** → `assets/video/products/<id>.mp4` y su imagen de vista previa `<id>.jpg`
3. **Catálogo** → `assets/js/products-data.js`, con fusión campo por campo
4. **Fichas** → `producto/<slug>.html`, solo las que cambiaron
5. **Sitemap** → reconciliado contra el catálogo completo
6. **Videos que ya no se usan** → se borran del repo (quitados de un producto o de un producto eliminado)
7. **Costos internos** → `data/costs.json`
8. **Auditoría** → `data/audit-log.json`

Las fotos y los videos van primero porque hasta que no están subidos, el
producto no tiene su ruta definitiva: publicar el catálogo antes dejaría
referencias a archivos que todavía no existen.

### Videos de producto

`p.videos` es una lista de hasta 2 `{src, poster?, w, h, dur, b, ts}`. El panel
los revisa **antes de aceptarlos** leyendo el contenedor MP4 (sin decodificarlo;
`assets/js/video-tools.js`, la misma lógica en el navegador y en las pruebas):

| Regla | Límite |
|---|---|
| Formato | MP4 con H.264 (perfil Baseline/Main/High, 8 bits); audio AAC opcional |
| Peso | máx. 10 MB (ideal < 5 MB) |
| Duración | 2 a 30 s |
| Tamaño | máx. 1280×720 (vertical 720×1280); se avisa por debajo de 360 px |
| Cuadros | ≤ 30 por segundo |
| Tasa de datos | ≤ 3,2 Mbps (video + audio) |
| Índice | Fast Start (`moov` antes de `mdat`) |
| Cantidad | máx. 2 por producto |

En la ficha el video **no existe hasta que el cliente lo toca**: solo hay una
imagen liviana (el poster) y un botón; el MP4 se pide al abrir el reproductor y
se suelta al cerrarlo (`pdp.js`). Cada video sale además como `VideoObject` en
los datos estructurados. `api/gh.php` solo acepta `assets/video/products/<id>.(mp4|jpg)`,
comprueba que el contenido sea un MP4 de máx. 12 MB y le da más tiempo a la
subida que a un JSON. Pruebas: `tools/video-tools-test.mjs`,
`tools/admin-video-test.mjs`, `tools/pdp-video-test.mjs`, `tools/gh-proxy-test.mjs`.

Cada escritura lee el archivo remoto, construye el contenido nuevo **a partir
de lo que acaba de leer**, y escribe. Si GitHub responde conflicto, reintenta
hasta 4 veces con espera creciente, releyendo el remoto en cada intento.
Esto importa porque dos personas pueden tener el panel abierto a la vez: la
fusión es campo por campo, así que si una editó el precio y otra el stock,
ambos cambios sobreviven.

### Las fotos

Todo el procesamiento ocurre en el navegador del administrador, con canvas.
No hay servicio de imágenes.

- Lado máximo 1600 px, calidad 0.87, **siempre** reencodado a JPEG.
- Nombre **aleatorio**, nunca derivado de la posición en el arreglo. Con
  `{slug}-{índice}.jpg`, borrar una foto intermedia corre todas las
  siguientes y la próxima subida cae en un nombre que ya pertenecía a otra
  foto viva: la sobrescribe en silencio.
- **Fondo blanco antes de dibujar.** El JPEG no tiene canal alfa, así que
  todo lo transparente se aplana a negro. Sin esto, un PNG con fondo
  recortado se publica con el fondo negro.
- **Detector de imagen en negro.** En móviles con poca memoria — sobre todo
  los navegadores embebidos de WhatsApp e Instagram — `drawImage` puede
  fallar *en silencio*: sin excepción, sin error. El canvas queda
  transparente y se exporta como un JPEG válido que es un cuadrado negro, y
  pasa cualquier verificación de formato y tamaño. Se muestrean 9 puntos
  (esquinas, medios de borde y centro) y se rechaza si los nueve son
  idénticos.

### Validación

Corre antes de publicar y **bloquea la operación completa**. No es una
advertencia: nombre, marca, categoría existente, precio mayor a 0, al menos
una foto, tallas si la subcategoría las exige, `slug` único, `sku` único,
sin stock negativo. Y contra el estado remoto fresco, otra vez `slug` y
`sku`, porque dos sesiones abiertas generan el mismo "siguiente número
libre" y ninguna validación local lo detecta.

### Datos que nunca se publican

`data/costs.json` (costo y margen de cada producto), `data/sales-log.json`
(ventas) y `data/audit-log.json` **se excluyen del despliegue**, y el
workflow verifica activamente que esas rutas devuelvan error en el sitio en
vivo. Si ese paso se pone rojo, hay datos del negocio expuestos.

`data/site-content.json` **sí** es público a propósito: el sitio lo consulta
en vivo para los textos editables del hero y las categorías. El mismo paso
verifica que ese siga respondiendo 200.

> **Pendiente, y hay que decirlo:** el repositorio es **público**, así que
> `costs.json` y `sales-log.json` siguen siendo legibles en github.com aunque
> ya no estén en el sitio. Excluirlos del despliegue cierra una puerta, no
> las dos. La segunda se cierra haciendo privado el repositorio (posible en
> cuanto el sitio deje GitHub Pages por su hosting propio) o moviendo esos
> dos archivos a un repositorio aparte.


### Roles del panel

Quién entra y con qué rol vive en `api/_admin.php` (`STIKE_ADMIN_ROLES`); para sumar a alguien se agrega su correo de Google
y se publica. El servidor hace cumplir los límites (`api/gh.php`, `api/sales.php`); el panel solo adapta la pantalla.

| Rol | Ve y hace |
|---|---|
| `owner`, `developer`, `admin`, `dev_assistant` | Todo: costos, margen, KPIs, ventas, auditoría, contenido, configuración |
| `editor` (diseño y contenido) | Productos (fotos, videos, textos, precios) y Contenido del sitio. **No** ve costos, margen, KPIs, ventas ni datos de clientes; no toca la plantilla; al publicar no escribe costos |
| `staff` (tienda) | Productos y stock a la vista, registrar ventas y avisos de ventas |

Pruebas: `tools/gh-proxy-test.mjs` (servidor PHP) y `tools/admin-editor-role-test.mjs` (pantalla).

### Contenido del sitio (pestaña del panel)

`data/site-content.json` es un mapa plano que el panel edita; una clave que no está = se queda el original.
Los **textos** del inicio son los elementos de `index.html` con `data-content-key` (+ `data-content-label`,
`-group`, `-max`, `-optional`, `-multiline`): el panel los **descubre leyendo index.html**, así que para hacer
editable un texto nuevo basta con marcarlo en el HTML. Los **videos** del inicio son `home.video`
(`{type:"youtube", id}` o `{type:"mp4", src, poster, w, h, dur, b, ts}`), `home.clipLeft` y `home.clipRight`
(clips verticales mudos en bucle); los archivos viven en `assets/video/site/`. Los aplica `assets/js/home-media.js`
con las mismas protecciones de carga (no arrancan con ahorro de datos, 2G/3G o «menos movimiento»; el lado que no
se ve no descarga nada; solo se aceptan rutas `assets/video/site/…` e IDs de YouTube bien formados).
La vista previa del panel es el mismo `index.html`/`tienda.html` con `?admin-preview=1` dentro de un iframe
(la política de seguridad de `.htaccess` incluye `'self'` en `frame-src` y `blob:` en `img-src`/`media-src` para eso).
Pruebas: `tools/admin-content-test.mjs`, `tools/home-content-test.mjs`.

## 6. Herramientas

Todas corren con Node pelado salvo donde se indica.

```bash
node tools/build-pages.mjs           # regenera fichas, sitemap, robots, <base href>
node tools/build-pages.mjs --check   # no escribe: dice si algo está desactualizado
node tools/stock-test.mjs            # 19 casos del motor de stock, sin dependencias
node tools/e2e-test.mjs              # 24 casos en un navegador real (necesita Playwright)
node tools/photo-test.mjs            # el PNG transparente (necesita Playwright)
```

`build-pages.mjs` se niega a generar si el catálogo llegó vacío, si un
producto tiene una categoría que no existe, si el sitemap lista una página
que no está en el repo, si el número de WhatsApp de `site.js` y el de
`app.js` no coinciden, si quedó un marcador `__ASÍ__` sin reemplazar, si un
bloque de datos estructurados no es JSON válido, o si alguna URL absoluta
salió con la ruta pegada al dominio sin barra en medio.

Ese último caso no es hipotético: así se publicaron las 52 fichas con el
`og:image` apuntando a `…/bmxstoreassets/img/…`, y durante meses ningún
producto compartido por WhatsApp mostró foto.

---

## 7. En qué se aparta del motor original

Esta arquitectura viene de un motor de catálogo replicable. Stike **no** es
una copia con otros colores: estas son las diferencias de fondo, y cada una
tiene una razón.

| | Motor original | Stike |
|---|---|---|
| **Agotado** | Desaparece del sitio hasta que vuelve el stock | Se queda, marcado `OutOfStock`, y pide el contacto por WhatsApp |
| **Stock con dos dimensiones** | Manda una sola dimensión; la otra no alimenta el agregado | Dos bodegas independientes; una combinación se vende hasta el `mín()` de las dos |
| **Relacionados** | Horneados en el HTML + un script que los poda porque envejecen | Calculados en vivo del catálogo: no envejecen, no hace falta el script |
| **Navegación** | 2-3 vitrinas genéricas con filtro `?sub=` | 23 landings propias por tipo de parte, cada una indexable |
| **Panel** | Tabla de inventario | Grilla con la misma foto que ve el cliente, más registrar venta que descuenta stock en el momento |
| **Identidad** | — | Monocromo blanco y negro con tipografía Archivo, configurador "Arma tu BMX", micro-sitio propio de Fate BMX Colombia, blog |
| **Dominio** | Bloque de configuración a reemplazar | Bloque de configuración **más** un script que propaga el cambio a los 101 HTML |

Lo que **sí** se hereda, porque son correcciones que ya se pagaron una vez y
no tiene sentido volver a pagarlas: la fusión campo por campo con reintento,
la validación que bloquea, los nombres de foto aleatorios, el detector de
imagen en negro, el relleno blanco antes de dibujar, el generador como
función pura compartida, y la regla de que las reglas no pueden vivir en el
archivo que el panel reescribe.
