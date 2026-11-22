/**
 * Mentores 3478 toma la Crítica desde afuera (Xhavi, 22-nov: "tiene que quedarse por fuera y agarrar la critical piece y quedarse afuera";
 * "literalmente no está animado"). Complementa `tests/squash.test.ts` (dónde la lleva y que no atraviese nada):
 * - con la muñeca doblada sobre el chasis (pose de inicio) no la toma: la pieza quedaría encima del chasis;
 * - el alcance se mide desde el frente de las ruedas, donde queda su cara de atrás, no desde la punta;
 * - guarda de dónde la tomó (`critFrom`) para que el dibujo la deslice a la garra en vez de aparecerla de golpe;
 * - de N3 de regreso al piso, pasando por todos los ángulos intermedios, no se mete en ningún colisionador del robot.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import * as F from '../src/config/field';
import { CRIT_SQUEEZE, critHeldSeatOf, type RobotSpec } from '../src/config/robot';
import { robotSpec } from '../src/config/robotIds';
import { GameSession } from '../src/game/GameSession';
import { emptyInput } from '../src/input/InputManager';
import { initRapier } from '../src/physics/PhysicsWorld';

beforeAll(async () => {
  await initRapier();
});

const H = F.CRITICAL_SIZE / 2;

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

describe('Mentores 3478: toma de la Crítica desde afuera', () => {
  const spec = robotSpec('cad:mentores-3478');

  it('con la muñeca doblada (pose de inicio) no la toma; desplegada, sí, y guarda de dónde la tomó', () => {
    const g = session(spec);
    const r = g.player;
    const m = r.mech;
    r.phys.teleport(0, 2.2, 0);
    step(g, 60);
    expect(m.wristFold).toBe(1);
    const c = g.pieces.critical(r.alliance);
    const seat = critHeldSeatOf(spec)!;
    const put = () => {
      const at = r.phys.localToWorld(m.tipX() + seat.x + 0.02, 0, 0);
      g.pieces.place(c, at.x, H, at.z, 0);
      return at;
    };
    put();
    expect(m.grabCritical([])).toBe(false);
    m.stowed = false;
    step(g, 6 * 120);
    expect(m.wristFold).toBe(0);
    const at = put();
    const seq = m.critFrom.seq;
    expect(m.grabCritical([])).toBe(true);
    expect(m.critFrom.seq).toBe(seq + 1);
    expect(Math.hypot(m.critFrom.x - at.x, m.critFrom.z - at.z)).toBeLessThan(1e-6);
  });

  it('el alcance se mide desde el frente de las ruedas: la toma con su cara de atrás a ~10 cm de ellas, no a 30', () => {
    for (const [gap, ok] of [[0.1, true], [0.3, false]] as const) {
      const g = session(spec);
      const r = g.player;
      const m = r.mech;
      r.phys.teleport(0, 2.2, 0);
      m.stowed = false;
      step(g, 6 * 120);
      const c = g.pieces.critical(r.alliance);
      const seat = critHeldSeatOf(spec)!;
      const at = r.phys.localToWorld(m.tipX() + seat.x + gap, 0, 0);
      g.pieces.place(c, at.x, H, at.z, 0);
      expect(m.grabCritical([]), `a ${gap} m`).toBe(ok);
    }
  });

  it('del piso a N3 y de regreso, en cada paso, no se mete en ningún colisionador del robot más de CRIT_SQUEEZE', () => {
    const g = session(spec);
    const r = g.player;
    const m = r.mech;
    r.phys.teleport(0, 2.2, 0);
    m.stowed = false;
    step(g, 6 * 120);
    const c = g.pieces.critical(r.alliance);
    const seat = critHeldSeatOf(spec)!;
    const at = r.phys.localToWorld(m.tipX() + seat.x, 0, 0);
    g.pieces.place(c, at.x, H, at.z, 0);
    expect(m.grabCritical([])).toBe(true);
    const held = r.phys.armColliders.critical;
    let worst = 0;
    let steps = 0;
    for (const pos of [0, 1, 2, 3, 2, 1, 0] as const) {
      m.target = pos;
      for (let i = 0; i < 2 * 120; i++) {
        step(g);
        expect(m.critical).toBe(c);
        for (let k = 0; k < r.phys.body.numColliders(); k++) {
          const col = r.phys.body.collider(k);
          if (col.handle === held.handle || !col.isEnabled()) continue;
          const hit = held.contactCollider(col, 0);
          if (hit) worst = Math.max(worst, -hit.distance);
        }
        steps++;
      }
    }
    expect(steps).toBeGreaterThan(1000);
    expect(worst).toBeLessThanOrEqual(CRIT_SQUEEZE + 0.003);
  });
});
