/** Axiom (pinza): al soltar la Muestra en cualquier nivel sale de la garra y no se queda trabada sobre la viga, los dedos o la placa (Xhavi, 16-nov). */
import { beforeAll, describe, expect, it } from 'vitest';
import { robotSpec } from '../src/config/robotIds';
import { GameSession } from '../src/game/GameSession';
import { emptyInput, type PlayerInput } from '../src/input/InputManager';
import { initRapier } from '../src/physics/PhysicsWorld';

beforeAll(async () => {
  await initRapier();
});

function run(g: GameSession, s: number, inp: Partial<PlayerInput> = {}): void {
  g.setInput({ ...emptyInput(), ...inp });
  for (let i = 0; i < s * 120; i++) {
    if (i === 1) g.setInput({ ...emptyInput(), elevator: inp.elevator ?? 0 });
    g.step();
  }
}

describe('Axiom suelta la Muestra', () => {
  for (const level of [0, 1, 2, 3] as const) {
    it(`nivel ${level}: la Muestra sale de la garra y el brazo sigue moviéndose`, () => {
      const g = new GameSession({ player: 0, preload: true, specs: [robotSpec('cad:axiom')] });
      const m = g.player.mech;
      g.player.phys.teleport(-1.5, 0, 0);
      run(g, 3, { elevator: level });
      expect(m.inClaw).toBe(true);
      const piece = m.stored[m.stored.length - 1];
      run(g, 0.05, { elevator: level, releaseSample: true });
      expect(m.inClaw).toBe(false);
      run(g, 2, { elevator: level });
      // Sin contacto real con la viga, los dedos ni la placa de la garra
      const c = g.player.phys.armColliders;
      const touching = [c.beam, c.palm, ...c.fingers].filter((x) => {
        let hit = false;
        g.pw.world.contactPair(piece.collider, x, (man) => {
          if (man.numContacts() > 0) hit = true;
        });
        return hit;
      });
      expect(touching).toHaveLength(0);
      // El brazo no quedó trabado: llega a otro nivel
      const before = m.angle;
      run(g, 3, { elevator: level === 2 ? 0 : 2 });
      expect(Math.abs(m.angle - before)).toBeGreaterThan(0.1);
    });
  }
});

describe('Axiom: colisiones de la garra (Xhavi, 16-nov: "se queda flotando")', () => {
  it('4 Axiom de la IA en 100 s no se levantan ni se inclinan por topar con la Cámara', () => {
    const P = robotSpec('cad:axiom');
    const g = new GameSession({ player: 0, preload: true, ai: true, specs: [P, P, P, P] });
    g.startMatch();
    let maxTilt = 0;
    let floating = 0;
    for (let i = 0; i < 100 * 120 && !g.match!.finished; i++) {
      g.setInput(emptyInput());
      g.step();
      for (const r of g.robots) {
        maxTilt = Math.max(maxTilt, r.phys.tilt());
        if (r.phys.position().y > 0.035) floating++;
      }
    }
    // Antes: 492 pasos levantado hasta 7 cm y 21° de inclinación
    expect(floating).toBeLessThan(100);
    expect(maxTilt).toBeLessThan((15 * Math.PI) / 180);
  }, 240000);
});
