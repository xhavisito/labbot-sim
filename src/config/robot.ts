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
 * Tipo de mecanismo para anotar (ideas del equipo; el manual no fija mecanismos, §7.2):
 * - generic: elevador al frente con depósito que sale hacia adelante.
 * - elevator: intake al frente, tolva y una plataforma que sube y empuja las Muestras por atrás.
 * - pivot: brazo con garra en un pivote; toma una pieza a la vez del piso y la suelta al frente.
 * - tower: torre fija de ruedas (sin carro que suba): sube varias Muestras a una salida fija atrás,
 *   a la altura del Nivel 3, y lleva una pala al frente para la Muestra Crítica.
 * - chassis: la base común de las sugerencias, sin mecanismo para anotar (mínimo viable): lleva la
 *   precarga sin soltarla, cruza la línea y sube a la Plataforma.
 * Pivote, torre y chasis siguen las sugerencias de CAD en MDF de 5.5 mm (§7.1); el elevador se
 * descartó para construir en MDF, pero se queda aquí para comparar.
 */
export type MechanismKind = 'generic' | 'elevator' | 'pivot' | 'tower' | 'chassis';
export const MECHANISM_KINDS: readonly MechanismKind[] = ['generic', 'elevator', 'pivot', 'tower', 'chassis'];

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
}

export interface RobotSpec {
  name: string;
  /** Nombre a mostrar (robots de referencia de FIRST); si no hay, se usa el nombre del tipo. */
  label?: string;
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
  /** Solo `tower`: altura fija (fondo de la pieza, m sobre la base) de la salida de las Muestras, atrás. */
  sampleExit?: number;
  /** Solo `tower`: alcance de la pala de la Crítica más allá del frente del chasis (≤ 0.40 m). */
  critReach?: number;
  /** Velocidad del elevador (m/s); en `tower`, de la pala de la Crítica. */
  elevatorSpeed: number;
  /**
   * Alturas (m, sobre la base del robot) del fondo de la pieza al soltarla, por posición.
   * 0 = guardado; 1–3 = niveles de la Cámara (aperturas a 200/500/800 mm, §3.2.3);
   * 4 = Repisa / rendija de la Campana (≈568 mm sobre el piso desde la plataforma; 610 mm).
   * En `pivot` es la altura de la punta de la garra, y la posición 0 es el piso (para agarrar).
   * En `tower` solo mueven la pala de la Crítica (las Muestras salen siempre por `sampleExit`).
   */
  elevatorHeights: [number, number, number, number, number];
  /** Nivel más alto que alcanza (por defecto 3). Las posiciones de arriba repiten la de ese nivel. */
  maxLevel?: Level;
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
 * Pivote con garra (sugerencia de CAD en MDF): chasis 600 × 600 mm, pivote 110 mm adelante del centro
 * a 440 mm de la base, brazo de 500 mm (del eje al centro de la base de la pieza), guardado a 127°
 * con la precarga. Así llega al piso, a N1–N3 y a la Repisa sin salir más de 40 cm, y al inicio
 * cabe en el perímetro y bajo 100 cm (lo revisa `validateRobot`). La posición 4 (0.60 m) sirve para
 * la rendija de la Campana y para soltar sobre la Repisa desde la Plataforma. Una sola pieza a la vez.
 */
export const PIVOT_ROBOT: RobotSpec = {
  ...DEFAULT_ROBOT,
  name: 'Pivote',
  mechanism: 'pivot',
  length: mm(600),
  width: mm(600),
  capacity: 1,
  reach: 0,
  intake: { extension: 0, width: mm(300) },
  arm: { pivotX: mm(110), pivotY: mm(440), length: mm(500), speed: 4, stowAngle: (127 * Math.PI) / 180 },
  elevatorHeights: [0, mm(260), mm(560), mm(830), mm(600)],
};

/**
 * Torre fija a Nivel 3 (sugerencia de CAD en MDF): chasis 600 × 600 mm, intake al frente, columna de
 * ruedas que guarda hasta 5 Muestras (el manual no limita la posesión: SUPUESTO) y las saca atrás a
 * 830 mm por una rampa de 30 cm; se anota de reversa. La Crítica (200 mm) no cabe en la columna: la
 * lleva una pala al frente que sube a la rendija o a la Repisa.
 */
export const TOWER_ROBOT: RobotSpec = {
  ...DEFAULT_ROBOT,
  name: 'Torre',
  mechanism: 'tower',
  length: mm(600),
  width: mm(600),
  baseHeight: mm(950),
  capacity: 5,
  intake: { extension: mm(250), width: mm(450) },
  reach: mm(300),
  sampleExit: mm(830),
  critReach: mm(250),
  elevatorSpeed: 1.0,
  elevatorHeights: [mm(100), mm(260), mm(560), mm(600), mm(600)],
};

/**
 * Chasis tanque de la base común (sugerencia de CAD en MDF, mínimo viable): 600 × 600 mm, 6 ruedas de
 * 6 in con la central baja y 4 CIM a ~12.75:1 (~2.7 m/s reales). Sin mecanismo para anotar: lleva
 * la precarga (§4.1) sin soltarla y da 5 por la línea en AUTO y 10/20 por la Plataforma (§4.4).
 * SUPUESTOS: ~30 kg (el documento estima 25–35 kg) y 30 cm de alto (batería y main breaker arriba, §7.1).
 */
export const CHASSIS_ROBOT: RobotSpec = {
  ...DEFAULT_ROBOT,
  name: 'Chasis',
  mechanism: 'chassis',
  length: mm(600),
  width: mm(600),
  baseHeight: mm(300),
  massKg: 30,
  maxSpeed: 2.7,
  capacity: 1,
  intake: { extension: 0, width: 0 },
  reach: 0,
  elevatorHeights: [mm(100), mm(100), mm(100), mm(100), mm(100)],
};

export const ROBOT_PRESETS: Record<MechanismKind, RobotSpec> = {
  generic: DEFAULT_ROBOT,
  elevator: ELEVATOR_ROBOT,
  pivot: PIVOT_ROBOT,
  tower: TOWER_ROBOT,
  chassis: CHASSIS_ROBOT,
};

/** Capacidad fija del tipo (la garra del pivote lleva una pieza; el chasis solo la precarga), o null si es ajustable. */
export function fixedCapacity(kind: MechanismKind): number | null {
  return kind === 'pivot' || kind === 'chassis' ? 1 : null;
}

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
    else {
      for (const h of s.elevatorHeights) {
        const tip = armTip(s.arm, armAngle(s.arm, h));
        // La pieza agarrada (hasta la Crítica, 200 mm) cuenta como parte del robot
        if (tip.x + pieceSize / 2 - s.length / 2 > ROBOT_LIMITS.maxExtension + 1e-9) {
          out.push('la garra sale más de 40 cm (§7.2)');
          break;
        }
      }
      // Guardado al inicio con la precarga (150 mm): dentro del perímetro y bajo 100 cm (§4.1, §7.2)
      const st = armTip(s.arm, s.arm.stowAngle ?? armAngle(s.arm, s.elevatorHeights[0]));
      const half = mm(150) / 2;
      if (st.x + half > s.length / 2 + 1e-9 || st.x - half < -s.length / 2 - 1e-9 || st.y + mm(150) > ROBOT_LIMITS.maxHeight + 1e-9)
        out.push('el brazo guardado no cabe en el perímetro al inicio (§4.1)');
    }
  }
  if (s.mechanism === 'tower') {
    const exit = s.sampleExit ?? 0;
    if (exit + mm(150) > ROBOT_LIMITS.maxHeight + 1e-9) out.push('salida de la torre + Muestra pasa de 100 cm (§7.2)');
    if ((s.critReach ?? 0) > ROBOT_LIMITS.maxExtension + 1e-9) out.push('pala sale más de 40 cm (§7.2)');
  }
  return out;
}
