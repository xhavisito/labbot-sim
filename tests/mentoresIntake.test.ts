/** Mentores 3478: el intake (rodillos del CAD) come la Muestra del piso y los rodillos negros y verdes del CAD existen. */
import { beforeAll, describe, expect, it } from 'vitest';
import { CAD_ROBOT_SPECS } from '../src/cad/cadRobots';
import { SAMPLE_SIZE } from '../src/config/field';
import { GameSession } from '../src/game/GameSession';
import { emptyInput } from '../src/input/InputManager';
import { initRapier } from '../src/physics/PhysicsWorld';

beforeAll(async () => {
  await initRapier();
});

const M = () => CAD_ROBOT_SPECS['mentores-3478'];

function trial(dx: number, dz: number, level: 0 | 4 = 0) {
  const g = new GameSession({ player: 0, preload: false, specs: [M()] });
  for (const p of g.pieces.list) if (p.state.at === 'field' && p.kind === 'sample') g.pieces.stash(p, { at: 'hp', alliance: 'red' });
  g.player.phys.teleport(1.0, -1.2, 0);
  const p = g.pieces.list.find((x) => x.kind === 'sample')!;
  g.pieces.place(p, 1.0 + dx, SAMPLE_SIZE / 2 + 0.001, -1.2 + dz, 0);
  let t = Infinity;
  for (let i = 0; i < 8 * 120; i++) {
    g.setInput({ ...emptyInput(), forward: g.player.phys.position().x < 1.0 + dx - 0.55 ? 0.5 : 0, intake: true, elevator: level });
    g.step();
    if (g.player.mech.inClaw) { t = i / 120; break; }
  }
  return { t, inClaw: g.player.mech.inClaw, x: g.player.phys.position().x };
}

describe('Mentores 3478: intake', () => {
  it('con el brazo al piso come una Muestra de frente, con desvío y manejando hacia ella', () => {
    for (const [dx, dz] of [[1.0, 0], [0.8, 0.05], [1.0, -0.06], [0.7, 0]] as const) {
      const r = trial(dx, dz);
      console.log('MENTORES-INTAKE', dx, dz, JSON.stringify(r));
      expect(r.inClaw).toBe(true);
    }
  });
});

describe('Mentores 3478: brazo a N3', () => {
  it('N3 (0.85 m) queda a 47° al frente y desde el piso el brazo gira menos de 90° sin pasar por atrás', () => {
    const g = new GameSession({ player: 0, preload: true, specs: [M()] });
    const m = g.player.mech;
    g.player.phys.teleport(1.0, -1.2, 0); // piso plano
    const angles: number[] = [];
    for (const lvl of [1, 0, 3] as const) {
      for (let i = 0; i < 3 * 120; i++) {
        g.setInput({ ...emptyInput(), elevator: lvl });
        g.step();
        angles.push(m.angle);
      }
    }
    const floor = angles[6 * 120 - 1];
    expect(floor).toBeCloseTo(-0.3715, 2);
    expect(m.angle).toBeCloseTo(Math.asin((0.85 - 0.335) / 0.7003), 2);
    expect(m.height).toBeCloseTo(0.85, 3);
    expect(m.angle - floor).toBeLessThan(Math.PI / 2);
    for (const a of angles) expect(Math.abs(a)).toBeLessThan(Math.PI / 2); // nunca pasa de la vertical
  });
});
