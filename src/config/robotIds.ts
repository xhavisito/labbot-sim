/**
 * Robots elegibles: el pivote y su variante de 180° (`ROBOT_PRESETS`) y los robots propios
 * del editor (`customRobots.ts`, guardados en este navegador).
 */
import { CAD_ROBOT_SPECS } from '../cad/cadRobots';
import { CUSTOM_PREFIX, customById, customRobots, customSpec } from './customRobots';
import { DEFAULT_ROBOT, MECHANISM_KINDS, ROBOT_PRESETS, type MechanismKind, type RobotSpec } from './robot';

/** Robot elegible: un tipo de LabBot o uno propio del editor. */
export type RobotId = MechanismKind | `custom:${string}` | `cad:${string}`;

/** Prefijo de los robots importados desde CAD (`robots/*.robot.json`). */
export const CAD_PREFIX = 'cad:';
export const isCadId = (id: string): boolean => id.startsWith(CAD_PREFIX) && id.slice(CAD_PREFIX.length) in CAD_ROBOT_SPECS;

export const ROBOT_IDS: readonly RobotId[] = MECHANISM_KINDS;

/** Ids elegibles ahora: los fijos y los robots propios guardados en este navegador. */
export const allRobotIds = (): RobotId[] => [...ROBOT_IDS, ...Object.keys(CAD_ROBOT_SPECS).map((k): RobotId => `${CAD_PREFIX}${k}`), ...customRobots.map((c): RobotId => `${CUSTOM_PREFIX}${c.id}`)];

/** El `RobotSpec` de cualquier robot elegible (uno propio que ya no existe cae al pivote). */
export function robotSpec(id: RobotId): RobotSpec {
  if (isCadId(id)) return CAD_ROBOT_SPECS[id.slice(CAD_PREFIX.length)];
  const c = customById(id);
  if (c) return customSpec(c);
  return ROBOT_PRESETS[id as MechanismKind] ?? DEFAULT_ROBOT;
}
