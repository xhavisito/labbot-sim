/**
 * Repetición de un match (lógica pura, sin DOM ni Three.js): poses de los robots y de las piezas a
 * paso fijo, marcador y eventos con su robot (para las estadísticas). Formato binario compacto:
 * enteros de 16 bits (posiciones en mm, cuaterniones × 32767), así un match de 150 s pesa ≈ 1.7 MB
 * sin comprimir y unos cientos de KB en gzip (`store.ts`).
 */
import type { RobotSpec } from '../config/robot';
import type { TimedEvent } from '../core/matchLog';
import type { Alliance, Level } from '../core/types';

/** Cuadros por segundo de la grabación (la reproducción interpola entre cuadros). */
export const REPLAY_HZ = 15;

/** Valores por cuadro: tiempo (cs), marcador rojo y azul, y la fase (índice de `PHASES`). */
export const FRAME_HEAD = 4;
/** Por robot: x, y, z (mm), cuaternión (×32767), altura del mecanismo (mm), ángulo del brazo (×10⁴ rad), banderas. */
export const ROBOT_VALUES = 10;
/** Por pieza: x, y, z (mm), cuaternión (×32767), 1 si está en la cancha. */
export const PIECE_VALUES = 8;
export const PHASES = ['PRE', 'AUTO', 'PAUSE', 'TELEOP', 'ENDGAME', 'DONE'] as const;

/** Banderas del robot: intake desplegada, Muestra Crítica en el robot, Muestras guardadas (bits 2–11) y Muestra en la garra del pivote (bit 12). */
export const FLAG_INTAKE = 1;
export const FLAG_CRITICAL = 2;
export const FLAG_CLAW = 1 << 12;

/** Lo que pasó en el match, con el robot que lo hizo (las Muestras se atribuyen a quien las soltó). */
export type ReplayEvent =
  | { t: number; type: 'intake'; robot: number }
  | { t: number; type: 'release'; robot: number; kind: 'sample' | 'critical' }
  | { t: number; type: 'grabCritical'; robot: number }
  | { t: number; type: 'score'; robot: number | null; alliance: Alliance; level: Level; points: number; period: 'AUTO' | 'TELEOP' };

export interface ReplayRobot {
  index: number;
  alliance: Alliance;
  station: 0 | 1;
  spec: RobotSpec;
  /** Nombre que se muestra (tipo o robot propio). */
  label: string;
}

export interface ReplayHeader {
  format: 'labbot-rescue-replay';
  version: 1;
  createdAt: string;
  /** Robot del jugador (−1 = solo IA). */
  player: number;
  robots: ReplayRobot[];
  /** Tipo de cada pieza del pool (mismo orden que `Pieces.list`). */
  pieces: Array<{ kind: 'sample' | 'critical'; owner?: Alliance }>;
  frames: number;
  final: Record<Alliance, number>;
  /** Robots en la Plataforma y Muestra Crítica al final (§4.3.1), y robots que cruzaron la línea (§4.4). */
  endgame: { platform: number[]; critical: Record<Alliance, boolean>; autoLine: number[] };
  meta: Record<string, unknown>;
}

export interface Replay {
  header: ReplayHeader;
  events: ReplayEvent[];
  /** Eventos del match (fase, faltas, tarjetas) con su tiempo, como el registro exportable. */
  matchEvents: TimedEvent[];
  /** Cuadros seguidos, cada uno de `frameSize(header)` valores. */
  data: Int16Array;
}

export const frameSize = (h: Pick<ReplayHeader, 'robots' | 'pieces'>): number => FRAME_HEAD + h.robots.length * ROBOT_VALUES + h.pieces.length * PIECE_VALUES;

const clamp16 = (v: number): number => Math.max(-32768, Math.min(32767, Math.round(v)));
export const toMm = (m: number): number => clamp16(m * 1000);
export const toQ = (q: number): number => clamp16(q * 32767);
export const toAngle = (a: number): number => clamp16(a * 1e4);

/** Pose de un robot en el cuadro `f`. */
export interface RobotFrame {
  x: number;
  y: number;
  z: number;
  q: [number, number, number, number];
  height: number;
  angle: number;
  intake: boolean;
  critical: boolean;
  stored: number;
  /** Muestra en la garra (repeticiones viejas: no se grababa). */
  claw: boolean;
}

export function frameTime(r: Replay, f: number): number {
  return r.data[f * frameSize(r.header)] / 100;
}

export function frameScore(r: Replay, f: number): { red: number; blue: number; phase: (typeof PHASES)[number] } {
  const o = f * frameSize(r.header);
  return { red: r.data[o + 1], blue: r.data[o + 2], phase: PHASES[r.data[o + 3]] ?? 'DONE' };
}

export function robotFrame(r: Replay, f: number, i: number): RobotFrame {
  const o = f * frameSize(r.header) + FRAME_HEAD + i * ROBOT_VALUES;
  const d = r.data;
  const flags = d[o + 9];
  return {
    x: d[o] / 1000,
    y: d[o + 1] / 1000,
    z: d[o + 2] / 1000,
    q: [d[o + 3] / 32767, d[o + 4] / 32767, d[o + 5] / 32767, d[o + 6] / 32767],
    height: d[o + 7] / 1000,
    angle: d[o + 8] / 1e4,
    intake: (flags & FLAG_INTAKE) !== 0,
    critical: (flags & FLAG_CRITICAL) !== 0,
    stored: (flags >> 2) & 0x3ff,
    claw: (flags & FLAG_CLAW) !== 0,
  };
}

/** Pieza `i` en el cuadro `f`: posición, cuaternión y si está en la cancha. */
export function pieceFrame(r: Replay, f: number, i: number): { x: number; y: number; z: number; q: [number, number, number, number]; onField: boolean } {
  const h = r.header;
  const o = f * frameSize(h) + FRAME_HEAD + h.robots.length * ROBOT_VALUES + i * PIECE_VALUES;
  const d = r.data;
  return { x: d[o] / 1000, y: d[o + 1] / 1000, z: d[o + 2] / 1000, q: [d[o + 3] / 32767, d[o + 4] / 32767, d[o + 5] / 32767, d[o + 6] / 32767], onField: d[o + 7] === 1 };
}

/** Duración (s) de la repetición. */
export const replayDuration = (r: Replay): number => (r.header.frames > 0 ? frameTime(r, r.header.frames - 1) : 0);

// ------------------------------------------------------------------ archivo
const MAGIC = 0x4c425231; // "LBR1"

/** Empaqueta la repetición: MAGIC, largo + JSON (encabezado y eventos) y los cuadros (little endian). */
export function encodeReplay(r: Replay): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify({ header: r.header, events: r.events, matchEvents: r.matchEvents }));
  const out = new Uint8Array(8 + json.length + r.data.length * 2);
  const v = new DataView(out.buffer);
  v.setUint32(0, MAGIC, true);
  v.setUint32(4, json.length, true);
  out.set(json, 8);
  const o = 8 + json.length;
  for (let i = 0; i < r.data.length; i++) v.setInt16(o + i * 2, r.data[i], true);
  return out;
}

export function decodeReplay(bytes: Uint8Array): Replay {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 8 || v.getUint32(0, true) !== MAGIC) throw new Error('no es una repetición de LabBot');
  const n = v.getUint32(4, true);
  const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + n))) as Pick<Replay, 'header' | 'events' | 'matchEvents'>;
  if (meta.header?.format !== 'labbot-rescue-replay') throw new Error('formato desconocido');
  const o = 8 + n;
  const count = (bytes.length - o) >> 1;
  const data = new Int16Array(count);
  for (let i = 0; i < count; i++) data[i] = v.getInt16(o + i * 2, true);
  if (count !== meta.header.frames * frameSize(meta.header)) throw new Error('repetición incompleta');
  return { header: meta.header, events: meta.events ?? [], matchEvents: meta.matchEvents ?? [], data };
}
