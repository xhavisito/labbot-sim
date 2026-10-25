/**
 * Especificación de un robot y sus límites según el manual (§7.2, §4.1). El manual no da
 * velocidad, masa ni mecanismos: esos números son SUPUESTOS configurables.
 */
import { mm } from './field';

/** Límites del manual. */
export const ROBOT_LIMITS = {
  /** Perímetro máximo del chasis 65 × 65 cm (§7.2). */
  maxChassis: mm(650),
  /** Extensión de mecanismos fuera del perímetro: hasta 40 cm en cualquier dirección (§7.2). */
  maxExtension: mm(400),
  /** Altura máxima 100 cm (§7.2). */
  maxHeight: mm(1000),
} as const;

/**
 * Tipo de mecanismo para anotar (ideas del equipo; el manual no fija mecanismos, §7.2):
 * - generic: elevador al frente con depósito que sale hacia adelante.
 * - elevator: intake al frente, tolva y una plataforma que sube y empuja las Muestras por atrás.
 * - pivot: brazo con garra en un pivote; toma una pieza a la vez del piso y la suelta al frente.
 */
export type MechanismKind = 'generic' | 'elevator' | 'pivot';
export const MECHANISM_KINDS: readonly MechanismKind[] = ['generic', 'elevator', 'pivot'];

/** Brazo del pivote (local: x adelante desde el centro del robot, y sobre la base). */
export interface ArmSpec {
  pivotX: number;
  pivotY: number;
  /** Largo del pivote a la punta de la garra (el fondo de la pieza agarrada). */
  length: number;
  /** Velocidad angular (rad/s). */
  speed: number;
}

export interface RobotSpec {
  name: string;
  mechanism: MechanismKind;
  /** Chasis (m): largo (adelante) y ancho. Tanque obligatorio, sin bumpers (§7.2). */
  length: number;
  width: number;
  /** Altura de la estructura fija (sin el elevador extendido). */
  baseHeight: number;
  /** SUPUESTO: sin límite de peso en el manual (§7.2). */
  massKg: number;
  /** SUPUESTOS de manejo. */
  maxSpeed: number;
  maxAccel: number;
  maxOmega: number;
  /** Coeficiente de tracción rueda–alfombra. */
  traction: number;
  intake: {
    /** Cuánto sale la intake del frente del chasis al desplegarse (≤ 0.40 m). */
    extension: number;
    width: number;
  };
  /** Muestras que puede guardar. El manual no pone límite de posesión: SUPUESTO de diseño. */
  capacity: number;
  /** Alcance del depósito más allá del chasis (≤ 0.40 m): al frente, o atrás en `elevator`. */
  reach: number;
  /** Solo `pivot`. */
  arm?: ArmSpec;
  /** Velocidad del elevador (m/s). */
  elevatorSpeed: number;
  /**
   * Alturas (m, sobre la base del robot) del fondo de la pieza al soltarla, por posición.
   * 0 = guardado; 1–3 = niveles de la Cámara (aperturas a 200/500/800 mm, §3.2.3);
   * 4 = Repisa / rendija de la Campana (≈568 mm sobre el piso desde la plataforma; 610 mm).
   * En `pivot` es la altura de la punta de la garra, y la posición 0 es el piso (para agarrar).
   */
  elevatorHeights: [number, number, number, number, number];
}

/** Posiciones del elevador. */
export type ElevatorPos = 0 | 1 | 2 | 3 | 4;

export const DEFAULT_ROBOT: RobotSpec = {
  name: 'LabBot',
  mechanism: 'generic',
  length: mm(650),
  width: mm(650),
  baseHeight: mm(450),
  massKg: 40,
  maxSpeed: 3.0,
  maxAccel: 6.0,
  maxOmega: 5.5,
  traction: 1.0,
  intake: { extension: mm(250), width: mm(500) },
  capacity: 5,
  reach: mm(300),
  elevatorSpeed: 1.4,
  elevatorHeights: [mm(100), mm(260), mm(560), mm(850), mm(640)],
};

/** Elevador que empuja por atrás: misma base; la plataforma saca las Muestras 30 cm detrás del chasis. */
export const ELEVATOR_ROBOT: RobotSpec = {
  ...DEFAULT_ROBOT,
  name: 'Elevador',
  mechanism: 'elevator',
  reach: mm(300),
};

/**
 * Pivote con garra: una pieza a la vez (la garra es el almacenamiento). SUPUESTOS de diseño: pivote
 * 5 cm detrás del centro a 45 cm de la base, brazo de 68 cm, 4 rad/s. Con eso la garra alcanza el piso
 * y el Nivel 3 sin salir más de 40 cm del chasis ni pasar de 100 cm (lo revisa `validateRobot`).
 */
export const PIVOT_ROBOT: RobotSpec = {
  ...DEFAULT_ROBOT,
  name: 'Pivote',
  mechanism: 'pivot',
  capacity: 1,
  reach: 0,
  intake: { extension: 0, width: mm(300) },
  arm: { pivotX: -mm(50), pivotY: mm(450), length: mm(680), speed: 4 },
  elevatorHeights: [0, mm(260), mm(560), mm(850), mm(640)],
};

export const ROBOT_PRESETS: Record<MechanismKind, RobotSpec> = { generic: DEFAULT_ROBOT, elevator: ELEVATOR_ROBOT, pivot: PIVOT_ROBOT };

/** Ángulo del brazo (rad, 0 = horizontal hacia adelante) para que la punta quede a la altura `h`. */
export function armAngle(arm: ArmSpec, h: number): number {
  return Math.asin(Math.max(-1, Math.min(1, (h - arm.pivotY) / arm.length)));
}

/** Punta del brazo (local x, y) con el ángulo `a`. */
export function armTip(arm: ArmSpec, a: number): { x: number; y: number } {
  return { x: arm.pivotX + arm.length * Math.cos(a), y: arm.pivotY + arm.length * Math.sin(a) };
}

/** Revisa los límites de §7.2. Devuelve la lista de problemas (vacía si cumple). */
export function validateRobot(s: RobotSpec, pieceSize = mm(200)): string[] {
  const out: string[] = [];
  if (s.length > ROBOT_LIMITS.maxChassis + 1e-9 || s.width > ROBOT_LIMITS.maxChassis + 1e-9) out.push('chasis mayor a 65 × 65 cm (§7.2)');
  if (s.intake.extension > ROBOT_LIMITS.maxExtension + 1e-9) out.push('intake sale más de 40 cm (§7.2)');
  if (s.reach > ROBOT_LIMITS.maxExtension + 1e-9) out.push('depósito sale más de 40 cm (§7.2)');
  if (s.baseHeight > ROBOT_LIMITS.maxHeight + 1e-9) out.push('más alto que 100 cm (§7.2)');
  // Con el elevador arriba y una Muestra (150 mm) el robot no puede pasar de 100 cm
  if (s.elevatorHeights[3] + mm(150) > ROBOT_LIMITS.maxHeight + 1e-9) out.push('elevador + Muestra pasa de 100 cm (§7.2)');
  if (s.elevatorHeights[4] + pieceSize > ROBOT_LIMITS.maxHeight + 1e-9) out.push('elevador + Muestra Crítica pasa de 100 cm (§7.2)');
  if (s.capacity < 1) out.push('capacidad mínima 1 (precarga, §4.1)');
  if (s.mechanism === 'pivot') {
    if (!s.arm) out.push('pivote sin brazo');
    else
      for (const h of s.elevatorHeights) {
        const tip = armTip(s.arm, armAngle(s.arm, h));
        // La pieza agarrada (hasta la Crítica, 200 mm) cuenta como parte del robot
        if (tip.x + pieceSize / 2 - s.length / 2 > ROBOT_LIMITS.maxExtension + 1e-9) {
          out.push('la garra sale más de 40 cm (§7.2)');
          break;
        }
      }
  }
  return out;
}
