/**
 * Estadísticas por robot guardado (práctica y matches): tiempo de ciclo, precisión de tiro y
 * puntos por minuto. Puro: sin DOM ni almacenamiento. Si un dato no se puede calcular (nunca hubo
 * ciclos, tiros o tiempo suficiente) vale `null` y la UI lo muestra como "sin datos"; nunca se inventa.
 *
 * Definiciones (SUPUESTO, el manual no define métricas):
 *  - Ciclo: segundos desde que el robot recoge una Muestra hasta que esa misma Muestra se anota.
 *    La precarga no cuenta (no se recogió).
 *  - Precisión: Muestras anotadas ÷ Muestras soltadas por el robot (la Crítica no cuenta).
 *  - Puntos por minuto: puntos de Muestras anotadas por el robot ÷ minutos con el robot habilitado.
 */
export interface RobotRecord {
  /** Clave del robot guardado (`robotId`). */
  id: string;
  label: string;
  /** Segundos con el robot habilitado (práctica o TELEOP; en AUTO maneja la rutina). */
  seconds: number;
  shots: number;
  hits: number;
  points: number;
  cycles: number;
  cycleSeconds: number;
  /** Veces que se acumuló (sesiones). */
  sessions: number;
}

/** Con menos tiempo que esto los puntos por minuto no son confiables y se marcan sin datos. */
export const MIN_SECONDS_FOR_PPM = 30;

export interface RobotMetrics {
  /** Segundos por ciclo, o null sin ciclos. */
  cycleTime: number | null;
  /** 0–1, o null sin tiros. */
  accuracy: number | null;
  /** Puntos por minuto, o null con poco tiempo jugado. */
  pointsPerMinute: number | null;
}

export function metrics(r: RobotRecord): RobotMetrics {
  return {
    cycleTime: r.cycles > 0 ? r.cycleSeconds / r.cycles : null,
    accuracy: r.shots > 0 ? Math.min(1, r.hits / r.shots) : null,
    pointsPerMinute: r.seconds >= MIN_SECONDS_FOR_PPM ? r.points / (r.seconds / 60) : null,
  };
}

/** Clave estable de un robot guardado: mecanismo, velocidad y capacidad. */
export function robotId(spec: { mechanism: string; maxSpeed: number; capacity: number }): string {
  return `${spec.mechanism}|${+spec.maxSpeed.toFixed(2)}|${spec.capacity}`;
}

export const emptyRecord = (id: string, label: string): RobotRecord => ({ id, label, seconds: 0, shots: 0, hits: 0, points: 0, cycles: 0, cycleSeconds: 0, sessions: 0 });

/** Acumula lo que pasa en una sesión para un solo robot. */
export class SessionStats {
  seconds = 0;
  shots = 0;
  hits = 0;
  points = 0;
  cycles = 0;
  cycleSeconds = 0;
  /** Para no guardar dos veces la misma sesión. */
  committed = false;
  private picked = new Map<number, number>();
  private released = new Set<number>();

  /** Tiempo con el robot habilitado. */
  tick(dt: number, enabled: boolean): void {
    if (enabled) this.seconds += dt;
  }
  /** El robot recogió la Muestra `piece` en el tiempo `t`. */
  intake(piece: number, t: number): void {
    this.picked.set(piece, t);
  }
  /** El robot soltó la Muestra `piece`. */
  shot(piece: number): void {
    this.shots++;
    this.released.add(piece);
  }
  /** Se anotó la Muestra `piece` (de quien sea) valiendo `points`; cuenta solo si la soltó este robot. */
  scored(piece: number, points: number, t: number): void {
    if (!this.released.delete(piece)) return;
    this.hits++;
    this.points += points;
    const t0 = this.picked.get(piece);
    this.picked.delete(piece);
    if (t0 !== undefined && t >= t0) {
      this.cycles++;
      this.cycleSeconds += t - t0;
    }
  }
  get empty(): boolean {
    return this.seconds <= 0 && this.shots === 0;
  }
  /** Suma esta sesión a un registro. */
  addTo(r: RobotRecord): RobotRecord {
    return {
      ...r,
      seconds: r.seconds + this.seconds,
      shots: r.shots + this.shots,
      hits: r.hits + this.hits,
      points: r.points + this.points,
      cycles: r.cycles + this.cycles,
      cycleSeconds: r.cycleSeconds + this.cycleSeconds,
      sessions: r.sessions + 1,
    };
  }
}

export type CompareKey = 'cycleTime' | 'accuracy' | 'pointsPerMinute';
export interface CompareRow {
  key: CompareKey;
  a: number | null;
  b: number | null;
  /** Quién va mejor; null si falta algún dato o empatan. */
  better: 'a' | 'b' | null;
}

/** Filas de comparación de dos robots. Menos es mejor en el ciclo; más es mejor en lo demás. */
export function compareRobots(a: RobotRecord, b: RobotRecord): CompareRow[] {
  const ma = metrics(a);
  const mb = metrics(b);
  return (['cycleTime', 'accuracy', 'pointsPerMinute'] as const).map((key) => {
    const x = ma[key];
    const y = mb[key];
    let better: CompareRow['better'] = null;
    if (x !== null && y !== null && x !== y) better = (key === 'cycleTime' ? x < y : x > y) ? 'a' : 'b';
    return { key, a: x, b: y, better };
  });
}

/** Registros válidos a partir de cualquier valor guardado. */
export function sanitizeRecords(raw: unknown): RobotRecord[] {
  if (!Array.isArray(raw)) return [];
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  const out: RobotRecord[] = [];
  for (const o of raw as Array<Record<string, unknown>>) {
    if (!o || typeof o.id !== 'string' || typeof o.label !== 'string') continue;
    out.push({ id: o.id, label: o.label, seconds: n(o.seconds), shots: n(o.shots), hits: n(o.hits), points: n(o.points), cycles: n(o.cycles), cycleSeconds: n(o.cycleSeconds), sessions: n(o.sessions) });
  }
  return out;
}
