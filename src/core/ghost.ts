/**
 * Ghost del mejor ciclo (lógica pura): la trayectoria del ciclo completo más rápido (buscar + llevar,
 * ver `core/cycles.ts`) de cada robot, para dibujarla semitransparente en la práctica 1 contra 1 y
 * compararla con el ciclo actual. SUPUESTOS de diseño del simulador (el manual no tiene práctica ni
 * ciclos): "mejor" = menor tiempo de ciclo completo, uno por robot; se guarda en el lado rojo (el
 * layout es simétrico por rotación de 180°, igual que el mapa de tiro) y se rota si juegas con azul.
 */
import type { Alliance } from './types';

/** Muestras por segundo de la trayectoria. */
export const GHOST_HZ = 15;
/** Ciclos más largos que esto no se guardan (s). */
export const GHOST_MAX = 60;

export interface GhostTrace {
  /** Segundos del ciclo completo. */
  dur: number;
  /** Puntos aplanados [x, z, rumbo] cada 1/GHOST_HZ s, en el lado rojo. */
  pts: number[];
}

export interface GhostPose {
  x: number;
  z: number;
  heading: number;
}

/** Trayectorias guardadas por robot (`robotId`). */
export interface GhostStore {
  v: 1;
  robots: Record<string, GhostTrace>;
}

export const emptyGhosts = (): GhostStore => ({ v: 1, robots: {} });

/** Lleva una pose de la alianza dada al lado rojo (o de vuelta: la rotación de 180° es su propia inversa). */
export function mirrorPose(p: GhostPose, a: Alliance): GhostPose {
  return a === 'red' ? p : { x: -p.x, z: -p.z, heading: p.heading + Math.PI };
}

/** Pose del ghost a los `t` segundos de su ciclo (interpola; después del final se queda en la meta). */
export function ghostAt(g: GhostTrace, t: number): GhostPose {
  const n = Math.floor(g.pts.length / 3);
  const f = Math.max(0, t) * GHOST_HZ;
  const i = Math.min(n - 1, Math.floor(f));
  const j = Math.min(n - 1, i + 1);
  const k = Math.min(1, f - i);
  const at = (q: number) => ({ x: g.pts[q * 3], z: g.pts[q * 3 + 1], h: g.pts[q * 3 + 2] });
  const a = at(i);
  const b = at(j);
  let dh = b.h - a.h;
  dh -= Math.round(dh / (2 * Math.PI)) * 2 * Math.PI; // camino corto entre rumbos
  return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, heading: a.h + dh * k };
}

/**
 * Graba la pose del robot en una ventana corrediza y, cuando cuenta una pieza, corta la trayectoria
 * del ciclo (de que contó la anterior a que contó esta). Se queda con la más rápida de la práctica.
 */
export class GhostRecorder {
  /** Más rápida de esta práctica (null si no hubo ciclos). */
  best: GhostTrace | null = null;
  private buf: number[] = [];
  private segStart = 0;
  private nextT = 0;

  constructor(private readonly alliance: Alliance) {}

  /** Una pose cada paso; se guarda a GHOST_HZ. `t` = segundos de práctica. */
  sample(t: number, p: GhostPose): void {
    if (t + 1e-9 < this.nextT) return;
    this.nextT = t + 1 / GHOST_HZ;
    const m = mirrorPose(p, this.alliance);
    this.buf.push(t, round(m.x), round(m.z), round(m.heading));
    // Lo anterior al inicio del ciclo abierto ya no sirve
    let drop = 0;
    while (drop * 4 < this.buf.length && this.buf[drop * 4] < this.segStart - 0.5) drop++;
    if (drop > 0) this.buf.splice(0, drop * 4);
  }

  /** Contó una pieza en `end`: cierra el ciclo que empezó en el inicio de la ventana. */
  cycleDone(end: number): void {
    const start = this.segStart;
    this.segStart = end;
    const dur = end - start;
    if (dur <= 0 || dur > GHOST_MAX) return;
    if (this.best && this.best.dur <= dur) return;
    const pts: number[] = [];
    for (let i = 0; i < this.buf.length; i += 4) {
      const t = this.buf[i];
      if (t >= start - 1e-9 && t <= end + 1 / GHOST_HZ) pts.push(this.buf[i + 1], this.buf[i + 2], this.buf[i + 3]);
    }
    if (pts.length >= 6) this.best = { dur: round(dur), pts };
  }
}

const round = (v: number): number => Math.round(v * 100) / 100;

/** Guarda la trayectoria si es más rápida que la del robot; true si la reemplazó. */
export function updateGhost(s: GhostStore, robot: string, g: GhostTrace | null): boolean {
  if (!g) return false;
  const prev = s.robots[robot];
  if (prev && prev.dur <= g.dur + 1e-9) return false;
  s.robots[robot] = g;
  return true;
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Lee lo guardado (descarta lo que no tenga la forma esperada). */
export function parseGhosts(raw: string | null): GhostStore {
  if (!raw) return emptyGhosts();
  try {
    const o = JSON.parse(raw) as Partial<GhostStore>;
    if (o?.v !== 1 || !o.robots || typeof o.robots !== 'object') return emptyGhosts();
    const robots: GhostStore['robots'] = {};
    for (const [id, g] of Object.entries(o.robots)) {
      const t = g as Partial<GhostTrace> | null;
      if (!t || !num(t.dur) || t.dur <= 0 || t.dur > GHOST_MAX || !Array.isArray(t.pts)) continue;
      if (t.pts.length < 6 || t.pts.length % 3 !== 0 || !t.pts.every(num)) continue;
      robots[id] = { dur: t.dur, pts: t.pts };
    }
    return { v: 1, robots };
  } catch {
    return emptyGhosts();
  }
}
