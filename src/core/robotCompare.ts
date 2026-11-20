/**
 * Comparación de dos robots guardados con las estadísticas que ya se acumulan: mejores ciclos
 * (`CycleBests`) y tiros (`ShotLog`) de la práctica 1 contra 1, más el rendimiento acumulado
 * (`PerfData`) de práctica y matches. Puro: sin DOM ni almacenamiento. Lo que falta vale `null` y
 * la UI lo muestra como "sin datos"; nunca se inventa.
 */
import { CYCLE_CATS, type CycleBests } from './cycles';
import type { ShotLog } from './scoreMap';

/** Rendimiento acumulado de un robot (suma de prácticas y matches). */
export interface PerfRecord {
  /** Segundos jugados con el robot habilitado. */
  seconds: number;
  /** Puntos de Muestras que anotó (valor del periodo, §4.4). */
  points: number;
  /** Ciclos completos (recoger → anotar) y su suma de segundos. */
  cycles: number;
  cycleSeconds: number;
}

export interface PerfData {
  v: 1;
  robots: Record<string, PerfRecord>;
}

export const emptyPerf = (): PerfData => ({ v: 1, robots: {} });

/** Suma una sesión al robot `id`. Sesiones sin tiempo no cuentan. */
export function addPerf(d: PerfData, id: string, add: PerfRecord): void {
  if (!(add.seconds > 0)) return;
  const r = (d.robots[id] ??= { seconds: 0, points: 0, cycles: 0, cycleSeconds: 0 });
  r.seconds += add.seconds;
  r.points += add.points;
  r.cycles += add.cycles;
  r.cycleSeconds += add.cycleSeconds;
}

/** Lee lo guardado (descarta lo que no tenga la forma esperada). */
export function parsePerf(raw: string | null): PerfData {
  if (!raw) return emptyPerf();
  try {
    const o = JSON.parse(raw) as Partial<PerfData>;
    if (o?.v !== 1 || !o.robots || typeof o.robots !== 'object') return emptyPerf();
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
    const robots: PerfData['robots'] = {};
    for (const [id, r] of Object.entries(o.robots)) {
      if (!r || typeof r !== 'object') continue;
      const x = r as unknown as Record<string, unknown>;
      robots[id] = { seconds: n(x.seconds), points: n(x.points), cycles: n(x.cycles), cycleSeconds: n(x.cycleSeconds) };
    }
    return { v: 1, robots };
  } catch {
    return emptyPerf();
  }
}

/** Con menos tiempo que esto los puntos por minuto no son confiables y se marcan sin datos (SUPUESTO). */
export const MIN_SECONDS_FOR_PPM = 30;

export interface RobotSummary {
  id: string;
  name: string;
  /** Promedio de ciclo (s); null sin ciclos. */
  avgCycle: number | null;
  /** Mejor ciclo (s) de cualquier categoría; null sin récords. */
  bestCycle: number | null;
  /** Aciertos ÷ tiros (0–1); null sin tiros. */
  accuracy: number | null;
  shots: number;
  /** Puntos por minuto; null con poco tiempo jugado. */
  pointsPerMinute: number | null;
  /** Minutos jugados registrados. */
  minutes: number;
}

export function summarize(id: string, name: string, bests: CycleBests, shots: ShotLog, perf: PerfData): RobotSummary {
  const times = CYCLE_CATS.map((c) => bests.bests[id]?.[c]).filter((v): v is number => v !== undefined);
  const list = shots.robots[id] ?? [];
  const p = perf.robots[id];
  return {
    id,
    name,
    avgCycle: p && p.cycles > 0 ? p.cycleSeconds / p.cycles : null,
    bestCycle: times.length ? Math.min(...times) : null,
    accuracy: list.length ? list.filter((s) => s.ok).length / list.length : null,
    shots: list.length,
    pointsPerMinute: p && p.seconds >= MIN_SECONDS_FOR_PPM ? p.points / (p.seconds / 60) : null,
    minutes: p ? p.seconds / 60 : 0,
  };
}

export type CompareKey = 'avgCycle' | 'bestCycle' | 'accuracy' | 'pointsPerMinute';
export interface CompareRow {
  key: CompareKey;
  a: number | null;
  b: number | null;
  /** Quién va mejor; null si falta algún dato o empatan. */
  better: 'a' | 'b' | null;
}

/** Filas lado a lado. Menos es mejor en los ciclos; más es mejor en precisión y puntos por minuto. */
export function compareRows(a: RobotSummary, b: RobotSummary): CompareRow[] {
  return (['avgCycle', 'bestCycle', 'accuracy', 'pointsPerMinute'] as const).map((key) => {
    const x = a[key];
    const y = b[key];
    let better: CompareRow['better'] = null;
    if (x !== null && y !== null && x !== y) better = (key === 'avgCycle' || key === 'bestCycle' ? x < y : x > y) ? 'a' : 'b';
    return { key, a: x, b: y, better };
  });
}
