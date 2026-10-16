# SEO + GEO de Stike Bike Shop (pago único, sin mensualidad)

**GEO** = que ChatGPT, Gemini, Claude, Perplexity y Copilot encuentren la tienda y puedan citar datos correctos
(dirección, horario, envíos, precios). **SEO** = lo mismo para Google y Bing.

Todo se **genera solo** desde el catálogo (`assets/js/products-data.js`) y los datos del negocio
(`assets/js/site.js`). Cada deploy (cada vez que el panel publica) regenera todo en la copia que va al hosting
(`tools/stage-hostinger.sh`). No hay nada que mantener a mano.

## Qué hace el sitio por sí solo

| Qué | Dónde | Para qué |
|---|---|---|
| Ficha de producto con datos estructurados (`Product` / `ProductGroup` con una variante por color/talla, precio, disponibilidad, envío) | `producto/*.html` | Precios y stock en Google y en respuestas de IA |
| Página por tipo de producto (Camisetas, Bielas, Espigas…) | `categoria/*.html` | Posicionar búsquedas como "bielas BMX Bogotá". Se crea sola al entrar el primer producto |
| Página por marca (Odyssey, Cult, Fiend…) con 2+ productos | `marca/*.html` | Búsquedas por marca. Se crea sola |
| Preguntas frecuentes (envíos, pagos, cambios, armado, ubicación) con `FAQPage` | `preguntas-frecuentes.html` | Las IA citan respuestas de aquí |
| Título, descripción, canonical, Open Graph, hreflang es-CO, JSON-LD de la tienda (`BicycleStore`, `WebSite` con buscador, migas de pan) | `<head>` de cada página | Google y vistas previas en WhatsApp |
| `robots.txt` con rastreadores de IA permitidos (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, OAI-SearchBot…) | `robots.txt` | Que las IA puedan leer el sitio |
| `llms.txt` y `llms-full.txt` (resumen del negocio + catálogo completo en texto) | raíz | Estándar para modelos de lenguaje |
| Sitemap con fotos | `sitemap.xml` | Google Imágenes |
| Feed de productos para Google Merchant (gratis) | `feed/google-merchant.xml` | Fichas gratis en Google Shopping |
| Menú y listados en HTML plano (`<noscript>`) | todas las páginas | Rastreadores de IA que no ejecutan JavaScript |
| 301 reales para fichas fusionadas + página 404 útil | `.htaccess`, `404.html` | No perder posicionamiento al agrupar productos |
| IndexNow (aviso a Bing/Copilot/ChatGPT de lo que cambió) | `tools/indexnow.mjs`, workflow | Que Bing se entere en horas, no semanas |

## Datos que sí hay que mantener (y dónde)

* Dirección, teléfono, horario, redes, medios de pago, costo de envío y envío gratis: `assets/js/site.js` (`business`, `shipping`).
  El costo real del carrito está en `api/_lib.php` y `carrito.html` (`STIKE_SHIP_COST`, `STIKE_FREE_SHIP`): si cambia, cámbialo en los tres.
* Textos de las páginas de tipo/marca y las preguntas frecuentes: `data/seo-content.json`.
* Todo lo demás (precios, stock, variantes, conteos, listados) sale del catálogo y se actualiza solo.

## Comandos

```bash
node tools/build-seo.mjs      # regenera páginas de tipo/marca, <head>, robots, llms, feed, 404, 301
node tools/build-pages.mjs    # regenera fichas de producto y sitemap
node tools/seo-test.mjs       # auditoría: títulos, canonical, h1, JSON-LD, sitemap, feed, enlaces rotos…
```

El deploy corre los dos primeros automáticamente; si algo falla, publica lo commiteado y no frena el stock.

## Lista de una sola vez para el dueño (gratis, sin pagar a nadie)

1. **Google Search Console** (search.google.com/search-console): agregar `https://stikebikeshop.com`, verificar y enviar `https://stikebikeshop.com/sitemap.xml`.
   Si piden una etiqueta `<meta>`, pegar solo el valor en `googleSiteVerification` de `assets/js/site.js`.
2. **Bing Webmaster Tools** (bing.com/webmasters): importar el sitio desde Search Console y enviar el sitemap (alimenta a Copilot y a la búsqueda de ChatGPT).
3. **Perfil de Negocio de Google** (business.google.com): crear/reclamar "Stike Bike Shop" con la misma dirección, teléfono y horario de `site.js`. Es lo que más pesa para "tienda BMX en Bogotá" y para el mapa.
4. **Google Merchant Center** (merchants.google.com): Productos → Fuentes de datos → agregar fuente → archivo programado →
   `https://stikebikeshop.com/feed/google-merchant.xml` (diario). Activar "fichas gratuitas".
5. Pedir a clientes contentos una reseña en Google (las reseñas reales son lo único que no se puede generar).

## Decisiones que quedaron registradas

* Los rastreadores de IA de entrenamiento (GPTBot, Google-Extended, CCBot…) están permitidos para que la marca aparezca en las respuestas.
  Para bloquear alguno: quitarlo de `AI_BOTS` en `tools/build-seo.mjs` y agregar su `Disallow: /`.
* Una marca con un solo producto no tiene página propia (`MIN_BRAND_PAGE` en `tools/lib-catalog.mjs`).
* Un tipo o marca que se queda sin productos sigue existiendo pero pasa a `noindex` y sale del sitemap; vuelve solo al reponer.
* Pendiente del dueño (texto con corchetes visible en el sitio): días de entrega a zonas rurales (`envios.html`) y días para cambios (`devoluciones.html`).
