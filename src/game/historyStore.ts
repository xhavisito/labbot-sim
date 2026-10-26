/**
 * Historial de torneos y temporadas guardado en el navegador (localStorage, `core/history.ts`). Se
 * exporta e importa como JSON para pasarlo a otro equipo.
 */
import { emptyHistory, sanitizeHistory, type HistoryData } from '../core/history';

const KEY = 'labbot.history.v1';

export function loadHistory(): HistoryData {
  try {
    return sanitizeHistory(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return emptyHistory();
  }
}

/** Guarda; si no cabe, borra los eventos más viejos hasta que quepa. */
export function saveHistory(h: HistoryData): void {
  for (let drop = 0; drop <= h.events.length; drop++)
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...h, events: h.events.slice(drop) }));
      return;
    } catch {
      /* lleno o sin almacenamiento: intenta con menos */
    }
}
