/**
 * Búfer circular de cuadros del Modo Director (puro: sin Three.js ni Rapier, se prueba en Vitest).
 *
 * Guarda a ~30 Hz las poses de los robots (con el estado visible de su mecanismo) y de las piezas de
 * los últimos segundos. Todo vive en UN Float32Array preasignado: grabar un cuadro no crea objetos,
 * así que no mete tirones al simular. Un `Clip` es la copia (una sola vez, al guardarlo) de un tramo.
 *
 * Cuadro = [tiempoDelMatch, ...robots × ROBOT_STRIDE, ...piezas × PIECE_STRIDE].
 */

export const RECORD_HZ = 30;
export const BUFFER_SECONDS = 15;

export const ROBOT_STRIDE = 12;
/** Offsets dentro de un robot. */
export const R = { x: 0, y: 1, z: 2, qx: 3, qy: 4, qz: 5, qw: 6, height: 7, angle: 8, flags: 9, stored: 10, speed: 11 } as const;
/** Bits de `flags`. */
export const FLAG_INTAKE = 1;
export const FLAG_CRITICAL = 2;

export const PIECE_STRIDE = 8;
/** Offsets dentro de una pieza (visible = 1 si está en la cancha). */
export const P = { vis: 0, x: 1, y: 2, z: 3, qx: 4, qy: 5, qz: 6, qw: 7 } as const;

export interface Layout {
  nRobots: number;
  nPieces: number;
  /** Floats por cuadro. */
  stride: number;
}

export const layout = (nRobots: number, nPieces: number): Layout => ({ nRobots, nPieces, stride: 1 + nRobots * ROBOT_STRIDE + nPieces * PIECE_STRIDE });
export const robotOffset = (_l: Layout, i: number): number => 1 + i * ROBOT_STRIDE;
export const pieceOffset = (l: Layout, i: number): number => 1 + l.nRobots * ROBOT_STRIDE + i * PIECE_STRIDE;

export type HighlightKind = 'rapid' | 'topLevel' | 'maneuver' | 'endgame' | 'platform' | 'critical' | 'clutch' | 'manual';

/** Un tramo guardado, listo para reproducir y editar. El tiempo del clip va de 0 a `duration`. */
export interface Clip {
  id: number;
  kind: HighlightKind;
  /** Otras razones que se juntaron en el mismo clip. */
  tags: HighlightKind[];
  /** Robot protagonista (para las cámaras). */
  focus: number;
  /** Segundo del clip en que ocurre el momento (anotación, impacto…). */
  trigger: number;
  duration: number;
  hz: number;
  layout: Layout;
  /** Tiempo del match (s) al inicio del clip; NaN en práctica. */
  matchStart: number;
  frames: number;
  data: Float32Array;
}

/** Ring de cuadros con tiempo de simulación (monótono; no avanza en pausa). */
export class FrameRing {
  readonly layout: Layout;
  readonly capacity: number;
  private data: Float32Array;
  private times: Float64Array;
  /** Siguiente casilla a escribir. */
  private head = 0;
  count = 0;

  constructor(nRobots: number, nPieces: number, seconds = BUFFER_SECONDS, readonly hz = RECORD_HZ) {
    this.layout = layout(nRobots, nPieces);
    this.capacity = Math.ceil(seconds * hz) + 2;
    this.data = new Float32Array(this.capacity * this.layout.stride);
    this.times = new Float64Array(this.capacity);
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }

  /** Casilla donde escribir el cuadro nuevo (no se asigna memoria); llamar a `commit` al terminar. */
  slot(): Float32Array {
    return this.data.subarray(this.head * this.layout.stride, (this.head + 1) * this.layout.stride);
  }

  commit(time: number): void {
    this.times[this.head] = time;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  /** Tiempo del cuadro más reciente (−∞ si está vacío). */
  get latest(): number {
    return this.count ? this.times[(this.head - 1 + this.capacity) % this.capacity] : -Infinity;
  }

  get oldest(): number {
    return this.count ? this.times[(this.head - this.count + this.capacity) % this.capacity] : Infinity;
  }

  /** Copia al clip los cuadros con tiempo en [t0, t1]. `null` si no hay ninguno. */
  extract(t0: number, t1: number, meta: Pick<Clip, 'id' | 'kind' | 'tags' | 'focus'> & { triggerTime: number }): Clip | null {
    const idx: number[] = [];
    for (let k = 0; k < this.count; k++) {
      const i = (this.head - this.count + k + this.capacity) % this.capacity;
      if (this.times[i] >= t0 - 1e-9 && this.times[i] <= t1 + 1e-9) idx.push(i);
    }
    if (idx.length < 2) return null;
    const s = this.layout.stride;
    const data = new Float32Array(idx.length * s);
    idx.forEach((i, k) => data.set(this.data.subarray(i * s, (i + 1) * s), k * s));
    const first = this.times[idx[0]];
    const last = this.times[idx[idx.length - 1]];
    return {
      id: meta.id,
      kind: meta.kind,
      tags: meta.tags,
      focus: meta.focus,
      trigger: Math.min(Math.max(meta.triggerTime - first, 0), last - first),
      duration: last - first,
      hz: this.hz,
      layout: this.layout,
      matchStart: data[0],
      frames: idx.length,
      data,
    };
  }
}

/**
 * Cuadro interpolado del clip en el tiempo `t` (s) → `out` (tamaño `stride`). Posiciones y
 * mecanismos por interpolación lineal, rotaciones con lerp normalizado; banderas y visibilidad del
 * cuadro más cercano.
 */
export function sampleClip(c: Clip, t: number, out: Float32Array): void {
  const s = c.layout.stride;
  const f = Math.min(Math.max(t * c.hz, 0), c.frames - 1);
  const i0 = Math.floor(f);
  const i1 = Math.min(i0 + 1, c.frames - 1);
  const a = f - i0;
  const A = c.data.subarray(i0 * s, (i0 + 1) * s);
  const B = c.data.subarray(i1 * s, (i1 + 1) * s);
  const near = a < 0.5 ? A : B;
  out[0] = A[0] + (B[0] - A[0]) * a;
  const lerpQ = (o: number) => {
    // Mismo hemisferio para no girar por el camino largo
    const dot = A[o] * B[o] + A[o + 1] * B[o + 1] + A[o + 2] * B[o + 2] + A[o + 3] * B[o + 3];
    const sg = dot < 0 ? -1 : 1;
    let n = 0;
    for (let k = 0; k < 4; k++) {
      out[o + k] = A[o + k] + (sg * B[o + k] - A[o + k]) * a;
      n += out[o + k] * out[o + k];
    }
    n = Math.sqrt(n) || 1;
    for (let k = 0; k < 4; k++) out[o + k] /= n;
  };
  for (let r = 0; r < c.layout.nRobots; r++) {
    const o = robotOffset(c.layout, r);
    for (const k of [R.x, R.y, R.z, R.height, R.angle, R.speed]) out[o + k] = A[o + k] + (B[o + k] - A[o + k]) * a;
    lerpQ(o + R.qx);
    out[o + R.flags] = near[o + R.flags];
    out[o + R.stored] = near[o + R.stored];
  }
  for (let p = 0; p < c.layout.nPieces; p++) {
    const o = pieceOffset(c.layout, p);
    out[o + P.vis] = near[o + P.vis];
    // Una pieza que aparece/desaparece no se desliza desde el parqueo
    const both = A[o + P.vis] > 0 && B[o + P.vis] > 0;
    const w = both ? a : a < 0.5 ? 0 : 1;
    for (const k of [P.x, P.y, P.z]) out[o + k] = A[o + k] + (B[o + k] - A[o + k]) * w;
    if (both) lerpQ(o + P.qx);
    else for (let k = 0; k < 4; k++) out[o + P.qx + k] = near[o + P.qx + k];
  }
}
