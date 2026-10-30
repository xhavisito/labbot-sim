/**
 * Práctica 1 contra 1 (lógica pura): cronómetro de ciclos y estadísticas por Muestra del robot del
 * jugador. Los puntos son los del TELEOP del manual (§4.4: N1/N2/N3 = 2/6/15, Muestra Crítica 15,
 * con los números de `config/game.ts`); todo lo demás es SUPUESTO de diseño del simulador (el manual
 * no habla de ciclos ni de intentos):
 *
 *  - Ciclo = de recoger una pieza (intake de la Muestra o la garra toma la Crítica) a que esa misma
 *    pieza cuente en tu Cámara (o, la Crítica, en tu Repisa). La precarga (§4.1) empieza su ciclo
 *    al arrancar la práctica.
 *  - Intento = soltar la pieza con el elevador en un nivel (N1–N3) o en la posición de la Repisa
 *    (la Crítica). Soltarla abajo (posición 0) no es intento: es dejarla en el piso.
 *  - Un intento acierta si la pieza cuenta en tu Cámara dentro de `ATTEMPT_WINDOW` segundos. Si
 *    cae en la Cámara rival (D14: sería para el rival), en el piso, o la vuelves a recoger, falla.
 *  - El intento se cuenta en el nivel donde cayó la pieza si anotó; si falló, en el nivel al que
 *    apuntaba el elevador.
 */
import type { GameConfig } from '../config/game';
import type { Level } from './types';

/** Categorías de las estadísticas: los tres niveles de la Cámara (§3.2.3) y la Muestra Crítica (§3.2.5). */
export type CycleCat = 'n1' | 'n2' | 'n3' | 'critical';
export const CYCLE_CATS: readonly CycleCat[] = ['n1', 'n2', 'n3', 'critical'];
export const levelCat = (l: Level): CycleCat => (l === 1 ? 'n1' : l === 2 ? 'n2' : 'n3');

/** Segundos que tiene una pieza soltada para contar como acierto (SUPUESTO: cae, rebota y el sensor la ve). */
export const ATTEMPT_WINDOW = 2.5;

export interface CycleRecord {
  cat: CycleCat;
  /** Segundo (desde que arrancó la práctica) en que se recogió y en que anotó. */
  start: number;
  end: number;
  time: number;
  points: number;
}

export interface CatStats {
  attempts: number;
  scored: number;
  /** Aciertos / intentos (0–1); null sin intentos. */
  accuracy: number | null;
  /** Promedio y mejor ciclo (s) de las anotadas; null sin anotar. */
  avg: number | null;
  best: number | null;
  points: number;
}

export interface CycleSummary {
  /** Segundos de práctica. */
  time: number;
  cycles: number;
  attempts: number;
  scored: number;
  accuracy: number | null;
  avg: number | null;
  best: number | null;
  last: number | null;
  points: number;
  /** Muestras anotadas por minuto (sin la Crítica). */
  perMinute: number;
  byCat: Record<CycleCat, CatStats>;
}

interface Pending {
  piece: number;
  cat: CycleCat;
  at: number;
  /** Cuándo se recogió (inicio del ciclo). */
  start: number;
}

/**
 * Lleva la cuenta de una práctica. La llama `game/cycleTracker.ts` con lo que pasa en la física
 * (solo lo del robot del jugador) y el tiempo de la práctica.
 */
export class CycleStats {
  readonly records: CycleRecord[] = [];
  readonly failed: Record<CycleCat, number> = { n1: 0, n2: 0, n3: 0, critical: 0 };
  /** Pieza → segundo en que la recogió (ciclo abierto). */
  private carried = new Map<number, number>();
  /** Intentos esperando a ver si cuentan. */
  private pending: Pending[] = [];
  time = 0;

  constructor(private readonly game: GameConfig) {}

  /** La precarga (o una pieza que ya traía): su ciclo empieza ahora. */
  carrying(piece: number, t = this.time): void {
    this.carried.set(piece, t);
  }

  /** Recogió una pieza: empieza su ciclo. Si estaba en un intento sin resolver, ese intento falló. */
  pickup(piece: number, t: number): void {
    this.advance(t);
    const i = this.pending.findIndex((p) => p.piece === piece);
    if (i >= 0) this.fail(i);
    this.carried.set(piece, t);
  }

  /** Soltó una pieza. `cat` = a dónde apuntaba (null = abajo, no es intento). */
  release(piece: number, cat: CycleCat | null, t: number): void {
    this.advance(t);
    const start = this.carried.get(piece);
    this.carried.delete(piece);
    if (cat === null || start === undefined) return;
    this.pending.push({ piece, cat, at: t, start });
  }

  /**
   * La pieza contó en tu Cámara (o la Crítica en tu Repisa). Si no había intento (la empujó o la
   * soltó abajo y entró) cuenta igual, como intento acertado, con el ciclo desde que la recogió.
   */
  scored(piece: number, cat: CycleCat, t: number): void {
    this.advance(t);
    const i = this.pending.findIndex((p) => p.piece === piece);
    let start: number | undefined;
    if (i >= 0) {
      start = this.pending[i].start;
      this.pending.splice(i, 1);
    } else {
      start = this.carried.get(piece);
      this.carried.delete(piece);
    }
    const points = cat === 'critical' ? this.game.points.critical : this.game.points.sampleTeleop[cat === 'n1' ? 1 : cat === 'n2' ? 2 : 3];
    const s = start ?? t;
    this.records.push({ cat, start: s, end: t, time: Math.max(0, t - s), points });
  }

  /** La pieza cayó en la Cámara rival (D14): el intento falló. */
  missed(piece: number, t: number): void {
    this.advance(t);
    const i = this.pending.findIndex((p) => p.piece === piece);
    if (i >= 0) this.fail(i);
  }

  /** Avanza el reloj y cierra los intentos que ya no alcanzaron a contar. */
  advance(t: number): void {
    this.time = Math.max(this.time, t);
    for (let i = this.pending.length - 1; i >= 0; i--) if (this.time - this.pending[i].at > ATTEMPT_WINDOW) this.fail(i);
  }

  /** ¿Hay un intento de esta pieza esperando? */
  isPending(piece: number): boolean {
    return this.pending.some((p) => p.piece === piece);
  }

  private fail(i: number): void {
    this.failed[this.pending[i].cat]++;
    this.pending.splice(i, 1);
  }

  summary(): CycleSummary {
    const byCat = {} as Record<CycleCat, CatStats>;
    for (const c of CYCLE_CATS) {
      const rs = this.records.filter((r) => r.cat === c);
      const scored = rs.length;
      const attempts = scored + this.failed[c];
      byCat[c] = { attempts, scored, accuracy: attempts ? scored / attempts : null, avg: avg(rs), best: best(rs), points: sum(rs) };
    }
    const attempts = CYCLE_CATS.reduce((a, c) => a + byCat[c].attempts, 0);
    const scored = this.records.length;
    const samples = this.records.filter((r) => r.cat !== 'critical').length;
    return {
      time: this.time,
      cycles: scored,
      attempts,
      scored,
      accuracy: attempts ? scored / attempts : null,
      avg: avg(this.records),
      best: best(this.records),
      last: this.records.length ? this.records[this.records.length - 1].time : null,
      points: sum(this.records),
      perMinute: this.time > 0 ? (samples * 60) / this.time : 0,
      byCat,
    };
  }
}

const avg = (rs: readonly CycleRecord[]): number | null => (rs.length ? rs.reduce((a, r) => a + r.time, 0) / rs.length : null);
const best = (rs: readonly CycleRecord[]): number | null => (rs.length ? Math.min(...rs.map((r) => r.time)) : null);
const sum = (rs: readonly CycleRecord[]): number => rs.reduce((a, r) => a + r.points, 0);

// ------------------------------------------------------------------ récords (mejor ciclo por robot)

/** Mejor ciclo de cada categoría por robot (`robotId` → categoría → segundos), guardado en el navegador. */
export interface CycleBests {
  v: 1;
  bests: Record<string, Partial<Record<CycleCat, number>>>;
}

export const emptyBests = (): CycleBests => ({ v: 1, bests: {} });

/** Guarda los mejores ciclos de una práctica; devuelve las categorías con récord nuevo. */
export function updateBests(b: CycleBests, robot: string, s: CycleSummary): CycleCat[] {
  const mine = (b.bests[robot] ??= {});
  const out: CycleCat[] = [];
  for (const c of CYCLE_CATS) {
    const v = s.byCat[c].best;
    if (v === null) continue;
    const prev = mine[c];
    if (prev === undefined || v < prev - 1e-9) {
      mine[c] = Math.round(v * 100) / 100;
      out.push(c);
    }
  }
  return out;
}

/** Lee los récords guardados (descarta lo que no tenga la forma esperada). */
export function parseBests(raw: string | null): CycleBests {
  if (!raw) return emptyBests();
  try {
    const o = JSON.parse(raw) as Partial<CycleBests>;
    if (o?.v !== 1 || !o.bests || typeof o.bests !== 'object') return emptyBests();
    const bests: CycleBests['bests'] = {};
    for (const [robot, r] of Object.entries(o.bests)) {
      if (!r || typeof r !== 'object') continue;
      const clean: Partial<Record<CycleCat, number>> = {};
      for (const c of CYCLE_CATS) {
        const v = (r as Record<string, unknown>)[c];
        if (typeof v === 'number' && Number.isFinite(v) && v >= 0) clean[c] = v;
      }
      bests[robot] = clean;
    }
    return { v: 1, bests };
  } catch {
    return emptyBests();
  }
}
