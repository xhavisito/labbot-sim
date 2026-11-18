/**
 * Repisa (base) de la Muestra Crítica en la rendija de la Zona de Alimentación (§3.2.4).
 * Mide solo un poco más que la Muestra Crítica (SUPUESTO, ver CRITICAL_SHELF_LENGTH) y el Human
 * Player la desliza a lo largo de la pared para centrarla con su robot, que solo puede tomar la
 * Crítica en el endgame (§4.1.1). Cuerpo cinemático de Rapier; la pieza viaja por fricción.
 */
import * as F from '../config/field';
import { criticalShelfBox } from '../config/fieldLayout';
import type { Alliance } from '../core/types';
import { GROUPS, RAPIER, type PhysicsWorld } from '../physics/PhysicsWorld';
import { MDF_FRICTION } from '../physics/FieldColliders';

export class CriticalShelf {
  /** Posición X del centro en el marco ROJO (la azul se refleja). */
  x = F.CRITICAL_HOLDER_RED.x;
  /** Posición X anterior (para interpolar el dibujo). */
  prevX = this.x;
  private vel = 0;
  private body: RAPIER.RigidBody;

  constructor(
    readonly alliance: Alliance,
    pw: PhysicsWorld,
  ) {
    const b = criticalShelfBox();
    const p = this.worldPos();
    this.body = pw.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x, b.cy, p.z));
    const c = pw.world.createCollider(RAPIER.ColliderDesc.cuboid(b.hx, b.hy, b.hz).setFriction(MDF_FRICTION + 0.4).setCollisionGroups(GROUPS.field), this.body);
    pw.tag(c, { kind: 'field', part: 'criticalHolder', alliance });
  }

  private worldPos(): { x: number; z: number } {
    return F.forAlliance(this.alliance, { x: this.x, z: criticalShelfBox().cz });
  }

  /** Posición del centro en el mundo. */
  world(): { x: number; y: number; z: number } {
    const p = this.worldPos();
    return { x: p.x, y: criticalShelfBox().cy, z: p.z };
  }

  reset(): void {
    this.x = this.prevX = F.CRITICAL_HOLDER_RED.x;
    this.vel = 0;
    this.sync();
  }

  /** Desliza la repisa hacia `targetX` (marco rojo), con aceleración y velocidad limitadas. */
  step(dt: number, targetX: number): void {
    this.prevX = this.x;
    const [lo, hi] = F.CRITICAL_SHELF_X_RANGE;
    const goal = Math.min(hi, Math.max(lo, targetX));
    const err = goal - this.x;
    // Velocidad deseada: frena a tiempo para llegar sin pasarse
    const brake = Math.sqrt(2 * F.CRITICAL_SHELF_ACCEL * Math.abs(err));
    const want = Math.sign(err) * Math.min(F.CRITICAL_SHELF_SPEED, brake);
    const dv = F.CRITICAL_SHELF_ACCEL * dt;
    this.vel += Math.max(-dv, Math.min(dv, want - this.vel));
    if (Math.abs(err) < 1e-3 && Math.abs(this.vel) < dv) this.vel = 0;
    this.x = Math.min(hi, Math.max(lo, this.x + this.vel * dt));
    this.sync();
  }

  private sync(): void {
    const p = this.worldPos();
    this.body.setNextKinematicTranslation({ x: p.x, y: criticalShelfBox().cy, z: p.z });
  }
}
