/**
 * Robots propios del editor (se guardan en este navegador, localStorage). Cada uno se describe con
 * números que el equipo puede medir o decidir (medidas del chasis, motores y reducción de la
 * tracción, mecanismo, área de MDF) y de ahí sale su `RobotSpec`: masa estimada, velocidad y
 * aceleración. También se revisa contra las reglas de construcción del manual (§7).
 *
 * Datos de motores (velocidad libre y torque de paro, conmutación trapezoidal): tabla de
 * frc8569.readthedocs.io y documentación de WCP (Kraken). Masas de motores, batería, ruedas y
 * electrónica: aproximadas (SUPUESTO); la densidad del MDF también (≈ 750 kg/m³, varía 600–800).
 */
import type { Level } from '../core/types';
import { mm } from './field';
import { DEFAULT_ROBOT, MECHANISM_KINDS, ROBOT_PRESETS, validateRobot, type MechanismKind, type RobotSpec } from './robot';

export type MotorKind = 'cim' | 'x60' | 'x44' | 'neo';
export const MOTOR_KINDS: readonly MotorKind[] = ['cim', 'x60', 'x44', 'neo'];

/** Motores permitidos (§7.3): "6 CIMs, 1 Kraken x44, 3 Kraken x60 y 1 NEO". */
export const MOTOR_LIMITS: Record<MotorKind, number> = { cim: 6, x44: 1, x60: 3, neo: 1 };

export const MOTORS: Record<MotorKind, { name: string; freeRpm: number; stallNm: number; kg: number }> = {
  cim: { name: 'CIM', freeRpm: 5330, stallNm: 2.41, kg: 1.27 },
  x60: { name: 'Kraken X60', freeRpm: 6000, stallNm: 7.09, kg: 0.54 },
  x44: { name: 'Kraken X44', freeRpm: 7530, stallNm: 4.05, kg: 0.36 },
  neo: { name: 'NEO', freeRpm: 5676, stallNm: 2.6, kg: 0.43 },
};

/** MDF de 5.5 mm (§7.1); densidad SUPUESTA. */
export const MDF_THICKNESS = mm(5.5);
export const MDF_DENSITY = 750;
/** PLA para imprimir por equipo (§7.1.1). */
export const PLA_LIMIT_G = 150;
/** SUPUESTOS de masa: batería FRC de 12 V (§7.3) ≈ 5.9 kg; electrónica y cables; rueda de 6 in; caja de reducción; tornillería = % del resto. */
export const MASS_PARTS = { battery: 5.9, electronics: 2.0, wheel6in: 0.3, gearbox: 0.9, hardware: 0.1 };
/** Fracción de la velocidad libre que se alcanza en el piso (pérdidas y carga). SUPUESTO. */
export const SPEED_EFFICIENCY = 0.8;
/** Fracción del torque de paro que se usa para acelerar (limitador de corriente). SUPUESTO. */
export const ACCEL_TORQUE_FRACTION = 0.35;

export interface CustomRobot {
  id: string;
  name: string;
  mechanism: MechanismKind;
  /** Chasis (cm): largo, ancho y alto de la estructura fija. */
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  /** Tracción tanque (§7.2): motor, cuántos (los dos lados), reducción y rueda (in). */
  driveMotor: MotorKind;
  driveCount: number;
  gearRatio: number;
  wheelIn: number;
  wheels: number;
  /** Motores de los mecanismos (cuentan para el límite de §7.3). */
  mechMotors: Record<MotorKind, number>;
  /** Muestras que guarda (1 en la garra y el resto en el hopper). */
  capacity: number;
  /** Velocidad del brazo (rad/s). */
  liftSpeed: number;
  maxLevel: Level;
  /** Brazo: eje adelante del centro y alto (cm) y largo del brazo (cm). */
  armPivotXCm: number;
  armPivotYCm: number;
  armLengthCm: number;
  /** Área de MDF (m²); null = estimada con las medidas. */
  mdfM2: number | null;
  plaG: number;
  /** Otros kg (neumática, sensores, contrapeso). */
  extraKg: number;
  /** Masa pesada en báscula (kg); null = usar la estimada. */
  massKg: number | null;
}

export const CUSTOM_PREFIX = 'custom:';
const KEY = 'labbot.customRobots';

const cm = (m: number) => Math.round(m * 1000) / 10;

/** Un robot nuevo a partir de un `RobotSpec` (los presets u otro robot propio), con la tracción del chasis base (4 CIM, 12.75:1, 6 in). */
export function customFromSpec(s: RobotSpec, name: string, id = newId()): CustomRobot {
  return {
    id,
    name,
    mechanism: s.mechanism,
    lengthCm: cm(s.length),
    widthCm: cm(s.width),
    heightCm: cm(s.baseHeight),
    driveMotor: 'cim',
    driveCount: 4,
    gearRatio: 12.75,
    wheelIn: 6,
    wheels: 6,
    // 2 X60 en el brazo, X44 en la garra y NEO en el indexador del hopper (§7.3)
    mechMotors: { cim: 0, x60: 2, x44: 1, neo: 1 },
    capacity: s.capacity,
    liftSpeed: s.arm.speed,
    maxLevel: s.maxLevel ?? 3,
    armPivotXCm: cm(s.arm.pivotX),
    armPivotYCm: cm(s.arm.pivotY),
    armLengthCm: cm(s.arm.length),
    mdfM2: null,
    plaG: 0,
    extraKg: 0,
    massKg: null,
  };
}

export const newId = (): string => Math.random().toString(36).slice(2, 9);

/** Área de MDF estimada (m²): dos placas del chasis, sus paredes y los paneles del mecanismo. SUPUESTO de diseño. */
export function estimateMdf(c: CustomRobot): number {
  const L = c.lengthCm / 100;
  const W = c.widthCm / 100;
  const H = c.heightCm / 100;
  const chassis = 2 * L * W + 2 * (L + W) * 0.12;
  // Torres del pivote, brazo, y el hopper: 4 paredes (2 altas por fuera, 2 bajas junto al canal), pisos inclinados y fondo
  const mech = 2 * 0.3 * (c.armPivotYCm / 100) + 2 * 0.06 * (c.armLengthCm / 100) + 2 * 0.6 * L * H + 2 * 0.6 * L * 0.35 + 2 * 0.6 * L * 0.2 + W * 0.3;
  return chassis + mech;
}

export interface MassBreakdown {
  mdf: number;
  motors: number;
  battery: number;
  electronics: number;
  drivetrain: number;
  pla: number;
  extra: number;
  hardware: number;
  total: number;
}

/** Masa estimada por partes (kg). */
export function estimateMass(c: CustomRobot): MassBreakdown {
  const mdf = (c.mdfM2 ?? estimateMdf(c)) * MDF_THICKNESS * MDF_DENSITY;
  const count = motorCount(c);
  const motors = MOTOR_KINDS.reduce((a, k) => a + count[k] * MOTORS[k].kg, 0);
  const drivetrain = c.wheels * MASS_PARTS.wheel6in * (c.wheelIn / 6) ** 2 + 2 * MASS_PARTS.gearbox;
  const pla = c.plaG / 1000;
  const sub = mdf + motors + MASS_PARTS.battery + MASS_PARTS.electronics + drivetrain + pla + c.extraKg;
  const hardware = sub * MASS_PARTS.hardware;
  return { mdf, motors, battery: MASS_PARTS.battery, electronics: MASS_PARTS.electronics, drivetrain, pla, extra: c.extraKg, hardware, total: sub + hardware };
}

/** Todos los motores del robot (tracción + mecanismos). */
export function motorCount(c: CustomRobot): Record<MotorKind, number> {
  const out = { ...c.mechMotors };
  out[c.driveMotor] += c.driveCount;
  return out;
}

/** Masa que usa la simulación: la de báscula si se dio, si no la estimada. */
export const robotMass = (c: CustomRobot): number => c.massKg ?? estimateMass(c).total;

/** Velocidad máxima en el piso (m/s): velocidad libre del motor / reducción × circunferencia × eficiencia. */
export function driveSpeed(c: CustomRobot): number {
  const wheelM = c.wheelIn * 0.0254;
  return (MOTORS[c.driveMotor].freeRpm / c.gearRatio / 60) * Math.PI * wheelM * SPEED_EFFICIENCY;
}

/** Aceleración (m/s²): la menor entre la del motor (fracción del torque de paro) y la tracción (μ·g). */
export function driveAccel(c: CustomRobot, traction = 1): number {
  const r = (c.wheelIn * 0.0254) / 2;
  const force = (c.driveCount * MOTORS[c.driveMotor].stallNm * ACCEL_TORQUE_FRACTION * c.gearRatio) / r;
  return Math.min(force / robotMass(c), traction * 9.81 * 0.62);
}

/** `RobotSpec` para la simulación. Las alturas de los niveles y la boca del hopper salen del preset de su tipo. */
export function customSpec(c: CustomRobot): RobotSpec {
  const base = ROBOT_PRESETS[c.mechanism];
  const L = mm(c.lengthCm * 10);
  const speed = driveSpeed(c);
  const s: RobotSpec = {
    ...base,
    name: c.name,
    label: c.name,
    mechanism: c.mechanism,
    length: L,
    width: mm(c.widthCm * 10),
    baseHeight: mm(c.heightCm * 10),
    massKg: Math.max(8, robotMass(c)),
    maxSpeed: speed,
    maxAccel: driveAccel(c),
    // Giro: un tanque gira a ≈ v / (media trocha) limitado por el derrape de las ruedas (SUPUESTO)
    maxOmega: Math.min(7, (2 * speed) / Math.max(0.3, mm(c.widthCm * 10))),
    traction: base.traction,
    capacity: Math.max(2, Math.round(c.capacity)),
    arm: { ...base.arm, pivotX: mm(c.armPivotXCm * 10), pivotY: mm(c.armPivotYCm * 10), length: mm(c.armLengthCm * 10), speed: c.liftSpeed },
    maxLevel: c.maxLevel,
  };
  return s;
}

export interface Check {
  level: 'error' | 'warn' | 'info';
  text: string;
}

/**
 * Revisión contra el manual. Errores = no pasaría la inspección (§7.1–§7.3, §8.1); avisos = algo
 * que conviene revisar; info = datos del manual que no limitan (no hay límite de peso, §7.2).
 */
export function checkCustom(c: CustomRobot): Check[] {
  const out: Check[] = validateRobot(customSpec(c)).map((text) => ({ level: 'error' as const, text }));
  const n = motorCount(c);
  for (const k of MOTOR_KINDS) if (n[k] > MOTOR_LIMITS[k]) out.push({ level: 'error', text: `${n[k]} ${MOTORS[k].name}: el máximo es ${MOTOR_LIMITS[k]} (§7.3)` });
  if (c.plaG > PLA_LIMIT_G) out.push({ level: 'error', text: `${c.plaG} g de PLA: cada equipo tiene ${PLA_LIMIT_G} g (§7.1.1)` });
  if (c.driveCount < 2 || c.driveCount % 2 !== 0) out.push({ level: 'warn', text: 'tracción tanque: los motores van en pares, uno o más por lado (§7.2)' });
  const sp = driveSpeed(c);
  if (sp > 5) out.push({ level: 'warn', text: `${sp.toFixed(1)} m/s es muy rápido para una cancha de 9 m: más reducción da más empuje` });
  if (sp < 1.2) out.push({ level: 'warn', text: `${sp.toFixed(1)} m/s es lento: menos reducción o rueda más grande` });
  const m = robotMass(c);
  out.push({ level: 'info', text: `masa ${m.toFixed(1)} kg${c.massKg === null ? ' (estimada)' : ' (báscula)'}: no hay límite de peso (§7.2)` });
  out.push({ level: 'info', text: 'MDF de 5.5 mm (§7.1); chasis tanque sin bumpers (§7.2); main breaker visible y accesible (§7.1)' });
  return out;
}

const finite = (v: unknown, d: number, lo: number, hi: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);

/**
 * Robot válido a partir de cualquier valor guardado (lo raro toma el valor del preset).
 * Robots propios de tipos que ya no existen (genérico, elevador, pivote, torre, chasis; quitados el
 * 27-oct): se convierten en pivote con hopper con su nombre, chasis, tracción y masa, y el brazo,
 * la capacidad y los motores de los mecanismos del preset (los suyos eran de otro mecanismo).
 */
export function sanitizeCustom(raw: unknown): CustomRobot | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const known = MECHANISM_KINDS.find((k) => k === o.mechanism);
  const mech = known ?? DEFAULT_ROBOT.mechanism;
  const d = customFromSpec(ROBOT_PRESETS[mech], 'Mi robot', typeof o.id === 'string' && /^[a-z0-9]{1,16}$/.test(o.id) ? o.id : newId());
  // De un tipo quitado solo se conserva lo que no depende del mecanismo
  const arm = (v: unknown, def: number, lo: number, hi: number) => (known ? finite(v, def, lo, hi) : def);
  const mm0 = (o.mechMotors ?? {}) as Record<string, unknown>;
  const motor = (v: unknown): MotorKind => MOTOR_KINDS.find((k) => k === v) ?? d.driveMotor;
  return {
    id: d.id,
    name: typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 40) : d.name,
    mechanism: mech,
    lengthCm: finite(o.lengthCm, d.lengthCm, 20, 120),
    widthCm: finite(o.widthCm, d.widthCm, 20, 120),
    heightCm: finite(o.heightCm, d.heightCm, 15, 150),
    driveMotor: motor(o.driveMotor),
    driveCount: Math.round(finite(o.driveCount, d.driveCount, 1, 8)),
    gearRatio: finite(o.gearRatio, d.gearRatio, 2, 40),
    wheelIn: finite(o.wheelIn, d.wheelIn, 3, 8),
    wheels: Math.round(finite(o.wheels, d.wheels, 4, 8)),
    mechMotors: known
      ? { cim: Math.round(finite(mm0.cim, 0, 0, 8)), x60: Math.round(finite(mm0.x60, 0, 0, 8)), x44: Math.round(finite(mm0.x44, 0, 0, 8)), neo: Math.round(finite(mm0.neo, 0, 0, 8)) }
      : d.mechMotors,
    capacity: Math.round(arm(o.capacity, d.capacity, 2, 10)),
    liftSpeed: arm(o.liftSpeed, d.liftSpeed, 0.2, 8),
    maxLevel: o.maxLevel === 1 || o.maxLevel === 2 ? o.maxLevel : 3,
    armPivotXCm: arm(o.armPivotXCm, d.armPivotXCm, -40, 40),
    armPivotYCm: arm(o.armPivotYCm, d.armPivotYCm, 15, 100),
    armLengthCm: arm(o.armLengthCm, d.armLengthCm, 20, 90),
    mdfM2: o.mdfM2 === null || o.mdfM2 === undefined ? null : finite(o.mdfM2, 1, 0, 10),
    plaG: finite(o.plaG, 0, 0, 1000),
    extraKg: finite(o.extraKg, 0, 0, 40),
    massKg: o.massKg === null || o.massKg === undefined ? null : finite(o.massKg, 30, 8, 120),
  };
}

export function loadCustomRobots(): CustomRobot[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.map(sanitizeCustom).filter((c): c is CustomRobot => c !== null) : [];
  } catch {
    return [];
  }
}

export function saveCustomRobots(list: readonly CustomRobot[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* sin almacenamiento */
  }
}

/** Robots propios en memoria (los lee `robotSpec` para los ids `custom:…`). */
export const customRobots: CustomRobot[] = typeof localStorage === 'undefined' ? [] : loadCustomRobots();

export const customById = (id: string): CustomRobot | undefined => (id.startsWith(CUSTOM_PREFIX) ? customRobots.find((c) => CUSTOM_PREFIX + c.id === id) : undefined);
