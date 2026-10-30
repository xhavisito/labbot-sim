/**
 * Mecanismos del pivote (`RobotSpec.arm`; los dos tipos del simulador, `config/robot.ts`): brazo con
 * garra. Agarra una pieza del piso con el brazo abajo y la suelta en la punta (atrás en N1–N3 si el
 * brazo voltea, `ArmSpec.scoreBack`: la punta queda detrás del robot). Empieza guardado
 * (`ArmSpec.stowAngle`) y sale de ahí al primer mando. Lleva una pieza a la vez (capacidad 1); con
 * capacidad > 1 (un hopper, ya sin tipo que lo use) la garra pasa cada Muestra a la boca del hopper
 * (`ArmSpec.hopperAngle`) y la saca de ahí para anotar.
 * Las piezas guardadas son lógicas (cuerpo deshabilitado); al soltarlas vuelven a la física en la
 * punta del mecanismo, así que anotar depende de dónde caen (lo detecta la sesión).
 *
 * Agarre (Xhavi, 29-oct: "se me hace extremadamente fácil recoger las muestras"): la garra ya no
 * "absorbe" lo que está cerca. Tiene dedos con colisión (`RobotPhysics.setArmPose`), así que la
 * Muestra tiene que entrar de verdad entre ellos (`CLAW_GAP`) hasta la placa, y casi derecha (≲18°).
 * Ahí la garra tarda `GRIP.closeTime` en cerrar (si la Muestra se sale en ese tiempo, no la toma) y
 * puede resbalarse: la probabilidad crece con la velocidad de llegada y el giro de la pieza. Todos
 * esos números son SUPUESTOS de diseño (el manual no habla de mecanismos, §7.2).
 */
import { inCamara } from '../config/field';
import { CLAW, CLAW_GAP, armTip, posAngle, type ElevatorPos } from '../config/robot';
import { SAMPLE_SIZE } from '../config/field';
import { clawDir } from '../physics/RobotPhysics';
import type { Alliance } from '../core/types';
import type { Piece, Pieces } from '../physics/Pieces';
import type { RobotPhysics } from '../physics/RobotPhysics';

export type MechEvent =
  | { type: 'intake'; robot: number; piece: number }
  | { type: 'grabCritical'; robot: number; piece: number }
  | { type: 'release'; robot: number; piece: number }
  /** La garra cerró pero la Muestra se le resbaló (agarre realista). */
  | { type: 'grabMiss'; robot: number; piece: number };

/**
 * Agarre realista (SUPUESTOS de diseño). `easy` = el agarre de antes (toma lo que quede a 12 cm de
 * la punta, sin alinear ni fallar), para quien empieza.
 */
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

export type GripMode = 'real' | 'easy';

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

/** Probabilidad de que la Muestra se resbale al cerrar la garra (agarre realista). Pura. */
export function missChance(relSpeed: number, yaw: number): number {
  const p = GRIP.baseMiss + GRIP.missPerSpeed * Math.max(0, relSpeed - GRIP.safeSpeed) + GRIP.missPerYaw * Math.min(1, yaw / GRIP.maxYaw);
  return Math.max(0, Math.min(0.95, p));
}

/** Tiempo mínimo entre dos piezas soltadas (s). SUPUESTO. */
const EJECT_COOLDOWN = 0.35;

export class Mechanisms {
  intakeOn = false;
  readonly stored: Piece[] = [];
  critical: Piece | null = null;
  target: ElevatorPos = 0;
  /** Altura actual de la punta de la garra (fondo de la pieza, m sobre la base del robot). */
  height: number;
  /** Ángulo del brazo (rad, 0 = horizontal hacia adelante). */
  angle = 0;
  /** Brazo en su posición de guardado del inicio. */
  stowed = false;
  /** La garra lleva una Muestra (la última de `stored`); las demás van en el hopper. */
  inClaw = false;
  /** Segundos con la garra en la boca del hopper (pasando una Muestra). */
  private transferT = 0;
  private cooldown = 0;
  /** Agarre realista: Muestra entre los dedos mientras la garra cierra, y cuánto lleva cerrando. */
  private closing: { piece: number; t: number } | null = null;
  /** Agarre: realista o fácil (el de antes). */
  grip: GripMode = 'real';
  /** Azar del agarre (la sesión le da uno con semilla). */
  rand: () => number = Math.random;
  /** Fallas (`game/Damage.ts`): la garra atascada no cierra. */
  jammed = false;
  /** Fallas: fracción de la velocidad del brazo (1 = sano). */
  armScale = 1;

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
    if (this.stowed) return null;
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
      this.angle = Math.abs(d) <= stepA ? g : this.angle + Math.sign(d) * stepA;
      this.height = Math.abs(d) <= stepA && !task ? goal : armTip(s.arm, this.angle).y;
      // En la boca del hopper: pasa la Muestra después de `transferTime`
      if (task && Math.abs(d) <= stepA) {
        this.transferT += dt;
        if (this.transferT >= (s.arm.transferTime ?? 0.25)) {
          this.transferT = 0;
          this.inClaw = task === 'fetch';
        }
      } else this.transferT = 0;
    }
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.intakeOn && this.stored.length < this.capacity && !this.jammed) this.runClaw(events, dt);
    else this.closing = null;
    this.syncHitbox();
  }

  /** Pone los colisionadores del brazo y la garra donde está el brazo (con la pieza que lleva). */
  syncHitbox(): void {
    this.phys.setArmPose(this.angle, this.critical ? 'critical' : this.inClaw ? 'sample' : null);
  }

  private resetArm(): void {
    const s = this.phys.spec;
    this.stowed = s.arm.stowAngle !== undefined;
    this.transferT = 0;
    this.angle = s.arm.stowAngle ?? posAngle(s, 0);
    this.height = armTip(s.arm, this.angle).y;
  }

  /** Garra: con el brazo abajo y vacía, agarra la Muestra que queda entre sus dedos. */
  private runClaw(events: MechEvent[], dt: number): void {
    if (this.critical || this.inClaw || this.height > 0.06 || this.cooldown > 0 || this.hopperTask()) {
      this.closing = null;
      return;
    }
    const p = this.phys;
    const base = p.position().y;
    const easy = this.grip === 'easy';
    // Lugar de la Muestra en la garra: recargada en la placa (del lado del brazo)
    const dir = clawDir(this.angle);
    let cx = this.tipX() - (easy ? 0 : dir * (CLAW.fingerLength / 2 - SAMPLE_SIZE / 2));
    // Si la placa queda dentro del chasis, la Muestra se recarga en el chasis
    const stop = p.halfL + SAMPLE_SIZE / 2;
    if (!easy) cx = dir > 0 ? Math.max(cx, stop) : Math.min(cx, -stop);
    const h = p.heading();
    let found: { piece: Piece; yaw: number } | null = null;
    for (const piece of this.pieces.list) {
      if (piece.kind !== 'sample' || piece.state.at !== 'field') continue;
      const t = piece.body.translation();
      if (t.y - base > 0.2) continue;
      // Las anotadas quedan en el piso del pozo, tras paredes de 200–800 mm (§3.2.3): la garra no las saca
      if (inCamara(t.x, t.z)) continue;
      const { lx, lz } = p.worldToLocalFlat(t.x, t.z);
      if (easy) {
        if (Math.abs(lx - this.tipX()) > 0.12 || Math.abs(lz) > 0.12) continue;
        found = { piece, yaw: 0 };
        break;
      }
      if (Math.abs(lx - cx) > GRIP.pocketX || Math.abs(lz) > GRIP.pocketZ) continue;
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
    if (!easy) {
      // La garra tarda en cerrar; si la Muestra se sale (o es otra), empieza de nuevo
      if (!this.closing || this.closing.piece !== piece.index) this.closing = { piece: piece.index, t: 0 };
      this.closing.t += dt;
      if (this.closing.t < GRIP.closeTime) return;
      this.closing = null;
      const v = p.body.linvel();
      const pv = piece.body.linvel();
      const rel = Math.hypot(v.x - pv.x, v.z - pv.z);
      if (this.rand() < missChance(Math.max(rel, Math.hypot(v.x, v.z)), found.yaw)) {
        // Se resbala: la garra la empuja un poco y vuelve a abrir
        const fwd = { x: Math.cos(h) * dir, z: -Math.sin(h) * dir };
        piece.body.applyImpulse({ x: fwd.x * 0.08, y: 0.02, z: fwd.z * 0.08 }, true);
        this.cooldown = GRIP.retry;
        events.push({ type: 'grabMiss', robot: p.index, piece: piece.index });
        return;
      }
    }
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
      if (!this.inClaw) {
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
    if (this.critical || this.inClaw || this.angle > Math.PI / 2) return false;
    const p = this.phys;
    const c = this.pieces.critical(this.alliance);
    if (c.state.at !== 'field') return false;
    const t = c.body.translation();
    const { lx, lz } = p.worldToLocalFlat(t.x, t.z);
    const carriage = p.position().y + this.height;
    const ok = Math.abs(lx - this.tipX()) < 0.2 && Math.abs(lz) < 0.3 && t.y > carriage - 0.2 && t.y < carriage + 0.35;
    if (!ok) return false;
    this.pieces.stash(c, { at: 'robot', robot: p.index });
    this.critical = c;
    events.push({ type: 'grabCritical', robot: p.index, piece: c.index });
    this.syncHitbox();
    return true;
  }

  /**
   * Suelta una pieza (Muestra o Crítica) en la punta de la garra, a su altura. La garra solo abre
   * (sin empujón): suelta desde alto y, con empujón, la Crítica rebotaba y se pasaba de la Repisa.
   * Suelta lo que trae en la garra (no lo del hopper).
   */
  release(kind: 'sample' | 'critical', events: MechEvent[], force = false): boolean {
    if (this.cooldown > 0 && !force) return false;
    if (kind === 'sample' && !this.inClaw) return false;
    const piece = kind === 'critical' ? this.critical : this.stored[this.stored.length - 1];
    if (!piece) return false;
    if (kind === 'critical') this.critical = null;
    else {
      this.stored.pop();
      this.inClaw = false;
    }
    const p = this.phys;
    const size = this.pieces.size(piece);
    const at = p.localToWorld(this.tipX(), this.height + size / 2, 0);
    const h = p.heading();
    const v = p.body.linvel();
    this.pieces.place(piece, at.x, at.y, at.z, h, { x: v.x, y: 0, z: v.z });
    piece.lastRobot = p.index;
    this.cooldown = EJECT_COOLDOWN;
    events.push({ type: 'release', robot: p.index, piece: piece.index });
    this.syncHitbox();
    return true;
  }

  /** Vacía el robot (reinicio). */
  clear(): void {
    this.stored.length = 0;
    this.critical = null;
    this.inClaw = false;
    this.intakeOn = false;
    this.target = 0;
    this.height = this.phys.spec.elevatorHeights[0];
    this.closing = null;
    this.cooldown = 0;
    this.jammed = false;
    this.armScale = 1;
    this.resetArm();
    this.syncHitbox();
  }
}
