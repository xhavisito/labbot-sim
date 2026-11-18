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
   * Ángulo (rad) del brazo en N1–N3 si no es el que sale de la altura de la punta (`armAngle`): con más de 90° el brazo
   * pasa la vertical y la garra voltea hacia atrás (Axiom, N3 a 110°). `elevatorHeights` debe traer la altura de la punta a ese ángulo.
   */
  levelAngles?: Partial<Record<1 | 2 | 3, number>>;
  /**
   * Elevador: la punta no hace un arco sino que sube recto. `length` es la mitad del recorrido y el
   * ángulo (−π/2…π/2) lo recorre de forma lineal: y = pivotY + length·(2a/π), x = pivotX.
   */
  linear?: boolean;
  /** Elevador con la garra atrás (Phoenix: recoge de reversa por el canal trasero): la garra abre hacia −x. */
  rearClaw?: boolean;
  /** Media altura (m) de la viga del brazo para la colisión (por defecto 2 cm). Axiom: 4.9 cm, el grosor de las placas del CAD. */
  halfThickness?: number;
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
  /**
   * Hitbox por pieza del CAD (`scripts/cad/hitboxes.mjs`): un casco convexo por pieza física fija; `pts` = x,y,z
   * de ≤26 puntos de soporte (m, sistema del robot). Choca con piezas, robots, pared y madera, sin masa.
   * Con ellos no se crea la torre genérica inventada.
   */
  hitboxes?: ReadonlyArray<{ name: string; pts: readonly number[] }>;
}

/** Ruedas de tracción del CAD: radio, posiciones a lo largo del robot (por lado), distancia del centro a cada rueda y ancho (m). */
/** Cuánto sobresale la llanta por debajo del chasis (m): el robot apoya en ellas, no en el chasis. SUPUESTO (6 mm: Xhavi pidió la elevación mínima). */
export const WHEEL_DROP = 0.006;

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
  /** El modelo ya trae las llantas del CAD (estáticas): el simulador no dibuja las suyas encima. La física sí usa `RobotSpec.wheel`. */
  staticWheels?: boolean;
  /**
   * Largo del brazo (eje → centro de la garra) del CAD. Si `arm.length` es mayor (Axiom, Xhavi 16-nov), el modelo estira las
   * piezas del brazo a lo largo y recorre la garra esa diferencia.
   */
  cadArmLength?: number;
  /**
   * La garra del CAD queda a lo largo del brazo (la boca mira hacia donde apunta el brazo) y su centro es la punta (Axiom):
   * los colisionadores de la garra giran con el brazo igual que el dibujo y la Muestra queda centrada en la punta.
   */
  clawAlongArm?: boolean;
  /**
   * El CAD ya trae los compliants del intake (Hazmat 704: 4 ruedas de 3 in con eje vertical, dos apiladas por lado, en el carro):
   * se pintan de negro (como en el CAD) y giran con el intake, y el simulador no les dibuja unos rodillos genéricos encima (Xhavi, 18-nov).
   */
  cadRollers?: boolean;
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

/**
 * Garra fija de la Crítica (`IntakeSpec.critClaw`). Del CAD (Psycho, 16-nov): la placa de la garra (`Garrita-Suelo`, 11 × 23 cm, a ras del
 * frente del chasis) y el eje de cada dedo. SUPUESTOS (el CAD trae una sola pose, la abierta, y no dice cómo cierran): el cubo queda con su
 * cara de atrás en el borde de los dedos y sobre la placa (sobresale 16 cm del chasis); cada dedo gira `closeDeg` sobre su eje vertical
 * hasta tocarlo; toma la Crítica de la rendija (100–140 mm más abajo que la garra: la sube al tomarla).
 */
export interface CritClaw {
  /** Centro del cubo ya tomado (sistema del robot: x al frente, y desde la base del chasis). */
  seat: { x: number; y: number };
  /**
   * Alcance de la garra (SUPUESTO, Xhavi 17-nov: "agarrarla de donde sea si tienes garra"): la toma cuando el centro de la Crítica está
   * dentro de esta caja alrededor del asiento, sin tener que tocarla: `reachBack` hacia atrás y `reachFront` hacia adelante (m),
   * `reachZ` de lado (±), y `reachDown` / `reachUp` de altura. La garra la jala al asiento (`Mechanisms.critPull`).
   */
  reachBack: number;
  reachFront: number;
  reachZ: number;
  reachDown: number;
  reachUp: number;
  /** Ejes de los dedos (x, z locales; dos, uno por lado) y cuánto giran al cerrar sobre la Crítica (°). Solo para el dibujo. */
  shafts: Array<{ x: number; z: number }>;
  /** Giro (°) con la Crítica adentro: los dedos quedan apretándola. */
  closeDeg: number;
  /** Giro (°) al cerrar en vacío: los dos dedos chocan entre sí (como una garra de verdad, Xhavi 16-nov). SUPUESTO. */
  emptyDeg: number;
}

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
  /** Medidas reales de la garra del CAD (m) si no son las genéricas de `CLAW`: alto de los dedos, grueso de cada dedo y grueso de la placa. */
  claw?: { height?: number; thickness?: number; palm?: number };
  /**
   * Garra-caja con rodillos (Psycho, robot real de Xhavi): ejes de lado a lado con ruedas arriba y
   * abajo de la Muestra que la jalan por fricción hasta el fondo (`ROLLERS` en `game/Mechanisms.ts`).
   * Las Muestras quedan en fila sobre el eje de la boca: la primera recargada en la placa del fondo y
   * la segunda detrás de ella (`seatX`).
   */
  rollers?: boolean;
  /**
   * Velocidad (m/s, respecto al robot) con la que la garra escupe la Muestra al soltarla, en vez de la de `OUTTAKE.spit`.
   * Hazmat 704 (Xhavi, 18-nov: "las suelta muy en vertical, se supone que las escupe"): los compliants la sacan hacia adelante.
   * SUPUESTO de simulación (el manual no dice nada de mecanismos, §7.2).
   */
  spitSpeed?: number;
  /**
   * Sin mecanismo para la Muestra Crítica (Psycho no lo tenía, Xhavi 13-nov; desde el 16-nov tiene `critClaw`): no la toma, no la
   * cuenta como suya y la IA y el HUD lo tratan así. Quitar la bandera la vuelve a activar.
   */
  noCritical?: boolean;
  /**
   * La garra solo toma la Crítica si está en el piso (Axiom, Xhavi 18-nov: "no puede agarrar la critical piece desde donde la ponen,
   * solo si está en el piso"): no la toma de la rendija de la Campana, de la Repisa ni de ningún otro lugar elevado. SUPUESTO de
   * simulación (el manual no dice nada de mecanismos, §7.2). La IA no la va a buscar a la rendija.
   */
  critFloorOnly?: boolean;
  /**
   * Garra de la Crítica fija al chasis, aparte de la caja del brazo (Psycho, la "Garrita" del CAD del 16-nov: placa con dos
   * dedos de eje vertical al frente). La Crítica se toma de la rendija de la Campana con el robot de frente a ella, queda
   * en `seat` y se suelta ahí mismo (la deja caer sobre la Repisa subiendo a la Plataforma). Va sola: la caja del brazo
   * sigue llevando Muestras al mismo tiempo. Todo SUPUESTO salvo la placa (CAD): ver `CritClaw`.
   */
  critClaw?: CritClaw;
  /** Lanzador (Phoenix): en N1–N3 la Muestra sale disparada hacia la Cámara en vez de soltarse. */
  shooter?: ShooterSpec;
}

/**
 * Lanzador de ruedas (Phoenix, Xhavi 16-nov). El manual no prohíbe lanzar (§7.2 solo limita tamaño, extensión y altura):
 * todo es SUPUESTO de diseño. El ángulo es fijo; la velocidad se acomoda a la distancia al pozo (`game/shooter.ts`).
 */
export interface ShooterSpec {
  /** Ángulo de salida sobre la horizontal (rad). */
  pitch: number;
  /** Velocidad máxima de las ruedas (m/s en la salida): más allá no llega. */
  maxSpeed: number;
  /** Variación de la velocidad (fracción, 1σ) y del rumbo (rad, 1σ) en cada tiro. */
  speedSigma: number;
  yawSigma: number;
  /** Distancia horizontal de la boca al centro del pozo a la que la IA se pone a tirar (m). */
  range: number;
  /** Boca del lanzador en el sistema del robot (x al frente, y desde el piso), donde sale el centro de la Muestra. Sin ella, la punta de la garra. */
  muzzle?: { x: number; y: number };
  /**
   * Potencia que pierde el tiro por cada Muestra que lleva de más (fracción de `maxSpeed`): con `n` Muestras, la velocidad
   * máxima es `maxSpeed · (1 − loadPenalty · (n − 1))` (`game/shooter.ts`). SUPUESTO: el manual no habla de lanzar.
   * Sin ella, `DEFAULT_LOAD_PENALTY`.
   */
  loadPenalty?: number;
  /**
   * Puede tomar la Muestra Crítica (de donde esté, a ras de piso) y PASARLA: soltar con ella la lanza hacia la zona de entrega
   * (`PASS_TARGET`), sin anotarla. No la deposita en la Repisa (`canHoldCritical` sigue en falso: la IA y el HUD no cuentan con ella).
   * SUPUESTO (Xhavi, 16-nov): el manual no habla de lanzar (§7.2 solo limita tamaño, extensión y altura).
   */
  passCritical?: boolean;
  /**
   * Giro con que sale la pieza (rad/s, hacia atrás: la cara de arriba va contra el avance, como las ruedas de un lanzador que la
   * frotan por abajo) y su variación (fracción, 1σ). SUPUESTO (Xhavi, 16-nov: «en las pruebas reales gira mucho»): el CAD no trae las rpm.
   * Sin ella, sale sin giro.
   */
  spin?: number;
  spinSigma?: number;
  /**
   * Giro alrededor de la vertical (rad/s, 1σ, con signo al azar por tiro): la pieza no sale perfectamente alineada con las ruedas y
   * además de girar hacia atrás gira como trompo. SUPUESTO (Xhavi, 17-nov: «también deberían girar en vertical»).
   */
  spinYaw?: number;
}

/** ¿Puede tomar la Crítica para pasarla (no para anotarla)? Necesita la apertura de 20 cm (§4.1.1). */
export const canPassCritical = (s: { intake?: IntakeSpec }): boolean => intakeOf(s).shooter?.passCritical === true && intakeOf(s).gap >= mm(200) - 1e-9;

/** Pérdida de potencia por Muestra extra en el lanzador (SUPUESTO de Xhavi, 16-nov: "mientras más lleno, más débiles sus disparos"). */
export const DEFAULT_LOAD_PENALTY = 0.1;

/**
 * Cuántas Muestras caben en la rampa del lanzador: el único límite es el espacio físico (Xhavi, 16-nov). Van en fila desde el
 * pie de la rampa (donde entran, centro a `SAMPLE_SIZE / 2` del piso y a `arm.pivotX`) hasta la boca (`muzzle`); cada una ocupa
 * 15 cm (§4.1.1) y la fila cuenta media pieza de más en cada punta (los centros no pasan de la boca ni del pie).
 */
export function shooterCapacity(s: { arm: { pivotX: number }; intake?: { shooter?: ShooterSpec } }): number {
  const m = s.intake?.shooter?.muzzle;
  if (!m) return 1;
  const S = SAMPLE_SIZE;
  const len = Math.hypot(m.x - s.arm.pivotX, m.y - S / 2);
  return Math.max(1, Math.floor((len + S) / S + 1e-9));
}

/** Lanzador por defecto de Phoenix (SUPUESTOS). */
export const DEFAULT_SHOOTER: ShooterSpec = { pitch: (62 * Math.PI) / 180, maxSpeed: 6.5, speedSigma: 0.04, yawSigma: 0.025, range: 1.0 };

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
export const canHoldCritical = (s: { intake?: IntakeSpec }): boolean => {
  const i = intakeOf(s);
  return i.noCritical !== true && (i.critClaw !== undefined || i.gap >= mm(200) - 1e-9);
};

/** ¿Toma la Crítica desde la rendija de la Campana (donde la ponen)? Falso si solo la toma del piso (`IntakeSpec.critFloorOnly`). */
export const canTakeCriticalFromHolder = (s: { intake?: IntakeSpec }): boolean => intakeOf(s).critFloorOnly !== true;

/**
 * Posición de la Crítica en la garra fija (`IntakeSpec.critClaw`): centro del cubo (x, y desde la base del chasis) y su cara de abajo.
 * null si el robot la toma con el brazo.
 */
export function critSeat(s: { intake?: IntakeSpec }): { x: number; y: number; bottom: number } | null {
  const c = s.intake?.critClaw;
  return c ? { x: c.seat.x, y: c.seat.y, bottom: c.seat.y - mm(200) / 2 } : null;
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

export type ClawDims = { fingerLength: number; fingerHeight: number; fingerThickness: number; fingerZ: number; palmThickness: number };

/** Medidas de la garra de un robot (las de `CLAW` con la apertura y el largo de dedos de su intake). */
export function clawOf(s: { intake?: IntakeSpec }): ClawDims {
  const i = intakeOf(s);
  const t = i.claw?.thickness ?? CLAW.fingerThickness;
  return { ...CLAW, fingerLength: i.fingerLength, fingerHeight: i.claw?.height ?? CLAW.fingerHeight, fingerThickness: t, palmThickness: i.claw?.palm ?? CLAW.palmThickness, fingerZ: i.gap / 2 + t / 2 };
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
  const fixed = pos >= 1 && pos <= 3 ? s.arm.levelAngles?.[pos as 1 | 2 | 3] : undefined;
  if (fixed !== undefined) return fixed;
  const a = armAngle(s.arm, s.elevatorHeights[pos]);
  return s.arm.pickBack && (pos === 0 || pos === 4) ? Math.PI - a : a;
}

/** +1 si en esa posición la punta queda al frente del robot, −1 si atrás. */
export const posDir = (s: RobotSpec, pos: ElevatorPos): 1 | -1 =>
  pos === 4 && critSeat(s) ? 1 : pos >= 1 && pos <= 3 && s.arm.levelAngles?.[pos as 1 | 2 | 3] !== undefined
    ? Math.cos(s.arm.levelAngles[pos as 1 | 2 | 3]!) >= 0 ? 1 : -1
    : ((s.arm.pickBack || s.arm.rearClaw) && (pos === 0 || pos === 4) ? -1 : 1);

/** Punta del brazo (local x, y) en una posición. */
export const posTip = (s: RobotSpec, pos: ElevatorPos): { x: number; y: number } => {
  // La Crítica (posición 4) con garra fija: la "punta" es el asiento del cubo (x del centro, y de su cara de abajo)
  const seat = pos === 4 ? critSeat(s) : null;
  return seat ? { x: seat.x, y: seat.bottom } : armTip(s.arm, posAngle(s, pos));
};

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
