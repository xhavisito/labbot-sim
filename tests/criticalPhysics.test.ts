/** La Muestra Crítica tiene las mismas físicas que las Muestras normales: solo cambia el tamaño y el puntaje (Xhavi, 16-nov). */
import { beforeAll, describe, expect, it } from 'vitest';
import { PhysicsWorld, initRapier } from '../src/physics/PhysicsWorld';
import { Pieces } from '../src/physics/Pieces';

beforeAll(async () => {
  await initRapier();
});

describe('Muestra Crítica', () => {
  it('misma masa, fricción, rebote y amortiguamiento que una Muestra', () => {
    const pieces = new Pieces(new PhysicsWorld());
    const s = pieces.list.find((p) => p.kind === 'sample')!;
    for (const c of pieces.list.filter((p) => p.kind === 'critical')) {
      expect(c.collider.mass()).toBeCloseTo(s.collider.mass(), 6);
      expect(c.collider.friction()).toBe(s.collider.friction());
      expect(c.collider.restitution()).toBe(s.collider.restitution());
      expect(c.body.linearDamping()).toBe(s.body.linearDamping());
      expect(c.body.angularDamping()).toBe(s.body.angularDamping());
    }
  });
});
