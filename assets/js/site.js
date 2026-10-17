/* =========================================================================
   STIKE BIKE SHOP: identidad del sitio, en UN solo lugar.

   Todo lo que depende de "en que dominio vive este sitio" sale de aca:
   las URL canonicas, el og:image que leen WhatsApp y Facebook, el
   sitemap y el <base href> de cada pagina. Antes estaba escrito a mano en
   cinco archivos distintos y en 101 <head>, asi que cambiar de dominio era
   un find/replace a ciegas por todo el repo.

   PARA MUDAR EL SITIO A SU DOMINIO PROPIO:
     1. cambiar DOMAIN y BASE_PATH aca abajo
     2. correr:  node tools/build-pages.mjs
     3. revisar el diff y publicar
   Eso reescribe las fichas de producto, el sitemap, el robots.txt y el
   <base href> de todas las paginas. No hay que editar ningun HTML a mano.

   Este archivo corre en los dos lados (navegador y Node) porque lo usan
   tanto admin.html como el script de build; mismo patron de doble export
   que assets/js/pdp-render.js.
   ========================================================================= */
(function (root) {
  "use strict";

  /* --------------------------- LO QUE SE CAMBIA -------------------------- */

  /* Sitio en su dominio propio (Hostinger). Antes vivia en GitHub Pages bajo
     daniel666674.github.io/stike-x7k2m9/; tools/build-pages.mjs sabe reapuntar
     las URL de ida y vuelta (tools/domain-flip-test.mjs). */
  var DOMAIN    = "stikebikeshop.com";
  var BASE_PATH = "/";        // con "/" al inicio y al final

  /* El numero que arma los mensajes de WhatsApp de las fichas de producto.
     Tiene que ser el mismo de STIKE_CONFIG.whatsapp en assets/js/app.js
     (que es el que usa el resto del sitio); tools/build-pages.mjs compara
     los dos y se niega a generar si no coinciden. */
  var WHATSAPP  = "573118108848";

  /* Acceso al panel admin: la lista de correos autorizados y la sesion viven
     en el SERVIDOR (api/_admin.php), no aca -- este archivo es publico. */

  /* ------------------------------ DERIVADO ------------------------------ */

  var basePath = "/" + String(BASE_PATH).replace(/^\/+|\/+$/g, "") + "/";
  if (basePath === "//") basePath = "/";

  var SITE = {
    domain: DOMAIN,
    basePath: basePath,
    /* Sin barra al final: todo lo que se le pega abajo empieza con "/".
       El bug que esto previene ya paso: las 52 fichas se generaron con un
       siteUrl y una ruta pegados sin barra en medio
       ("...github.io/bmxstoreassets/img/...") y los rastreadores de
       WhatsApp y Facebook recibieron 404 en el og:image de TODOS los
       productos. Una sola fuente y una sola concatenacion, por eso. */
    siteUrl: "https://" + DOMAIN + (basePath === "/" ? "" : basePath.replace(/\/$/, "")),
    name: "Stike Bike Shop",
    /* Como se saluda en los mensajes de WhatsApp. Corto a proposito: el
       cliente le escribe a la tienda, no a una razon social. */
    shortName: "Stike",
    whatsapp: WHATSAPP,
    ogFallback: "assets/img/og-stike.jpg",

    /* ---- Datos del negocio (NAP): UNA fuente para el sitio, los datos
       estructurados (JSON-LD), llms.txt y el feed de Google Merchant. Si
       cambia la direccion, el telefono o el horario, se cambia aca y se
       publica: todo lo demas se regenera solo. ---- */
    business: {
      type: "BicycleStore",
      legalName: "Stike Bike Shop",
      description: "Tienda BMX en Bogotá: repuestos, protecciones, ropa y armado de BMX a la medida con asesoría de riders.",
      telephone: "+573118108848",
      email: "jparra375@gmail.com",
      street: "Cra 52A # 45A-29 Sur",
      locality: "Venecia, Bogotá",
      region: "Bogotá D.C.",
      country: "CO",
      geo: { lat: 4.5981, lng: -74.1469 },
      hours: { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"], opens: "10:00", closes: "19:00", text: "Lunes a sábado, 10:00 a.m. a 7:00 p.m." },
      sameAs: [
        "https://www.instagram.com/stikebikeshop",
        "https://www.facebook.com/share/1Cz3ezfUvL/",
        "https://tiktok.com/@stikebikeshop"
      ],
      payments: ["Tarjeta de crédito o débito", "PSE", "Nequi", "Bancolombia"]
    },

    /* Envio del carrito (api/_lib.php STIKE_FREE_SHIP / STIKE_SHIP_COST y
       carrito.html usan los mismos valores; build-seo los publica en los
       datos estructurados de cada producto). */
    shipping: { cost: 18000, freeFrom: 300000 },

    /* Verificacion de propiedad (Google Search Console / Bing Webmaster).
       Si te dan una etiqueta <meta>, pega aca SOLO el valor del content=""
       y publica; build-seo la pone en el <head> del inicio. Vacio = no pone nada. */
    googleSiteVerification: "",
    bingSiteVerification: "",

    /* Las paginas fijas del sitemap: [ruta, prioridad, frecuencia].
       Vive aca porque la usan DOS generadores -- tools/build-pages.mjs y el
       panel al publicar (regenerateSitemap en admin.js) -- y cuando cada uno
       tenia su propia copia, la del panel se quedo sin las cuatro paginas de
       Fate: cada vez que el dueno publicaba un producto, el sitemap perdia
       ese micro-sitio completo sin que nadie se enterara.
       Las fichas de producto NO van aca: salen del catalogo. */
    staticPages: [
      ["",                      "1.0", "weekly"],
      ["tienda.html",           "0.9", "weekly"],
      ["armar.html",            "0.9", "monthly"],
      ["marcas.html",           "0.6", "monthly"],
      ["nosotros.html",         "0.6", "monthly"],
      ["contacto.html",         "0.6", "monthly"],
      ["blog.html",             "0.8", "weekly"],
      ["blog-historia-bmx.html","0.7", "yearly"],
      ["blog-bmx-bogota.html",  "0.7", "yearly"],
      ["blog-arma-tu-bmx.html", "0.7", "yearly"],
      ["preguntas-frecuentes.html","0.6","monthly"],
      ["envios.html",           "0.4", "yearly"],
      ["devoluciones.html",     "0.4", "yearly"],
      ["terminos.html",         "0.2", "yearly"],
      ["privacidad.html",       "0.2", "yearly"],
      ["fate/",                 "0.6", "monthly"],
      ["fate/tienda.html",      "0.6", "weekly"],
      ["fate/blog.html",        "0.6", "weekly"],
      ["fate/historia-fate.html","0.5","yearly"],
      ["fate/taller-fate.html", "0.5", "yearly"],
      ["fate/riders-fate.html", "0.5", "yearly"],
    ],
  };

  /* Une el sitio con una ruta relativa sin dejar barras dobles ni pegadas. */
  SITE.url = function (path) {
    var p = String(path == null ? "" : path).replace(/^\/+/, "");
    return p ? SITE.siteUrl + "/" + p : SITE.siteUrl + "/";
  };

  if (typeof module !== "undefined" && module.exports) module.exports = SITE;
  else root.STIKE_SITE = SITE;
})(typeof window !== "undefined" ? window : globalThis);
