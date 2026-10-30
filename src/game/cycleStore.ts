/** Mejor ciclo por robot de la práctica 1 contra 1, guardado en el navegador (localStorage). */
import { emptyBests, parseBests, type CycleBests } from '../core/cycles';

const KEY = 'labbot.cycles.v1';

export function loadCycleBests(): CycleBests {
  try {
    return parseBests(localStorage.getItem(KEY));
  } catch {
    return emptyBests();
  }
}

export function saveCycleBests(b: CycleBests): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(b));
  } catch {
    /* sin almacenamiento: el récord dura lo que la pestaña */
  }
}
