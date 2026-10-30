/* Service worker generado en el build (vite.config.ts → serviceWorkerPlugin), como en rebuilt-sim.
 * Precache de todo el build: el simulador abre y juega sin conexión después de la primera visita.
 * La página va primero a la red (siempre la última versión con internet); lo precacheado (JS, CSS,
 * fuentes y sonidos con hash) se sirve de la caché; lo demás, de la red con respaldo en caché. */
const CACHE = 'labbot-sim-0.1.0-mvve98mm';
const PRECACHE = ["./","assets/boot-CkMTouYR.js","assets/boot-DK-lqRot.css","assets/index-5XVZjkGP.js","assets/inter-cyrillic-ext-wght-normal-BOeWTOD4.woff2","assets/inter-cyrillic-wght-normal-DqGufNeO.woff2","assets/inter-greek-ext-wght-normal-DlzME5K_.woff2","assets/inter-greek-wght-normal-CkhJZR-_.woff2","assets/inter-latin-ext-wght-normal-DO1Apj_S.woff2","assets/inter-latin-wght-normal-Dx4kXJAl.woff2","assets/inter-vietnamese-wght-normal-CBcvBZtf.woff2","assets/league-spartan-latin-ext-wght-normal-DdUHL39C.woff2","assets/league-spartan-latin-wght-normal-0z8Zi79b.woff2","assets/league-spartan-vietnamese-wght-normal-COdtqR7n.woff2","icons/favicon.svg","icons/icon-180.png","icons/icon-192.png","icons/icon-512.png","icons/icon-maskable-512.png","icons/icon.svg","index.html","manifest.webmanifest","sounds/LICENSES.md","sounds/end.wav","sounds/resume.wav","sounds/start.wav","sounds/warning.wav"];

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
