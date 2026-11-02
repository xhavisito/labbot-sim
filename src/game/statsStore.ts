/** Estadísticas por robot guardado en localStorage. */
import { emptyRecord, sanitizeRecords, type RobotRecord, type SessionStats } from '../core/robotStats';

const KEY = 'labbot.robotStats';

export function loadRecords(): RobotRecord[] {
  try {
    return sanitizeRecords(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return [];
  }
}

/** Suma la sesión al robot `id` (lo crea si es nuevo) y guarda. Sesiones vacías o ya guardadas no cuentan. */
export function commitSession(s: SessionStats, id: string, label: string): void {
  if (s.committed || s.empty) return;
  s.committed = true;
  const all = loadRecords();
  const i = all.findIndex((r) => r.id === id);
  const next = s.addTo(i >= 0 ? { ...all[i], label } : emptyRecord(id, label));
  if (i >= 0) all[i] = next;
  else all.push(next);
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* sin almacenamiento */
  }
}
