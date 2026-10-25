/**
 * Punto de entrada mínimo. El simulador pesa ~5 MB (Three.js y Rapier con su WASM): se descarga
 * DESPUÉS de que la página pinta la pantalla de carga. Si no, Safari en iPhone deja la pantalla en
 * negro hasta terminar de bajar todo (el evento `load` espera a los scripts del <head>), y con
 * datos móviles son muchos segundos.
 */
const loadingText = (): HTMLElement | null => document.getElementById('loading-text');

function fail(e: unknown): void {
  const el = loadingText();
  if (el) el.textContent = `No se pudo iniciar: ${e instanceof Error ? e.message : String(e)}`;
  document.getElementById('loading-spinner')?.remove();
  console.error(e);
}

window.addEventListener('error', (e) => fail(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => fail(e.reason));

function go(): void {
  const el = loadingText();
  if (el) el.textContent = 'Descargando el simulador (~2 MB)…';
  import('./boot').then((m) => m.start()).catch(fail);
}

if (document.readyState === 'complete') go();
else window.addEventListener('load', go, { once: true });
