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

const press = (g: GameSession) => {
  g.setInput({ ...emptyInput(), elevator: 0, intake: true });
  for (let i = 0; i < 3; i++) g.step();
  g.setInput({ ...emptyInput(), elevator: 0 });
  for (let i = 0; i < 2; i++) g.step();
};

/** Brazo al piso y la Muestra entre los dedos (como la prueba de Axiom): un toque cierra la pinza. */
function trial(dx: number, dz: number) {
  const g = new GameSession({ player: 0, preload: false, specs: [M()] });
  for (const p of g.pieces.list) if (p.state.at === 'field' && p.kind === 'sample') g.pieces.stash(p, { at: 'hp', alliance: 'red' });
  g.player.phys.teleport(1.0, -1.2, 0);
  const p = g.pieces.list.find((x) => x.kind === 'sample')!;
  g.pieces.place(p, 1.0 + dx, SAMPLE_SIZE / 2 + 0.001, -1.2 + dz, 0);
  g.setInput({ ...emptyInput(), elevator: 1 });
  for (let i = 0; i < 120; i++) g.step();
  g.setInput({ ...emptyInput(), elevator: 0 });
  for (let i = 0; i < 240; i++) g.step();
  press(g);
  for (let i = 0; i < 3 * 120 && !g.player.mech.inClaw; i++) g.step();
  return { g, inClaw: g.player.mech.inClaw, closed: g.player.mech.clawClosed };
}

describe('Mentores 3478: garra de pinza como la de Axiom', () => {
  it('usa la misma pinza que Axiom (interruptor, 0.29 m de apertura, dedos de 0.113 m)', () => {
    expect(M().intake).toMatchObject({ kind: 'pinza', gap: 0.29, fingerLength: 0.113 });
    expect(M().intake?.claw).toEqual(CAD_ROBOT_SPECS.axiom.intake?.claw);
  });

  it('un toque con la Muestra entre los dedos la toma y se queda cerrada sin mantener el botón', () => {
    for (const [dx, dz] of [[0.44, 0], [0.4, 0.03], [0.48, -0.03]] as const) {
      const r = trial(dx, dz);
      expect(r.inClaw).toBe(true);
      expect(r.closed).toBe(true);
    }
  });

  it('otro toque abre la pinza y la suelta', () => {
    const { g } = trial(0.44, 0);
    press(g);
    expect(g.player.mech.clawClosed).toBe(false);
    expect(g.player.mech.inClaw).toBe(false);
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
