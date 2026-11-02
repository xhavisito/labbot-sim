/**
 * Desafío semanal (lógica pura): un reto fijo por semana, con meta de puntos y un marcador local
 * de mejores marcas (sin servidor: se guarda en el navegador). Reusa los retos de entrenamiento
 * (`core/training.ts`): los puntos son los de TELEOP del manual (§4.4). Que haya un desafío por
 * semana, cuál toca, su duración y su meta de puntos son SUPUESTOS de diseño (el manual no tiene
 * desafíos). El de la semana sale solo de la fecha, así que todos los equipos juegan el mismo.
 */
import { drillById, type Drill, type DrillId } from './training';

/** Un desafío del catálogo: reto base, duración y meta de puntos (SUPUESTOS). */
export interface WeeklyDef {
  id: string;
  base: DrillId;
  /** Segundos que dura. */
  limit: number;
  /** Puntos para cumplir la meta. */
  goal: number;
}

/** Catálogo que va rotando semana a semana. Las metas piden ≈ lo que un robot de referencia (N3, ≈10 Muestras por match) saca en ese tiempo. */
export const WEEKLY_POOL: readonly WeeklyDef[] = [
  { id: 'sprint60', base: 'cycles', limit: 60, goal: 60 },
  { id: 'endgame30', base: 'endgame', limit: 30, goal: 25 },
  { id: 'cycles90', base: 'cycles', limit: 90, goal: 100 },
  { id: 'sprint45', base: 'cycles', limit: 45, goal: 45 },
];

export interface WeeklyChallenge {
  /** Identificador de la semana ISO, p. ej. "2026-W45". */
  week: string;
  def: WeeklyDef;
  /** Reto de entrenamiento con la duración del desafío (el que se juega). */
  drill: Drill;
  goal: number;
  /** Lunes 00:00 (hora local) en que empieza esta semana, y el siguiente. */
  start: Date;
  end: Date;
}

/** Semana ISO 8601 (empieza en lunes; la semana 1 es la que tiene el primer jueves del año). */
export function isoWeek(d: Date): { year: number; week: number } {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day); // el jueves de esta semana
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return { year, week };
}

export const weekId = (d: Date): string => {
  const { year, week } = isoWeek(d);
  return `${year}-W${String(week).padStart(2, '0')}`;
};

/** El desafío de la semana de `now` (determinista: solo depende de la fecha). */
export function weeklyChallenge(now: Date = new Date()): WeeklyChallenge {
  const { year, week } = isoWeek(now);
  const def = WEEKLY_POOL[(year * 53 + week) % WEEKLY_POOL.length];
  const base = drillById(def.base)!;
  const day = (now.getDay() + 6) % 7; // lunes = 0
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  return { week: `${year}-W${String(week).padStart(2, '0')}`, def, drill: { ...base, limit: def.limit }, goal: def.goal, start, end };
}

// ------------------------------------------------------------------ marcador local

/** Una marca en el marcador. */
export interface WeeklyEntry {
  points: number;
  /** Robot con el que se hizo (nombre para mostrar). */
  robot: string;
  /** Fecha (ISO). */
  at: string;
}

/** Marcador guardado: las mejores marcas de cada semana (de mayor a menor). */
export interface WeeklyBoard {
  v: 1;
  weeks: Record<string, WeeklyEntry[]>;
}

/** Marcas que se guardan por semana. */
export const BOARD_SIZE = 10;
/** Semanas que se conservan (las más recientes). */
export const KEEP_WEEKS = 12;

export const emptyBoard = (): WeeklyBoard => ({ v: 1, weeks: {} });

export interface WeeklyResult {
  /** Lugar en el marcador de la semana (1 = primero); null si no entró entre las mejores. */
  rank: number | null;
  /** Mejor marca de esa semana hasta ahora. */
  isBest: boolean;
  /** Cumplió la meta de puntos. */
  metGoal: boolean;
  /** Mejor marca anterior de la semana (si había). */
  prevBest: number | null;
}

/** Registra una marca en la semana; ordena, recorta y descarta semanas viejas. Empate: queda debajo de la anterior. */
export function addEntry(b: WeeklyBoard, ch: Pick<WeeklyChallenge, 'week' | 'goal'>, e: WeeklyEntry): WeeklyResult {
  const list = (b.weeks[ch.week] ??= []);
  const prevBest = list.length ? list[0].points : null;
  let i = list.findIndex((x) => x.points < e.points);
  if (i < 0) i = list.length;
  list.splice(i, 0, e);
  const rank = i < BOARD_SIZE ? i + 1 : null;
  list.length = Math.min(list.length, BOARD_SIZE);
  const keys = Object.keys(b.weeks).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_WEEKS))) delete b.weeks[k];
  return { rank, isBest: prevBest === null || e.points > prevBest, metGoal: e.points >= ch.goal, prevBest };
}

export const entriesOf = (b: WeeklyBoard, week: string): readonly WeeklyEntry[] => b.weeks[week] ?? [];

/** Semanas en que se cumplió la meta (con las metas de hoy se cuenta cada semana contra la meta que le tocaba). */
export function weeksCleared(b: WeeklyBoard): number {
  let n = 0;
  for (const [wk, list] of Object.entries(b.weeks)) {
    const m = /^(\d{4})-W(\d{2})$/.exec(wk);
    if (!m || !list.length) continue;
    const def = WEEKLY_POOL[(Number(m[1]) * 53 + Number(m[2])) % WEEKLY_POOL.length];
    if (list[0].points >= def.goal) n++;
  }
  return n;
}

/** Lee el marcador guardado (descarta lo que no tenga la forma esperada). */
export function parseBoard(raw: string | null): WeeklyBoard {
  if (!raw) return emptyBoard();
  try {
    const o = JSON.parse(raw) as Partial<WeeklyBoard>;
    if (o?.v !== 1 || typeof o.weeks !== 'object' || !o.weeks) return emptyBoard();
    const weeks: Record<string, WeeklyEntry[]> = {};
    for (const [wk, list] of Object.entries(o.weeks)) {
      if (!/^\d{4}-W\d{2}$/.test(wk) || !Array.isArray(list)) continue;
      const ok = list
        .filter((e): e is WeeklyEntry => typeof e?.points === 'number' && Number.isFinite(e.points) && typeof e.robot === 'string')
        .map((e) => ({ points: e.points, robot: e.robot, at: typeof e.at === 'string' ? e.at : '' }))
        .sort((a, b) => b.points - a.points)
        .slice(0, BOARD_SIZE);
      if (ok.length) weeks[wk] = ok;
    }
    return { v: 1, weeks };
  } catch {
    return emptyBoard();
  }
}
