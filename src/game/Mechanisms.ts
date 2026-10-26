/**
 * Mecanismos del robot según su tipo (`RobotSpec.mechanism`):
 * - generic: intake al piso, almacenamiento, elevador y depósito al frente, pinza para la Crítica.
 * - elevator: igual, pero la plataforma del elevador está atrás y empuja las piezas hacia atrás.
 * - pivot: brazo con garra; agarra una pieza del piso con el brazo abajo y la suelta en la punta.
 *   Empieza guardado (`ArmSpec.stowAngle`) y sale de ahí al primer mando.
 * - pivotHopper: el mismo brazo con garra y un hopper atrás. Con la garra encendida, cada Muestra que
 *   agarra del piso la lleva a la boca del hopper (`ArmSpec.hopperAngle`) y regresa al piso; con la
 *   garra apagada y vacía, el brazo saca la siguiente del hopper y vuelve a la posición pedida. La
 *   Crítica va en la garra aunque el hopper tenga Muestras.
 * - tower: intake al frente y torre fija: las Muestras salen atrás a `sampleExit`; el elevador solo
 *   mueve la pala de la Crítica, que está al frente.
 * - chassis: sin mecanismo: no toma ni suelta piezas; solo lleva la precarga.
 * Las piezas guardadas son lógicas (cuerpo deshabilitado); al soltarlas vuelven a la física en la
 * punta del mecanismo, así que anotar depende de dónde caen (lo detecta la sesión).
 */
import { inCamara } from '../config/field';
import { armAngle, armTip, hasArm, type ElevatorPos } from '../config/robot';
import type { Alliance } from '../core/types';
import type { Piece, Pieces } from '../physics/Pieces';
import type { RobotPhysics } from '../physics/RobotPhysics';

export type MechEvent =
  | { type: 'intake'; robot: number; piece: number }
  | { type: 'grabCritical'; robot: number; piece: number }
  | { type: 'release'; robot: number; piece: number };

/** Velocidad con la que sale la pieza del depósito, hacia adelante (m/s). SUPUESTO. */
const EJECT_SPEED = 0.6;
/** Tiempo mínimo entre dos piezas soltadas (s). SUPUESTO. */
const EJECT_COOLDOWN = 0.35;

export class Mechanisms {
  intakeOn = false;
  readonly stored: Piece[] = [];
  critical: Piece | null = null;
  target: ElevatorPos = 0;
  /** Altura actual del elevador (fondo de la pieza, m sobre la base del robot). */
  height: number;
  /** Ángulo del brazo (solo pivote; rad, 0 = horizontal). */
  angle = 0;
  /** Brazo del pivote en su posición de guardado del inicio. */
  stowed = false;
  /** Pivote: la garra lleva una Muestra (la última de `stored`); en `pivotHopper` las demás van en el hopper. */
  inClaw = false;
  /** `pivotHopper`: segundos con la garra en la boca del hopper (pasando una Muestra). */
  private transferT = 0;
  private cooldown = 0;

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

  /** +1 si las Muestras salen por el frente, −1 si salen por atrás (elevador o torre). */
  get side(): 1 | -1 {
    const k = this.phys.spec.mechanism;
    return k === 'elevator' || k === 'tower' ? -1 : 1;
  }

  /** ¿Puede soltar una Muestra ya? (elevador o brazo en su posición; la torre siempre). */
  get atTarget(): boolean {
    const s = this.phys.spec;
    const k = s.mechanism;
    if (k === 'tower' || k === 'chassis') return true;
    // El brazo se compara por ángulo: de camino al hopper pasa por las mismas alturas, hacia atrás
    if (k === 'pivotHopper' && s.arm) return !this.stowed && this.hopperTask() === null && Math.abs(this.angle - armAngle(s.arm, s.elevatorHeights[this.target])) < 0.01;
    return Math.abs(this.height - s.elevatorHeights[this.target]) < 0.01;
  }

  /** Muestras en el hopper (las guardadas que no van en la garra). */
  get inHopper(): number {
    return this.phys.spec.mechanism === 'pivotHopper' ? this.stored.length - (this.inClaw ? 1 : 0) : 0;
  }

  /**
   * `pivotHopper`: ¿el brazo tiene que ir a la boca del hopper? 'store' si trae una Muestra en la
   * garra, la garra está encendida y cabe; 'fetch' si la garra está apagada y vacía (sin la Crítica)
   * y hay Muestras en el hopper, salvo en la posición 4 (ahí se espera la Crítica con la garra vacía).
   */
  hopperTask(): 'store' | 'fetch' | null {
    if (this.phys.spec.mechanism !== 'pivotHopper' || this.stowed) return null;
    if (this.inClaw && this.intakeOn && this.inHopper < this.capacity - 1) return 'store';
    if (!this.inClaw && !this.critical && !this.intakeOn && this.inHopper > 0 && this.target !== 4) return 'fetch';
    return null;
  }

  /** Posición local (adelante) del centro de una pieza de lado `size` en la punta del mecanismo. */
  tipX(size: number, kind: 'sample' | 'critical' = 'sample'): number {
    const s = this.phys.spec;
    if (hasArm(s.mechanism) && s.arm) return armTip(s.arm, this.angle).x;
    // La pala de la torre está al frente
    if (s.mechanism === 'tower' && kind === 'critical') return this.phys.halfL + (s.critReach ?? 0) - size / 2;
    return this.side * (this.phys.halfL + s.reach - size / 2);
  }

  /** Altura (fondo de la pieza, sobre la base) a la que sale una pieza de ese tipo. */
  exitHeight(kind: 'sample' | 'critical'): number {
    const s = this.phys.spec;
    return s.mechanism === 'tower' && kind === 'sample' ? (s.sampleExit ?? this.height) : this.height;
  }

  /** Avanza el elevador (o el brazo) y la intake un paso. */
  step(dt: number, events: MechEvent[]): void {
    const s = this.phys.spec;
    const goal = s.elevatorHeights[this.target];
    if (this.stowed && (this.target !== 0 || this.intakeOn)) this.stowed = false;
    if (hasArm(s.mechanism) && s.arm && this.stowed) {
      // Guardado: no se mueve
    } else if (hasArm(s.mechanism) && s.arm) {
      const task = this.hopperTask();
      const g = task ? (s.arm.hopperAngle ?? Math.PI) : armAngle(s.arm, goal);
      const d = g - this.angle;
      const stepA = s.arm.speed * dt;
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
    } else {
      const d = goal - this.height;
      const stepLen = s.elevatorSpeed * dt;
      this.height = Math.abs(d) <= stepLen ? goal : this.height + Math.sign(d) * stepLen;
    }
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.intakeOn && this.stored.length < this.capacity && s.mechanism !== 'chassis') {
      if (hasArm(s.mechanism)) this.runClaw(events);
      else this.runIntake(events);
    }
  }

  private resetArm(): void {
    const s = this.phys.spec;
    if (!s.arm) return;
    this.stowed = s.arm.stowAngle !== undefined;
    this.transferT = 0;
    this.angle = s.arm.stowAngle ?? armAngle(s.arm, s.elevatorHeights[0]);
    this.height = armTip(s.arm, this.angle).y;
  }

  /** Garra del pivote: con el brazo abajo y vacía, agarra la Muestra que queda entre sus dedos. */
  private runClaw(events: MechEvent[]): void {
    if (this.critical || this.inClaw || this.height > 0.06 || this.cooldown > 0 || this.hopperTask()) return;
    const p = this.phys;
    const base = p.position().y;
    const cx = this.tipX(0.15);
    for (const piece of this.pieces.list) {
      if (piece.kind !== 'sample' || piece.state.at !== 'field') continue;
      const t = piece.body.translation();
      if (t.y - base > 0.2) continue;
      // Las anotadas quedan en el piso del pozo, tras paredes de 200–800 mm (§3.2.3): la garra no las saca
      if (inCamara(t.x, t.z)) continue;
      const { lx, lz } = p.worldToLocalFlat(t.x, t.z);
      if (Math.abs(lx - cx) > 0.12 || Math.abs(lz) > 0.12) continue;
      this.pieces.stash(piece, { at: 'robot', robot: p.index });
      this.stored.push(piece);
      this.inClaw = true;
      events.push({ type: 'intake', robot: p.index, piece: piece.index });
      return;
    }
  }

  /** Captura las Muestras en la cancha que toca el rodillo de la intake desplegada. */
  private runIntake(events: MechEvent[]): void {
    const p = this.phys;
    const base = p.position().y;
    const x0 = p.halfL - 0.02;
    const x1 = p.halfL + p.spec.intake.extension;
    const hw = p.spec.intake.width / 2;
    for (const piece of this.pieces.list) {
      if (piece.kind !== 'sample' || piece.state.at !== 'field') continue;
      const t = piece.body.translation();
      if (t.y - base > 0.25) continue;
      const { lx, lz } = p.worldToLocalFlat(t.x, t.z);
      if (lx < x0 || lx > x1 || Math.abs(lz) > hw) continue;
      this.pieces.stash(piece, { at: 'robot', robot: p.index });
      this.stored.push(piece);
      events.push({ type: 'intake', robot: p.index, piece: piece.index });
      if (this.stored.length >= this.capacity) return;
    }
  }

  /** Recibe una pieza directamente (precarga, §4.1). */
  load(piece: Piece): void {
    this.pieces.stash(piece, { at: 'robot', robot: this.phys.index });
    if (piece.kind === 'critical') this.critical = piece;
    else {
      // El pivote la lleva en la garra (con hopper, si la garra ya trae una, va al hopper)
      if (!hasArm(this.phys.spec.mechanism)) this.stored.push(piece);
      else if (!this.inClaw) {
        this.stored.push(piece);
        this.inClaw = true;
      } else this.stored.unshift(piece);
    }
  }

  /**
   * Pinza: toma la Muestra Crítica de su alianza si está al alcance del depósito y a la altura
   * del elevador (en la rendija de la Campana, en el piso o en la Repisa).
   */
  grabCritical(events: MechEvent[]): boolean {
    if (this.critical || this.phys.spec.mechanism === 'chassis') return false;
    // La garra del pivote lleva una sola pieza (con hopper, las del hopper no estorban)
    if (hasArm(this.phys.spec.mechanism) && this.inClaw) return false;
    if (this.phys.spec.mechanism === 'pivotHopper' && this.angle > Math.PI / 2) return false;
    const p = this.phys;
    const c = this.pieces.critical(this.alliance);
    if (c.state.at !== 'field') return false;
    const t = c.body.translation();
    const { lx, lz } = p.worldToLocalFlat(t.x, t.z);
    const carriage = p.position().y + this.height;
    const k = p.spec.mechanism;
    const reachOk =
      hasArm(k)
        ? Math.abs(lx - this.tipX(0.2)) < 0.2
        : k === 'tower'
          ? lx > p.halfL - 0.1 && lx < p.halfL + (p.spec.critReach ?? 0) + 0.15
          : this.side * lx > p.halfL - 0.1 && this.side * lx < p.halfL + p.spec.reach + 0.15;
    const ok = reachOk && Math.abs(lz) < 0.3 && t.y > carriage - 0.2 && t.y < carriage + 0.35;
    if (!ok) return false;
    this.pieces.stash(c, { at: 'robot', robot: p.index });
    this.critical = c;
    events.push({ type: 'grabCritical', robot: p.index, piece: c.index });
    return true;
  }

  /** Suelta una pieza (Muestra o Crítica) en la punta del mecanismo, a su altura, hacia afuera. */
  release(kind: 'sample' | 'critical', events: MechEvent[]): boolean {
    if (this.cooldown > 0 || this.phys.spec.mechanism === 'chassis') return false;
    // El pivote suelta lo que trae en la garra (no lo del hopper)
    if (kind === 'sample' && hasArm(this.phys.spec.mechanism) && !this.inClaw) return false;
    const piece = kind === 'critical' ? this.critical : this.stored[this.stored.length - 1];
    if (!piece) return false;
    if (kind === 'critical') this.critical = null;
    else {
      this.stored.pop();
      this.inClaw = false;
    }
    const p = this.phys;
    const size = this.pieces.size(piece);
    const at = p.localToWorld(this.tipX(size, kind), this.exitHeight(kind) + size / 2, 0);
    const h = p.heading();
    const v = p.body.linvel();
    // La garra del pivote con hopper solo abre (sin empujón): suelta desde más alto que el pivote y,
    // con empujón, la Crítica rebotaba y se pasaba de la Repisa
    const e = p.spec.mechanism === 'pivotHopper' ? 0 : (p.spec.mechanism === 'tower' && kind === 'critical' ? 1 : this.side) * EJECT_SPEED;
    this.pieces.place(piece, at.x, at.y, at.z, h, { x: v.x + Math.cos(h) * e, y: 0, z: v.z - Math.sin(h) * e });
    piece.lastRobot = p.index;
    this.cooldown = EJECT_COOLDOWN;
    events.push({ type: 'release', robot: p.index, piece: piece.index });
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
    this.resetArm();
  }
}
