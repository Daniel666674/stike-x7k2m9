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

  /* Acceso al panel. Mientras ADMIN_EMAILS este vacio, admin.html entra
     sin login (asi arranco esto). Con la lista llena, como ahora, admin.html
     exige iniciar sesion con una de estas cuentas de Google antes de mostrar
     nada del catalogo real.

     El Client ID es publico a proposito -- va escrito en la pagina, y lo
     que protege el acceso es esta lista de correos, no el secreto de la
     credencial (ese no se usa: Sign In With Google no lo necesita). */
  var OAUTH_CLIENT_ID = "752305520255-7e2abc762p3saer5sube25jh9rt9jle7.apps.googleusercontent.com";

  /* Quien puede ENTRAR al panel. Un correo que no este aca se autentica bien
     con Google (es una cuenta real) pero el panel lo rechaza igual: la
     lista de Google en Cloud Console es aparte y NO sustituye a esta. */
  var ADMIN_EMAILS = [
    "daniel.f.acosta96@gmail.com",
    "camilor9507@gmail.com",
    "jparra375@gmail.com",
  ];

  /* De los de arriba, quien ve costo y margen. El resto entra y publica
     igual, pero esos numeros quedan ocultos (ver session.role en admin.js). */
  var OWNER_EMAILS = [
    "daniel.f.acosta96@gmail.com",
    "jparra375@gmail.com",
  ];

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
    oauthClientId: OAUTH_CLIENT_ID,
    adminEmails: ADMIN_EMAILS,
    ownerEmails: OWNER_EMAILS,

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
