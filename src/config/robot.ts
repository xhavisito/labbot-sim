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
 * Tipos de robot del simulador (27-oct, a pedido de Xhavi solo quedan los pivotes con hopper; el
 * manual no fija mecanismos, §7.2):
 * - pivotHopper: pivote con hopper (idea del equipo, 26-oct): brazo con garra entre dos paredes altas
 *   de un hopper que guarda varias Muestras. La garra toma una del piso y la pasa al hopper; para
 *   anotar, el brazo saca la siguiente del hopper y la suelta al frente en N1–N3. Lleva la Muestra
 *   Crítica en la garra aunque traiga Muestras en el hopper. El brazo recorre 243° (piso adelante →
 *   boca del hopper atrás, a 180°).
 * - pivotHopper180: la misma máquina, pero el brazo solo gira 180° (del piso a 117°): la boca del
 *   hopper queda arriba del centro y la garra deja caer la Muestra desde ahí (SUPUESTO de diseño).
 * Ambos siguen la sugerencia de CAD en MDF de 5.5 mm (§7.1, `docs/pivote-hopper.md`).
 */
export type MechanismKind = 'pivotHopper' | 'pivotHopper180';
export const MECHANISM_KINDS: readonly MechanismKind[] = ['pivotHopper', 'pivotHopper180'];

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
  /** Altura de la estructura fija (las paredes del hopper; sin el brazo). */
  baseHeight: number;
  /** SUPUESTO: sin límite de peso en el manual (§7.2). */
  massKg: number;
  /** SUPUESTOS de manejo. */
  maxSpeed: number;
  maxAccel: number;
  maxOmega: number;
  /** Coeficiente de tracción rueda–alfombra. */
  traction: number;
  /** Muestras que puede guardar: 1 en la garra y el resto en el hopper. El manual no pone límite de posesión: SUPUESTO de diseño. */
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
 * Pivote con hopper (dibujo del equipo, 26-oct; sugerencia de CAD en MDF en
 * `docs/pivote-hopper.md`): chasis 600 × 600 mm; hopper con dos paredes altas a los lados (600 mm:
 * con más, la superestructura de la física chocaba con la Cámara al acomodarse) y un canal al centro
 * por donde pasa el brazo. El hopper guarda 4 Muestras y la garra 1
 * (capacidad 5; el manual no limita la posesión, §4.1: SUPUESTO de diseño).
 * El brazo pasa por arriba cada vez que guarda una Muestra, así que se diseñó para que la punta con
 * la Muestra nunca pase de 100 cm (§7.2, D24): eje 290 mm adelante del centro (1 cm detrás del
 * frente) a 400 mm de la base y brazo de 450 mm (400 + 450 + 150 = 1000 mm). Con ese brazo:
 * - piso: la garra toma la Muestra 12 cm delante del chasis;
 * - N1 y N2: suelta desde 740 mm (cae dentro del pozo; más bajo, la garra saldría más de 40 cm);
 * - N3: suelta a 820 mm, 15 cm delante del chasis (apertura a 800 mm, §3.2.3);
 * - posición 4 (730 mm): rendija de la Campana y Repisa desde la Plataforma (Crítica 200 mm → 93 cm);
 * - la garra solo abre al soltar (sin empujón, `Mechanisms.release`);
 * - boca del hopper y guardado al inicio a 180° (garra horizontal hacia atrás, dentro del chasis).
 * Tiempos de paso al hopper (0.25 s) y velocidad del brazo (4.5 rad/s): SUPUESTOS.
 * El manual no da velocidad, masa ni mecanismos: esos números son SUPUESTOS configurables.
 */
export const PIVOT_HOPPER_ROBOT: RobotSpec = {
  name: 'Pivote con hopper',
  mechanism: 'pivotHopper',
  length: mm(600),
  width: mm(600),
  baseHeight: mm(600),
  // Masa estimada con el editor (MDF ≈ 2.3 m², 4 + 4 motores, batería, tracción)
  massKg: 31,
  maxSpeed: 3.0,
  maxAccel: 6.0,
  maxOmega: 5.5,
  traction: 1.0,
  capacity: 5,
  arm: { pivotX: mm(290), pivotY: mm(400), length: mm(450), speed: 4.5, stowAngle: Math.PI, hopperAngle: Math.PI, transferTime: 0.25 },
  elevatorHeights: [0, mm(740), mm(740), mm(820), mm(730)],
};

/** Ángulo del brazo del pivote con hopper en el piso (−62.7°): de ahí cuentan los 180° de la variante. */
const FLOOR_ANGLE = Math.asin(-PIVOT_HOPPER_ROBOT.arm.pivotY / PIVOT_HOPPER_ROBOT.arm.length);

/**
 * Pivote con hopper de 180° (variante pedida por Xhavi, 27-oct): el mismo chasis, hopper, brazo y
 * alturas, pero el brazo solo gira 180°: del piso (−62.7°) a la boca del hopper a 117.3°, arriba
 * del centro del robot (punta a 800 mm, la Muestra llega a 950 mm: cabe bajo los 100 cm, §7.2).
 * La garra deja caer ahí la Muestra al hopper y de ahí la toma de vuelta, así que cada Muestra que
 * guarda es media vuelta (180°) en lugar de 243°, y sacar la siguiente desde N3 son 48° en vez de
 * 111°. Al inicio el brazo también va a 117.3° con la precarga, dentro del perímetro (§4.1).
 * SUPUESTO de diseño: que el hopper reciba y regrese la Muestra por arriba (un indexador que la sube
 * a la garra); conviene prototiparlo antes de elegir esta versión.
 */
export const PIVOT_HOPPER_180_ROBOT: RobotSpec = {
  ...PIVOT_HOPPER_ROBOT,
  name: 'Pivote con hopper 180°',
  mechanism: 'pivotHopper180',
  arm: { ...PIVOT_HOPPER_ROBOT.arm, stowAngle: FLOOR_ANGLE + Math.PI, hopperAngle: FLOOR_ANGLE + Math.PI },
};

/** Robot por defecto (el del menú la primera vez). */
export const DEFAULT_ROBOT = PIVOT_HOPPER_ROBOT;

export const ROBOT_PRESETS: Record<MechanismKind, RobotSpec> = {
  pivotHopper: PIVOT_HOPPER_ROBOT,
  pivotHopper180: PIVOT_HOPPER_180_ROBOT,
};

/**
 * Un `RobotSpec` guardado (repeticiones) de un tipo que ya no existe (genérico, elevador, pivote,
 * torre, chasis; quitados el 27-oct) se dibuja como pivote con hopper, con su nombre.
 */
export function knownSpec(s: RobotSpec): RobotSpec {
  if (MECHANISM_KINDS.includes(s.mechanism) && s.arm) return s;
  return { ...PIVOT_HOPPER_ROBOT, label: s.label ?? s.name };
}

/** Grados que recorre el brazo del piso a la boca del hopper (243° o 180°). */
export const armTravelDeg = (s: RobotSpec): number => Math.round(((s.arm.hopperAngle ?? Math.PI) - armAngle(s.arm, s.elevatorHeights[0])) * (180 / Math.PI));

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
  if (s.capacity < 2) out.push('el hopper debe guardar al menos una Muestra');
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
  // Pasa por arriba con una Muestra cada vez que la guarda: la punta más alta es pivotY + largo (D24)
  if (s.arm.pivotY + s.arm.length + mm(150) > ROBOT_LIMITS.maxHeight + 1e-9) out.push('el brazo con la Muestra pasa de 100 cm al pasar por arriba (§7.2)');
  const ht = armTip(s.arm, s.arm.hopperAngle ?? Math.PI);
  if (-ht.x + half - s.length / 2 > ROBOT_LIMITS.maxExtension + 1e-9) out.push('la boca del hopper deja la garra más de 40 cm atrás (§7.2)');
  return out;
}
