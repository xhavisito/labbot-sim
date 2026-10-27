/**
 * Posición inicial elegible (como el mapa de la configuración del match de rebuilt-sim, pero con las
 * reglas de LabBot): §3.2.1 "Cada alianza cuenta con 2 Zonas de Inicio, una por robot" y §4.1 "los
 * equipos deben acomodar su robot dentro de los límites de su Zona de Inicio, con ninguno de sus
 * mecanismos fuera del perímetro del robot".
 * - El chasis completo (sus 4 esquinas, con el giro) queda dentro de la zona de su estación.
 *   SUPUESTO: la zona es el cuadro de ≈1.0 × 1.0 m que encierra la cinta en L (`START_ZONES_RED`,
 *   [fig.]); el manual no da medidas ni dice si la cinta cuenta como adentro (se toma que sí).
 * - Los mecanismos ya van dentro del perímetro al inicio (brazo guardado, lo revisa `validateRobot`).
 * - Se puede girar el robot dentro de la zona (el manual no fija hacia dónde ve; SUPUESTO: libre).
 *
 * El lugar se guarda en el marco de la alianza roja, relativo al centro de su zona, así que vale
 * igual para rojo y azul (la azul es el giro de 180°, (x, z) → (−x, −z)) y para las dos estaciones.
 */
import type { Alliance } from '../core/types';
import * as F from './field';

/** Desplazamiento del centro del robot (m, marco rojo) desde el centro de su zona, y giro (rad, + = a la izquierda) desde "viendo al centro". */
export interface StartSpot {
  dx: number;
  dz: number;
  turn: number;
}

export const CENTER_SPOT: StartSpot = { dx: 0, dz: 0, turn: 0 };

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Media huella del chasis (m) en X y en Z con el giro `turn` (rectángulo de largo × ancho rotado). */
export function halfExtents(length: number, width: number, turn: number): { x: number; z: number } {
  const c = Math.abs(Math.cos(turn));
  const s = Math.abs(Math.sin(turn));
  return { x: (length / 2) * c + (width / 2) * s, z: (length / 2) * s + (width / 2) * c };
}

/** Cuánto se puede mover el centro (m) desde el centro de la zona en X y en Z con ese giro (negativo = no cabe). */
export function spotRoom(length: number, width: number, turn: number): { x: number; z: number } {
  const z0 = F.START_ZONES_RED[0];
  const h = halfExtents(length, width, turn);
  return { x: (z0.x1 - z0.x0) / 2 - h.x, z: (z0.z1 - z0.z0) / 2 - h.z };
}

/** ¿El chasis completo queda dentro de su Zona de Inicio? (§3.2.1, §4.1) */
export function spotValid(length: number, width: number, s: StartSpot): boolean {
  const r = spotRoom(length, width, s.turn);
  return r.x >= -1e-9 && r.z >= -1e-9 && Math.abs(s.dx) <= r.x + 1e-9 && Math.abs(s.dz) <= r.z + 1e-9;
}

/**
 * El lugar válido más cercano: recorta el desplazamiento a lo que deja el giro. Si con ese giro el
 * chasis no cabe (un robot propio muy grande), lo endereza; si ni así cabe, al centro.
 */
export function clampSpot(length: number, width: number, s: StartSpot): StartSpot {
  let turn = Number.isFinite(s.turn) ? wrap(s.turn) : 0;
  let r = spotRoom(length, width, turn);
  if (r.x < 0 || r.z < 0) {
    // Enderezado: de frente o de reversa, lo más cercano al giro pedido
    turn = Math.abs(turn) > Math.PI / 2 ? Math.PI : 0;
    r = spotRoom(length, width, turn);
  }
  // 1 mm de margen: la física guarda la pose en float32 y la esquina no debe quedar sobre la cinta
  const lim = (v: number, m: number) => (Number.isFinite(v) ? Math.max(-Math.max(0, m - 0.001), Math.min(Math.max(0, m - 0.001), v)) : 0);
  return { dx: lim(s.dx, r.x), dz: lim(s.dz, r.z), turn };
}

/** Centro de la Zona de Inicio de una estación, en el marco rojo. */
function zoneCenterRed(station: 0 | 1): { x: number; z: number } {
  const z = F.START_ZONES_RED[station];
  return { x: (z.x0 + z.x1) / 2, z: (z.z0 + z.z1) / 2 };
}

/** Pose en la cancha (x, z y rumbo) del robot de esa alianza y estación en el lugar `s`. */
export function spotPose(a: Alliance, station: 0 | 1, s: StartSpot = CENTER_SPOT): { x: number; z: number; heading: number } {
  const c = zoneCenterRed(station);
  const p = F.forAlliance(a, { x: c.x + s.dx, z: c.z + s.dz });
  // Viendo al centro de la cancha: el rojo hacia −X (rumbo π), el azul hacia +X (0)
  return { ...p, heading: wrap((a === 'red' ? Math.PI : 0) + s.turn) };
}

/** Lugar válido a partir de cualquier valor guardado. */
export function sanitizeSpot(raw: unknown): StartSpot {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return { dx: Math.max(-1, Math.min(1, n(o.dx))), dz: Math.max(-1, Math.min(1, n(o.dz))), turn: wrap(n(o.turn)) };
}
