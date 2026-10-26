/**
 * Entrenamiento por retos (lógica pura): ejercicios guiados con medalla (bronce, plata, oro) y
 * récord personal. Los puntos son los del manual (§4.4, con los números de `config/game.ts`); los
 * tiempos límite y los cortes de cada medalla son SUPUESTOS de diseño del simulador (no están en el
 * manual), calibrados con la física: una ruta con script (línea 0.6 s, Plataforma 3.0 s, Crítica 7.1 s con el
 * genérico) y la IA difícil en un match (el genérico anota 5 en N3 a los ≈28 s del TELEOP). El oro pide
 * acercarse a eso; el bronce, cumplir la meta dentro del límite.
 *
 * Dos clases de reto:
 *  - 'time': cumplir la meta lo antes posible (menos segundos = mejor). Sin cumplirla no hay medalla.
 *  - 'points': juntar puntos hasta que suena la bocina del reto (más puntos = mejor).
 */
import type { GameConfig } from '../config/game';
import type { MechanismKind } from '../config/robot';

export type DrillId = 'line' | 'level3' | 'critical' | 'platform' | 'endgame' | 'cycles' | 'dominance';
export type Medal = 'bronze' | 'silver' | 'gold';
export const MEDALS: readonly Medal[] = ['bronze', 'silver', 'gold'];

/** Dónde empieza el robot: su Zona de Inicio (§4.1) o frente a su Cámara (SUPUESTO del reto). */
export type DrillStart = 'zone' | 'camara';

export interface Drill {
  id: DrillId;
  kind: 'time' | 'points';
  /** Sección del manual de la que salen los puntos o la meta. */
  section: string;
  /** Segundos que dura el reto (en 'time', el límite para cumplir la meta). */
  limit: number;
  /** Meta de los retos 'time' que cuentan algo (Muestras). */
  goal?: number;
  /** Cortes [bronce, plata, oro]: segundos máximos ('time') o puntos mínimos ('points'). */
  medals: readonly [number, number, number];
  /** Qué necesita el robot: anotar Muestras, tomar la Muestra Crítica o nada (solo manejar). */
  needs: 'none' | 'samples' | 'critical';
  /** Los cortes se ajustan al ritmo del tipo de robot (`paceFactor`). */
  paced: boolean;
  start: DrillStart;
  /** El Human Player mete Muestras por la ranura (§3.2.4) durante el reto. */
  hp: boolean;
}

/**
 * Los retos, en el orden en que se muestran. Límites y cortes: SUPUESTO de diseño.
 *  - line: salir por completo de la Zona de Inicio (la línea de autónomo, D1); 15 s = el AUTO (§4.2).
 *  - level3: 5 Muestras en el Nivel 3 (§3.2.3, apertura a 800 mm).
 *  - critical: tomar la Muestra Crítica de la rendija de la Campana y dejarla en la Repisa
 *    (§3.2.4, §3.2.5); 30 s = el ENDGAME (§4.3.1).
 *  - platform: subir a la Plataforma (D5: basta la rampa, sin tocar la alfombra) desde la Cámara y
 *    quedarse arriba 1 s; 10 s = los últimos segundos del ENDGAME.
 *  - endgame: los 30 s del ENDGAME (§4.3.1) con puntos de TELEOP; Plataforma y Muestra Crítica se
 *    evalúan al sonar la bocina.
 *  - cycles: puntos de Muestras de TELEOP (2/6/15, §4.4) en 60 s.
 *  - dominance: 10 Muestras en tu Cámara (Dominio de Cámara, RP de §4.4) en el TELEOP (135 s, §4.3).
 */
export const DRILLS: readonly Drill[] = [
  { id: 'line', kind: 'time', section: '§4.4 · D1', limit: 15, medals: [3, 1.6, 1], needs: 'none', paced: false, start: 'zone', hp: false },
  { id: 'level3', kind: 'time', section: '§3.2.3 · §4.4', limit: 120, goal: 5, medals: [120, 55, 35], needs: 'samples', paced: true, start: 'zone', hp: true },
  { id: 'critical', kind: 'time', section: '§3.2.5 · §4.3.1', limit: 30, medals: [30, 17, 11], needs: 'critical', paced: false, start: 'zone', hp: false },
  { id: 'platform', kind: 'time', section: '§4.4 · D5', limit: 10, medals: [10, 6, 4.5], needs: 'none', paced: false, start: 'camara', hp: false },
  { id: 'endgame', kind: 'points', section: '§4.3.1 · §4.4', limit: 30, medals: [10, 25, 40], needs: 'none', paced: false, start: 'zone', hp: true },
  { id: 'cycles', kind: 'points', section: '§4.4', limit: 60, medals: [30, 60, 105], needs: 'samples', paced: true, start: 'zone', hp: true },
  { id: 'dominance', kind: 'time', section: '§4.4', limit: 135, goal: 10, medals: [135, 75, 50], needs: 'samples', paced: true, start: 'zone', hp: true },
];

export const drillById = (id: string): Drill | undefined => DRILLS.find((d) => d.id === id);

/**
 * Ritmo de cada tipo de robot comparado con el genérico, para que la medalla sea justa con robots
 * que llevan menos piezas. Sale de las Muestras de N3 por match de la IA difícil en la física
 * (`core/tournament.ts`, PROFILES: genérico 10.5, elevador 10.9, torre 9.5, pivote 4.75, pivote con hopper ≈ el pivote) y de sus
 * tiempos al principio del TELEOP (el pivote anota cada ≈8 s, pero de una en una). SUPUESTO de
 * diseño. El chasis no anota.
 */
export const PACE: Record<MechanismKind, number> = { generic: 1, elevator: 1, tower: 1.1, pivot: 1.5, pivotHopper: 1.5, chassis: 1 };

/** ¿Puede este tipo de robot hacer el reto? (el chasis no toma ni suelta piezas) */
export function canPlay(d: Drill, mech: MechanismKind): boolean {
  return mech !== 'chassis' || d.needs === 'none';
}

/** Límite y cortes del reto para un tipo de robot (con su ritmo, si el reto es de Muestras). */
export function drillTargets(d: Drill, mech: MechanismKind): { limit: number; medals: [number, number, number] } {
  const k = d.paced ? PACE[mech] : 1;
  if (d.kind === 'time') return { limit: d.limit * k, medals: d.medals.map((v) => Math.round(v * k * 10) / 10) as [number, number, number] };
  return { limit: d.limit, medals: d.medals.map((v) => Math.round(v / k)) as [number, number, number] };
}

/** Lo que hizo el robot en el reto (lo arma `game/drills.ts`). */
export interface DrillOutcome {
  /** Cumplió la meta (retos 'time') o terminó el tiempo (retos 'points'). */
  completed: boolean;
  /** Segundos que tardó (retos 'time'). */
  time: number;
  /** Puntos con los valores del manual (retos 'points'; informativos en los 'time'). */
  points: number;
}

/** Valor que se compara para la medalla y el récord: segundos ('time') o puntos ('points'). */
export function drillValue(d: Drill, o: DrillOutcome): number | null {
  if (d.kind === 'time') return o.completed ? Math.round(o.time * 100) / 100 : null;
  return o.points;
}

/** Medalla para un valor (null = sin medalla). */
export function medalFor(d: Drill, mech: MechanismKind, value: number | null): Medal | null {
  if (value === null) return null;
  const { medals } = drillTargets(d, mech);
  let best: Medal | null = null;
  for (let i = 0; i < 3; i++) {
    const ok = d.kind === 'time' ? value <= medals[i] + 1e-9 : value >= medals[i];
    if (ok) best = MEDALS[i];
  }
  return best;
}

/** ¿`a` es mejor que `b`? */
export const better = (d: Drill, a: number, b: number): boolean => (d.kind === 'time' ? a < b : a > b);

export const medalRank = (m: Medal | null): number => (m ? MEDALS.indexOf(m) + 1 : 0);

/** Puntos de TELEOP de las Muestras por nivel y de Plataforma/Crítica (§4.4), para los retos. */
export function teleopPoints(g: GameConfig, samples: Record<1 | 2 | 3, number>, platform: boolean, critical: boolean): number {
  const P = g.points;
  return samples[1] * P.sampleTeleop[1] + samples[2] * P.sampleTeleop[2] + samples[3] * P.sampleTeleop[3] + (platform ? P.platformOne : 0) + (critical ? P.critical : 0);
}

// ------------------------------------------------------------------ progreso (récords)

/** Récord de un reto con un robot. */
export interface DrillRecord {
  best: number;
  medal: Medal | null;
  runs: number;
  /** Fecha del récord (ISO). */
  at: string;
}

/** Progreso guardado: récord por reto y robot (`drill:robotId`). */
export interface TrainingProgress {
  v: 1;
  records: Record<string, DrillRecord>;
}

export const emptyProgress = (): TrainingProgress => ({ v: 1, records: {} });
export const recordKey = (d: DrillId, robot: string): string => `${d}:${robot}`;

export interface RunResult {
  value: number | null;
  medal: Medal | null;
  /** Récord nuevo (el primero también cuenta). */
  improved: boolean;
  /** Récord anterior (si había). */
  prev: DrillRecord | null;
}

/** Registra una corrida y actualiza el récord (y la mejor medalla) si la mejora. */
export function recordRun(p: TrainingProgress, d: Drill, robot: string, mech: MechanismKind, o: DrillOutcome, now = new Date()): RunResult {
  const value = drillValue(d, o);
  const medal = medalFor(d, mech, value);
  const key = recordKey(d.id, robot);
  const prevRec = p.records[key];
  const prev = prevRec ? { ...prevRec } : null;
  // best < 0 = corridas sin marca todavía (no cumplió la meta)
  const hasMark = !!prevRec && prevRec.best >= 0;
  const improved = value !== null && (!hasMark || better(d, value, prevRec!.best));
  if (improved) p.records[key] = { best: value, medal, runs: (prevRec?.runs ?? 0) + 1, at: now.toISOString() };
  else if (prevRec) prevRec.runs++;
  else p.records[key] = { best: -1, medal: null, runs: 1, at: '' };
  return { value, medal, improved, prev: hasMark ? prev : null };
}

/** Récord de un reto con un robot (sin marca = null). */
export function bestOf(p: TrainingProgress, d: DrillId, robot: string): DrillRecord | null {
  const r = p.records[recordKey(d, robot)];
  return r && r.best >= 0 ? r : null;
}

/** Medallas del robot: cuántas de cada una (la mejor por reto). */
export function medalCount(p: TrainingProgress, robot: string): Record<Medal, number> {
  const out: Record<Medal, number> = { bronze: 0, silver: 0, gold: 0 };
  for (const d of DRILLS) {
    const m = bestOf(p, d.id, robot)?.medal;
    if (m) out[m]++;
  }
  return out;
}

/** Lee el progreso guardado (descarta lo que no tenga la forma esperada). */
export function parseProgress(raw: string | null): TrainingProgress {
  if (!raw) return emptyProgress();
  try {
    const o = JSON.parse(raw) as Partial<TrainingProgress>;
    if (o?.v !== 1 || typeof o.records !== 'object' || !o.records) return emptyProgress();
    const records: Record<string, DrillRecord> = {};
    for (const [k, r] of Object.entries(o.records)) {
      const [id] = k.split(':');
      if (!drillById(id) || typeof r?.best !== 'number' || typeof r.runs !== 'number') continue;
      const medal = MEDALS.includes(r.medal as Medal) ? (r.medal as Medal) : null;
      records[k] = { best: r.best, medal, runs: r.runs, at: typeof r.at === 'string' ? r.at : '' };
    }
    return { v: 1, records };
  } catch {
    return emptyProgress();
  }
}
