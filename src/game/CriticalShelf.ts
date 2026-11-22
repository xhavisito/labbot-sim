/**
 * Repisa (base) de la Muestra Crítica en la rendija de la Zona de Alimentación (§3.2.4).
 * Mide solo un poco más que la Muestra Crítica (SUPUESTO, ver CRITICAL_SHELF_LENGTH) y el Human
 * Player la desliza a lo largo de la pared (D39) para centrarla con su robot: la repisa va con la pieza.
 * Cuerpo fijo de Rapier que se reubica (teleport) junto con la pieza.
 */
import * as F from '../config/field';
import { criticalShelfBox } from '../config/fieldLayout';
import type { Alliance } from '../core/types';
import { GROUPS, RAPIER, type PhysicsWorld } from '../physics/PhysicsWorld';
import { MDF_FRICTION } from '../physics/FieldColliders';

/** Ángulo (rad) al que se abate la repisa hacia atrás para soltar la Crítica (≈69°: la pieza resbala sola). SUPUESTO: el manual (§3.2.4) no dice nada. */
export const SHELF_FOLD_ANGLE = 1.2;
/** Velocidad (rad/s) al abatirse y al regresar. */
const SHELF_FOLD_SPEED = 6;
const SHELF_RETURN_SPEED = 3;
/** Segundos que se queda abatida para que la pieza caiga (SUPUESTO). */
const SHELF_HOLD = 1;

/**
 * Pose de la repisa en el marco ROJO abatida `tilt` rad: gira sobre la arista pegada a la pared (la orilla
 * libre baja, como una charola que se pliega hacia atrás). Con tilt 0 es `criticalShelfBox()`.
 */
export function shelfPose(x: number, tilt: number): { x: number; y: number; z: number; qx: number; qw: number } {
  const b = criticalShelfBox();
  const hingeY = b.cy + b.hy;
  const hingeZ = b.cz - b.hz;
  const c = Math.cos(tilt);
  const sn = Math.sin(tilt);
  return {
    x,
    y: hingeY - b.hy * c - b.hz * sn,
    z: hingeZ - b.hy * sn + b.hz * c,
    qx: Math.sin(tilt / 2),
    qw: Math.cos(tilt / 2),
  };
}

export class CriticalShelf {
  /** Posición X del centro en el marco ROJO (la azul se refleja). */
  x = F.CRITICAL_HOLDER_RED.x;
  /** Posición X anterior (para interpolar el dibujo). */
  prevX = this.x;
  /** Abatimiento actual y anterior (rad) para soltar la Crítica al piso; 0 = horizontal. */
  tilt = 0;
  prevTilt = 0;
  private phase: 'closed' | 'folding' | 'hold' | 'returning' = 'closed';
  private holdT = 0;
  private body: RAPIER.RigidBody;

  constructor(
    readonly alliance: Alliance,
    pw: PhysicsWorld,
  ) {
    const b = criticalShelfBox();
    const p = this.worldPos();
    this.body = pw.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(p.x, b.cy, p.z));
    const c = pw.world.createCollider(RAPIER.ColliderDesc.cuboid(b.hx, b.hy, b.hz).setFriction(MDF_FRICTION + 0.4).setCollisionGroups(GROUPS.field), this.body);
    pw.tag(c, { kind: 'field', part: 'criticalHolder', alliance });
  }

  private worldPos(): { x: number; z: number } {
    return F.forAlliance(this.alliance, { x: this.x, z: criticalShelfBox().cz });
  }

  /** ¿Está abatida o moviéndose (no sostiene la Crítica)? */
  get folded(): boolean {
    return this.phase !== 'closed';
  }

  /** Abate la repisa hacia atrás para dejar caer la Crítica al piso (el HP, SUPUESTO). false si ya está abatida. */
  fold(): boolean {
    if (this.phase !== 'closed') return false;
    this.phase = 'folding';
    return true;
  }

  /** Avanza el abatimiento (cada paso de física). */
  step(dt: number): void {
    this.prevTilt = this.tilt;
    if (this.phase === 'closed') return;
    if (this.phase === 'folding') {
      this.tilt = Math.min(SHELF_FOLD_ANGLE, this.tilt + SHELF_FOLD_SPEED * dt);
      if (this.tilt >= SHELF_FOLD_ANGLE) {
        this.phase = 'hold';
        this.holdT = 0;
      }
    } else if (this.phase === 'hold') {
      this.holdT += dt;
      if (this.holdT >= SHELF_HOLD) this.phase = 'returning';
    } else {
      this.tilt = Math.max(0, this.tilt - SHELF_RETURN_SPEED * dt);
      if (this.tilt <= 0) this.phase = 'closed';
    }
    this.sync();
  }

  /** Posición del centro en el mundo. */
  world(): { x: number; y: number; z: number } {
    const p = this.worldPos();
    return { x: p.x, y: criticalShelfBox().cy, z: p.z };
  }

  reset(): void {
    this.x = this.prevX = F.CRITICAL_HOLDER_RED.x;
    this.tilt = this.prevTilt = 0;
    this.phase = 'closed';
    this.sync();
  }

  /** Mueve la repisa junto con la pieza que el HP deslizó `dx` m en X del mundo (D39). */
  shift(dx: number): void {
    this.prevX = this.x;
    if (dx === 0) return;
    this.x += this.alliance === 'red' ? dx : -dx;
    this.sync();
  }

  private sync(): void {
    const q = shelfPose(this.x, this.tilt);
    const p = F.forAlliance(this.alliance, { x: q.x, z: q.z });
    this.body.setTranslation({ x: p.x, y: q.y, z: p.z }, true);
    // La azul es la roja girada 180° sobre Y: el eje de abatimiento se invierte
    const sg = this.alliance === 'red' ? 1 : -1;
    this.body.setRotation({ x: sg * q.qx, y: 0, z: 0, w: q.qw }, true);
  }
}
