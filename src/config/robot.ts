/**
 * Especificación de un robot y sus límites según el manual (§7.2, §4.1). El manual no da
 * velocidad, masa ni mecanismos: esos números son SUPUESTOS configurables.
 */
import type { Level } from '../core/types';
import { CRITICAL_SIZE, SAMPLE_SIZE, mm } from './field';

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
  /** Con `cadRollers`: los rodillos del CAD tienen el eje a lo ancho (z del brazo) en vez de vertical (Mentores 3478: ruedas negras de 4 in arriba y rodillos verdes de 1 in abajo). */
  cadRollersZ?: boolean;
  /**
   * Con `clawAlongArm`: la Muestra agarrada se queda horizontal (como entró) aunque el brazo gire, en vez de girar con él (Mentores 3478,
   * Xhavi 21-nov: "se quedan donde las agarras, en posición horizontal"). Solo cambia la Muestra; la garra y el brazo giran igual.
   */
  levelSample?: boolean;
  /**
   * Con `levelSample`: x (m, en el sistema de la caja: el de la pose de piso, origen en la punta) del centro de la Muestra agarrada. Va apoyada
   * en el piso (como la recogió) con su cara de atrás contra los cilindros de 1 in y las ruedas de 4 in encima, sin atravesarlas (Mentores 3478,
   * Xhavi 21-nov). SUPUESTO: sale de la posición de los rodillos del CAD (cilindros en x −0.113 de 1 in de radio → cara de atrás en −0.100).
   */
  heldX?: number;
  /** Color de las ruedas del chasis del GLB (nodos `Wheel…` fuera del brazo), p. ej. 0xf2f2f2. Mentores 3478: son blancas, no negras (Xhavi, 21-nov). */
  wheelColor?: number;
  /**
   * Muñeca de la garra (Mentores 3478): el eje, en el sistema del nodo `brazo` del GLB, y la x desde la que las piezas del CAD cuelgan de ella.
   * `levels`: giro (rad, + = la punta de la placa sube) de la placa respecto al brazo en N1–N3, desde la pose del CAD, medido de las capturas de
   * lado de SolidWorks de Xhavi (21-nov: "en todos los niveles gira su muñeca"). En el piso y en la Repisa queda en 0 (la pose del CAD) y entre
   * posiciones se interpola con el ángulo del brazo (`wristAngleOf`). La Muestra agarrada y los rodillos (física y dibujo) van con la placa.
   * `stow`: giro de la muñeca en la pose de inicio del match (doblada hacia atrás sobre el chasis, captura de Xhavi del 21-nov); se despliega
   * al primer mando del brazo (`Mechanisms.wristFold`).
   */
  cadWrist?: { axis: readonly [number, number]; fromX: number; levels: Partial<Record<1 | 2 | 3, number>>; stow?: number };
  /**
   * Colisión del brazo y de la muñeca del CAD (Mentores 3478, Xhavi 21-nov: "agrégale colisión a todo el robot porque algunas cosas traspasan
   * las paredes de scoring"): cascos convexos (x, y, z planos, m) sacados del GLB con `scripts/cad/arm-hulls.mjs`. `arm` en el sistema del
   * nodo `brazo` (origen en el eje del hombro, pose del CAD); `wrist` uno por lado (placa, espaciadores y motor) con el origen en el eje de la
   * muñeca (`cadWrist.axis`), que gira con ella.
   */
  cadArmHulls?: { arm: readonly number[]; wrist: ReadonlyArray<readonly number[]> };
  /**
   * Colisionadores de los rodillos de la garra (Mentores 3478, Xhavi 21-nov: "los rollers no tienen colisión"): cilindros con el eje en z, cada
   * uno `[x, y, radio]` en el sistema de la caja (pose de piso, origen en la punta), todos de media anchura `halfZ`. Cuelgan de la muñeca,
   * igual que las piezas del CAD. Medidos del GLB (ruedas de 4 in y cilindros de 1 in); el radio se achica 4 mm para que la Muestra entre.
   */
  cadRollerCols?: { halfZ: number; cyl: ReadonlyArray<readonly [number, number, number]> };
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
  /**
   * Alcance para una Muestra normal (N1–N3), SUPUESTO (Xhavi, 19-nov: "que pueda agarrar muestras normales también, aunque no sea diseñado
   * para eso, en casos muy específicos y muy poco probables"): la Garrita está a 73 cm del piso y sus dedos están hechos para el cubo de
   * 20 cm, así que solo toma una Muestra que ya queda entre ellos (centro a ±`reachZ` de lado, de `reachBack` atrás a `reachFront` adelante
   * del asiento y de `reachDown` abajo a `reachUp` arriba de su centro apoyada en los dedos). Sin esto no toma Muestras.
   */
  sample?: { reachBack: number; reachFront: number; reachZ: number; reachDown: number; reachUp: number };
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
   * El botón del nivel de la Repisa (4) deja de subir el brazo y pide al Human Player que deje caer la Crítica de la repisa al
   * piso (Axiom y Mentores 3478, Xhavi, 21-nov: "para los equipos que pueden agarrar la cp del piso nada más… sustituye el botón de
   * nivel de repisa a uno que sea específicamente de dejarla caer"). SUPUESTO: el manual (§3.2.4) no dice nada de mecanismos.
   */
  critDropKey?: boolean;
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
   * Pase de Muestras normales (NO de la Crítica, que Phoenix no toma): velocidad máxima (m/s) del lanzamiento en arco con que, sin nivel
   * elegido (N0), suelta la Muestra hacia la zona de entrega (`PASS_TARGET`, su lugar de scoring) desde cualquier punto de la cancha.
   * SUPUESTO (Xhavi, 20-nov): el manual no habla de lanzar (§7.2 solo limita tamaño, extensión y altura).
   */
  passSpeed?: number;
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

/**
 * Lugar (x, y en el sistema de la caja, origen en la punta) de la Muestra agarrada `k` con `heldX`: apoyada en el piso de la pose de piso
 * (no flotando a la altura de la punta). `null` si el robot no lo declara (queda el de siempre, `seatX`).
 */
export function heldSeatOf(s: RobotSpec, dir: number, k: number): { x: number; y: number } | null {
  const hx = s.model?.heldX;
  if (hx === undefined || s.model?.levelSample !== true) return null;
  return { x: hx + dir * k * SAMPLE_SIZE, y: SAMPLE_SIZE / 2 - armTip(s.arm, posAngle(s, 0)).y };
}

/** Eje de la muñeca (`cadWrist`) en el sistema de la caja (origen en la punta del brazo). */
export function wristOf(s: RobotSpec): { x: number; y: number } | null {
  const w = s.model?.cadWrist;
  if (!w) return null;
  // El nodo `brazo` del GLB está girado `−stowAngle` respecto al brazo: la punta (a `L` del hombro) queda en L·(cos, sin)(stowAngle) en sus ejes
  const L = s.model?.cadArmLength ?? s.arm.length;
  const st = s.model?.stowAngle ?? 0;
  return { x: w.axis[0] - L * Math.cos(st), y: w.axis[1] - L * Math.sin(st) };
}

/**
 * Cuánto aprieta la rueda de 4 in de la garra de Mentores 3478 la espuma de la Crítica al sujetarla (m). SUPUESTO (el manual no habla de
 * mecanismos, §7.2): 1.5 cm, lo que se hunde una rueda compliant en un cubo de espuma.
 */
export const CRIT_SQUEEZE = 0.015;

/**
 * Lugar (x, y en el sistema de la caja: el de la pose de piso, origen en la punta) del centro de la Crítica en la garra de Mentores 3478, como en
 * el dibujo de Xhavi sobre el CAD (22-nov, vista de lado en N1): adentro de la garra, debajo de la rueda grande de 4 in (que la aprieta
 * `CRIT_SQUEEZE` desde arriba) y con la cara de atrás contra el rodillo chico de 1 in; va fija a la placa de la muñeca. Las placas quedan a los
 * lados (cara de adentro a 8.9 cm del centro: aprietan la espuma ~1 cm por lado). `null` sin `heldX` ni `cadRollerCols`.
 */
export function critHeldSeatOf(s: RobotSpec): { x: number; y: number } | null {
  const rc = s.model?.cadRollerCols;
  if (!heldSeatOf(s, 1, 0) || !rc || rc.cyl.length === 0) return null;
  const h = CRITICAL_SIZE / 2;
  const top = rc.cyl.reduce((p, q) => (q[1] > p[1] ? q : p)); // la rueda grande, arriba
  const back = rc.cyl.reduce((p, q) => (q[0] < p[0] ? q : p)); // el rodillo chico, atrás
  return { x: back[0] + back[2] + h, y: top[1] - top[2] + CRIT_SQUEEZE - h };
}

/** Giro (rad, respecto al robot) de la placa de la muñeca con el brazo en `a`: el del brazo `a − stowAngle` más el de la muñeca. */
export function wristTilt(s: RobotSpec, a: number, fold = 0): number {
  return a - (s.model?.stowAngle ?? 0) + wristAngleOf(s, a, fold);
}

/**
 * Dónde queda (respecto a la punta, ejes del robot) la Muestra `k` agarrada con `heldX` cuando el brazo está en `a`: la pose de piso en el
 * sistema de la caja, llevada por la muñeca (`wristPoint`) y girada con el brazo `a − stowAngle`.
 */
export function heldOffsetOf(s: RobotSpec, a: number, k: number, fold = 0, critical = false): { x: number; y: number } | null {
  // La Crítica (20 cm): su lugar en la garra (`critHeldSeatOf`), llevado por la muñeca igual que la Muestra
  const hs0 = critical ? critHeldSeatOf(s) : heldSeatOf(s, 1, k);
  if (!hs0) return null;
  const d = a - (s.model?.stowAngle ?? 0);
  // La Muestra va con la placa de la muñeca en todos los niveles (dibujo y física: colisionador, salida al soltar, `posScoreTip` para la IA)
  const p = wristPoint(s, a, hs0.x, hs0.y, fold);
  const c = Math.cos(d);
  const sn = Math.sin(d);
  return { x: p.x * c - p.y * sn, y: p.x * sn + p.y * c };
}

/**
 * Ángulo (rad) de la muñeca con el brazo en `a`: el de `cadWrist.levels` en cada nivel (capturas de SolidWorks de Xhavi, 21-nov) y 0 (pose del
 * CAD) en el piso y en la Repisa. Entre dos posiciones va con el ángulo del brazo (suavizado: llega quieta a cada una). SUPUESTO: el robot real
 * mueve la muñeca con su propio motor; el simulador la ata al brazo para que en cada posición quede igual que en las capturas.
 */
export function wristAngleOf(s: RobotSpec, a: number, fold = 0): number {
  const w = s.model?.cadWrist;
  if (!w) return 0;
  const t = levelWristAngle(s, a);
  // Pose de inicio (`cadWrist.stow`): `fold` 1 = doblada, 0 = la de los niveles
  return w.stow === undefined || fold <= 0 ? t : t + (w.stow - t) * Math.min(1, fold);
}

/** Giro de la muñeca de los niveles (`cadWrist.levels`), sin la pose de inicio. */
function levelWristAngle(s: RobotSpec, a: number): number {
  const w = s.model!.cadWrist!;
  const keys: Array<[number, number]> = [[posAngle(s, 0), 0], [posAngle(s, 4), 0]];
  for (const lvl of [1, 2, 3] as const) {
    const t = w.levels[lvl];
    if (t !== undefined) keys.push([posAngle(s, lvl), t]);
  }
  keys.sort((p, q) => p[0] - q[0]);
  if (a <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [a1, t1] = keys[i];
    if (a > a1) continue;
    const [a0, t0] = keys[i - 1];
    const u = a1 - a0 < 1e-9 ? 1 : (a - a0) / (a1 - a0);
    return t0 + (t1 - t0) * u * u * (3 - 2 * u);
  }
  return keys[keys.length - 1][1];
}

/** 0 hasta ~69° → 1 en N3: pasada la mitad, los rodillos dejan de chocar (la Muestra de N3 sale por donde están). */
export function wristFade(s: RobotSpec, a: number): number {
  const a3 = s.arm.levelAngles?.[3];
  if (!s.model?.cadWrist || a3 === undefined) return 0;
  const t = Math.max(0, Math.min(1, (a - 1.2) / (a3 - 1.2)));
  return t * t * (3 - 2 * t);
}

/** Punto (x, y) del sistema de la caja (pose de piso) llevado por la muñeca al ángulo del brazo `a`. */
export function wristPoint(s: RobotSpec, a: number, x: number, y: number, fold = 0): { x: number; y: number } {
  const w = wristOf(s);
  if (!w) return { x, y };
  const t = wristAngleOf(s, a, fold);
  const c = Math.cos(t);
  const sn = Math.sin(t);
  const dx = x - w.x;
  const dy = y - w.y;
  return { x: w.x + dx * c - dy * sn, y: w.y + dx * sn + dy * c };
}

/**
 * Centros (respecto a la punta, ejes del robot) de los cilindros `cadRollerCols` con el brazo en `a`: el de la pose de piso llevado por la muñeca
 * (`wristPoint`) y girado con el brazo `a − stowAngle`. Mismo cálculo que `heldOffsetOf`.
 */
export function rollerColsOf(s: RobotSpec, a: number, fold = 0): Array<{ x: number; y: number; r: number }> {
  const rc = s.model?.cadRollerCols;
  if (!rc) return [];
  const d = a - (s.model?.stowAngle ?? 0);
  const c = Math.cos(d);
  const sn = Math.sin(d);
  return rc.cyl.map(([x0, y0, r]) => {
    const { x, y } = wristPoint(s, a, x0, y0, fold);
    return { x: x * c - y * sn, y: x * sn + y * c, r };
  });
}

/** Contorno (x, y) del casco del brazo del CAD (`cadArmHulls.arm`) visto de lado, en su sistema; se calcula una vez por robot. */
const hullOutlines = new WeakMap<object, Array<[number, number]>>();
function outline(pts: readonly number[]): Array<[number, number]> {
  // Casco convexo 2D (cadena monótona) de los puntos proyectados en x–y
  const p: Array<[number, number]> = [];
  for (let i = 0; i + 2 < pts.length; i += 3) p.push([pts[i], pts[i + 1]]);
  p.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Array<[number, number]> = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  const hi: Array<[number, number]> = [];
  for (let i = p.length - 1; i >= 0; i--) {
    while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p[i]) <= 0) hi.pop();
    hi.push(p[i]);
  }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

/** Cuánto se mete un polígono convexo en el cuadrado de centro (cx, cy) y media arista `h` (m; 0 si no se tocan). Ejes separadores (SAT). */
function squarePolyDepth(cx: number, cy: number, h: number, poly: ReadonlyArray<[number, number]>): number {
  let best = Infinity;
  const axes: Array<[number, number]> = [[1, 0], [0, 1]];
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    const l = Math.hypot(x1 - x0, y1 - y0);
    if (l > 1e-9) axes.push([(y1 - y0) / l, -(x1 - x0) / l]);
  }
  for (const [nx, ny] of axes) {
    const c = cx * nx + cy * ny;
    const e = h * (Math.abs(nx) + Math.abs(ny));
    let mn = Infinity;
    let mx = -Infinity;
    for (const [x, y] of poly) {
      const d = x * nx + y * ny;
      mn = Math.min(mn, d);
      mx = Math.max(mx, d);
    }
    const o = Math.min(c + e - mn, mx - (c - e));
    if (o <= 0) return 0;
    best = Math.min(best, o);
  }
  return best;
}

/** Cuánto se mete en el cuadrado de centro (cx, cy), media arista `h` y giro `t` un círculo (rodillo) de centro (x, y) y radio `r` (m). */
function squareCircleDepth(cx: number, cy: number, h: number, t: number, x: number, y: number, r: number): number {
  const c = Math.cos(t);
  const sn = Math.sin(t);
  const lx = (x - cx) * c + (y - cy) * sn;
  const ly = -(x - cx) * sn + (y - cy) * c;
  const dx = Math.abs(lx) - h;
  const dy = Math.abs(ly) - h;
  const out = dx > 0 && dy > 0 ? Math.hypot(dx, dy) : Math.max(dx, dy);
  return Math.max(0, r - out);
}

/**
 * Centro (respecto a la punta, ejes del robot) y giro (rad) de la Crítica que lleva la garra de Mentores 3478 con el brazo en `a`. Va en
 * `critHeldSeatOf`, fija a la placa de la muñeca (gira con ella). Cerca del piso ese lugar quedaría bajo la alfombra: el cubo se queda apoyado
 * en el piso y se recorre a lo largo de la boca, hacia afuera, hasta que los rodillos (`cadRollerCols`) y el brazo (`cadArmHulls.arm`) lo
 * aprietan como mucho `CRIT_SQUEEZE`; al subir el brazo vuelve a su lugar adentro de la garra. Así nunca los atraviesa. `null` sin asiento.
 */
export function critHeldOffsetOf(s: RobotSpec, a: number, fold = 0): { x: number; y: number; tilt: number } | null {
  const seat = critHeldSeatOf(s);
  const m = s.model;
  if (!seat || !m) return null;
  const h = CRITICAL_SIZE / 2;
  const tip = armTip(s.arm, a);
  const d = a - (m.stowAngle ?? 0);
  const p = wristPoint(s, a, seat.x, seat.y, fold);
  const cd = Math.cos(d);
  const sd = Math.sin(d);
  let x = p.x * cd - p.y * sd;
  let y = p.x * sd + p.y * cd;
  const tilt = wristTilt(s, a, fold);
  // Apoyado en el piso (y local del robot = 0) si no
  const low = tip.y + y - h * (Math.abs(Math.cos(tilt)) + Math.abs(Math.sin(tilt)));
  if (low < 0) y -= low;
  const rollers = rollerColsOf(s, a, fold);
  let arm: Array<[number, number]> = [];
  if (m.cadArmHulls) {
    let o = hullOutlines.get(m);
    if (!o) {
      o = outline(m.cadArmHulls.arm);
      hullOutlines.set(m, o);
    }
    arm = o.map(([px, py]): [number, number] => [s.arm.pivotX + px * cd - py * sd - tip.x, s.arm.pivotY + px * sd + py * cd - tip.y]);
  }
  const depth = (cx: number, cy: number): number => {
    let worst = 0;
    for (const r of rollers) worst = Math.max(worst, squareCircleDepth(cx, cy, h, tilt, r.x, r.y, r.r));
    if (arm.length) {
      // El brazo en el sistema del cubo (girado −tilt), para medirlo contra el cuadrado sin girar
      const c = Math.cos(-tilt);
      const sn = Math.sin(-tilt);
      const q = arm.map(([px, py]): [number, number] => [(px - cx) * c - (py - cy) * sn, (px - cx) * sn + (py - cy) * c]);
      worst = Math.max(worst, squarePolyDepth(0, 0, h, q));
    }
    return worst;
  };
  const lim = CRIT_SQUEEZE + 1e-4;
  if (depth(x, y) > lim) {
    // A lo largo de la boca (hacia afuera de la garra): lo más cerca que no aprieta más de `CRIT_SQUEEZE` (búsqueda binaria)
    const ux = Math.cos(tilt);
    const uy = Math.sin(tilt);
    let lo = 0;
    let hi = 0.3;
    for (let i = 0; i < 24 && hi - lo > 1e-4; i++) {
      const mid = (lo + hi) / 2;
      if (depth(x + mid * ux, y + mid * uy) > lim) lo = mid;
      else hi = mid;
    }
    x += hi * ux;
    y += hi * uy;
  }
  return { x, y, tilt };
}

/**
 * Ángulo del brazo de Mentores 3478 en la posición de piso mientras lleva la Crítica: la garra no puede bajar hasta la alfombra con el cubo de
 * 20 cm adentro, así que se queda apoyada sobre él, con el cubo en su lugar de la garra (`critHeldSeatOf`) tocando el piso (Xhavi, 22-nov:
 * "mejora cómo se ve en nivel piso"). SUPUESTO: el robot real tampoco puede bajar más; el manual no habla de mecanismos (§7.2).
 * `null` si el robot no tiene ese asiento.
 */
export function critFloorAngle(s: RobotSpec): number | null {
  const seat = critHeldSeatOf(s);
  if (!seat) return null;
  const h = CRITICAL_SIZE / 2;
  // Lo más bajo del cubo (y local del robot, 0 = piso) en su lugar de la garra con el brazo en `a`
  const low = (a: number): number => {
    const d = a - (s.model?.stowAngle ?? 0);
    const p = wristPoint(s, a, seat.x, seat.y);
    const t = wristTilt(s, a);
    return armTip(s.arm, a).y + p.x * Math.sin(d) + p.y * Math.cos(d) - h * (Math.abs(Math.cos(t)) + Math.abs(Math.sin(t)));
  };
  let lo = posAngle(s, 0);
  let hi = posAngle(s, 1);
  if (low(lo) >= 0) return lo;
  if (low(hi) < 0) return hi;
  for (let i = 0; i < 30 && hi - lo > 1e-5; i++) {
    const mid = (lo + hi) / 2;
    if (low(mid) < 0) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** Ángulo del brazo al que va en la posición `pos`: el de `posAngle`, salvo en el piso con la Crítica en la garra (`critFloorAngle`). */
export function armGoalAngle(s: RobotSpec, pos: ElevatorPos, holdingCritical: boolean): number {
  return (pos === 0 && holdingCritical ? critFloorAngle(s) : null) ?? posAngle(s, pos);
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

/**
 * Punta para ANOTAR en una posición: la de `posTip`, corrida a donde queda la Muestra agarrada cuando la muñeca gira la garra (`heldOffsetOf`;
 * Mentores 3478). Lo usan la IA y el diseñador de AUTO para acercarse al HUB; en el piso (recoger) no cambia nada.
 */
export const posScoreTip = (s: RobotSpec, pos: ElevatorPos): { x: number; y: number } => {
  const t = posTip(s, pos);
  const o = pos === 0 ? null : heldOffsetOf(s, posAngle(s, pos), 0);
  return o ? { x: t.x + o.x, y: t.y } : t;
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
