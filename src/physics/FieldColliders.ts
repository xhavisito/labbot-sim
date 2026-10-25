/**
 * Colisionadores estáticos de la cancha: alfombra (piso) + cada sólido de `fieldSolids()`
 * como casco convexo. Fricción de la alfombra y el MDF: no se dan; SUPUESTO 0.9 y 0.5.
 */
import { fieldSolids } from '../config/fieldLayout';
import { GROUPS, RAPIER, type PhysicsWorld } from './PhysicsWorld';

export const CARPET_FRICTION = 0.9;
export const MDF_FRICTION = 0.5;

export function buildFieldColliders(pw: PhysicsWorld): void {
  // Piso amplio (la alfombra más el área alrededor, hasta la barrera invisible)
  pw.fixed(RAPIER.ColliderDesc.cuboid(10, 0.1, 10).setTranslation(0, -0.1, 0).setFriction(CARPET_FRICTION), { kind: 'floor' });
  for (const s of fieldSolids()) {
    const desc = RAPIER.ColliderDesc.convexHull(new Float32Array(s.points.flat()));
    if (!desc) throw new Error(`casco convexo inválido: ${s.part}`);
    desc.setFriction(s.part === 'ramp' || s.part === 'platform' ? CARPET_FRICTION : MDF_FRICTION);
    pw.fixed(desc, { kind: 'field', part: s.part, alliance: s.alliance }, s.part === 'boundary' ? GROUPS.boundary : GROUPS.field);
  }
}
