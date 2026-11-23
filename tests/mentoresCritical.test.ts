/**
 * Mentores 3478, toma de la Crítica (Xhavi, 22-nov: "literalmente no está animado"; pidió realismo):
 * - con la muñeca doblada sobre el chasis (pose de inicio) no la toma: la pieza quedaría encima del chasis (SUPUESTO, §7.2 no habla de mecanismos);
 * - guarda de dónde la tomó (`critFrom`) para que el dibujo la deslice a la garra en vez de aparecerla de golpe (`RobotView`).
 * Dónde la lleva y que no atraviese nada lo prueba `tests/squash.test.ts`.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import * as F from '../src/config/field';
import { type RobotSpec } from '../src/config/robot';
import { robotSpec } from '../src/config/robotIds';
import { GameSession } from '../src/game/GameSession';
import { emptyInput } from '../src/input/InputManager';
import { initRapier } from '../src/physics/PhysicsWorld';

beforeAll(async () => {
  await initRapier();
});

function session(spec: RobotSpec): GameSession {
  const g = new GameSession({ player: 0, preload: false, specs: [spec], hp: { enabled: false, interval: 3 } });
  for (const p of g.pieces.list) if (p.state.at === 'field' && p.kind === 'sample') g.pieces.stash(p, { at: 'hp', alliance: 'red' });
  return g;
}

const step = (g: GameSession, n = 1) => {
  for (let i = 0; i < n; i++) {
    g.setInput(emptyInput());
    g.step();
  }
};

describe('Mentores 3478: toma de la Crítica', () => {
  const spec = robotSpec('cad:mentores-3478');

  it('con la muñeca doblada (pose de inicio) no la toma; desplegada, sí, y guarda de dónde la tomó', () => {
    const g = session(spec);
    const r = g.player;
    const m = r.mech;
    r.phys.teleport(0, 2.2, 0);
    step(g, 60);
    expect(m.wristFold).toBe(1);
    const c = g.pieces.critical(r.alliance);
    const put = () => {
      const at = r.phys.localToWorld(m.tipX() + 0.12, 0, 0);
      g.pieces.place(c, at.x, F.CRITICAL_SIZE / 2, at.z, 0);
      return at;
    };
    put();
    expect(m.grabCritical([])).toBe(false);
    m.stowed = false; // como al primer mando del brazo
    step(g, 6 * 120);
    expect(m.wristFold).toBe(0);
    const at = put();
    const seq = m.critFrom.seq;
    expect(m.grabCritical([])).toBe(true);
    expect(m.critFrom.seq).toBe(seq + 1);
    expect(Math.hypot(m.critFrom.x - at.x, m.critFrom.z - at.z)).toBeLessThan(1e-6);
  });

  it('con la garra prendida la toma en cuanto la muñeca termina de desplegarse', () => {
    const g = session(spec);
    const r = g.player;
    const m = r.mech;
    r.phys.teleport(0, 2.2, 0);
    step(g, 60);
    const c = g.pieces.critical(r.alliance);
    const at = r.phys.localToWorld(m.tipX() + 0.12, 0, 0);
    g.pieces.place(c, at.x, F.CRITICAL_SIZE / 2, at.z, 0);
    for (let i = 0; i < 3 * 120 && m.critical !== c; i++) {
      g.setInput({ ...emptyInput(), intake: true });
      g.step();
      if (m.critical === c) expect(m.wristFold).toBeLessThanOrEqual(0.02);
    }
    expect(m.critical).toBe(c);
  });
});
