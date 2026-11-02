/**
 * Dónde van las cámaras "como en un match real" (pedido de Xhavi, 1-nov): el conductor de pie en
 * su Driver Station, la esquina de su alianza y la cámara a bordo del robot. Geometría pura (sin
 * Three.js) para poder probarla.
 *
 * El manual solo dice que las Driver Stations están en los lados cortos, fuera de la cancha, una
 * mesa por alianza (§3.2.6). Todo lo demás es SUPUESTO y está en `docs/reglas-reto.md` (D43):
 * - Cada conductor se para detrás de la mitad de la mesa del lado de su zona de inicio (§4.2):
 *   la estación 1 de rojo (zona en −Z) a la izquierda viendo la cancha desde rojo.
 * - Ojos a 1.60 m del piso (adulto de pie promedio).
 * - Esquina: poste a 2.4 m en la esquina de la alianza, por fuera de la pared.
 * - Cámara a bordo: al frente del robot, un poco arriba de la estructura fija, como una webcam.
 */
import type { Alliance } from '../core/types';
import * as F from './field';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Altura de los ojos del conductor de pie (SUPUESTO D43). */
export const DRIVER_EYE_HEIGHT = 1.6;
/** El conductor está detrás de la mesa, a este espacio de su borde trasero (SUPUESTO). */
export const DRIVER_BEHIND_TABLE = 0.35;
/** Separación del centro de la mesa a cada laptop / conductor (igual que `FieldView`). */
export const DRIVER_SIDE_OFFSET = 0.3;
/** Centro de la mesa de la Driver Station roja en X (igual que `FieldView`). */
export const DRIVER_TABLE_X = F.HALF_L + F.OUT_OF_BOUNDS_MARGIN + F.DRIVER_STATION_DEPTH / 2 + 0.2;
/** Altura del poste de la cámara de esquina (SUPUESTO). */
export const CORNER_HEIGHT = 2.4;
/** La cámara de esquina queda por fuera de la pared, a este margen de cada lado (SUPUESTO). */
export const CORNER_OUTSIDE = 0.45;

/** Lado (±1 en Z, marco rojo) de la zona de inicio de la estación (§4.2, `START_ZONES_RED`). */
export function stationSideRed(station: 0 | 1): -1 | 1 {
  const z = F.START_ZONES_RED[station];
  return (z.z0 + z.z1) / 2 < 0 ? -1 : 1;
}

/** Ojos del conductor de esa alianza y estación, de pie detrás de su mesa (§3.2.6). */
export function driverEye(a: Alliance, station: 0 | 1): Vec3 {
  const p = F.forAlliance(a, {
    x: DRIVER_TABLE_X + F.DRIVER_STATION_DEPTH / 2 + DRIVER_BEHIND_TABLE,
    z: stationSideRed(station) * DRIVER_SIDE_OFFSET,
  });
  return { x: p.x, y: DRIVER_EYE_HEIGHT, z: p.z };
}

/** Cámara en la esquina de la alianza, del lado de la estación (fuera de la pared perimetral). */
export function cornerEye(a: Alliance, station: 0 | 1): Vec3 {
  const p = F.forAlliance(a, {
    x: F.HALF_L + F.WALL_THICKNESS + CORNER_OUTSIDE,
    z: stationSideRed(station) * (F.HALF_W + F.WALL_THICKNESS + CORNER_OUTSIDE),
  });
  return { x: p.x, y: CORNER_HEIGHT, z: p.z };
}

/**
 * Montaje de la cámara a bordo, en coordenadas del robot (x adelante, y arriba): al frente del
 * chasis y 12 cm sobre la estructura fija, para que se vea la garra al bajar el brazo.
 */
export function onboardMount(spec: { length: number; baseHeight: number }): { forward: number; up: number } {
  return { forward: spec.length / 2 - 0.04, up: spec.baseHeight + 0.12 };
}

/** Hacia dónde mira la cámara a bordo: adelante y un poco abajo (rad bajo el horizonte). */
export const ONBOARD_PITCH = 0.32;
/** Campos de visión (°): la vista humana más abierta que la de TV; la webcam, gran angular. */
export const FOV = { default: 50, driver: 58, onboard: 78 } as const;
