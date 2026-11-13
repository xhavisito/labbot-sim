/**
 * Robots elegibles: el pivote y su variante de 180° (`ROBOT_PRESETS`) y los robots propios
 * del editor (`customRobots.ts`, guardados en este navegador).
 */
import { CUSTOM_PREFIX, customById, customRobots, customSpec } from './customRobots';
import { DEFAULT_ROBOT, MECHANISM_KINDS, ROBOT_PRESETS, type MechanismKind, type RobotSpec } from './robot';

/** Robot elegible: un tipo de LabBot o uno propio del editor. */
export type RobotId = MechanismKind | `custom:${string}`;

export const ROBOT_IDS: readonly RobotId[] = MECHANISM_KINDS;

/** Ids elegibles ahora: los fijos y los robots propios guardados en este navegador. */
export const allRobotIds = (): RobotId[] => [...ROBOT_IDS, ...customRobots.map((c): RobotId => `${CUSTOM_PREFIX}${c.id}`)];

/** El `RobotSpec` de cualquier robot elegible (uno propio que ya no existe cae al pivote). */
export function robotSpec(id: RobotId): RobotSpec {
  const c = customById(id);
  if (c) return customSpec(c);
  return ROBOT_PRESETS[id as MechanismKind] ?? DEFAULT_ROBOT;
}
