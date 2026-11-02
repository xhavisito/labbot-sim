/**
 * Tiempo total jugado (lógica pura). Suma solo el tiempo en que la sesión corre de verdad (estado
 * "playing" de la App): ni pausa, ni menús, ni resultados, ni repeticiones.
 *
 * SUPUESTO: el simulador no tiene cuentas; el "perfil" es el navegador (localStorage), igual que los
 * récords del entrenamiento y el historial.
 */
export type PlayMode = 'match' | 'practice' | 'practice1v1' | 'auto' | 'training';
export const PLAY_MODES: readonly PlayMode[] = ['match', 'practice', 'practice1v1', 'auto', 'training'];

export interface Playtime {
  format: 'labbot-playtime';
  version: 1;
  /** Segundos jugados en total. */
  total: number;
  /** Segundos por modo. */
  byMode: Record<PlayMode, number>;
}

export const emptyPlaytime = (): Playtime => ({ format: 'labbot-playtime', version: 1, total: 0, byMode: { match: 0, practice: 0, practice1v1: 0, auto: 0, training: 0 } });

/** Un cuadro más largo que esto (pestaña dormida, depuración) no se cuenta como tiempo jugado. */
export const MAX_FRAME = 0.25;

/** Suma `dt` segundos al modo; ignora valores no finitos o negativos y recorta cuadros enormes. */
export function addPlaytime(p: Playtime, mode: PlayMode, dt: number): void {
  if (!Number.isFinite(dt) || dt <= 0) return;
  const d = Math.min(dt, MAX_FRAME);
  p.byMode[mode] += d;
  p.total += d;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/** Lee lo guardado (JSON o texto) y descarta lo inválido; el total se recalcula de los modos. */
export function parsePlaytime(raw: unknown): Playtime {
  const out = emptyPlaytime();
  let o: unknown = raw;
  if (typeof raw === 'string') {
    try {
      o = JSON.parse(raw);
    } catch {
      return out;
    }
  }
  const by = (o as { byMode?: Record<string, unknown> } | null)?.byMode;
  if (!by || typeof by !== 'object') return out;
  for (const m of PLAY_MODES) {
    out.byMode[m] = num(by[m]);
    out.total += out.byMode[m];
  }
  return out;
}

/** "45 s", "12 min", "3 h 05 min" (sin traducir: solo cifras y unidades). */
export function formatPlaytime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}
