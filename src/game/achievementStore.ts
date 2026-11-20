/** Logros y progreso guardados en el navegador (localStorage, `core/achievements.ts`). */
import { emptyAch, parseAch, type AchProgress } from '../core/achievements';

const KEY = 'labbot.achievements.v1';

export function loadAch(): AchProgress {
  try {
    return parseAch(localStorage.getItem(KEY));
  } catch {
    return emptyAch();
  }
}

export function saveAch(p: AchProgress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* sin almacenamiento: el progreso dura lo que la pestaña */
  }
}
