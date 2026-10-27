/**
 * Mecanismos del pivote (`RobotSpec.arm`; los dos tipos del simulador, `config/robot.ts`): brazo con
 * garra. Agarra una pieza del piso con el brazo abajo y la suelta en la punta. Empieza guardado
 * (`ArmSpec.stowAngle`) y sale de ahí al primer mando. Lleva una pieza a la vez (capacidad 1); con
 * capacidad > 1 (un hopper, ya sin tipo que lo use) la garra pasa cada Muestra a la boca del hopper
 * (`ArmSpec.hopperAngle`) y la saca de ahí para anotar.
 * Las piezas guardadas son lógicas (cuerpo deshabilitado); al soltarlas vuelven a la física en la
 * punta del mecanismo, así que anotar depende de dónde caen (lo detecta la sesión).
 */
import { inCamara } from '../config/field';
import { armAngle, armTip, type ElevatorPos } from '../config/robot';
import type { Alliance } from '../core/types';
import type { Piece, Pieces } from '../physics/Pieces';
import type { RobotPhysics } from '../physics/RobotPhysics';

export type MechEvent =
  | { type: 'intake'; robot: number; piece: number }
  | { type: 'grabCritical'; robot: number; piece: number }
  | { type: 'release'; robot: number; piece: number };

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
    return !this.stowed && this.hopperTask() === null && Math.abs(this.angle - armAngle(s.arm, s.elevatorHeights[this.target])) < 0.01;
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
    }
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.intakeOn && this.stored.length < this.capacity) this.runClaw(events);
  }

  private resetArm(): void {
    const s = this.phys.spec;
    this.stowed = s.arm.stowAngle !== undefined;
    this.transferT = 0;
    this.angle = s.arm.stowAngle ?? armAngle(s.arm, s.elevatorHeights[0]);
    this.height = armTip(s.arm, this.angle).y;
  }

  /** Garra: con el brazo abajo y vacía, agarra la Muestra que queda entre sus dedos. */
  private runClaw(events: MechEvent[]): void {
    if (this.critical || this.inClaw || this.height > 0.06 || this.cooldown > 0 || this.hopperTask()) return;
    const p = this.phys;
    const base = p.position().y;
    const cx = this.tipX();
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
    return true;
  }

  /**
   * Suelta una pieza (Muestra o Crítica) en la punta de la garra, a su altura. La garra solo abre
   * (sin empujón): suelta desde alto y, con empujón, la Crítica rebotaba y se pasaba de la Repisa.
   * Suelta lo que trae en la garra (no lo del hopper).
   */
  release(kind: 'sample' | 'critical', events: MechEvent[]): boolean {
    if (this.cooldown > 0) return false;
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
