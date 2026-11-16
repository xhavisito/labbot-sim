/** Hitbox por pieza de los robots del CAD (Phoenix y Psycho) y el intake fijo de Phoenix (Xhavi, 16-nov). */
import { beforeAll, describe, expect, it } from 'vitest';
import { robotSpec, type RobotId } from '../src/config/robotIds';
import { GameSession } from '../src/game/GameSession';
import { emptyInput } from '../src/input/InputManager';
import { initRapier } from '../src/physics/PhysicsWorld';

beforeAll(async () => {
  await initRapier();
});

function session(id: RobotId): GameSession {
  const g = new GameSession({ player: 0, preload: false, specs: [robotSpec(id)] });
  for (const p of g.pieces.list) if (p.state.at === 'field' && p.kind === 'sample') g.pieces.stash(p, { at: 'hp', alliance: 'red' });
  return g;
}

describe('hitbox por pieza del CAD', () => {
  for (const id of ['cad:phoenix', 'cad:psycho'] as const) {
    it(`${id}: cada hitbox del archivo es un casco válido y un colisionador del robot`, () => {
      const s = robotSpec(id);
      expect(s.hitboxes!.length).toBeGreaterThan(10);
      for (const h of s.hitboxes!) {
        expect(h.pts.length % 3).toBe(0);
        expect(h.pts.length / 3).toBeGreaterThanOrEqual(4);
      }
      const g = session(id);
      // chasis + hitboxes + llantas + mecanismos: al menos un colisionador por hitbox
      expect(g.player.phys.body.numColliders()).toBeGreaterThanOrEqual(s.hitboxes!.length);
    });
  }

  it('Phoenix: una Muestra lanzada contra el riel de la rampa rebota y no entra', () => {
    const g = session('cad:phoenix');
    g.player.phys.teleport(2.6, -1.2, 0);
    const piece = g.pieces.list.find((p) => p.kind === 'sample')!;
    // Desde el costado derecho (+z), a 0.5 m de altura (sobre el chasis bajo), rápido, hacia el riel de la rampa
    g.pieces.place(piece, 2.6 - 0.05, 0.5, -1.2 + 0.9, 0, { x: 0, y: 0, z: -9 });
    let minZ = Infinity;
    for (let i = 0; i < 120 * 1.5; i++) {
      g.setInput({ ...emptyInput() });
      g.step();
      minZ = Math.min(minZ, piece.body.translation().z - -1.2);
    }
    // El riel está en z = ±0.15: la Muestra (centro) no pasa de ahí (con 7.5 cm de su media cara)
    expect(minZ).toBeGreaterThan(0.15);
  });

  it('Phoenix: el intake empieza y se queda en el piso, aunque se pidan niveles', () => {
    const g = session('cad:phoenix');
    expect(g.player.mech.stowed).toBe(false);
    expect(g.player.mech.height).toBeCloseTo(0, 6);
    for (const level of [3, 2, 1, 4] as const) {
      for (let i = 0; i < 60; i++) {
        g.setInput({ ...emptyInput(), elevator: level });
        g.step();
      }
      expect(g.player.mech.height).toBeCloseTo(0, 6);
    }
  });
});
