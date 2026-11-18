/**
 * Repisa (base) de la Muestra Crítica en la rendija de la Zona de Alimentación (§3.2.4).
 * Mide solo un poco más que la Muestra Crítica (SUPUESTO, ver CRITICAL_SHELF_LENGTH) y el Human
 * Player la desliza a lo largo de la pared (D39) para centrarla con su robot: la repisa va con la pieza.
 * Cuerpo cinemático de Rapier.
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
    const p = this.worldPos();
    this.body.setNextKinematicTranslation({ x: p.x, y: criticalShelfBox().cy, z: p.z });
  }
}
