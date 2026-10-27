/**
 * Especificación de un robot y sus límites según el manual (§7.2, §4.1). El manual no da
 * velocidad, masa ni mecanismos: esos números son SUPUESTOS configurables.
 */
import type { Level } from '../core/types';
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
 * Tipos de robot del simulador (27-oct, a pedido de Xhavi solo queda el Pivote; el manual no fija
 * mecanismos, §7.2):
 * - pivot: pivote con garra (sugerencia de CAD en MDF): brazo de 50 cm que agarra una Muestra del
 *   piso y la suelta al frente en N1–N3, o lleva la Muestra Crítica. Una pieza a la vez.
 * - pivot180: el mismo pivote con el brazo limitado a 180° de giro (del piso hasta guardado arriba
 *   y atrás); para que quepa guardado con la precarga (§4.1, §7.2) el eje va un poco más bajo y
 *   adelante (SUPUESTO de diseño).
 */
export type MechanismKind = 'pivot' | 'pivot180';
export const MECHANISM_KINDS: readonly MechanismKind[] = ['pivot', 'pivot180'];

/** Brazo del pivote (local: x adelante desde el centro del robot, y sobre la base). */
export interface ArmSpec {
  pivotX: number;
  pivotY: number;
  /** Largo del pivote a la punta de la garra (el fondo de la pieza agarrada). */
  length: number;
  /** Velocidad angular (rad/s). */
  speed: number;
  /**
   * Ángulo de guardado al inicio (rad): todo dentro del perímetro y bajo 100 cm (§4.1, §7.2). Sale
   * de ahí la primera vez que se le pide otra posición o se enciende la garra.
   */
  stowAngle?: number;
  /**
   * Ángulo (rad) en el que la garra queda en la boca del hopper para dejarle o sacarle una Muestra.
   * Puede salir del perímetro (≤ 40 cm, §7.2), no al inicio.
   */
  hopperAngle?: number;
  /** Segundos con la garra en la boca del hopper para pasar una Muestra. */
  transferTime?: number;
}

export interface RobotSpec {
  name: string;
  /** Nombre a mostrar (robots propios del editor); si no hay, se usa el nombre del tipo. */
  label?: string;
  mechanism: MechanismKind;
  /** Chasis (m): largo (adelante) y ancho. Tanque obligatorio, sin bumpers (§7.2). */
  length: number;
  width: number;
  /** Altura de la estructura fija (sin el brazo). */
  baseHeight: number;
  /** SUPUESTO: sin límite de peso en el manual (§7.2). */
  massKg: number;
  /** SUPUESTOS de manejo. */
  maxSpeed: number;
  maxAccel: number;
  maxOmega: number;
  /** Coeficiente de tracción rueda–alfombra. */
  traction: number;
  /** Piezas que lleva: 1 en la garra (el pivote); más de 1 solo con hopper. El manual no pone límite de posesión: SUPUESTO de diseño. */
  capacity: number;
  /** Brazo con garra. */
  arm: ArmSpec;
  /**
   * Alturas (m, sobre la base del robot) de la punta de la garra (el fondo de la pieza), por
   * posición. 0 = piso (para agarrar); 1–3 = niveles de la Cámara (aperturas a 200/500/800 mm,
   * §3.2.3); 4 = Repisa / rendija de la Campana (≈568 mm sobre el piso desde la plataforma; 610 mm).
   */
  elevatorHeights: [number, number, number, number, number];
  /** Nivel más alto que alcanza (por defecto 3). Las posiciones de arriba repiten la de ese nivel. */
  maxLevel?: Level;
}

/** Posiciones del brazo (0 = piso, 1–3 = niveles, 4 = Repisa). */
export type ElevatorPos = 0 | 1 | 2 | 3 | 4;

/**
 * Pivote con garra (sugerencia de CAD en MDF): chasis 600 × 600 mm, pivote 110 mm adelante del centro
 * a 440 mm de la base, brazo de 500 mm (del eje al centro de la base de la pieza), guardado a 127°
 * con la precarga. Así llega al piso, a N1–N3 y a la Repisa sin salir más de 40 cm, y al inicio
 * cabe en el perímetro y bajo 100 cm (lo revisa `validateRobot`). La posición 4 (0.60 m) sirve para
 * la rendija de la Campana y para soltar sobre la Repisa desde la Plataforma. Una sola pieza a la vez.
 * El manual no da velocidad, masa ni mecanismos: esos números son SUPUESTOS configurables.
 */
export const PIVOT_ROBOT: RobotSpec = {
  name: 'Pivote',
  mechanism: 'pivot',
  length: mm(600),
  width: mm(600),
  baseHeight: mm(450),
  massKg: 40,
  maxSpeed: 3.0,
  maxAccel: 6.0,
  maxOmega: 5.5,
  traction: 1.0,
  capacity: 1,
  arm: { pivotX: mm(110), pivotY: mm(440), length: mm(500), speed: 4, stowAngle: (127 * Math.PI) / 180 },
  elevatorHeights: [0, mm(260), mm(560), mm(830), mm(600)],
};

/** Eje y brazo de la variante de 180° (SUPUESTOS de diseño, ver `PIVOT_180_ROBOT`). */
const ARM_180 = { pivotX: mm(120), pivotY: mm(420), length: mm(500) };

/**
 * Pivote 180° (variante pedida por Xhavi, 27-oct): el mismo pivote, pero el brazo solo gira 180°, del
 * piso (−57°) a guardado arriba y atrás (123°). Con el eje del pivote original (440 mm) la precarga
 * guardada a ese ángulo pasaría de 100 cm (§7.2), así que el eje baja a 420 mm y se adelanta a
 * 120 mm del centro: guardado, la Muestra llega a 99 cm y queda dentro del perímetro (§4.1), y sigue
 * alcanzando N3 y la Repisa sin salir más de 40 cm. Alturas de cada posición: las del pivote.
 */
export const PIVOT_180_ROBOT: RobotSpec = {
  ...PIVOT_ROBOT,
  name: 'Pivote 180°',
  mechanism: 'pivot180',
  arm: { ...PIVOT_ROBOT.arm, ...ARM_180, stowAngle: Math.asin(-ARM_180.pivotY / ARM_180.length) + Math.PI },
};

/** Robot por defecto (el del menú la primera vez). */
export const DEFAULT_ROBOT = PIVOT_ROBOT;

export const ROBOT_PRESETS: Record<MechanismKind, RobotSpec> = {
  pivot: PIVOT_ROBOT,
  pivot180: PIVOT_180_ROBOT,
};

/**
 * Un `RobotSpec` guardado (repeticiones) de un tipo que ya no existe (genérico, elevador, torre,
 * chasis, pivote con hopper; quitados el 27-oct) se dibuja como pivote, con su nombre.
 */
export function knownSpec(s: RobotSpec): RobotSpec {
  if (MECHANISM_KINDS.includes(s.mechanism) && s.arm) return s;
  return { ...PIVOT_ROBOT, label: s.label ?? s.name };
}

/** Grados que recorre el brazo del piso a guardado (189° el pivote, 180° la variante). */
export const armTravelDeg = (s: RobotSpec): number => Math.round(((s.arm.stowAngle ?? s.arm.hopperAngle ?? Math.PI) - armAngle(s.arm, s.elevatorHeights[0])) * (180 / Math.PI));

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
  if (s.baseHeight > ROBOT_LIMITS.maxHeight + 1e-9) out.push('más alto que 100 cm (§7.2)');
  if (s.capacity < 1) out.push('la garra lleva al menos una pieza');
  for (const h of s.elevatorHeights) {
    const tip = armTip(s.arm, armAngle(s.arm, h));
    // La pieza agarrada (hasta la Crítica, 200 mm) cuenta como parte del robot
    if (tip.x + pieceSize / 2 - s.length / 2 > ROBOT_LIMITS.maxExtension + 1e-9) {
      out.push('la garra sale más de 40 cm (§7.2)');
      break;
    }
  }
  // Con la garra arriba y una pieza, el robot no puede pasar de 100 cm (§7.2, D24)
  if (s.elevatorHeights[3] + mm(150) > ROBOT_LIMITS.maxHeight + 1e-9) out.push('garra en N3 + Muestra pasa de 100 cm (§7.2)');
  if (s.elevatorHeights[4] + pieceSize > ROBOT_LIMITS.maxHeight + 1e-9) out.push('garra + Muestra Crítica pasa de 100 cm (§7.2)');
  // Guardado al inicio con la precarga (150 mm): dentro del perímetro y bajo 100 cm (§4.1, §7.2)
  const st = armTip(s.arm, s.arm.stowAngle ?? armAngle(s.arm, s.elevatorHeights[0]));
  const half = mm(150) / 2;
  if (st.x + half > s.length / 2 + 1e-9 || st.x - half < -s.length / 2 - 1e-9 || st.y + mm(150) > ROBOT_LIMITS.maxHeight + 1e-9)
    out.push('el brazo guardado no cabe en el perímetro al inicio (§4.1)');
  // Con hopper (capacidad > 1) el brazo pasa por arriba con una Muestra cada vez que la guarda (D24)
  if (s.capacity > 1) {
    if (s.arm.pivotY + s.arm.length + mm(150) > ROBOT_LIMITS.maxHeight + 1e-9) out.push('el brazo con la Muestra pasa de 100 cm al pasar por arriba (§7.2)');
    const ht = armTip(s.arm, s.arm.hopperAngle ?? Math.PI);
    if (-ht.x + half - s.length / 2 > ROBOT_LIMITS.maxExtension + 1e-9) out.push('la boca del hopper deja la garra más de 40 cm atrás (§7.2)');
  }
  return out;
}
