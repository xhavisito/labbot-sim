/**
 * Lista de precache y plantilla del service worker (puro, sin Vite): `vite.config.ts` los usa al
 * generar `sw.js` y `tests/pwa.test.ts` los prueba.
 */

/** Archivos que no tiene caso guardar para jugar sin conexión. */
const SKIP = /(\.map|\.DS_Store|Thumbs\.db)$|(^|\/)sw\.js$/;

/** Todo lo del build (assets con hash) + `public/` + la página, sin duplicados y ordenado. */
export function buildPrecacheList(bundleFiles: readonly string[], publicFiles: readonly string[]): string[] {
  const all = ['./', 'index.html', ...bundleFiles, ...publicFiles].map((p) => p.split('\\').join('/'));
  return [...new Set(all.filter((p) => !SKIP.test(p)))].sort();
}

/** Rellena la plantilla `sw-template.js` con la versión de la caché y la lista de precache. */
export function renderServiceWorker(template: string, version: string, precache: readonly string[]): string {
  if (!template.includes('__CACHE_VERSION__') || !template.includes('__PRECACHE__')) {
    throw new Error('sw-template.js sin marcadores __CACHE_VERSION__ / __PRECACHE__');
  }
  return template.replace('__CACHE_VERSION__', version).replace('__PRECACHE__', JSON.stringify(precache));
}
