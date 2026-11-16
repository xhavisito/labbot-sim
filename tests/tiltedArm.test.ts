/** Un robot volteado no atraviesa la alfombra con su brazo y su garra (Xhavi, 16-nov). */
import { beforeAll, describe, expect, it } from 'vitest';
import { robotSpec, type RobotId } from '../src/config/robotIds';
import { GameSession } from '../src/game/GameSession';
import { emptyInput } from '../src/input/InputManager';
import { initRapier } from '../src/physics/PhysicsWorld';

beforeAll(async () => {
  await initRapier();
});

function lowest(g: GameSession): number {
  const r = g.player.phys;
  let m = Infinity;
  for (const c of [r.armColliders.beam, ...r.armColliders.fingers, r.armColliders.palm]) {
    const t = c.translation();
    const rot = c.rotation();
    const he = (c.shape as unknown as { halfExtents: { x: number; y: number; z: number } }).halfExtents;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const x = sx * he.x, y = sy * he.y, z = sz * he.z;
      const tx = 2 * (rot.y * z - rot.z * y), ty = 2 * (rot.z * x - rot.x * z), tz = 2 * (rot.x * y - rot.y * x);
      void tx; void tz;
      m = Math.min(m, t.y + y + rot.w * ty + (rot.z * tx - rot.x * tz));
    }
  }
  return m;
}

describe('robot volteado', () => {
  for (const id of ['cad:axiom', 'cad:psycho'] as const satisfies readonly RobotId[]) {
    it(`${id}: boca abajo, el brazo no baja de la alfombra`, () => {
      const g = new GameSession({ player: 0, preload: false, specs: [robotSpec(id)] });
      g.player.phys.teleport(-1.2, 2.6, 0, 0.9);
      // Boca abajo (180° sobre el eje del frente)
      g.player.phys.body.setRotation({ x: 1, y: 0, z: 0, w: 0 }, true);
      let tiltedSteps = 0;
      let worst = Infinity;
      // Cae boca abajo y luego intenta enderezarse moviendo el brazo por todas sus posiciones
      const targets = [0, 3, 0, 2, 1, 0, 3] as const;
      for (let i = 0; i < 240 + targets.length * 120; i++) {
        if (i >= 240 && (i - 240) % 120 === 0) {
          g.player.mech.stowed = false;
          g.player.mech.target = targets[(i - 240) / 120];
        }
        g.setInput({ ...emptyInput() });
        g.step();
        if (i > 30 && g.player.phys.tilt() > 0.35) {
          tiltedSteps++;
          worst = Math.min(worst, lowest(g));
        }
      }
      expect(tiltedSteps).toBeGreaterThan(20);
      expect(worst).toBeGreaterThan(-0.03);
    });
  }
});
