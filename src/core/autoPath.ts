/**
 * Rutinas de AUTO dibujadas (menú → Taller → "Rutinas de AUTO"): la trayectoria que sigue tu robot
 * en los 15 s del AUTO (§2, §4.2: "instrucciones preprogramadas") como una lista de puntos en la
 * cancha, cada uno con lo que hace el robot al salir hacia él y al llegar. Lógica pura (sin DOM,
 * Three.js ni Rapier); la sigue `auto/pathFollower.ts` en lazo cerrado (corrige con la pose real del
 * robot, a diferencia de las rutas grabadas de `auto/recorded.ts`, que repiten los controles).
 *
 * Coordenadas: metros en el marco de la alianza ROJA (la tuya siempre en +X, como `config/field` y
 * `core/plan.ts`); para azul se giran 180° al usarse (`F.forAlliance`). Rumbos en rad, mismo marco
 * (π = viendo hacia el centro desde la pared roja).
 *
 * Reglas que revisa el editor (`pathIssues`):
 * - §4.2: AUTO dura 15 s y no se cruza la línea central → los puntos se quedan de tu lado
 *   (`AUTO_MIN_X`, igual que las estrategias) y avisa si la estimación pasa de 15 s.
 * - §4.4 / D1: Línea de Autónomo = salir por completo de la Zona de Inicio → avisa si ningún punto sale.
 * - §4.6: subir a la Plataforma antes del ENDGAME es Tech Foul → avisa si la ruta la pisa.
 * - SUPUESTO (D46): la ruta no debe atravesar la Cámara ni la Campana (son paredes); solo se avisa.
 */
import * as F from '../config/field';
import { GAME } from '../config/game';
import type { ElevatorPos } from '../config/robot';
import { CENTER_SPOT, sanitizeSpot, spotPose, type StartSpot } from '../config/startSpot';
import { AUTO_MIN_X } from './plan';

export interface PathPoint {
  x: number;
  z: number;
  /** Llega de reversa (el Pivote 180° recoge atrás). */
  reverse: boolean;
  /** Velocidad hacia este punto, fracción de la máxima del robot (0.2–1). */
  speed: number;
  /** Al llegar, girar en su lugar hasta este rumbo (rad, marco rojo); null = no girar. */
  face: number | null;
  /** Posición del brazo (0 piso, 1–3 niveles, 4 Repisa); null = no cambia. */
  arm: ElevatorPos | null;
  /** El brazo se mueve al salir hacia el punto (en camino) en vez de al llegar. */
  armEarly: boolean;
  /** Garra al salir hacia el punto: true la prende (recoger en el camino), false la apaga; null = igual. */
  intake: boolean | null;
  /** Al llegar (y con el brazo en su lugar), soltar la pieza. */
  release: boolean;
  /** Segundos que se queda al final (0–5). */
  wait: number;
}

export interface AutoPath {
  id: string;
  name: string;
  /** Última edición (ms). */
  updated: number;
  /** Zona de Inicio para la que se dibujó (0 = A, 1 = B) y lugar del robot dentro de ella (§4.1). */
  station: 0 | 1;
  start: StartSpot;
  points: PathPoint[];
}

export const MAX_PATH_POINTS = 16;
export const MAX_PATH_NAME = 40;
export const MAX_WAIT = 5;
export const PATH_PREFIX = 'path:';
/** Margen de los puntos a la pared perimetral (m): el centro del robot no puede pegarse a la orilla. */
export const WALL_MARGIN = 0.3;
/** Duración del AUTO (§2, §4.2). */
export const AUTO_SECONDS = GAME.times.auto;

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round = (v: number, k = 100) => Math.round(v * k) / k;

export const newPathId = (): string => `a${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

export function newPath(name: string, station: 0 | 1 = 0, id = newPathId()): AutoPath {
  return { id, name, updated: Date.now(), station, start: { ...CENTER_SPOT }, points: [] };
}

export function newPoint(x: number, z: number): PathPoint {
  return { ...cleanXZ(x, z), reverse: false, speed: 0.7, face: null, arm: null, armEarly: true, intake: null, release: false, wait: 0 };
}

/** Punto dentro de la cancha y de tu lado de la línea central (§4.2). */
export function cleanXZ(x: number, z: number): { x: number; z: number } {
  return {
    x: round(Math.max(AUTO_MIN_X, Math.min(F.HALF_L - WALL_MARGIN, x))),
    z: round(Math.max(-F.HALF_W + WALL_MARGIN, Math.min(F.HALF_W - WALL_MARGIN, z))),
  };
}

function point(v: unknown): PathPoint | null {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const x = num(o.x);
  const z = num(o.z);
  if (x === null || z === null) return null;
  const p = newPoint(x, z);
  p.reverse = o.reverse === true;
  p.speed = round(Math.max(0.2, Math.min(1, num(o.speed) ?? 0.7)));
  const face = num(o.face);
  p.face = face === null ? null : round(wrap(face), 1000);
  const arm = num(o.arm);
  p.arm = arm !== null && Number.isInteger(arm) && arm >= 0 && arm <= 4 ? (arm as ElevatorPos) : null;
  p.armEarly = o.armEarly !== false;
  p.intake = typeof o.intake === 'boolean' ? o.intake : null;
  p.release = o.release === true;
  p.wait = round(Math.max(0, Math.min(MAX_WAIT, num(o.wait) ?? 0)), 10);
  return p;
}

/** Rutina válida a partir de cualquier valor guardado (null si no se puede rescatar). */
export function sanitizePath(raw: unknown): AutoPath | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || !/^[\w-]{1,40}$/.test(o.id)) return null;
  const pts = Array.isArray(o.points) ? o.points.slice(0, MAX_PATH_POINTS).map(point).filter((p): p is PathPoint => !!p) : [];
  return {
    id: o.id,
    name: (typeof o.name === 'string' && o.name.trim() ? o.name.trim() : 'Rutina').slice(0, MAX_PATH_NAME),
    updated: num(o.updated) ?? 0,
    station: o.station === 1 ? 1 : 0,
    start: sanitizeSpot(o.start),
    points: pts,
  };
}

export function sanitizePaths(raw: unknown): AutoPath[] {
  if (!Array.isArray(raw)) return [];
  const out: AutoPath[] = [];
  for (const r of raw) {
    const p = sanitizePath(r);
    if (p && !out.some((x) => x.id === p.id)) out.push(p);
  }
  return out;
}

/** Pose inicial (marco rojo) de la rutina: su Zona de Inicio y su lugar dentro (§4.1). */
export const pathStart = (p: AutoPath): { x: number; z: number; heading: number } => spotPose('red', p.station, p.start);

/** ¿Tiene alguna acción al llegar? (si no, el robot pasa por el punto sin frenar). */
export const hasArrivalAction = (p: PathPoint): boolean => p.face !== null || (p.arm !== null && !p.armEarly) || p.release || p.wait > 0;

// ------------------------------------------------------------------ estimación de tiempo

/** Lo que la estimación necesita del robot (`RobotSpec`). */
export interface PathRobotSpec {
  maxSpeed: number;
  maxAccel: number;
  maxOmega: number;
}

/** SUPUESTOS de la estimación (no del manual): lo que tarda el brazo en cambiar de posición y soltar. */
export const ARM_MOVE_S = 0.8;
export const RELEASE_S = 0.35;

export interface PathEstimate {
  /** Segundos desde el inicio del AUTO en que termina cada punto (con sus acciones). */
  at: number[];
  total: number;
}

/**
 * Tiempo aproximado de la rutina: tramos rectos con aceleración (perfil trapezoidal), giros en su
 * lugar al ~60 % de la velocidad de giro (un tanque derrapa) y las acciones. Es una guía para el
 * editor; la prueba de verdad es simularla (`auto/pathTest.ts`).
 */
export function estimatePath(p: AutoPath, spec: PathRobotSpec): PathEstimate {
  const start = pathStart(p);
  let x = start.x;
  let z = start.z;
  let h = start.heading;
  let t = 0;
  const at: number[] = [];
  const omega = spec.maxOmega * 0.8 * 0.6;
  for (const q of p.points) {
    const dx = q.x - x;
    const dz = q.z - z;
    const d = Math.hypot(dx, dz);
    if (d > 0.05) {
      const want = wrap(Math.atan2(-dz, dx) + (q.reverse ? Math.PI : 0));
      const turn = Math.abs(wrap(want - h));
      // Gira en su lugar si el ángulo es grande; si no, corrige en el camino
      if (turn > 0.6) t += turn / omega;
      h = want;
      const v = spec.maxSpeed * q.speed;
      const a = Math.max(0.5, spec.maxAccel);
      const dAcc = (v * v) / a; // acelerar y frenar
      t += d >= dAcc ? d / v + v / a : 2 * Math.sqrt(d / a);
    }
    x = q.x;
    z = q.z;
    if (q.face !== null) {
      t += Math.abs(wrap(q.face - h)) / omega;
      h = q.face;
    }
    if (q.arm !== null && !q.armEarly) t += ARM_MOVE_S;
    if (q.release) t += RELEASE_S;
    t += q.wait;
    at.push(t);
  }
  return { at, total: t };
}

// ------------------------------------------------------------------ revisión contra el manual

export type PathIssueCode = 'tooLong' | 'noLeave' | 'platform' | 'wall' | 'noPoints';

export interface PathIssue {
  code: PathIssueCode;
  section: string;
  /** Punto (índice) donde pasa, si aplica. */
  point?: number;
}

const PLATFORM: F.Rect = { x0: -F.PLATFORM_LENGTH / 2, x1: F.PLATFORM_LENGTH / 2, z0: -F.PLATFORM_WIDTH / 2, z1: F.PLATFORM_WIDTH / 2 };
const CAMARA: F.Rect = { x0: F.CAMARA_X_END_RED - F.CAMARA_LENGTH, x1: F.CAMARA_X_END_RED, z0: F.CAMARA_Z_RED[0], z1: F.CAMARA_Z_RED[1] };
const CAMPANA: F.Rect = { x0: F.CAMPANA_X_RED[0], x1: F.CAMPANA_X_RED[1], z0: -F.HALF_W, z1: -F.HALF_W + F.CAMPANA_DEPTH };

/** ¿El tramo a→b (centro del robot, con un margen `m`) pasa por el rectángulo? Muestreo cada 5 cm. */
function segmentHits(a: { x: number; z: number }, b: { x: number; z: number }, r: F.Rect, m: number): boolean {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.05));
  const g: F.Rect = { x0: r.x0 - m, x1: r.x1 + m, z0: r.z0 - m, z1: r.z1 + m };
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    if (F.inRect(g, a.x + (b.x - a.x) * k, a.z + (b.z - a.z) * k)) return true;
  }
  return false;
}

/**
 * Avisos de la rutina contra el manual. `halfLength` = media longitud del chasis (para saber cuándo
 * salió por completo de la Zona de Inicio, D1); `spec` para la estimación de tiempo.
 */
export function pathIssues(p: AutoPath, spec: PathRobotSpec, halfLength = 0.3): PathIssue[] {
  const out: PathIssue[] = [];
  if (!p.points.length) return [{ code: 'noPoints', section: '§4.2' }];
  if (estimatePath(p, spec).total > AUTO_SECONDS) out.push({ code: 'tooLong', section: '§4.2' });
  const zone = F.START_ZONES_RED[p.station];
  // Fuera por completo: el centro a más de media longitud del borde de la zona (hacia el centro o a los lados)
  const out1 = (q: { x: number; z: number }) => q.x < zone.x0 - halfLength || q.z < zone.z0 - halfLength || q.z > zone.z1 + halfLength;
  if (!p.points.some(out1)) out.push({ code: 'noLeave', section: '§4.4' });
  let prev: { x: number; z: number } = pathStart(p);
  p.points.forEach((q, i) => {
    if (segmentHits(prev, q, PLATFORM, 0.1)) out.push({ code: 'platform', section: '§4.6', point: i });
    if (segmentHits(prev, q, CAMARA, 0.05) || segmentHits(prev, q, CAMPANA, 0.05)) out.push({ code: 'wall', section: 'D46', point: i });
    prev = q;
  });
  return out;
}

// ------------------------------------------------------------------ ayudas del editor

/** Rumbo (marco rojo) para ver de frente la pared de la Cámara propia (+Z); de reversa si anota atrás. */
export const FACE_CAMARA = -Math.PI / 2;

/**
 * Punto de anotación en el nivel `level` (como la IA, `Bot.scoringPose`): frente a la pared de la
 * Cámara, al centro del pozo, a la distancia de la punta del brazo `tip` (m del centro del robot).
 */
export function scoringPoint(level: 1 | 2 | 3, tip: number, halfLength: number, scoreBack = false): PathPoint {
  const w = F.camaraWells()[level];
  const z = Math.min((w.z0 + w.z1) / 2 - tip, F.CAMARA_Z_RED[0] - halfLength - 0.03);
  const p = newPoint((w.x0 + w.x1) / 2, z);
  p.reverse = scoreBack;
  p.speed = 0.6;
  p.face = wrap(FACE_CAMARA + (scoreBack ? Math.PI : 0));
  p.arm = level;
  p.armEarly = true;
  p.release = true;
  p.wait = 0.3;
  return p;
}

/**
 * Después de anotar: alejarse `dist` m de la pared de la Cámara (de reversa si anotó al frente) para
 * poder girar y bajar el brazo sin que la garra tope con la madera.
 */
export function backOffPoint(from: PathPoint, dist = 0.45): PathPoint {
  const back = from.face !== null && Math.abs(wrap(from.face - FACE_CAMARA)) > Math.PI / 2;
  const p = newPoint(from.x, from.z - dist);
  p.reverse = !back;
  p.speed = 0.5;
  return p;
}

/**
 * Recoger una Muestra del piso en (sx, sz) llegando desde `from`: un punto de espera detrás de ella
 * (garra prendida en camino; ahí gira hacia ella y baja el brazo) y la entrada despacio hasta que la garra la alcanza,
 * como lo hace la IA (`Bot.driveToPiece`). `grab` = distancia del centro del robot a la punta de la
 * garra en el piso; `back` = recoge atrás (Pivote 180°, entra de reversa).
 */
export function pickupPoints(sx: number, sz: number, from: { x: number; z: number }, grab: number, back = false): PathPoint[] {
  const d = Math.hypot(sx - from.x, sz - from.z) || 1;
  const ux = (sx - from.x) / d;
  const uz = (sz - from.z) / d;
  const stage = newPoint(sx - ux * (grab + 0.45), sz - uz * (grab + 0.45));
  stage.reverse = back;
  stage.speed = 0.7;
  // El brazo baja ya parado y viendo a la Muestra: bajarlo mientras gira la barre con la garra
  stage.arm = 0;
  stage.armEarly = false;
  stage.intake = true;
  stage.face = wrap(Math.atan2(-uz, ux) + (back ? Math.PI : 0));
  const grabAt = newPoint(sx - ux * Math.max(0, grab - 0.04), sz - uz * Math.max(0, grab - 0.04));
  grabAt.reverse = back;
  grabAt.speed = 0.3;
  grabAt.wait = 0.4;
  return [stage, grabAt];
}
