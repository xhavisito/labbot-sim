/**
 * Mecanismos genéricos del robot: intake al piso (Muestras), almacenamiento, elevador y depósito
 * al frente, y pinza para la Muestra Crítica. Las piezas guardadas son lógicas (cuerpo
 * deshabilitado); al soltarlas vuelven a la física en la punta del depósito, así que anotar en
 * un nivel de la Cámara o en la Repisa depende de dónde caen (lo detecta la sesión, Hito 3).
 */
import type { ElevatorPos } from '../config/robot';
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
  private cooldown = 0;

  constructor(
    private phys: RobotPhysics,
    private pieces: Pieces,
    readonly alliance: Alliance,
  ) {
    this.height = phys.spec.elevatorHeights[0];
  }

  get capacity(): number {
    return this.phys.spec.capacity;
  }

  /** Avanza el elevador y la intake un paso. */
  step(dt: number, events: MechEvent[]): void {
    const s = this.phys.spec;
    const goal = s.elevatorHeights[this.target];
    const d = goal - this.height;
    const stepLen = s.elevatorSpeed * dt;
    this.height = Math.abs(d) <= stepLen ? goal : this.height + Math.sign(d) * stepLen;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.intakeOn && this.stored.length < this.capacity) this.runIntake(events);
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
    else this.stored.push(piece);
  }

  /**
   * Pinza: toma la Muestra Crítica de su alianza si está al alcance del depósito y a la altura
   * del elevador (en la rendija de la Campana, en el piso o en la Repisa).
   */
  grabCritical(events: MechEvent[]): boolean {
    if (this.critical) return false;
    const p = this.phys;
    const c = this.pieces.critical(this.alliance);
    if (c.state.at !== 'field') return false;
    const t = c.body.translation();
    const { lx, lz } = p.worldToLocalFlat(t.x, t.z);
    const carriage = p.position().y + this.height;
    const ok = lx > p.halfL - 0.1 && lx < p.halfL + p.spec.reach + 0.15 && Math.abs(lz) < 0.3 && t.y > carriage - 0.2 && t.y < carriage + 0.35;
    if (!ok) return false;
    this.pieces.stash(c, { at: 'robot', robot: p.index });
    this.critical = c;
    events.push({ type: 'grabCritical', robot: p.index, piece: c.index });
    return true;
  }

  /** Suelta una pieza (Muestra o Crítica) en la punta del depósito, a la altura del elevador. */
  release(kind: 'sample' | 'critical', events: MechEvent[]): boolean {
    if (this.cooldown > 0) return false;
    const piece = kind === 'critical' ? this.critical : this.stored[this.stored.length - 1];
    if (!piece) return false;
    if (kind === 'critical') this.critical = null;
    else this.stored.pop();
    const p = this.phys;
    const size = this.pieces.size(piece);
    const at = p.localToWorld(p.halfL + p.spec.reach - size / 2, this.height + size / 2, 0);
    const h = p.heading();
    const v = p.body.linvel();
    this.pieces.place(piece, at.x, at.y, at.z, h, { x: v.x + Math.cos(h) * EJECT_SPEED, y: 0, z: v.z - Math.sin(h) * EJECT_SPEED });
    this.cooldown = EJECT_COOLDOWN;
    events.push({ type: 'release', robot: p.index, piece: piece.index });
    return true;
  }

  /** Vacía el robot (reinicio). */
  clear(): void {
    this.stored.length = 0;
    this.critical = null;
    this.intakeOn = false;
    this.target = 0;
    this.height = this.phys.spec.elevatorHeights[0];
  }
}
