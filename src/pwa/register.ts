/**
 * PWA: registro del service worker (solo en el build) y el botón "Instalar". Después de la primera
 * visita todo queda en caché y el simulador abre sin conexión (también instalado en el celular).
 */

/** Estado para la UI: ¿ya funciona sin conexión? ¿se puede instalar desde un botón? */
export const pwa = {
  offlineReady: false,
  /** Android/escritorio: evento guardado de `beforeinstallprompt` (iOS no lo tiene). */
  installEvent: null as (Event & { prompt: () => Promise<void> }) | null,
  /** Avisa a la UI cuando algo cambia. */
  onChange: (): void => undefined,
};

/** ¿Ya corre como app instalada (pantalla de inicio)? */
export function isStandalone(): boolean {
  return matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

/** iPhone/iPad: se instala a mano con Compartir → Agregar a inicio. */
export const isIos = (): boolean => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Muestra el diálogo de instalación del navegador (si lo ofreció). */
export async function promptInstall(): Promise<void> {
  const e = pwa.installEvent;
  if (!e) return;
  pwa.installEvent = null;
  await e.prompt();
  pwa.onChange();
}

export function registerServiceWorker(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    pwa.installEvent = e as typeof pwa.installEvent;
    pwa.onChange();
  });
  window.addEventListener('appinstalled', () => {
    pwa.installEvent = null;
    pwa.onChange();
  });
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker
    .register('./sw.js')
    .then(() => navigator.serviceWorker.ready)
    .then(() => {
      pwa.offlineReady = true;
      pwa.onChange();
    })
    .catch(() => undefined);
}
