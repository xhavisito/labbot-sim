/** Registro de robots importados desde CAD: todo `robots/*.robot.json` del repositorio. */
import { specFromRobotFile, type RobotFileLike } from '../config/robotFile';
import { validateRobot, type RobotSpec } from '../config/robot';

const files = import.meta.glob<RobotFileLike>('../../robots/*.robot.json', { eager: true, import: 'default' });

export const CAD_ROBOT_SPECS: Record<string, RobotSpec> = {};
/** Límites de §7.2 que el robot del CAD no cumple (vacío si cumple). */
export const CAD_ROBOT_PROBLEMS: Record<string, string[]> = {};
for (const [path, json] of Object.entries(files)) {
  const id = path.replace(/^.*\//, '').replace(/\.robot\.json$/, '');
  try {
    CAD_ROBOT_SPECS[id] = specFromRobotFile(json, false);
    CAD_ROBOT_PROBLEMS[id] = validateRobot(CAD_ROBOT_SPECS[id]);
  } catch (e) {
    console.warn(`[cad] ${id}: ${(e as Error).message}`); // un robot roto no debe tumbar el simulador
  }
}
