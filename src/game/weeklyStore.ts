/** Marcador del desafío semanal, guardado en el navegador (localStorage; sin servidor). */
import { emptyBoard, parseBoard, type WeeklyBoard } from '../core/weekly';

const KEY = 'labbot.weekly.v1';

export function loadWeekly(): WeeklyBoard {
  try {
    return parseBoard(localStorage.getItem(KEY));
  } catch {
    return emptyBoard();
  }
}

export function saveWeekly(b: WeeklyBoard): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(b));
  } catch {
    /* sin almacenamiento: el marcador dura lo que la pestaña */
  }
}
