/**
 * Rutinas de AUTO (§4.2: 15 s con instrucciones preprogramadas, sin cruzar la línea central).
 * Modelo portado de rebuilt-sim (`auto/AutoRoutine.ts`): una rutina es una lista de waypoints con
 * rumbo y acciones, guardada en el marco de la alianza AZUL (pared propia a la izquierda, −X, la
 * Zona de Inicio mirando a +X) y rotada 180° para la roja. Las acciones cambian por el reto:
 * en lugar de disparar/trepar, el robot anota en un nivel de su Cámara (§3.2.3).
 */
import * as F from '../config/field';
import { DEFAULT_ROBOT } from '../config/robot';
import type { Alliance, Level } from '../core/types';

export interface AutoWaypoint {
  /** Posición en el marco azul (m). */
  x: number;
  z: number;
  /** Rumbo deseado al llegar (rad, marco azul) o null = mirar hacia donde avanza. */
  heading: number | null;
  /** Acciones al llegar (en orden): intake on/off, anotar en un nivel, esperar. */
  intake?: boolean;
  /** Sube el elevador a este nivel de la Cámara y suelta lo que lleva (SUPUESTO: reemplaza "disparar"). */
  score?: Level;
  wait?: number;
  /** Rutas suaves: detenerse aquí aunque no haya acción (si no, pasa sin frenar). */
  stop?: boolean;
  /** Rutas suaves: manijas de la curva Bézier (offset en m desde el punto); sin ellas, automáticas. */
  hin?: { x: number; z: number };
  hout?: { x: number; z: number };
}

export interface AutoRoutine {
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
  /** La maneja la IA (`ai/Bot`) en lugar de waypoints (las rutinas de siempre de labbot). */
  bot?: { scoreOnly: boolean };
  /** Al terminar sus waypoints se queda quieta (las incluidas "Salir" y "Quieto"); si no, sigue jugando. */
  idleAfter?: boolean;
}

/** Posición de anotación frente a la Cámara propia (marco azul): el frente a 4 cm de la pared del nivel. */
export function scorePoint(level: Level, halfL = DEFAULT_ROBOT.length / 2): { x: number; z: number; heading: number } {
  const w = F.camaraWells()[level];
  const p = F.forAlliance('blue', { x: (w.x0 + w.x1) / 2, z: F.CAMARA_Z_RED[0] - halfL - 0.04 });
  // La Cámara azul queda en −Z: se mira hacia −Z (rumbo π/2)
  return { ...p, heading: Math.PI / 2 };
}

const sp3 = scorePoint(3);
const sp2 = scorePoint(2);
const startZ = 0.495;

/** Salir de la Zona de Inicio (= cruzar la línea de autónomo, D1) sin llegar a la Plataforma (§4.6). */
export const LEAVE_ZONE: AutoRoutine = {
  id: 'leave',
  name: 'Salir de la zona',
  builtin: true,
  mirrorToStart: true,
  idleAfter: true,
  waypoints: [{ x: -2.4, z: startZ, heading: null }],
};

export const DO_NOTHING: AutoRoutine = { id: 'none', name: 'Quedarse quieto', builtin: true, idleAfter: true, waypoints: [] };

/** La IA lleva la precarga a su Cámara (Nivel 3) sin salir de su mitad (§4.2); al salir de la zona también cruza la línea. */
export const SCORE_PRELOAD: AutoRoutine = { id: 'preload', name: 'Anotar precarga', builtin: true, waypoints: [], bot: { scoreOnly: true } };

/** La IA anota la precarga y recolecta Muestras de su mitad. */
export const COLLECT_HOME: AutoRoutine = { id: 'collect', name: 'Anotar y recolectar', builtin: true, waypoints: [], bot: { scoreOnly: false } };

/**
 * Rutas suaves de ejemplo (y plantillas de las nuevas). Salen en línea recta de la Zona de Inicio de
 * `z0` (Salida 1 = z > 0, Salida 2 = z < 0: así los dos robots de la alianza no se estorban), bordean
 * la Plataforma (solo se pisa en el ENDGAME, §4.6) y terminan frente a la Cámara. Como la Cámara está
 * fija en −Z no usan "se adapta a su lado": hay una versión por salida.
 */
const exitStart = (z0: number): AutoWaypoint => ({ x: -2.65, z: z0, heading: null });

/** De su Zona de Inicio a anotar la precarga en el Nivel 3. */
const pathScore = (n: 1 | 2): AutoRoutine => ({
  id: `path-score-${n}`,
  name: `Ruta suave · Anotar Nivel 3 (salida ${n})`,
  builtin: true,
  spline: true,
  speed: 0.85,
  waypoints: [exitStart(n === 1 ? startZ : -startZ), { x: -2.9, z: -1.2, heading: null }, { x: sp3.x, z: -1.9, heading: null }, { x: sp3.x, z: sp3.z, heading: sp3.heading, score: 3 }],
});

/** Recoge una Muestra del Laboratorio de su mitad y la anota en el Nivel 2 junto con la precarga. */
const pathCollect = (n: 1 | 2): AutoRoutine => ({
  id: `path-collect-${n}`,
  name: `Ruta suave · Recolectar y anotar (salida ${n})`,
  builtin: true,
  spline: true,
  speed: 0.85,
  waypoints: [
    exitStart(n === 1 ? startZ : -startZ),
    { x: -2.9, z: -1.4, heading: null, intake: true },
    { x: -1.2, z: -1.4, heading: null },
    { x: sp2.x, z: -1.9, heading: null, intake: false },
    { x: sp2.x, z: sp2.z, heading: sp2.heading, score: 2 },
  ],
});

export const PATH_SCORE_1 = pathScore(1);
export const PATH_SCORE_2 = pathScore(2);
export const PATH_COLLECT_1 = pathCollect(1);
export const PATH_COLLECT_2 = pathCollect(2);

/** Rutinas incluidas (no se pueden borrar). */
export const BUILTIN_ROUTINES: AutoRoutine[] = [LEAVE_ZONE, SCORE_PRELOAD, COLLECT_HOME, DO_NOTHING, PATH_SCORE_1, PATH_SCORE_2, PATH_COLLECT_1, PATH_COLLECT_2];
export const AUTO_ROUTINES: readonly AutoRoutine[] = BUILTIN_ROUTINES;

const KEY = 'labbot.autos.v1';

function loadJSON<T>(key: string, def: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : def;
  } catch {
    return def;
  }
}

export function loadRoutines(): AutoRoutine[] {
  const custom = loadJSON<unknown[]>(KEY, []);
  const out: AutoRoutine[] = [];
  for (const c of Array.isArray(custom) ? custom : []) {
    const r = sanitizeRoutine(c, (c as { id?: string } | null)?.id);
    if (r) out.push(r);
  }
  return [...BUILTIN_ROUTINES, ...out];
}

export function saveCustomRoutines(list: AutoRoutine[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.filter((r) => !r.builtin)));
  } catch {
    /* sin almacenamiento */
  }
}

export function routineById(id: string, all: AutoRoutine[] = loadRoutines()): AutoRoutine {
  return all.find((r) => r.id === id) ?? LEAVE_ZONE;
}

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
export function sanitizeRoutine(o: unknown, id?: string): AutoRoutine | null {
  const r = o as Partial<AutoRoutine> | null;
  if (!r || typeof r !== 'object' || !Array.isArray(r.waypoints) || r.waypoints.length > 64) return null;
  const waypoints: AutoWaypoint[] = [];
  for (const w of r.waypoints as unknown[]) {
    const q = w as Record<string, unknown>;
    const x = num(q?.x, -F.HALF_L, F.HALF_L);
    const z = num(q?.z, -F.HALF_W, F.HALF_W);
    if (x === undefined || z === undefined) return null;
    const wp: AutoWaypoint = { x, z, heading: num(q.heading, -10, 10) ?? null };
    if (typeof q.intake === 'boolean') wp.intake = q.intake;
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
  return {
    id: id && typeof id === 'string' ? id : `custom-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    name,
    spline: r.spline !== false,
    speed: num(r.speed, 0.2, 1) ?? 0.85,
    mirrorToStart: r.mirrorToStart === true || undefined,
    waypoints,
  };
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

/** ¿El waypoint cruza COMPLETAMENTE la línea central? (§4.2: la rutina sería ilegal). */
export function crossesCenter(w: AutoWaypoint, halfFootprint: number): boolean {
  return w.x - halfFootprint > F.CENTER_LINE_X;
}
