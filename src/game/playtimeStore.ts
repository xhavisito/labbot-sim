/** Tiempo total jugado, guardado en el navegador (localStorage). Ver `core/playtime.ts`. */
import { emptyPlaytime, parsePlaytime, type Playtime } from '../core/playtime';

const KEY = 'labbot.playtime.v1';

export function loadPlaytime(): Playtime {
  try {
    return parsePlaytime(localStorage.getItem(KEY));
  } catch {
    return emptyPlaytime();
  }
}

export function savePlaytime(p: Playtime): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* sin almacenamiento: el tiempo dura lo que la pestaña */
  }
}
