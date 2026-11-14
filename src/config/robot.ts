/**
 * Especificación de un robot y sus límites según el manual (§7.2, §4.1). El manual no da
 * velocidad, masa ni mecanismos: esos números son SUPUESTOS configurables.
 */
import type { Level } from '../core/types';
import { SAMPLE_SIZE, mm } from './field';

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
 * - pivot: pivote con garra (sugerencia de CAD en MDF): brazo de 51 cm que agarra una Muestra del
 *   piso y la suelta al frente en N1–N3, o lleva la Muestra Crítica. Una pieza a la vez.
 * - pivot180: pivote que voltea el brazo por arriba (como Jack in the Bot, FRC 2025): recoge del
 *   piso atrás y anota al frente en N1–N3 sin girar el chasis. Eje bajo y adelante del centro, brazo
 *   largo (SUPUESTO de diseño, ver `PIVOT_180_ROBOT`).
 * Variedad para comparar mecanismos con la misma estrategia (2-nov, a pedido de Xhavi):
 * - longarm: brazo largo con eje atrás y bajo; se pliega (telescópico) para caber al inicio.
 * - elevator: elevador vertical con el carro de la garra al frente (sube recto, sin arco).
 * - dual: doble intake: la garra y un hopper de una Muestra; lleva dos a la vez.
 * Todos son SUPUESTOS de diseño dentro de §7.2 (65 × 65 cm, 100 cm de alto, 40 cm de extensión).
 */
export type MechanismKind = 'pivot' | 'pivot180' | 'longarm' | 'elevator' | 'dual';
export const MECHANISM_KINDS: readonly MechanismKind[] = ['pivot', 'pivot180', 'longarm', 'elevator', 'dual'];

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
   * La garra misma lleva hasta `capacity` Muestras a la vez (la caja con rodillos de Psycho: en fila sobre el eje de la boca, `seatX`):
   * no hay hopper ni paso; sigue agarrando mientras quepa otra y suelta de una en una.
   */
  holdsTwo?: boolean;
  /**
   * Recoge atrás: el piso (0) y la posición 4 (Crítica y Repisa) quedan detrás del robot y en N1–N3
   * el brazo voltea por arriba para soltar al frente.
   */
  pickBack?: boolean;
  /**
   * Elevador: la punta no hace un arco sino que sube recto. `length` es la mitad del recorrido y el
   * ángulo (−π/2…π/2) lo recorre de forma lineal: y = pivotY + length·(2a/π), x = pivotX.
   */
  linear?: boolean;
  /**
   * Punta (x, y locales) con el brazo plegado: con ángulos mayores a π/2 (el de guardado es π) la
   * punta pasa linealmente de la posición con el brazo arriba (π/2) a esta. Lo usa el brazo largo y el
   * elevador para caber en el perímetro al inicio (§4.1) sin salirse de §7.2 al trabajar.
   */
  stowTip?: { x: number; y: number };
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
  /** Intake de la garra (constructor de robots); sin él, la garra de siempre (`DEFAULT_INTAKE`). */
  intake?: IntakeSpec;
  /** Modelo 3D del CAD (`npm run robot:import`): se dibuja en lugar del robot genérico. */
  model?: CadModel;
  /**
   * Huella del chasis en el piso: cajas `[x0, x1, z0, z1]` (m, sistema del robot). Sin ella, una caja
   * `length × width`. Con ella lo hueco (un canal entre rieles) deja pasar Muestras.
   */
  footprint?: ReadonlyArray<readonly [number, number, number, number]>;
  /**
   * Ruedas de tracción del CAD (Psycho, fotos de Xhavi 14-nov: ruedas blancas de hule con dibujo de bloques,
   * disco negro, buje de aluminio con eje hexagonal y polea dentada del lado de adentro). Sin esto, el robot
   * usa 4 esferas genéricas de 5 cm de radio. Medidas de las fotos aproximadas: SUPUESTO hasta que Xhavi las confirme.
   */
  wheel?: WheelSpec;
}

/** Ruedas de tracción del CAD: radio, posiciones a lo largo del robot (por lado), distancia del centro a cada rueda y ancho (m). */
/** Cuánto sobresale la llanta por debajo del chasis (m): el robot apoya en ellas, no en el chasis. SUPUESTO (2 cm). */
export const WHEEL_DROP = 0.02;

export interface WheelSpec {
  r: number;
  xs: number[];
  z: number;
  width: number;
}

/**
 * GLB del robot en su sistema (m, x al frente, y arriba desde el piso): nodo `estatico` y nodo `brazo`
 * (origen en el eje del pivote; en el CAD está en la pose de guardado, `stowAngle`).
 */
export interface CadModel {
  url: string;
  stowAngle?: number;
  /** Expresión regular: piezas que toman el color de la alianza. */
  tint?: string;
  /**
   * Expresión regular: piezas del CAD que van pegadas al brazo aunque el archivo las tenga fijas en el
   * chasis (en Psycho, el Kraken X44 del gripper: Xhavi, 13-nov "va pegado en el gripper").
   */
  armParts?: string;
}

/**
 * Intake de la garra (constructor de robots, Xhavi 2-nov). El manual no fija mecanismos (§7.2): todo
 * es SUPUESTO de diseño, con los límites que sí da el manual (40 cm de extensión y 100 cm de altura,
 * §7.2; motores, §7.3; medidas de las piezas, §4.1.1).
 * - `compliant`: garra con ruedas flexibles en la boca de los dedos (la de siempre, D37): jala la
 *   Muestra de cualquier ángulo y la empuja al soltar. Más rápidas las ruedas, cierra antes y empuja
 *   más fuerte (`rollerSpeed`).
 * - `pinza`: garra sin ruedas que cierra (servo o neumática): la Muestra tiene que entrar derecha
 *   hasta la placa y tarda `closeTime` en cerrar (el agarre "Preciso" de D36), sin empujón al soltar.
 */
export type IntakeKind = 'compliant' | 'pinza';
export const INTAKE_KINDS: readonly IntakeKind[] = ['compliant', 'pinza'];

export interface IntakeSpec {
  kind: IntakeKind;
  /** Espacio libre entre los dedos (m). La Muestra mide 150 mm y la Crítica 200 mm (±5, §4.1.1). */
  gap: number;
  /** Largo de los dedos (m), a lo largo del robot. Cuenta para los 40 cm de extensión (§7.2). */
  fingerLength: number;
  /** Ruedas de los compliants (m/s en la superficie): velocidad con la que empujan al soltar. */
  rollerSpeed: number;
  /** Pinza: segundos que tarda en cerrar con la Muestra adentro. */
  closeTime: number;
  /**
   * Garra-caja con rodillos (Psycho, robot real de Xhavi): ejes de lado a lado con ruedas arriba y
   * abajo de la Muestra que la jalan por fricción hasta el fondo (`ROLLERS` en `game/Mechanisms.ts`).
   * Las Muestras quedan en fila sobre el eje de la boca: la primera recargada en la placa del fondo y
   * la segunda detrás de ella (`seatX`).
   */
  rollers?: boolean;
  /**
   * Sin mecanismo para la Muestra Crítica (Psycho todavía no lo tiene, Xhavi 13-nov): no la toma, no la
   * cuenta como suya y la IA y el HUD lo tratan así. Quitar la bandera la vuelve a activar.
   */
  noCritical?: boolean;
}

/** Intake de los dos pivotes: garra con compliants, abierta 23 cm, dedos de 20 cm (D36, D37, D41). */
export const DEFAULT_INTAKE: IntakeSpec = { kind: 'compliant', gap: mm(230), fingerLength: mm(200), rollerSpeed: 1.0, closeTime: 0.18 };

/** Rangos que acepta el constructor (SUPUESTOS de diseño, fuera de ellos no tiene sentido construirla). */
export const INTAKE_RANGE = {
  gap: [mm(140), mm(340)],
  fingerLength: [mm(100), mm(320)],
  rollerSpeed: [0.3, 3],
  closeTime: [0.05, 0.8],
} as const;

export const intakeOf = (s: { intake?: IntakeSpec }): IntakeSpec => s.intake ?? DEFAULT_INTAKE;

/** ¿Le cabe la Muestra Crítica (200 mm, §4.1.1) entre los dedos? Si no, la IA no la intenta. */
export const canHoldCritical = (s: { intake?: IntakeSpec }): boolean => intakeOf(s).noCritical !== true && intakeOf(s).gap >= mm(200) - 1e-9;

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

export type ClawDims = { fingerLength: number; fingerHeight: number; fingerThickness: number; fingerZ: number; palmThickness: number };

/** Medidas de la garra de un robot (las de `CLAW` con la apertura y el largo de dedos de su intake). */
export function clawOf(s: { intake?: IntakeSpec }): ClawDims {
  const i = intakeOf(s);
  return { ...CLAW, fingerLength: i.fingerLength, fingerZ: i.gap / 2 + CLAW.fingerThickness / 2 };
}

/**
 * Garra con rodillos: posición local x (sistema del robot, nivelado) del centro de la Muestra `k`
 * (0 = la del fondo, recargada en la placa; 1 = la segunda, en fila detrás de la primera, hacia la
 * boca). `dir` = hacia dónde abre la garra (`clawDir`). Con la caja de Psycho (25.5 cm de fondo) la
 * segunda sobresale 4.5 cm de la boca, como en la foto del robot real con dos Muestras.
 */
export function seatX(s: { intake?: IntakeSpec }, tipX: number, dir: number, k: number): number {
  const fl = clawOf(s).fingerLength;
  return tipX - dir * (fl / 2 - SAMPLE_SIZE / 2) + dir * k * SAMPLE_SIZE;
}

/** Agarre de la garra (`game/Mechanisms.ts`): con compliants (por defecto), preciso o fácil. */
export type GripMode = 'compliant' | 'precise' | 'easy';
export const GRIP_MODES: readonly GripMode[] = ['compliant', 'precise', 'easy'];

/** Posiciones del brazo (0 = piso, 1–3 = niveles, 4 = Repisa). */
export type ElevatorPos = 0 | 1 | 2 | 3 | 4;

/**
 * Pivote con garra (sugerencia de CAD en MDF): chasis 600 × 600 mm, pivote 110 mm adelante del centro
 * a 460 mm de la base, brazo de 510 mm (del eje al centro de la base de la pieza), guardado a 131°
 * con la precarga. Más holgura al anotar (Xhavi, 30-oct: "es muy justo el espacio"; antes eje a
 * 440 mm, brazo de 500 mm, N2 a 560 mm y N3 a 830 mm): N3 suelta a 850 mm (5 cm sobre la pared de
 * 80 cm en vez de 3; con la Muestra llega justo a 100 cm, §7.2) y 1.6 cm más adelante; N2 a 610 mm
 * para no pasar de 40 cm con el brazo más largo. La punta queda 27.9/29.7/13.9 cm delante del chasis
 * en N1/N2/N3; en el piso, 3 cm. Las ruedas de la garra la empujan al soltar (`OUTTAKE`). Así llega al piso, a N1–N3 y a la Repisa sin salir más de 40 cm, y al inicio
 * cabe en el perímetro y bajo 100 cm (lo revisa `validateRobot`). La posición 4 (0.615 m, la altura de la rendija: con la garra más abajo los dedos chocaban con su soporte, D34) sirve para
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
  arm: { pivotX: mm(110), pivotY: mm(460), length: mm(510), speed: 4, stowAngle: (131 * Math.PI) / 180 },
  elevatorHeights: [0, mm(260), mm(610), mm(850), mm(615)],
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
 * - posición 4 (615 mm, Crítica y Repisa) atrás, 11 cm fuera del chasis;
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
  elevatorHeights: [0, mm(780), mm(780), mm(820), mm(615)],
};

/**
 * Brazo largo (2-nov): eje atrás del centro y a 50 cm, brazo de 64 cm que se pliega (telescópico)
 * a un punto dentro del perímetro al inicio. Anota en N3 más lejos de la pared que el Pivote, pero
 * es más pesado y más lento. SUPUESTOS de diseño; el manual no habla de mecanismos (§7.2).
 */
export const LONG_ARM_ROBOT: RobotSpec = {
  ...PIVOT_ROBOT,
  name: 'Brazo largo',
  mechanism: 'longarm',
  massKg: 44,
  maxSpeed: 2.8,
  arm: { pivotX: mm(-50), pivotY: mm(500), length: mm(640), speed: 3.2, stowAngle: Math.PI, stowTip: { x: mm(-120), y: mm(800) } },
  elevatorHeights: [0, mm(260), mm(610), mm(850), mm(615)],
};

/**
 * Elevador (2-nov): carro de la garra 58 cm al frente del centro sobre una torre vertical de 1 m de
 * recorrido total; sube recto y llega al piso, a N1–N3 y a la Repisa sin arco. Al inicio el carro
 * se recoge dentro del perímetro (`stowTip`). Más rápido y preciso que un brazo, pero más alto y
 * pesado (SUPUESTOS de diseño, §7.2).
 */
export const ELEVATOR_ROBOT: RobotSpec = {
  ...PIVOT_ROBOT,
  name: 'Elevador',
  mechanism: 'elevator',
  baseHeight: mm(300),
  massKg: 46,
  maxSpeed: 2.9,
  arm: { pivotX: mm(580), pivotY: mm(500), length: mm(500), speed: 3.8, stowAngle: Math.PI, stowTip: { x: mm(200), y: mm(500) }, linear: true },
  elevatorHeights: [0, mm(260), mm(610), mm(850), mm(615)],
};

/**
 * Doble intake (2-nov): la garra más un hopper de una Muestra; lleva dos a la vez (la garra agarra
 * del piso, la pasa a la boca del hopper atrás y toma la siguiente). Menos viajes a la Cámara y a la
 * Campana, a cambio de un brazo más corto y ciclos de paso (SUPUESTOS de diseño, §7.2).
 */
export const DUAL_INTAKE_ROBOT: RobotSpec = {
  ...PIVOT_ROBOT,
  name: 'Doble intake',
  mechanism: 'dual',
  baseHeight: mm(600),
  massKg: 34,
  capacity: 2,
  arm: { pivotX: mm(290), pivotY: mm(400), length: mm(450), speed: 4.5, stowAngle: Math.PI, hopperAngle: Math.PI, transferTime: 0.25 },
  elevatorHeights: [0, mm(740), mm(740), mm(820), mm(730)],
};

/** Robot por defecto (el del menú la primera vez). */
export const DEFAULT_ROBOT = PIVOT_ROBOT;

export const ROBOT_PRESETS: Record<MechanismKind, RobotSpec> = {
  pivot: PIVOT_ROBOT,
  pivot180: PIVOT_180_ROBOT,
  longarm: LONG_ARM_ROBOT,
  elevator: ELEVATOR_ROBOT,
  dual: DUAL_INTAKE_ROBOT,
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
  if (arm.linear) return Math.max(-Math.PI / 2, Math.min(Math.PI / 2, ((h - arm.pivotY) / arm.length) * (Math.PI / 2)));
  return Math.asin(Math.max(-1, Math.min(1, (h - arm.pivotY) / arm.length)));
}

/** Punta del brazo (local x, y) con el ángulo `a`. */
export function armTip(arm: ArmSpec, a: number): { x: number; y: number } {
  const arc = (b: number) =>
    arm.linear
      ? { x: arm.pivotX, y: arm.pivotY + arm.length * ((2 * b) / Math.PI) }
      : { x: arm.pivotX + arm.length * Math.cos(b), y: arm.pivotY + arm.length * Math.sin(b) };
  if (arm.stowTip && a > Math.PI / 2) {
    const k = Math.min(1, (a - Math.PI / 2) / (Math.PI / 2));
    const up = arc(Math.PI / 2);
    return { x: up.x + (arm.stowTip.x - up.x) * k, y: up.y + (arm.stowTip.y - up.y) * k };
  }
  return arc(a);
}

/** Revisa los límites de §7.2. Devuelve la lista de problemas (vacía si cumple). */
export function validateRobot(s: RobotSpec, pieceSize = mm(200)): string[] {
  const out: string[] = [];
  if (s.length > ROBOT_LIMITS.maxChassis + 1e-9 || s.width > ROBOT_LIMITS.maxChassis + 1e-9) out.push('chasis mayor a 65 × 65 cm (§7.2)');
  if (s.baseHeight > ROBOT_LIMITS.maxHeight + 1e-9) out.push('más alto que 100 cm (§7.2)');
  if (s.capacity < 1) out.push('la garra lleva al menos una pieza');
  // Lo que más sale de la punta: la pieza agarrada (hasta la Crítica, 200 mm, parte del robot) o los dedos
  const reach = Math.max(pieceSize, clawOf(s).fingerLength) / 2;
  for (const pos of [0, 1, 2, 3, 4] as const) {
    const tip = posTip(s, pos);
    if (Math.abs(tip.x) + reach - s.length / 2 > ROBOT_LIMITS.maxExtension + 1e-9) {
      out.push('la garra sale más de 40 cm (§7.2)');
      break;
    }
  }
  // Con la garra arriba y una pieza, el robot no puede pasar de 100 cm (§7.2, D24)
  if (s.elevatorHeights[3] + mm(150) > ROBOT_LIMITS.maxHeight + 1e-9) out.push('garra en N3 + Muestra pasa de 100 cm (§7.2)');
  if (s.elevatorHeights[4] + pieceSize > ROBOT_LIMITS.maxHeight + 1e-9) out.push('garra + Muestra Crítica pasa de 100 cm (§7.2)');
  // Guardado al inicio con la precarga (150 mm): dentro del perímetro y bajo 100 cm (§4.1, §7.2)
  const st = armTip(s.arm, s.arm.stowAngle ?? armAngle(s.arm, s.elevatorHeights[0]));
  // Dedos más largos que los de siempre (20 cm, ya cubiertos por el diseño base) también deben caber
  const half = (mm(150) + Math.max(0, clawOf(s).fingerLength - DEFAULT_INTAKE.fingerLength)) / 2;
  if (st.x + half > s.length / 2 + 1e-9 || st.x - half < -s.length / 2 - 1e-9 || st.y + mm(150) > ROBOT_LIMITS.maxHeight + 1e-9)
    out.push('el brazo guardado no cabe en el perímetro al inicio (§4.1)');
  // Con hopper (capacidad > 1) el brazo pasa por arriba con una Muestra cada vez que la guarda (D24)
  if (s.capacity > 1 && !s.arm.holdsTwo) {
    if (s.arm.pivotY + s.arm.length + mm(150) > ROBOT_LIMITS.maxHeight + 1e-9) out.push('el brazo con la Muestra pasa de 100 cm al pasar por arriba (§7.2)');
    const ht = armTip(s.arm, s.arm.hopperAngle ?? Math.PI);
    if (-ht.x + half - s.length / 2 > ROBOT_LIMITS.maxExtension + 1e-9) out.push('la boca del hopper deja la garra más de 40 cm atrás (§7.2)');
  }
  return out;
}
