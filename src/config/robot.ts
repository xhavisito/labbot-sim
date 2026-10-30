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
 * - pivot180: pivote que voltea el brazo por arriba (como Jack in the Bot, FRC 2025): recoge del
 *   piso atrás y anota al frente en N1–N3 sin girar el chasis. Eje bajo y adelante del centro, brazo
 *   largo (SUPUESTO de diseño, ver `PIVOT_180_ROBOT`).
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
  /**
   * Recoge atrás: el piso (0) y la posición 4 (Crítica y Repisa) quedan detrás del robot y en N1–N3
   * el brazo voltea por arriba para soltar al frente.
   */
  pickBack?: boolean;
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

/**
 * Garra (la misma medida en la física y en el dibujo). SUPUESTO de diseño: dos dedos de 20 × 16 cm
 * a los lados de la pieza, abiertos 23 cm (cabe la Muestra Crítica de 20 cm; la Muestra mide 15 cm,
 * §4.1.1; girada 45° mide 21 cm) y una placa del lado del brazo que la detiene. Para cerrar, la
 * Muestra tiene que estar casi derecha (`GRIP.maxYaw` en `game/Mechanisms.ts`). Todo nivelado con
 * el robot (como en el dibujo), con el centro en la punta del brazo.
 */
export const CLAW = {
  /** Largo de los dedos (a lo largo del robot). */
  fingerLength: mm(200),
  fingerHeight: mm(160),
  fingerThickness: mm(20),
  /** Distancia del centro de la garra al centro de cada dedo. */
  fingerZ: mm(125),
  palmThickness: mm(20),
} as const;
/** Espacio libre entre los dedos (m). */
export const CLAW_GAP = 2 * CLAW.fingerZ - CLAW.fingerThickness;

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

/**
 * Pivote 180° (variante pedida por Xhavi, 27-oct, "como Jack in the Bot 2025"; volteado el 29-oct a
 * su pedido: "que cuando avance a enfrente el frente sea donde se acomoda para anotar"): recoge del
 * piso atrás y voltea el brazo por arriba para anotar al frente, sin girar el chasis entre recoger y
 * anotar. Llega a la Cámara de frente; recoge de reversa.
 * Geometría (SUPUESTOS de diseño, buscada para cumplir §7.2 en cada posición):
 * - eje 150 mm delante del centro y a 170 mm de la base; brazo de 710 mm;
 * - piso (194°): la Muestra 24 cm detrás del chasis;
 * - N1 y N2 (780 mm) y N3 (820 mm), al frente: la Muestra cae al pozo desde arriba, 21 y 14 cm
 *   delante del chasis (N1 y N2 se sueltan desde arriba: más abajo la garra saldría más de 40 cm);
 * - posición 4 (600 mm, Crítica y Repisa) atrás, 11 cm fuera del chasis;
 * - guardado a 107° con la precarga: dentro del perímetro y a 99.9 cm (§4.1).
 * Del piso a N3 el brazo recorre ~128°. Al pasar por la vertical con una Muestra llega a 103 cm. Con
 * un brazo que voltea no hay forma de recoger de un lado, anotar en N3 del otro y llegar a la Crítica
 * sin pasar de 100 cm en ese instante; el manual no aclara si §7.2 vale con mecanismos en movimiento
 * (D24): SUPUESTO de que se permite al voltear (verificar con los jueces antes de construirlo).
 */
export const PIVOT_180_ROBOT: RobotSpec = {
  ...PIVOT_ROBOT,
  name: 'Pivote 180°',
  mechanism: 'pivot180',
  arm: { pivotX: mm(150), pivotY: mm(170), length: mm(710), speed: 4, stowAngle: (107 * Math.PI) / 180, pickBack: true },
  elevatorHeights: [0, mm(780), mm(780), mm(820), mm(600)],
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

/**
 * Ángulo del brazo en una posición: el que deja la punta a esa altura al frente, o atrás (volteado
 * por arriba) en el piso y la posición 4 si el brazo recoge atrás (`ArmSpec.pickBack`).
 */
export function posAngle(s: RobotSpec, pos: ElevatorPos): number {
  const a = armAngle(s.arm, s.elevatorHeights[pos]);
  return s.arm.pickBack && (pos === 0 || pos === 4) ? Math.PI - a : a;
}

/** +1 si en esa posición la punta queda al frente del robot, −1 si atrás. */
export const posDir = (s: RobotSpec, pos: ElevatorPos): 1 | -1 => (s.arm.pickBack && (pos === 0 || pos === 4) ? -1 : 1);

/** Punta del brazo (local x, y) en una posición. */
export const posTip = (s: RobotSpec, pos: ElevatorPos): { x: number; y: number } => armTip(s.arm, posAngle(s, pos));

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
  for (const pos of [0, 1, 2, 3, 4] as const) {
    const tip = posTip(s, pos);
    // La pieza agarrada (hasta la Crítica, 200 mm) cuenta como parte del robot
    if (Math.abs(tip.x) + pieceSize / 2 - s.length / 2 > ROBOT_LIMITS.maxExtension + 1e-9) {
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
