/**
 * Rutinas del Auto Designer (portado de rebuilt-sim, `auto/AutoRoutine.ts`): una rutina es una lista
 * de waypoints con rumbo y acciones, guardada en el marco de la alianza AZUL (pared propia a la
 * izquierda, −X, la Zona de Inicio mirando a +X) y rotada 180° para la roja. La cancha es simétrica
 * por esa rotación, así que el marco azul ES el mundo: la Cámara en la que anota el azul está en +X/+Z
 * (D52) y el robot azul sale de −X.
 *
 * Acciones por waypoint (cambian por el reto): INTAKE, brazo a una posición, **anotar en un nivel de
 * la Cámara** (reemplaza disparar y trepar de rebuilt), esperar y detenerse.
 */
import * as F from '../config/field';
import { posTip, ROBOT_PRESETS, type ElevatorPos } from '../config/robot';
import type { Alliance, Level } from '../core/types';
import type { AutoRoutine } from './AutoRoutine';

export interface AutoWaypoint {
  /** Posición en el marco azul (m). */
  x: number;
  z: number;
  /** Rumbo deseado al llegar (rad, marco azul) o null = mirar hacia donde avanza. */
  heading: number | null;
  /** Garra: prende o apaga al pasar por el punto (sin esto, no cambia). */
  intake?: boolean;
  /** Brazo a esta posición (0 piso, 1–3 niveles, 4 Repisa) al pasar por el punto. */
  arm?: ElevatorPos;
  /**
   * Anotar: al llegar (detenido) se alinea frente a la pared de la Cámara, sube el brazo a este nivel y
   * suelta lo que lleva (SUPUESTO: reemplaza "disparar" de rebuilt-sim).
   */
  score?: Level;
  wait?: number;
  /** Rutas suaves: detenerse aquí aunque no haya acción (si no, pasa sin frenar). */
  stop?: boolean;
  /** Rutas suaves: manijas de la curva Bézier (offset en m desde el punto); sin ellas, automáticas. */
  hin?: { x: number; z: number };
  hout?: { x: number; z: number };
}

export interface DesignedAuto {
  id: string;
  name: string;
  builtin?: boolean;
  /**
   * Rutina "de cualquier lado": si el robot sale de la Zona de Inicio contraria a la de su primer
   * waypoint (en z), se refleja en z para no cruzar por enfrente de su compañero.
   */
  mirrorToStart?: boolean;
  /** Ruta suave tipo PathPlanner (curvas Bézier + perfil de velocidad); si no, punto a punto. */
  spline?: boolean;
  /** Rutas suaves: fracción de la velocidad máxima del robot (0.2–1; por defecto 0.85). */
  speed?: number;
  waypoints: AutoWaypoint[];
}

/** Prefijo del id de rutina (`design:<id>`) en las listas de AUTO. */
export const DESIGN_PREFIX = 'design:';

/** Rutina de AUTO (`AutoRoutine`) que corre esta del diseñador (`auto/AutoExecutor.ts`). */
export const designRoutine = (d: DesignedAuto): AutoRoutine => ({ id: DESIGN_PREFIX + d.id, name: d.name, steps: [], design: d });

/**
 * Punto de anotación en el marco azul (como la IA, `Bot.scoringPose`): frente a la pared de la Cámara en
 * la que anota el azul (+X, +Z), al centro del pozo, a la distancia de la punta del brazo `tip` del centro.
 */
export function scorePoint(level: Level, tip: number, halfL: number): { x: number; z: number; heading: number } {
  const w = F.camaraWells()[level];
  const z = Math.min((w.z0 + w.z1) / 2 - tip, F.CAMARA_Z_RED[0] - halfL - 0.03);
  return { x: (w.x0 + w.x1) / 2, z, heading: F.camaraHeading('blue') };
}

/** Rutinas incluidas con las medidas del robot base (Pivote). */
const base = ROBOT_PRESETS.pivot;
const sp3 = scorePoint(3, Math.abs(posTip(base, 3).x), base.length / 2);
const startZ = 0.495;

/**
 * Rutas suaves de ejemplo (y plantillas de las nuevas). Salen en línea recta de la Zona de Inicio de
 * `z0` (salida 1 = z > 0, salida 2 = z < 0: así los dos robots de la alianza no se estorban), cruzan
 * el pasillo entre las dos filas del Laboratorio, rodean la Plataforma (solo se pisa en el ENDGAME,
 * §4.6) y terminan frente a su Cámara. Como la Cámara está fija en +Z hay una versión por salida.
 */
const pathScore = (n: 1 | 2): DesignedAuto => ({
  id: `score-${n}`,
  name: `Ruta suave · Anotar Nivel 3 (salida ${n})`,
  builtin: true,
  spline: true,
  speed: 0.85,
  waypoints: [
    { x: -2.65, z: n === 1 ? startZ : -startZ, heading: null },
    { x: -2.9, z: 1.3, heading: null },
    { x: sp3.x - 1.1, z: 1.95, heading: null },
    { x: sp3.x, z: 1.95, heading: null },
    { x: sp3.x, z: sp3.z, heading: sp3.heading, score: 3 },
  ],
});

export const BUILTIN_DESIGNS: DesignedAuto[] = [pathScore(1), pathScore(2)];

const KEY = 'labbot.autoDesigns.v1';

function loadJSON<T>(key: string, def: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : def;
  } catch {
    return def;
  }
}

/** Incluidas + las guardadas en este navegador. */
export function loadDesigns(): DesignedAuto[] {
  const custom = loadJSON<unknown[]>(KEY, []);
  const out: DesignedAuto[] = [];
  for (const c of Array.isArray(custom) ? custom : []) {
    const r = sanitizeDesign(c, (c as { id?: string } | null)?.id);
    if (r) out.push(r);
  }
  return [...BUILTIN_DESIGNS, ...out];
}

export function saveCustomDesigns(list: DesignedAuto[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.filter((r) => !r.builtin)));
  } catch {
    /* sin almacenamiento (modo privado) */
  }
}

/** Las guardadas (sin las incluidas), para las listas de AUTO. */
export const customDesigns = (): DesignedAuto[] => loadDesigns().filter((d) => !d.builtin);

const num = (v: unknown, lo: number, hi: number): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : undefined);
const vec = (v: unknown): { x: number; z: number } | undefined => {
  const o = v as { x?: unknown; z?: unknown } | null;
  const x = num(o?.x, -6, 6);
  const z = num(o?.z, -6, 6);
  return o && x !== undefined && z !== undefined ? { x, z } : undefined;
};

/**
 * Valida una rutina importada (JSON de otra persona): solo los campos conocidos, con números
 * finitos y dentro del campo. Devuelve null si no parece una rutina. `id` = conservar el id (al
 * cargar lo guardado); si no, se genera uno nuevo.
 */
export function sanitizeDesign(o: unknown, id?: string): DesignedAuto | null {
  const r = o as Partial<DesignedAuto> | null;
  if (!r || typeof r !== 'object' || !Array.isArray(r.waypoints) || r.waypoints.length > 64) return null;
  const waypoints: AutoWaypoint[] = [];
  for (const w of r.waypoints as unknown[]) {
    const q = w as Record<string, unknown>;
    const x = num(q?.x, -F.HALF_L, F.HALF_L);
    const z = num(q?.z, -F.HALF_W, F.HALF_W);
    if (x === undefined || z === undefined) return null;
    const wp: AutoWaypoint = { x, z, heading: num(q.heading, -10, 10) ?? null };
    if (typeof q.intake === 'boolean') wp.intake = q.intake;
    if (typeof q.arm === 'number' && Number.isInteger(q.arm) && q.arm >= 0 && q.arm <= 4) wp.arm = q.arm as ElevatorPos;
    if (q.score === 1 || q.score === 2 || q.score === 3) wp.score = q.score;
    if (q.stop === true) wp.stop = true;
    const wait = num(q.wait, 0, 15);
    if (wait) wp.wait = wait;
    const hin = vec(q.hin);
    const hout = vec(q.hout);
    if (hin) wp.hin = hin;
    if (hout) wp.hout = hout;
    waypoints.push(wp);
  }
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 48) : 'AUTO';
  const okId = typeof id === 'string' && /^[\w-]{1,40}$/.test(id) ? id : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  return {
    id: okId,
    name,
    spline: r.spline !== false,
    speed: num(r.speed, 0.2, 1) ?? 0.85,
    mirrorToStart: r.mirrorToStart === true || undefined,
    waypoints,
  };
}

/** La rutina del diseñador de un id de rutina (`design:<id>`), si existe. */
export function designByRoutineId(id: string): DesignedAuto | undefined {
  if (!id.startsWith(DESIGN_PREFIX)) return undefined;
  const did = id.slice(DESIGN_PREFIX.length);
  return loadDesigns().find((d) => d.id === did);
}

/** Waypoint reflejado en z (Zona de Inicio de arriba ↔ abajo). */
export function mirrorWaypointZ(w: AutoWaypoint): AutoWaypoint {
  return {
    ...w,
    z: -w.z,
    heading: w.heading === null ? null : -w.heading,
    hin: w.hin ? { x: w.hin.x, z: -w.hin.z } : undefined,
    hout: w.hout ? { x: w.hout.x, z: -w.hout.z } : undefined,
  };
}

/** Convierte un punto del marco azul al de la alianza (rotación de 180° para rojo). */
export function toAlliance(a: Alliance, x: number, z: number, h: number | null): { x: number; z: number; h: number | null } {
  if (a === 'blue') return { x, z, h };
  return { x: -x, z: -z, h: h === null ? null : h + Math.PI };
}
