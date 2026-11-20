/**
 * PWA: registro del service worker (solo en el build) y el botón "Instalar". Después de la primera
 * visita todo queda en caché y el simulador abre sin conexión (también instalado en el celular).
 */

/** Estado para la UI: ¿ya funciona sin conexión? ¿se puede instalar desde un botón? */
export const pwa = {
  offlineReady: false,
  /** Hay internet ahora mismo (`navigator.onLine`). */
  online: true,
  /** Salió una versión nueva y el service worker ya la guardó: recargar para usarla. */
  updateReady: false,
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

/** Recarga para usar la versión nueva ya guardada. */
export function applyUpdate(): void {
  location.reload();
}

export function registerServiceWorker(): void {
  pwa.online = navigator.onLine !== false;
  window.addEventListener('online', () => ((pwa.online = true), pwa.onChange()));
  window.addEventListener('offline', () => ((pwa.online = false), pwa.onChange()));
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
  // Pide que el navegador no borre la caché (y las rutinas guardadas) cuando falte espacio
  void navigator.storage?.persist?.().catch(() => undefined);
  // Un service worker nuevo toma el control cuando ya había uno: hay versión nueva
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    pwa.updateReady = true;
    pwa.onChange();
  });
  navigator.serviceWorker
    .register('./sw.js')
    .then(() => navigator.serviceWorker.ready)
    .then(() => {
      pwa.offlineReady = true;
      pwa.onChange();
    })
    .catch(() => undefined);
}
