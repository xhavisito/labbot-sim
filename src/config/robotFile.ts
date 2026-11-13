/**
 * Robots generados desde CAD (`npm run robot:import`): archivos `robots/*.robot.json` que se mezclan
 * sobre el preset de su mecanismo y se validan con los límites del manual (§7.2).
 */
import { DEFAULT_INTAKE, ROBOT_PRESETS, validateRobot, type MechanismKind, type RobotSpec } from './robot';

export interface RobotFileLike {
  schema?: string;
  name?: string;
  mechanism?: string;
  spec?: Partial<Omit<RobotSpec, 'intake' | 'arm' | 'elevatorHeights'>> & {
    intake?: Partial<NonNullable<RobotSpec['intake']>>;
    arm?: Partial<NonNullable<RobotSpec['arm']>>;
    elevatorHeights?: number[];
  };
  supuestos?: string[];
  model?: RobotSpec['model'];
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * Convierte el JSON a `RobotSpec`. Lanza Error si el archivo está mal formado; con `strict` (por defecto)
 * también si el robot no cumple §7.2. El simulador lo carga sin `strict` para poder jugar con un robot
 * real aunque se pase de un límite, avisando cuáles (`validateRobot`).
 */
export function specFromRobotFile(f: RobotFileLike, strict = true): RobotSpec {
  if (f.schema !== 'labbot-robot/1') throw new Error('archivo de robot: schema desconocido');
  const mech = f.mechanism as MechanismKind;
  const base = ROBOT_PRESETS[mech];
  if (!base) throw new Error(`archivo de robot: mecanismo desconocido "${f.mechanism}"`);
  const s = f.spec ?? {};
  for (const k of ['length', 'width', 'baseHeight'] as const) if (!finite(s[k]) || s[k]! <= 0) throw new Error(`archivo de robot: "${k}" inválido`);
  const spec: RobotSpec = {
    ...base,
    ...s,
    name: f.name ?? base.name,
    label: f.name ?? base.label,
    model: f.model,
    mechanism: mech,
    intake: s.intake ? { ...DEFAULT_INTAKE, ...base.intake, ...s.intake } : base.intake,
    arm: { ...base.arm, ...s.arm },
    elevatorHeights: (s.elevatorHeights as RobotSpec['elevatorHeights'] | undefined) ?? base.elevatorHeights,
  };
  if (spec.elevatorHeights.length !== 5 || !spec.elevatorHeights.every(finite)) throw new Error('archivo de robot: elevatorHeights debe tener 5 números');
  const problems = strict ? validateRobot(spec) : [];
  if (problems.length) throw new Error(`robot "${spec.name}" no cumple el manual: ${problems.join('; ')}`);
  return spec;
}
