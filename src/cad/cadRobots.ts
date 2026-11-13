/** Registro de robots importados desde CAD: todo `robots/*.robot.json` del repositorio. */
import { specFromRobotFile, type RobotFileLike } from '../config/robotFile';
import type { RobotSpec } from '../config/robot';

const files = import.meta.glob<RobotFileLike>('../../robots/*.robot.json', { eager: true, import: 'default' });

export const CAD_ROBOT_SPECS: Record<string, RobotSpec> = {};
for (const [path, json] of Object.entries(files)) {
  const id = path.replace(/^.*\//, '').replace(/\.robot\.json$/, '');
  try {
    CAD_ROBOT_SPECS[id] = specFromRobotFile(json);
  } catch (e) {
    console.warn(`[cad] ${id}: ${(e as Error).message}`); // un robot roto no debe tumbar el simulador
  }
}
