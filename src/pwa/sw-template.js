/* Service worker generado en el build (vite.config.ts → serviceWorkerPlugin), como en rebuilt-sim.
 * Precache de todo el build: el simulador abre y juega sin conexión después de la primera visita.
 * La página va primero a la red (siempre la última versión con internet); lo precacheado (JS, CSS,
 * fuentes y sonidos con hash) se sirve de la caché; lo demás, de la red con respaldo en caché. */
const CACHE = 'labbot-sim-__CACHE_VERSION__';
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE.map((p) => new URL(p, self.registration.scope).toString()))));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // La página (index.html) va primero a la red: con internet siempre abre la última versión publicada
  // (antes la caché servía la vieja y había que recargar dos o tres veces); sin internet, la guardada
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(new URL('index.html', self.registration.scope).toString(), copy));
          }
          return res;
        })
        .catch(() => caches.match(new URL('index.html', self.registration.scope).toString()).then((hit) => hit ?? Response.error())),
    );
    return;
  }
  event.respondWith(
    caches.match(req, { ignoreSearch: true, ignoreVary: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => (req.mode === 'navigate' ? caches.match(new URL('index.html', self.registration.scope).toString()) : Response.error()));
    }),
  );
});
