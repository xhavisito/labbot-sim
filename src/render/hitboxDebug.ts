/**
 * Dibujo de depuración de los colisionadores de un robot (`?hitboxes=1`): cada colisionador del cuerpo en
 * alambre, en la pose que tiene la física (el brazo y la garra se mueven con `setArmPose`). Sirve para
 * revisar a ojo que cada pieza del robot tenga hitbox y que no flote ni atraviese el piso.
 * Colores: chasis y piezas fijas verde, ruedas azul, brazo y garra naranja, pieza agarrada magenta.
 */
import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { RAPIER } from '../physics/PhysicsWorld';
import type { RobotPhysics } from '../physics/RobotPhysics';

const COLORS = { fixed: 0x35e06b, wheel: 0x4aa3ff, arm: 0xff9a1f, held: 0xff3bd4 };

function geometryOf(shape: RAPIER.Shape): THREE.BufferGeometry | null {
  if (shape instanceof RAPIER.Cuboid) return new THREE.BoxGeometry(shape.halfExtents.x * 2, shape.halfExtents.y * 2, shape.halfExtents.z * 2);
  if (shape instanceof RAPIER.Ball) return new THREE.SphereGeometry(shape.radius, 12, 8);
  if (shape instanceof RAPIER.Cylinder) return new THREE.CylinderGeometry(shape.radius, shape.radius, shape.halfHeight * 2, 16);
  if (shape instanceof RAPIER.ConvexPolyhedron) {
    const v = shape.vertices;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i + 2 < v.length; i += 3) pts.push(new THREE.Vector3(v[i], v[i + 1], v[i + 2]));
    return new ConvexGeometry(pts);
  }
  return null;
}

export class HitboxDebug {
  readonly group = new THREE.Group();
  private items: Array<{ c: RAPIER.Collider; obj: THREE.LineSegments }> = [];

  constructor(phys: RobotPhysics) {
    const arm = new Set<RAPIER.Collider>([phys.armColliders.beam, phys.armColliders.palm, ...phys.armColliders.fingers, ...phys.armColliders.plates]);
    const held = new Set<RAPIER.Collider>([phys.armColliders.sample, phys.armColliders.sample2, phys.armColliders.critical]);
    for (let i = 0; i < phys.body.numColliders(); i++) {
      const c = phys.body.collider(i);
      const g = geometryOf(c.shape);
      if (!g) continue;
      const color = held.has(c) ? COLORS.held : arm.has(c) ? COLORS.arm : c.shape instanceof RAPIER.Cylinder || c.shape instanceof RAPIER.Ball ? COLORS.wheel : COLORS.fixed;
      const mat = new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 });
      const obj = new THREE.LineSegments(new THREE.WireframeGeometry(g), mat);
      obj.renderOrder = 999;
      this.group.add(obj);
      this.items.push({ c, obj });
    }
  }

  /** Pone cada alambre donde está su colisionador (respecto al cuerpo, que ya sigue el grupo del robot). */
  sync(): void {
    for (const { c, obj } of this.items) {
      const t = c.translationWrtParent() ?? { x: 0, y: 0, z: 0 };
      const r = c.rotationWrtParent() ?? { x: 0, y: 0, z: 0, w: 1 };
      obj.position.set(t.x, t.y, t.z);
      obj.quaternion.set(r.x, r.y, r.z, r.w);
      obj.visible = c.isEnabled();
    }
  }
}

export const hitboxDebugOn = (): boolean => typeof location !== 'undefined' && new URLSearchParams(location.search).get('hitboxes') === '1';
