/**
 * Mecanismos del pivote (`RobotSpec.arm`; los dos tipos del simulador, `config/robot.ts`): brazo con
 * garra. Agarra una pieza del piso con el brazo abajo y la suelta en la punta (si el brazo voltea,
 * `ArmSpec.pickBack`, recoge y toma la Crítica atrás y anota al frente en N1–N3). Empieza guardado
 * (`ArmSpec.stowAngle`) y sale de ahí al primer mando. Lleva una pieza a la vez (capacidad 1); con
 * capacidad > 1 (un hopper, ya sin tipo que lo use) la garra pasa cada Muestra a la boca del hopper
 * (`ArmSpec.hopperAngle`) y la saca de ahí para anotar.
 * Las piezas guardadas son lógicas (cuerpo deshabilitado); al soltarlas vuelven a la física en la
 * punta del mecanismo, así que anotar depende de dónde caen (lo detecta la sesión).
 *
 * Agarre (Xhavi, 29-oct: "se me hace extremadamente fácil recoger las muestras"): la garra ya no
 * "absorbe" lo que está cerca. Tiene dedos con colisión (`RobotPhysics.setArmPose`). Tres modos:
 * - `compliant` (por defecto; Xhavi, 30-oct: "nuestro robot va a tener compliants"): ruedas flexibles
 *   en la boca de los dedos jalan la Muestra en cuanto la tocan, con la garra a la altura del piso.
 *   Agarra de cualquier ángulo y aunque llegue de lado o pegada a la punta de un dedo (no tiene que
 *   llegar hasta la placa: una Cámara o la pared ya no estorban); solo se resbala si llega muy rápido.
 * - `precise`: la Muestra tiene que entrar de verdad entre los dedos (`CLAW_GAP`) hasta la placa, y
 *   casi derecha (≲18°). Ahí la garra tarda `GRIP.closeTime` en cerrar (si la Muestra se sale en ese
 *   tiempo, no la toma) y puede resbalarse: la probabilidad crece con la velocidad y el giro.
 * - `easy`: el de antes (toma lo que quede a 12 cm de la punta, sin alinear ni fallar).
 * Todos esos números son SUPUESTOS de diseño (el manual no habla de mecanismos, §7.2).
 *
 * Garra-caja con rodillos (`IntakeSpec.rollers`, Psycho; Xhavi, 13-nov: "los rollers son para que pueda
 * agarrar fácilmente las [Muestras]"): no hay zona que "absorba". Las ruedas tocan la Muestra en
 * cuanto su cara llega a la boca (aunque llegue de lado o chueca) y la jalan por fricción, con fuerza
 * limitada (`ROLLERS`): la centran, la enderezan y la meten hasta que choca con la placa del fondo (o
 * con la primera Muestra). Ahí queda agarrada; la segunda entra igual y se queda en fila detrás de la
 * primera (`seatX`). Si algo la detiene (otro robot, la pared) el robot no "la teletransporta".
 */
import { camaraWells, inCamara, rectForCamara } from '../config/field';
import { shotVelocity } from './shooter';
import { CLAW_GAP, armTip, canHoldCritical, canPassCritical, clawOf, intakeOf, posAngle, posDir, seatX, type ElevatorPos, type GripMode } from '../config/robot';
import { CRITICAL_SIZE, SAMPLE_SIZE } from '../config/field';
import { FLOOR_POSE, clawDir } from '../physics/RobotPhysics';
import { GROUPS } from '../physics/PhysicsWorld';
import type { Alliance } from '../core/types';
import type { Piece, Pieces } from '../physics/Pieces';
import type { RobotPhysics } from '../physics/RobotPhysics';

export type MechEvent =
  | { type: 'intake'; robot: number; piece: number }
  | { type: 'grabCritical'; robot: number; piece: number }
  | { type: 'release'; robot: number; piece: number }
  /** La garra cerró pero la Muestra se le resbaló (agarre con compliants o preciso). */
  | { type: 'grabMiss'; robot: number; piece: number };

/** Agarre preciso (SUPUESTOS de diseño). */
export const GRIP = {
  /** Holgura del centro de la Muestra respecto a su lugar en la garra (m). */
  pocketX: 0.055,
  pocketZ: Math.min(0.045, (CLAW_GAP - SAMPLE_SIZE) / 2),
  /** Giro máximo de la Muestra respecto a la garra (rad): lo que cabe entre los dedos. */
  maxYaw: (18 * Math.PI) / 180,
  /** Inclinación máxima (rad): una Muestra volteada sobre una arista no se deja agarrar. */
  maxTilt: (20 * Math.PI) / 180,
  /** Segundos que tarda en cerrar con la Muestra adentro. */
  closeTime: 0.18,
  /** Probabilidad de resbalarse con la Muestra quieta y derecha. */
  baseMiss: 0.06,
  /** Más probabilidad por cada m/s de velocidad relativa arriba de `safeSpeed`. */
  missPerSpeed: 0.25,
  safeSpeed: 0.6,
  /** Más probabilidad con el giro máximo (proporcional al giro). */
  missPerYaw: 0.15,
  /** Segundos antes de volver a intentarlo tras resbalarse. */
  retry: 0.45,
} as const;

/**
 * Agarre con compliants (SUPUESTOS de diseño): dos ruedas flexibles en la boca de la garra, una en
 * la punta de cada dedo, que jalan la Muestra hacia adentro.
 */
export const COMPLIANT = {
  /** Qué tan adelante de la punta de los dedos alcanza a jalarla (m, del borde de la Muestra). */
  reachFront: 0.03,
  /** Segundos que tarda en meterla y cerrar. */
  closeTime: 0.06,
  /** Arriba de esta velocidad de llegada (m/s) puede rebotar en las ruedas… */
  safeSpeed: 2.2,
  /** …con esta probabilidad por cada m/s de más. */
  missPerSpeed: 0.2,
  /** Segundos antes de volver a intentarlo tras rebotar. */
  retry: 0.2,
} as const;

/**
 * Rodillos de la garra-caja (Psycho). SUPUESTOS de diseño (el manual no habla de mecanismos, §7.2; Xhavi
 * no dio medidas de ruedas, motores ni presión): ruedas de TPU/hule contra espuma, apretando la Muestra
 * entre la fila de arriba y la de abajo. La velocidad de la superficie es `IntakeSpec.rollerSpeed`.
 */
export const ROLLERS = {
  /** Fuerza con la que las dos filas aprietan la Muestra (N). */
  squeeze: 20,
  /** Fricción rueda–espuma. */
  mu: 0.9,
  /**
   * Cuánto salen las ruedas de la boca de la caja (m): la flecha de enfrente está a 3 cm de la boca (valeros
   * del CAD) y la rueda mide ~4.1 cm de radio, más ~0.5 cm de lo que cede la espuma.
   */
  reach: 0.016,
  /** Traslape mínimo (m) de la Muestra con la boca para que una rueda la toque. */
  minOverlap: 0.025,
  /** Centrado: velocidad lateral (1/s por m de desvío) y su máximo (m/s). Las ruedas y los bordes la encauzan. */
  centerGain: 9,
  centerMax: 0.7,
  /** Enderezado: giro (1/s por rad de desvío); el par lo limita la misma fricción con este brazo de palanca (m). */
  alignGain: 12,
  alignLever: 0.05,
  /** Holgura (m) para darla por asentada en la placa (o contra la primera). */
  seatTol: 0.02,
  /** Desvío lateral (m) máximo para darla por asentada (al apretarla, los rodillos la acaban de centrar). */
  seatLat: 0.05,
  /** Segundos que giran hacia afuera al soltar (sacan de la caja la Muestra que sale). */
  ejectTime: 0.4,
} as const;

/**
 * Al soltar una Muestra, las ruedas de los compliants giran al revés y la empujan hacia donde abre la
 * garra (Xhavi, 30-oct: "es muy justo el espacio [para anotar]"). Así cae más al fondo del pozo y el
 * robot puede soltar más lejos de la pared: en N3 la distancia a la pared desde la que entra pasa de 11–12 a 22–26 cm. No en el
 * agarre preciso (garra sin ruedas), ni con la Crítica (rebotaba y se pasaba de la Repisa), ni cuando
 * un golpe la tira. SUPUESTO de diseño (el manual no habla de mecanismos, §7.2).
 */
export const OUTTAKE = {
  /** Velocidad (m/s) con la que sale la Muestra, sumada a la del robot. */
  speed: 1.0,
  /**
   * Garra con rodillos en el piso (Psycho): la escupe despacio (m/s, respecto al robot) en vez de dispararla
   * (Xhavi, 13-nov: "simplemente haz que las escupa"). Las ruedas giran hacia afuera lo justo para sacarla.
   */
  spit: 0.45,
} as const;

export type { GripMode };

/**
 * Pose de un cubo apoyado: rumbo (rad) de una de sus caras laterales (las 4 son equivalentes, cada
 * π/2) e inclinación (rad) de la cara de abajo respecto al piso. Puro.
 */
export function cubePose(q: { x: number; y: number; z: number; w: number }): { faceYaw: number; tilt: number } {
  // Ejes del cubo en el mundo (columnas de la matriz de rotación)
  const axes = [
    [1 - 2 * (q.y * q.y + q.z * q.z), 2 * (q.x * q.y + q.w * q.z), 2 * (q.x * q.z - q.w * q.y)],
    [2 * (q.x * q.y - q.w * q.z), 1 - 2 * (q.x * q.x + q.z * q.z), 2 * (q.y * q.z + q.w * q.x)],
    [2 * (q.x * q.z + q.w * q.y), 2 * (q.y * q.z - q.w * q.x), 1 - 2 * (q.x * q.x + q.y * q.y)],
  ];
  let up = 0;
  for (let i = 1; i < 3; i++) if (Math.abs(axes[i][1]) > Math.abs(axes[up][1])) up = i;
  const side = axes[(up + 1) % 3];
  return { faceYaw: Math.atan2(-side[2], side[0]), tilt: Math.acos(Math.min(1, Math.abs(axes[up][1]))) };
}

/** Giro (rad, 0–π/4) de un cubo respecto a un rumbo, e inclinación de su cara de abajo. Puro. */
export function cubeAlignment(q: { x: number; y: number; z: number; w: number }, heading: number): { yaw: number; tilt: number } {
  const { faceYaw, tilt } = cubePose(q);
  let d = (((faceYaw - heading) % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
  if (d > Math.PI / 4) d = Math.PI / 2 - d;
  return { yaw: d, tilt };
}

/** Probabilidad de que la Muestra se resbale al cerrar la garra (agarre preciso o con compliants). Pura. */
export function missChance(relSpeed: number, yaw: number, mode: GripMode = 'precise'): number {
  if (mode === 'easy') return 0;
  if (mode === 'compliant') return Math.min(0.5, COMPLIANT.missPerSpeed * Math.max(0, relSpeed - COMPLIANT.safeSpeed));
  const p = GRIP.baseMiss + GRIP.missPerSpeed * Math.max(0, relSpeed - GRIP.safeSpeed) + GRIP.missPerYaw * Math.min(1, yaw / GRIP.maxYaw);
  return Math.max(0, Math.min(0.95, p));
}

/** Tiempo mínimo entre dos piezas soltadas (s). SUPUESTO. */
const EJECT_COOLDOWN = 0.35;

/** Mientras sale de la caja, la Muestra no choca con el brazo: hasta que se aleja `EXIT_CLEAR` m de la punta o pasan `EXIT_MAX` s. */
const EXIT_CLEAR = 0.32;
const EXIT_MAX = 0.9;
/** Lanzador: altura (m) sobre la apertura del nivel a la que apunta el centro de la Muestra al llegar al pozo (SUPUESTO, afinado con pruebas). */
/** Segundos que la Muestra lanzada no choca con el robot (sale de la rampa por dentro de sus placas). */
const SHOT_EXIT = 0.25;
export const SHOT_AIM_ABOVE = 0.12;
/**
 * Zona de entrega del pase de la Crítica (en el sistema del rojo, +X; el azul la espeja): la plataforma superior junto a la
 * Repisa, desde donde un compañero la sube a la Repisa. SUPUESTO (Xhavi, 16-nov). `PASS_MIN`: pase más corto que se lanza (m).
 */
export const PASS_TARGET = { x: 0.7, z: 0 };
export const PASS_MIN = 0.6;

export class Mechanisms {
  intakeOn = false;
  /**
   * Garra de pinza con control de interruptor (Xhavi, 16-nov): cada pulsación cierra o abre la garra, no se mantiene. Cierra
   * sin saber si hay Muestra: si la hay entre los dedos la toma (y se puede anotar); si no, queda cerrada vacía. Abrir
   * suelta lo que traiga. Solo lo usa el control de una persona (`toggleClaw`); la IA y las rutinas siguen con `intakeOn`.
   */
  latched = false;
  /** Con `latched`: la garra está cerrada (`intakeOn` lo refleja para el HUD y el botón). */
  clawClosed = false;
  /** Segundos que le quedan a la garra recién cerrada para tomar una Muestra; pasado eso queda cerrada sin recoger más. */
  private closeWindow = 0;
  readonly stored: Piece[] = [];
  critical: Piece | null = null;
  target: ElevatorPos = 0;
  /** Altura actual de la punta de la garra (fondo de la pieza, m sobre la base del robot). */
  height: number;
  /** Ángulo del brazo (rad, 0 = horizontal hacia adelante). */
  angle = 0;
  /** Brazo en su posición de guardado del inicio. */
  stowed = false;
  /** El brazo topó con una estructura de la cancha y se quedó ahí (hitbox literal, D34). */
  armBlocked = false;
  /** La garra lleva una Muestra (la última de `stored`); las demás van en el hopper. */
  inClaw = false;
  /** Segundos con la garra en la boca del hopper (pasando una Muestra). */
  private transferT = 0;
  private cooldown = 0;
  /** Muestra entre los dedos mientras la garra cierra, y cuánto lleva cerrando. */
  private closing: { piece: number; t: number } | null = null;
  /** Agarre: con compliants, preciso o fácil (el de antes). */
  grip: GripMode = 'compliant';
  /** Azar del agarre (la sesión le da uno con semilla). */
  rand: () => number = Math.random;
  /** Fallas (`game/Damage.ts`): la garra atascada no cierra. */
  jammed = false;
  /** Fallas: fracción de la velocidad del brazo (1 = sano). */
  armScale = 1;
  /** Segundos que les quedan a los rodillos girando hacia afuera tras soltar (para el dibujo). */
  ejectT = 0;
  /** Velocidad angular del brazo (rad/s) en el último paso: la Muestra que se suelta hereda la velocidad de la boca. */
  armW = 0;
  /** Muestra que está saliendo de la caja sin chocar con el brazo (y segundos que le quedan así). */
  private leaving: Piece | null = null;
  private leavingT = 0;
  private leavingShot = false;
  /** Muestras que los rodillos están tocando ahora (para el dibujo y las pruebas). */
  rollerContacts = 0;

  constructor(
    private phys: RobotPhysics,
    private pieces: Pieces,
    readonly alliance: Alliance,
  ) {
    this.height = phys.spec.elevatorHeights[0];
    this.resetArm();
  }

  get capacity(): number {
    return this.phys.spec.capacity;
  }

  /** ¿Puede soltar una Muestra ya? (brazo en su posición, comparado por ángulo: de camino al hopper pasa por las mismas alturas) */
  get atTarget(): boolean {
    const s = this.phys.spec;
    return !this.stowed && this.hopperTask() === null && Math.abs(this.angle - posAngle(s, this.target)) < 0.01;
  }

  /** Muestras en el hopper (las guardadas que no van en la garra). */
  get inHopper(): number {
    return this.stored.length - (this.inClaw ? 1 : 0);
  }

  /**
   * ¿El brazo tiene que ir a la boca del hopper? 'store' si trae una Muestra en la garra, la garra
   * está encendida y cabe; 'fetch' si la garra está apagada y vacía (sin la Crítica) y hay Muestras
   * en el hopper, salvo en la posición 4 (ahí se espera la Crítica con la garra vacía).
   */
  hopperTask(): 'store' | 'fetch' | null {
    if (this.stowed || this.phys.spec.arm.holdsTwo) return null;
    if (this.inClaw && this.intakeOn && this.inHopper < this.capacity - 1) return 'store';
    if (!this.inClaw && !this.critical && !this.intakeOn && this.inHopper > 0 && this.target !== 4) return 'fetch';
    return null;
  }

  /** Posición local (adelante) del centro de la pieza en la punta de la garra. */
  tipX(): number {
    return armTip(this.phys.spec.arm, this.angle).x;
  }

  /** Avanza el brazo y la garra un paso. */
  step(dt: number, events: MechEvent[]): void {
    const s = this.phys.spec;
    const goal = s.elevatorHeights[this.target];
    if (this.stowed && (this.target !== 0 || this.intakeOn)) this.stowed = false;
    if (!this.stowed) {
      const task = this.hopperTask();
      const g = task ? (s.arm.hopperAngle ?? Math.PI) : posAngle(s, this.target);
      const d = g - this.angle;
      const stepA = s.arm.speed * this.armScale * dt;
      const next = Math.abs(d) <= stepA ? g : this.angle + Math.sign(d) * stepA;
      // Si en la nueva pose el brazo o la garra se meterían en la madera, el brazo topa y se queda
      // (si ya estaba metido, p. ej. por un empujón, lo deja moverse para que se zafe)
      const held = this.critical ? 'critical' : this.inClaw ? 'sample' : null;
      const n = this.inClawCount;
      this.armBlocked = next !== this.angle && this.phys.armHitsField(next, held, n) && !this.phys.armHitsField(this.angle, held, n);
      const prevAngle = this.angle;
      if (!this.armBlocked) this.angle = next;
      this.armW = (this.angle - prevAngle) / dt;
      this.height = this.angle === g && !task ? goal : armTip(s.arm, this.angle).y;
      // En la boca del hopper: pasa la Muestra después de `transferTime`
      if (task && this.angle === g) {
        this.transferT += dt;
        if (this.transferT >= (s.arm.transferTime ?? 0.25)) {
          this.transferT = 0;
          this.inClaw = task === 'fetch';
        }
      } else this.transferT = 0;
    }
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.ejectT = Math.max(0, this.ejectT - dt);
    this.updateLeaving(dt);
    this.rollerContacts = 0;
    // Al soltar en el piso, los rodillos giran al revés y la sacan de la caja
    if (this.ejectT > 0 && intakeOf(s).rollers && this.height < FLOOR_POSE) this.runRollers(events, dt, -1);
    else if (this.latched && this.clawClosed && this.closeWindow > 0 && this.stored.length < this.capacity && !this.jammed) {
      this.closeWindow = Math.max(0, this.closeWindow - dt);
      if (!this.critical && !this.inClaw) this.grabCritical(events);
      this.runClaw(events, dt);
    } else if (!this.latched && this.intakeOn && this.stored.length < this.capacity && !this.jammed) this.runClaw(events, dt);
    else this.closing = null;
    this.syncHitbox();
  }

  /** Pulsación del botón de la garra de pinza: cierra (intenta tomar lo que tenga entre los dedos) o abre (suelta lo que traiga). */
  toggleClaw(events: MechEvent[]): void {
    this.latched = true;
    if (!this.clawClosed) {
      this.clawClosed = true;
      this.intakeOn = true;
      this.closeWindow = intakeOf(this.phys.spec).closeTime + 0.2;
      if (!this.critical) this.grabCritical(events);
    } else {
      if (this.critical) this.release('critical', events, true);
      else if (this.inClaw) this.release('sample', events);
      this.clawClosed = false;
      this.intakeOn = false;
      this.closeWindow = 0;
      this.closing = null;
    }
  }

  /** Pone los colisionadores del brazo y la garra donde está el brazo (con la pieza que lleva). */
  syncHitbox(): void {
    // Las Muestras de la garra (hasta dos apiladas con `holdsTwo`) chocan con todo
    // El lanzador lleva las Muestras dentro de su rampa (ya dentro del casco del CAD): al choque solo suma una
    const n = intakeOf(this.phys.spec).shooter ? Math.min(1, this.inClawCount) : this.inClawCount;
    this.phys.setArmPose(this.angle, this.critical ? 'critical' : this.inClaw ? 'sample' : null, n);
  }

  /** Muestras en la garra (con `holdsTwo` todas las guardadas; si no, 0 o 1). */
  get inClawCount(): number {
    if (!this.inClaw) return 0;
    return this.phys.spec.arm.holdsTwo ? this.stored.length : 1;
  }

  private resetArm(): void {
    const s = this.phys.spec;
    this.stowed = s.arm.stowAngle !== undefined;
    this.transferT = 0;
    this.armBlocked = false;
    // Pose plegada = pose de piso: mismo ángulo (módulo 2π) que `posAngle(s, 0)`; se usa esa rama para que el
    // brazo no dé una vuelta completa al salir de la pose guardada
    const floor = posAngle(s, 0);
    this.angle = s.arm.stowAngle === undefined || Math.cos(s.arm.stowAngle - floor) > 0.9999 ? floor : s.arm.stowAngle;
    this.height = armTip(s.arm, this.angle).y;
  }

  /** Garra: con el brazo abajo y vacía, agarra la Muestra que queda entre sus dedos. */
  private runClaw(events: MechEvent[], dt: number): void {
    if (this.critical || (this.inClaw && !this.phys.spec.arm.holdsTwo) || this.height > FLOOR_POSE || this.cooldown > 0 || this.hopperTask()) {
      this.closing = null;
      return;
    }
    const p = this.phys;
    const base = p.position().y;
    // Pinza (sin ruedas): agarre preciso con su tiempo de cierre; compliants: según `grip` (Ajustes)
    const intake = intakeOf(p.spec);
    const CLAW = clawOf(p.spec);
    const mode: GripMode = intake.kind === 'pinza' ? 'precise' : this.grip;
    if (intake.rollers && intake.kind !== 'pinza' && mode !== 'easy') return this.runRollers(events, dt);
    // Lugar de la Muestra en la garra (agarre preciso): recargada en la placa (del lado del brazo)
    const dir = clawDir(this.angle, this.phys.spec.arm);
    const tip = this.tipX();
    let cx = tip - dir * (CLAW.fingerLength / 2 - SAMPLE_SIZE / 2);
    // Si la placa queda dentro del chasis, la Muestra se recarga en el chasis
    // (robots del CAD con `footprint`: la garra trabaja dentro del canal abierto del chasis, sin recargar)
    if (!p.spec.footprint?.length) {
      const stop = p.halfL + SAMPLE_SIZE / 2;
      cx = dir > 0 ? Math.max(cx, stop) : Math.min(cx, -stop);
    }
    // Compliants: de la placa (o el chasis) a la punta de los dedos, más lo que alcanzan las ruedas
    const back = Math.max(0, Math.abs(cx) - SAMPLE_SIZE / 2);
    const front = Math.abs(tip) + CLAW.fingerLength / 2 + SAMPLE_SIZE / 2 + COMPLIANT.reachFront;
    // De lado basta con que la Muestra toque la rueda (su borde llega al centro del dedo)
    const side = CLAW.fingerZ + SAMPLE_SIZE / 2;
    const h = p.heading();
    let found: { piece: Piece; yaw: number } | null = null;
    for (const piece of this.pieces.list) {
      if (piece.kind !== 'sample' || piece.state.at !== 'field') continue;
      const t = piece.body.translation();
      if (t.y - base > 0.2) continue;
      // Las anotadas quedan en el piso del pozo, tras paredes de 200–800 mm (§3.2.3): la garra no las saca
      if (inCamara(t.x, t.z)) continue;
      const { lx, lz } = p.worldToLocalFlat(t.x, t.z);
      if (this.latched && intake.kind === 'pinza') {
        // Pinza con interruptor (Xhavi, 16-nov: "injugable, imposible agarrar"): cualquier Muestra dentro de la boca abierta
        // (los dedos del CAD abren a ±0.14 m) se toma; al cerrar los dedos la acomodan y la aprietan, así que no hace falta
        // que llegue derecha. Solo no sirve una volteada sobre una arista.
        if (Math.abs(lx - tip) > 0.11 || Math.abs(lz) > 0.12) continue;
        if (cubeAlignment(piece.body.rotation(), h).tilt > GRIP.maxTilt) continue;
        found = { piece, yaw: 0 };
        break;
      }
      if (mode === 'easy') {
        if (Math.abs(lx - tip) > 0.12 || Math.abs(lz) > 0.12) continue;
        found = { piece, yaw: 0 };
        break;
      }
      if (mode === 'compliant') {
        // Cualquier giro o inclinación: las ruedas la acomodan
        const ax = lx * dir;
        if (ax < back || ax > front || Math.abs(lz) > side) continue;
        found = { piece, yaw: 0 };
        break;
      }
      if (Math.abs(lx - cx) > GRIP.pocketX || Math.abs(lz) > Math.min(GRIP.pocketZ, Math.max(0.01, (intake.gap - SAMPLE_SIZE) / 2))) continue;
      const al = cubeAlignment(piece.body.rotation(), h);
      if (al.yaw > GRIP.maxYaw || al.tilt > GRIP.maxTilt) continue;
      found = { piece, yaw: al.yaw };
      break;
    }
    if (!found) {
      this.closing = null;
      return;
    }
    const piece = found.piece;
    if (mode !== 'easy') {
      // La garra tarda en cerrar; si la Muestra se sale (o es otra), empieza de nuevo
      if (!this.closing || this.closing.piece !== piece.index) this.closing = { piece: piece.index, t: 0 };
      this.closing.t += dt;
      if (this.closing.t < (mode === 'compliant' ? COMPLIANT.closeTime / Math.max(0.3, intake.rollerSpeed) : intake.kind === 'pinza' ? intake.closeTime : GRIP.closeTime)) return;
      this.closing = null;
      const v = p.body.linvel();
      const pv = piece.body.linvel();
      const rel = Math.hypot(v.x - pv.x, v.z - pv.z);
      if (this.rand() < missChance(Math.max(rel, Math.hypot(v.x, v.z)), found.yaw, mode)) {
        // Se resbala: la garra la empuja un poco y vuelve a abrir
        const fwd = { x: Math.cos(h) * dir, z: -Math.sin(h) * dir };
        piece.body.applyImpulse({ x: fwd.x * 0.08, y: 0.02, z: fwd.z * 0.08 }, true);
        this.cooldown = mode === 'compliant' ? COMPLIANT.retry : GRIP.retry;
        events.push({ type: 'grabMiss', robot: p.index, piece: piece.index });
        return;
      }
    }
    this.pieces.stash(piece, { at: 'robot', robot: p.index });
    this.stored.push(piece);
    this.inClaw = true;
    events.push({ type: 'intake', robot: p.index, piece: piece.index });
  }

  /**
   * Garra-caja con rodillos: jala por fricción cada Muestra que toca la boca (fuerza limitada por
   * `ROLLERS.mu · squeeze`) hacia adentro, centrándola y enderezándola; la da por agarrada cuando llega
   * a su lugar (la placa del fondo o, si ya trae una, detrás de esa). Todo en el plano del piso.
   * Con `sense = −1` (al soltar) giran al revés y empujan hacia afuera la que sigue en la caja.
   */
  private runRollers(events: MechEvent[], dt: number, sense: 1 | -1 = 1): void {
    const p = this.phys;
    const s = p.spec;
    const intake = intakeOf(s);
    const CLAW = clawOf(s);
    const S = SAMPLE_SIZE;
    const dir = clawDir(this.angle, s.arm);
    const tip = this.tipX();
    const mouth = tip + dir * (CLAW.fingerLength / 2);
    const held = this.inClawCount;
    // Profundidad (desde la boca hacia adentro) a la que queda el centro de la siguiente Muestra
    const seat = (mouth - seatX(s, tip, dir, held)) * dir;
    const free = Math.max(0, (intake.gap - S) / 2);
    const latMax = intake.gap / 2 + S / 2 - ROLLERS.minOverlap;
    const base = p.position().y;
    const h = p.heading();
    const ch = Math.cos(h);
    const sh = Math.sin(h);
    // Ejes en el mundo (x, z): `lx` (adelante del robot) y `lz` (ver `worldToLocalFlat`)
    const ex = { x: ch, z: -sh };
    const ez = { x: sh, z: ch };
    const rp = p.position();
    const rv = p.body.linvel();
    const wy = p.body.angvel().y;
    let best: { piece: Piece; t: number } | null = null;
    for (const piece of this.pieces.list) {
      if (piece.kind !== 'sample' || piece.state.at !== 'field') continue;
      const t = piece.body.translation();
      if (Math.abs(t.y - (base + this.height + S / 2)) > 0.12 || inCamara(t.x, t.z)) continue;
      const { lx, lz } = p.worldToLocalFlat(t.x, t.z);
      const d = (mouth - lx) * dir;
      // Giro respecto a la garra (a la cara más cercana) y lo que mide girada a lo largo de la garra
      const { faceYaw } = cubePose(piece.body.rotation());
      let err = (((faceYaw - h) % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
      if (err > Math.PI / 4) err -= Math.PI / 2;
      const half = (S / 2) * (Math.abs(Math.cos(err)) + Math.abs(Math.sin(err)));
      if (d < -(half + ROLLERS.reach) || d > seat + 0.06 || Math.abs(lz) > latMax) continue;
      this.rollerContacts++;
      // Contacto: crece mientras la Muestra entra (con la orilla apenas la rozan)
      const contact = Math.min(1, (d + half + ROLLERS.reach) / ROLLERS.reach);
      // Velocidad del robot en ese punto (v + ω × r)
      const vpx = rv.x + wy * (t.z - rp.z);
      const vpz = rv.z - wy * (t.x - rp.x);
      // Lo que quieren las ruedas: adentro a la velocidad de su superficie (más lento si aún no cabe
      // entre los costados, mientras la centran), hacia el centro y sin pasarse de su lugar
      const lat = Math.abs(lz);
      const inward =
        sense < 0
          ? -OUTTAKE.spit
          : (lat <= free + 0.01 ? intake.rollerSpeed : 0.25 * intake.rollerSpeed) * Math.min(1, Math.max(0, (seat - d) * 10 + 0.15));
      const side = sense < 0 ? 0 : -Math.sign(lz) * Math.min(ROLLERS.centerMax, ROLLERS.centerGain * lat);
      // "Adentro" = hacia la placa = −dir en x local
      const tx = vpx + ex.x * (-dir * inward) + ez.x * side;
      const tz = vpz + ex.z * (-dir * inward) + ez.z * side;
      const v = piece.body.linvel();
      let jx = tx - v.x;
      let jz = tz - v.z;
      const m = piece.body.mass();
      const jMax = (ROLLERS.mu * ROLLERS.squeeze * contact * dt) / Math.max(1e-6, m);
      const jl = Math.hypot(jx, jz);
      if (jl > jMax) {
        jx *= jMax / jl;
        jz *= jMax / jl;
      }
      piece.body.applyImpulse({ x: jx * m, y: 0, z: jz * m }, true);
      // Enderezar: gira hacia la cara más cercana al eje de la garra
      const w = piece.body.angvel();
      const wt = wy - ROLLERS.alignGain * err;
      // Par máximo de las ruedas = fricción · palanca; inercia de un cubo m·S²/6
      const aMax = (ROLLERS.mu * ROLLERS.squeeze * contact * ROLLERS.alignLever) / Math.max(1e-6, (m * S * S) / 6);
      const dw = Math.max(-aMax * dt, Math.min(aMax * dt, wt - w.y));
      piece.body.setAngvel({ x: w.x * 0.9, y: w.y + dw, z: w.z * 0.9 }, true);
      // ¿Ya llegó a su lugar? Su cara del fondo (girada ocupa más) toca la placa o la primera Muestra:
      // ahí los rodillos la aprietan y la emparejan
      const reachIn = d + half;
      if (sense > 0 && reachIn >= seat + S / 2 - ROLLERS.seatTol && lat <= ROLLERS.seatLat && (!best || d > best.t)) best = { piece, t: d };
    }
    if (!best) {
      this.closing = null;
      return;
    }
    const piece = best.piece;
    this.closing = null;
    this.pieces.stash(piece, { at: 'robot', robot: p.index });
    this.stored.push(piece);
    this.inClaw = true;
    events.push({ type: 'intake', robot: p.index, piece: piece.index });
  }

  /** Segundos que lleva cerrando la garra sobre una Muestra (0 si no). Para la UI. */
  get closingFor(): number {
    return this.closing?.t ?? 0;
  }

  /** Recibe una pieza directamente (precarga, §4.1). */
  load(piece: Piece): void {
    this.pieces.stash(piece, { at: 'robot', robot: this.phys.index });
    if (piece.kind === 'critical') this.critical = piece;
    else {
      // La lleva en la garra (si la garra ya trae una, va al hopper)
      if (!this.inClaw || this.phys.spec.arm.holdsTwo) {
        this.stored.push(piece);
        this.inClaw = true;
      } else this.stored.unshift(piece);
    }
    this.syncHitbox();
  }

  /**
   * Garra: toma la Muestra Crítica de su alianza si está al alcance de la garra y a su altura (en la
   * rendija de la Campana, en el piso o en la Repisa). Las del hopper no estorban; la garra, sí.
   */
  grabCritical(events: MechEvent[]): boolean {
    // La garra tiene que estar del lado donde toma la Crítica (no guardada ni volteada al otro)
    if (!(canHoldCritical(this.phys.spec) || canPassCritical(this.phys.spec)) || this.critical || this.inClaw || clawDir(this.angle, this.phys.spec.arm) !== posDir(this.phys.spec, 4)) return false;
    const p = this.phys;
    const c = this.pieces.critical(this.alliance);
    if (c.state.at !== 'field') return false;
    const t = c.body.translation();
    const { lx, lz } = p.worldToLocalFlat(t.x, t.z);
    const carriage = p.position().y + this.height;
    // Phoenix (pase): los compliants jalan la Crítica de 20 cm aunque la espuma topa con los rodillos (a más de 18 cm de altura): alcanza hasta 30 cm de la punta (SUPUESTO)
    const reach = canPassCritical(this.phys.spec) ? 0.3 : 0.2;
    const ok = Math.abs(lx - this.tipX()) < reach && Math.abs(lz) < 0.3 && t.y > carriage - 0.2 && t.y < carriage + 0.35;
    if (!ok) return false;
    this.pieces.stash(c, { at: 'robot', robot: p.index });
    this.critical = c;
    events.push({ type: 'grabCritical', robot: p.index, piece: c.index });
    this.syncHitbox();
    return true;
  }

  /**
   * Suelta una pieza (Muestra o Crítica) en la punta de la garra, a su altura. La Crítica sale sin
   * empujón (con empujón rebotaba y se pasaba de la Repisa); la Muestra, con el de las ruedas
   * (`OUTTAKE`). Suelta lo que trae en la garra (no lo del hopper).
   */
  release(kind: 'sample' | 'critical', events: MechEvent[], force = false): boolean {
    if (this.cooldown > 0 && !force) return false;
    if (kind === 'sample' && !this.inClaw) return false;
    if (this.latched) {
      // Soltar abre la garra
      this.clawClosed = false;
      this.intakeOn = false;
      this.closeWindow = 0;
    }
    const piece = kind === 'critical' ? this.critical : this.stored[this.stored.length - 1];
    if (!piece) return false;
    // Garra con rodillos: sale de su lugar en la fila (la de afuera primero)
    const rollers = kind === 'sample' && intakeOf(this.phys.spec).rollers === true;
    // Muestras en la rampa del lanzador al tirar (la que sale cuenta): más cargado, más débil el tiro
    const loaded = this.stored.length;
    const slot = Math.max(0, this.inClawCount - 1);
    if (kind === 'critical') this.critical = null;
    else {
      this.stored.pop();
      this.inClaw = this.phys.spec.arm.holdsTwo === true && this.stored.length > 0;
    }
    const p = this.phys;
    const size = this.pieces.size(piece);
    const intake = intakeOf(p.spec);
    const spec = p.spec;
    const h = p.heading();
    // Pinza (Axiom): la Muestra sale por la boca con el empujón de siempre y sin chocar con el brazo hasta que se aleja
    // (antes caía en el sitio sobre la viga y la placa de la garra y se quedaba trabada, Xhavi 16-nov)
    const pinza = kind === 'sample' && !force && intake.kind === 'pinza';
    const push = kind === 'sample' && !force && ((intake.kind === 'compliant' && this.grip !== 'precise') || pinza);
    const spit = rollers ? OUTTAKE.spit : intake.rollerSpeed;
    // Garra-caja fija al brazo (Psycho): la Muestra sale de la boca REAL de la caja, donde esté en ese
    // instante, y lleva la velocidad de la boca (robot + giro del chasis + giro del brazo) más la escupida
    // a lo largo de la boca (Xhavi, 13-nov: "que las escupa desde la posición que se encuentre el gripper").
    // Lo demás: de la punta con el empujón horizontal de siempre.
    let loc: { x: number; y: number };
    let vl: { x: number; y: number };
    if (rollers && p.rigidFloorAngle !== null) {
      const d0 = clawDir(p.rigidFloorAngle, spec.arm);
      const m = p.boxMouthDir(this.angle);
      loc = p.boxToLocal(this.angle, seatX(spec, 0, d0, slot), size / 2);
      const piv = { x: spec.arm.pivotX, y: spec.arm.pivotY };
      // Velocidad de ese punto por el giro del brazo: ω × (r − pivote)
      const rx = loc.x - piv.x;
      const ry = loc.y - piv.y;
      vl = { x: -this.armW * ry + (push ? spit * m.x : 0), y: this.armW * rx + (push ? spit * m.y : 0) };
    } else {
      const dir = clawDir(this.angle, spec.arm);
      const lx = rollers && this.height < FLOOR_POSE ? seatX(spec, this.tipX(), dir, slot) : this.tipX();
      // Garra del CAD centrada en la punta (Axiom): la Muestra sale del centro de los dedos
      loc = { x: lx, y: p.centeredClaw ? this.height : this.height + size / 2 };
      vl = { x: push ? spit * dir : 0, y: 0 };
    }
    // Lanzador (Phoenix): en N1–N3 la Muestra sale disparada hacia el pozo de ese nivel; sale de la boca del lanzador si el CAD la fija
    // Pase (Phoenix, `passCritical`): soltar con la Crítica la lanza hacia la zona de entrega, sin anotarla
    const passing = kind === 'critical' && !force && intake.shooter?.passCritical === true;
    const shooter = passing || (kind === 'sample' && !force && this.target >= 1 && this.target <= 3) ? intake.shooter : undefined;
    if (shooter?.muzzle) loc = { x: shooter.muzzle.x, y: shooter.muzzle.y };
    const at = p.localToWorld(loc.x, loc.y, 0);
    const v = p.body.linvel();
    const wy = p.body.angvel().y;
    const rp = p.position();
    // v del punto = v + ω_chasis × r (sin la parte vertical del giro del chasis, que no se da)
    let vx = v.x + wy * (at.z - rp.z) + Math.cos(h) * vl.x;
    let vz = v.z - wy * (at.x - rp.x) - Math.sin(h) * vl.x;
    // La velocidad la pide la distancia (como una tabla de tiro); el rumbo es el del robot, así que hay que apuntar, y cada tiro varía un poco
    let vy = vl.y;
    if (shooter) {
      let dist: number;
      let dh: number;
      if (passing) {
        // Hacia donde apunta el robot, hasta la zona de entrega (o hasta donde alcance, `clipped`); cae a ras de piso
        const s = this.alliance === 'red' ? 1 : -1;
        dist = Math.max(PASS_MIN, Math.hypot(s * PASS_TARGET.x - at.x, PASS_TARGET.z - at.z));
        dh = CRITICAL_SIZE / 2 - at.y;
      } else {
        const level = this.target as 1 | 2 | 3;
        const well = camaraWells()[level];
        const r = rectForCamara(this.alliance, well);
        dist = Math.max(0.3, (((r.x0 + r.x1) / 2 - at.x) * Math.cos(h)) - (((r.z0 + r.z1) / 2 - at.z) * Math.sin(h)));
        dh = well.rim + SHOT_AIM_ABOVE - at.y;
      }
      const sh = shotVelocity(shooter, dist, dh, this.rand, loaded);
      const hy = h + sh.yaw;
      vx = v.x + wy * (at.z - rp.z) + Math.cos(hy) * sh.speed * Math.cos(sh.pitch);
      vz = v.z - wy * (at.x - rp.x) - Math.sin(hy) * sh.speed * Math.cos(sh.pitch);
      vy = sh.speed * Math.sin(sh.pitch);
    }
    // Con la caja del CAD, la Muestra sale con la inclinación de la caja (igual que la lleva)
    const tilt = rollers && p.rigidFloorAngle !== null ? this.angle - p.rigidFloorAngle : 0;
    this.pieces.place(piece, at.x, at.y, at.z, h, { x: vx, y: vy, z: vz }, tilt);
    if (tilt !== 0 || shooter || pinza) {
      this.finishLeaving();
      // Tiro: sale por dentro del robot (la rampa va entre sus placas), así que no choca con él hasta salir
      piece.collider.setCollisionGroups(shooter ? GROUPS.pieceShot : GROUPS.pieceLeaving);
      this.leaving = piece;
      this.leavingShot = !!shooter;
      this.leavingT = shooter ? SHOT_EXIT : EXIT_MAX;
    }
    piece.lastRobot = p.index;
    this.cooldown = EJECT_COOLDOWN;
    if (push && rollers && this.height < FLOOR_POSE) {
      // En el piso las ruedas giran hacia afuera hasta que sale toda de la caja (desde su lugar en la fila)
      const dir = clawDir(this.angle, spec.arm);
      const mouth = this.tipX() + dir * (clawOf(spec).fingerLength / 2);
      const toExit = (mouth - loc.x) * dir + size / 2 + 0.02;
      this.ejectT = Math.max(ROLLERS.ejectTime, toExit / OUTTAKE.spit + 0.1);
    }
    events.push({ type: 'release', robot: p.index, piece: piece.index });
    this.syncHitbox();
    return true;
  }

  /** La Muestra recién soltada vuelve a chocar con el brazo cuando ya salió (o si algo la agarró). */
  private updateLeaving(dt: number): void {
    const l = this.leaving;
    if (!l) return;
    this.leavingT -= dt;
    let clear = this.leavingT <= 0 || l.state.at !== 'field';
    if (!clear && !this.leavingShot) {
      const t = l.body.translation();
      const p = this.phys.worldToLocalFlat(t.x, t.z);
      // `height` es local al robot: se compara con la altura del robot sumada (si no, 13 cm de más la dan por salida)
      clear = Math.hypot(p.lx - this.tipX(), t.y - this.phys.position().y - this.height) > EXIT_CLEAR;
    }
    if (clear) this.finishLeaving();
  }

  private finishLeaving(): void {
    if (this.leaving) this.leaving.collider.setCollisionGroups(GROUPS.piece);
    this.leaving = null;
  }

  /** Vacía el robot (reinicio). */
  clear(): void {
    this.finishLeaving();
    this.stored.length = 0;
    this.critical = null;
    this.inClaw = false;
    this.intakeOn = false;
    this.clawClosed = false;
    this.closeWindow = 0;
    this.target = 0;
    this.height = this.phys.spec.elevatorHeights[0];
    this.closing = null;
    this.cooldown = 0;
    this.ejectT = 0;
    this.jammed = false;
    this.armScale = 1;
    this.resetArm();
    this.syncHitbox();
  }
}
