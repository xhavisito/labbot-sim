/** Trayectoria del mejor ciclo por robot (ghost de la práctica 1 contra 1), en el navegador (localStorage). */
import { emptyGhosts, parseGhosts, type GhostStore } from '../core/ghost';

const KEY = 'labbot.ghost.v1';

export function loadGhosts(): GhostStore {
  try {
    return parseGhosts(localStorage.getItem(KEY));
  } catch {
    return emptyGhosts();
  }
}

export function saveGhosts(s: GhostStore): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* sin almacenamiento: el ghost dura lo que la pestaña */
  }
}
