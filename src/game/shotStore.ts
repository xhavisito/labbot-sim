/** Mapa de tiro acumulado por robot de la práctica por ciclos, guardado en el navegador (localStorage). */
import { emptyShotLog, parseShotLog, type ShotLog } from '../core/scoreMap';

const KEY = 'labbot.shots.v1';

export function loadShotLog(): ShotLog {
  try {
    return parseShotLog(localStorage.getItem(KEY));
  } catch {
    return emptyShotLog();
  }
}

export function saveShotLog(log: ShotLog): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(log));
  } catch {
    /* sin almacenamiento: el mapa dura lo que la pestaña */
  }
}
