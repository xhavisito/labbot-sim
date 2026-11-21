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

describe('Mentores 3478: intake de mantener (no interruptor) y Muestra horizontal', () => {
  const setup = () => {
    const g = new GameSession({ player: 0, preload: false, specs: [M()] });
    for (const p of g.pieces.list) if (p.state.at === 'field' && p.kind === 'sample') g.pieces.stash(p, { at: 'hp', alliance: 'red' });
    g.player.phys.teleport(1.0, -1.2, 0);
    const p = g.pieces.list.find((x) => x.kind === 'sample')!;
    g.setInput({ ...emptyInput(), elevator: 1 });
    for (let i = 0; i < 120; i++) g.step();
    g.setInput({ ...emptyInput(), elevator: 0 });
    for (let i = 0; i < 240; i++) g.step();
    return { g, p };
  };

  it('solo come mientras se mantiene el botón: al soltarlo ya no come', () => {
    const { g, p } = setup();
    g.pieces.place(p, 1.0 + 0.47, SAMPLE_SIZE / 2 + 0.001, -1.2, 0);
    for (let i = 0; i < 2 * 120; i++) {
      g.setInput({ ...emptyInput(), elevator: 0 }); // botón suelto
      g.step();
    }
    expect(g.player.mech.inClaw).toBe(false);
    expect(g.player.mech.intakeOn).toBe(false);
    for (let i = 0; i < 2 * 120 && !g.player.mech.inClaw; i++) {
      g.setInput({ ...emptyInput(), elevator: 0, intake: true }); // botón mantenido
      g.step();
    }
    expect(g.player.mech.inClaw).toBe(true);
    // Sigue adentro al soltar el botón (no se escupe) y no es un interruptor: soltar = intake apagado
    g.setInput({ ...emptyInput(), elevator: 0 });
    for (let i = 0; i < 120; i++) g.step();
    expect(g.player.mech.intakeOn).toBe(false);
    expect(g.player.mech.inClaw).toBe(true);
  });

  it('la Muestra agarrada queda horizontal (sin girar con el brazo) en el piso y en todos los niveles', () => {
    const { g, p } = setup();
    g.pieces.place(p, 1.0 + 0.47, SAMPLE_SIZE / 2 + 0.001, -1.2, 0);
    for (let i = 0; i < 2 * 120 && !g.player.mech.inClaw; i++) {
      g.setInput({ ...emptyInput(), elevator: 0, intake: true });
      g.step();
    }
    expect(g.player.mech.inClaw).toBe(true);
    const poses = (a: number) => (g.player.phys as unknown as { armPoses(a: number): { sample: { r: { x: number; y: number; z: number; w: number } } } }).armPoses(a).sample.r;
    for (const a of [-0.3715, -0.1, 0.4, 0.8, 2.3153]) {
      const r = poses(a);
      expect(Math.abs(r.z)).toBeLessThan(1e-9);
      expect(r.w).toBeCloseTo(1, 9);
    }
  });
});

describe('Mentores 3478: brazo a N3', () => {
  it('N3 usa el mismo ángulo que el N3 de Axiom (100°, Xhavi 21-nov) y acepta la altura que resulta', () => {
    expect(M().arm.levelAngles?.[3]).toBe(CAD_ROBOT_SPECS.axiom.arm.levelAngles?.[3]);
    const g = new GameSession({ player: 0, preload: true, specs: [M()] });
    const m = g.player.mech;
    g.player.phys.teleport(1.0, -1.2, 0); // piso plano
    for (const lvl of [1, 3] as const) {
      for (let i = 0; i < 4 * 120; i++) {
        g.setInput({ ...emptyInput(), elevator: lvl });
        g.step();
      }
    }
    expect((m.angle * 180) / Math.PI).toBeCloseTo(100, 1);
    expect(m.height).toBeCloseTo(0.335 + 0.7003 * Math.sin((100 * Math.PI) / 180), 3); // 1.025 m
  });
});
