/**
 * Mapa de tiro (lógica pura): dónde estaba cada robot cuando soltó una pieza para anotar y si contó.
 * Lo usan la práctica por ciclos (1 contra 1) y las estadísticas de las repeticiones.
 *
 * Todo esto es SUPUESTO de diseño del simulador: el manual no habla de zonas de tiro. Lo único del
 * manual es dónde está la Cámara de cada alianza (§3.2.3, `config/field.ts`); la rotación de 180° entre
 * alianzas es la del layout de la cancha (`docs/reglas-reto.md` §1.3), y se usa para juntar en un mismo mapa lo que tiraste con rojo y con azul.
 *
 *  - La posición es el centro del robot al SOLTAR la pieza (no donde cayó); si la pieza entró sin
 *    soltarla (empujada), la posición al contar.
 *  - Zonas por distancia del centro del robot a la orilla de su Cámara: cerca ≤ `ZONE_NEAR`,
 *    media ≤ `ZONE_MID`, lejos más allá. El robot no cabe a menos de medio chasis de la Cámara, así
 *    que "cerca" es pegado a ella.
 */
import type { Rect } from '../config/field';
import type { Alliance } from './types';
import type { CycleCat } from './cycles';

/** Un tiro: robot, posición (m, coordenadas de la cancha), a qué nivel, si contó y cuándo (s). */
export interface Shot {
  x: number;
  z: number;
  cat: CycleCat;
  ok: boolean;
  t: number;
}

/** Celda del mapa de tiro (m). Más chica que el robot para ver de qué lado se acomoda. */
export const SHOT_CELL = 0.25;
/** Distancias (m) del centro del robot a la orilla de su Cámara que separan las zonas (SUPUESTO). */
export const ZONE_NEAR = 0.6;
export const ZONE_MID = 1.5;
export type Zone = 'near' | 'mid' | 'far';
export const ZONES: readonly Zone[] = ['near', 'mid', 'far'];

/** Distancia de un punto a un rectángulo del piso (0 si está adentro). */
export function distToRect(x: number, z: number, r: Rect): number {
  const dx = Math.max(r.x0 - x, 0, x - r.x1);
  const dz = Math.max(r.z0 - z, 0, z - r.z1);
  return Math.hypot(dx, dz);
}

export function zoneOf(x: number, z: number, camara: Rect): Zone {
  const d = distToRect(x, z, camara);
  return d <= ZONE_NEAR ? 'near' : d <= ZONE_MID ? 'mid' : 'far';
}

/** Lleva un tiro de la alianza azul al lado rojo (rotación de 180° del layout), para juntar mapas. */
export function asRed(s: Shot, a: Alliance): Shot {
  return a === 'red' ? s : { ...s, x: -s.x, z: -s.z };
}

export interface ZoneStats {
  tried: number;
  made: number;
  accuracy: number | null;
}

/** Tiros y aciertos por zona; `best` = la zona con mejor acierto con al menos `minTried` tiros. */
export function zoneStats(shots: readonly Shot[], camara: Rect, minTried = 3): { byZone: Record<Zone, ZoneStats>; best: Zone | null } {
  const byZone = { near: z0(), mid: z0(), far: z0() };
  for (const s of shots) {
    const z = byZone[zoneOf(s.x, s.z, camara)];
    z.tried++;
    if (s.ok) z.made++;
  }
  let best: Zone | null = null;
  for (const k of ZONES) {
    const z = byZone[k];
    z.accuracy = z.tried ? z.made / z.tried : null;
    if (z.tried >= minTried && z.accuracy !== null && (best === null || z.accuracy > (byZone[best].accuracy ?? -1))) best = k;
  }
  return { byZone, best };
}
const z0 = (): ZoneStats => ({ tried: 0, made: 0, accuracy: null });

export interface ShotCell {
  col: number;
  row: number;
  tried: number;
  made: number;
}

/**
 * Junta los tiros en celdas de `SHOT_CELL` (col = X desde −largo/2, row = Z desde −ancho/2). Solo
 * devuelve las celdas con tiros. Lo de afuera de la cancha se pega a la orilla.
 */
export function shotCells(shots: readonly Shot[], length: number, width: number, cell = SHOT_CELL): ShotCell[] {
  const cols = Math.round(length / cell);
  const rows = Math.round(width / cell);
  const map = new Map<number, ShotCell>();
  for (const s of shots) {
    const col = clampI(Math.floor((s.x + length / 2) / cell), cols);
    const row = clampI(Math.floor((s.z + width / 2) / cell), rows);
    const k = row * cols + col;
    let c = map.get(k);
    if (!c) map.set(k, (c = { col, row, tried: 0, made: 0 }));
    c.tried++;
    if (s.ok) c.made++;
  }
  return [...map.values()];
}
const clampI = (v: number, n: number): number => Math.min(n - 1, Math.max(0, v));

// ------------------------------------------------------------------ mapa acumulado por robot

/** Tiros guardados por robot (`robotId` → tiros, ya llevados al lado rojo). */
export interface ShotLog {
  v: 1;
  robots: Record<string, Shot[]>;
}
/** Tiros que se guardan por robot (los más nuevos). */
export const MAX_SHOTS = 400;
const CATS: readonly CycleCat[] = ['n1', 'n2', 'n3', 'critical'];

export const emptyShotLog = (): ShotLog => ({ v: 1, robots: {} });

/** Agrega los tiros de una práctica (ya en el lado rojo) y recorta a los `MAX_SHOTS` más nuevos. */
export function addShots(log: ShotLog, robot: string, shots: readonly Shot[]): void {
  const round = (v: number) => Math.round(v * 100) / 100;
  const list = (log.robots[robot] ??= []);
  for (const s of shots) list.push({ x: round(s.x), z: round(s.z), cat: s.cat, ok: s.ok, t: round(s.t) });
  if (list.length > MAX_SHOTS) list.splice(0, list.length - MAX_SHOTS);
}

/** Lee el mapa guardado (descarta lo que no tenga la forma esperada). */
export function parseShotLog(raw: string | null): ShotLog {
  if (!raw) return emptyShotLog();
  try {
    const o = JSON.parse(raw) as Partial<ShotLog>;
    if (o?.v !== 1 || !o.robots || typeof o.robots !== 'object') return emptyShotLog();
    const robots: ShotLog['robots'] = {};
    for (const [id, list] of Object.entries(o.robots)) {
      if (!Array.isArray(list)) continue;
      const clean = list.filter(
        (s): s is Shot =>
          !!s && typeof s === 'object' && Number.isFinite(s.x) && Number.isFinite(s.z) && Number.isFinite(s.t) && typeof s.ok === 'boolean' && CATS.includes(s.cat),
      );
      robots[id] = clean.slice(-MAX_SHOTS);
    }
    return { v: 1, robots };
  } catch {
    return emptyShotLog();
  }
}
