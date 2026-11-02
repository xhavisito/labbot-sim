/**
 * Pizarra táctica del match: trazos libres dibujados sobre la cancha con el match en pausa, para
 * explicar jugadas. Lógica pura (sin DOM ni Three.js). Es una ayuda de la app: el manual no habla de
 * ella (SUPUESTO) y no cambia ninguna regla ni el estado del juego.
 *
 * Coordenadas: metros, en el marco del mundo (origen en el centro, rojo en +X), dentro de la cancha.
 */
import * as F from '../config/field';

export type BoardColor = 'white' | 'yellow' | 'cyan' | 'magenta' | 'green';
export const BOARD_COLORS: readonly BoardColor[] = ['white', 'yellow', 'cyan', 'magenta', 'green'];
/** Color de cada trazo en pantalla (hex de Three.js / CSS). */
export const BOARD_HEX: Record<BoardColor, number> = { white: 0xffffff, yellow: 0xffd23f, cyan: 0x3fd8ff, magenta: 0xe9239d, green: 0x4be37a };

export interface BoardPoint {
  x: number;
  z: number;
}
export interface Stroke {
  color: BoardColor;
  pts: BoardPoint[];
}

export const MAX_STROKES = 40;
export const MAX_POINTS = 240;
/** Distancia mínima (m) entre dos puntos de un trazo: filtra el temblor del mouse. */
export const MIN_STEP = 0.06;

const clampX = (x: number) => Math.max(-F.HALF_L, Math.min(F.HALF_L, x));
const clampZ = (z: number) => Math.max(-F.HALF_W, Math.min(F.HALF_W, z));
const clean = (p: BoardPoint): BoardPoint => ({ x: Math.round(clampX(p.x) * 100) / 100, z: Math.round(clampZ(p.z) * 100) / 100 });

export class Board {
  strokes: Stroke[] = [];

  /** Empieza un trazo; si ya hay `MAX_STROKES`, se borra el más viejo. */
  begin(color: BoardColor, p: BoardPoint): void {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return;
    if (this.strokes.length >= MAX_STROKES) this.strokes.shift();
    this.strokes.push({ color, pts: [clean(p)] });
  }

  /** Agrega un punto al trazo en curso (ignora los muy cercanos y pasa de `MAX_POINTS`). */
  extend(p: BoardPoint): void {
    const s = this.strokes[this.strokes.length - 1];
    if (!s || !Number.isFinite(p.x) || !Number.isFinite(p.z) || s.pts.length >= MAX_POINTS) return;
    const q = clean(p);
    const last = s.pts[s.pts.length - 1];
    if (Math.hypot(q.x - last.x, q.z - last.z) < MIN_STEP) return;
    s.pts.push(q);
  }

  /** Quita el último trazo. */
  undo(): void {
    this.strokes.pop();
  }

  clear(): void {
    this.strokes = [];
  }

  get empty(): boolean {
    return this.strokes.length === 0;
  }
}

/** Longitud (m) de un trazo. */
export function strokeLength(s: Stroke): number {
  let d = 0;
  for (let i = 1; i < s.pts.length; i++) d += Math.hypot(s.pts[i].x - s.pts[i - 1].x, s.pts[i].z - s.pts[i - 1].z);
  return d;
}
