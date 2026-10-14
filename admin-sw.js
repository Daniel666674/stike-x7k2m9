/* =========================================================================
   Service worker SOLO para admin.html. Cachea unicamente assets estaticos
   pequeños del shell (el logo). NUNCA cachea admin.html, admin.js, ningun
   otro .js del panel, ni ninguna pagina HTML: en una conexion movil poco
   confiable, una copia vieja cacheada del CODIGO del panel (que habla con
   la API de GitHub) es peor que no tener soporte offline.
   ========================================================================= */
const CACHE_NAME = "stike-admin-shell-v1";
const SHELL_ASSETS = ["/bmxstore/assets/img/logo-stike.svg"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(names => Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  const isShellAsset = SHELL_ASSETS.includes(url.pathname);
  if (!isShellAsset) return; // deja pasar TODO lo demas (HTML, JS, API de GitHub) directo a la red, sin cache

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(res => {
      const clone = res.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
      return res;
    }))
  );
});
