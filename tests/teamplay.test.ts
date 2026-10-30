import { beforeAll, describe, expect, it } from 'vitest';
import { polyGap, pushTouch, touches } from '../src/ai/contact';
import { planPath } from '../src/ai/grid';
import { COLLECT_HOME, DO_NOTHING } from '../src/auto/AutoRoutine';
import { GameSession } from '../src/game/GameSession';
import { emptyInput } from '../src/input/InputManager';
import { initRapier } from '../src/physics/PhysicsWorld';

beforeAll(async () => {
  await initRapier();
});

const square = (x: number, z: number, h = 0.3) => [
  { x: x + h, z: z + h },
  { x: x + h, z: z - h },
  { x: x - h, z: z - h },
  { x: x - h, z: z + h },
];

describe('contacto entre robots (ai/contact)', () => {
  it('mide la separación entre contornos y dice por dónde se tocan', () => {
    const a = polyGap(square(0, 0), square(1, 0));
    expect(a.gap).toBeCloseTo(0.4, 5);
    expect(a.at.x).toBeCloseTo(0.7, 5);
    // Traslapados: separación 0 y el punto queda entre los dos
    const b = polyGap(square(0, 0), square(0.5, 0));
    expect(b.gap).toBe(0);
    expect(b.at.x).toBeGreaterThan(0.1);
    expect(b.at.x).toBeLessThan(0.4);
  });
});

describe('camino en la rejilla (ai/grid)', () => {
  it('rodea un obstáculo y avisa cuando no hay paso', () => {
    const g = { halfL: 4.5, halfW: 3.5, cell: 0.15 };
    // Un "robot" en medio del camino recto
    const blocked = (p: { x: number; z: number }) => (Math.hypot(p.x, p.z) < 0.8 ? Infinity : 1);
    const r = planPath({ x: -2, z: 0 }, { x: 2, z: 0 }, blocked, g);
    expect(r.reached).toBe(true);
    expect(r.path.every((p) => Math.hypot(p.x, p.z) >= 0.8)).toBe(true);
    // Una pared de lado a lado: no llega
    const wall = (p: { x: number; z: number }) => (Math.abs(p.x) < 0.2 ? Infinity : 1);
    expect(planPath({ x: -2, z: 0 }, { x: 2, z: 0 }, wall, g).reached).toBe(false);
  });
});

/**
 * El jugador deja su robot parado en un lugar de paso (el Laboratorio, frente a la Cámara roja) todo
 * el TELEOP. La IA no lo empuja: lo rodea o espera (D41).
 */
function parkedMatch(player: number, spot: { x: number; z: number }) {
  const autos = [COLLECT_HOME, COLLECT_HOME, COLLECT_HOME, COLLECT_HOME];
  autos[player] = DO_NOTHING;
  const g = new GameSession({ player, preload: true, ai: true, autos, hp: { enabled: true, interval: 3 } });
  g.startMatch();
  let placed = false;
  let pushing = 0;
  for (let i = 0; i < 151 * 120 && !g.match!.finished; i++) {
    g.setInput(emptyInput());
    g.step();
    if (!placed && g.match!.phase === 'TELEOP') {
      g.robots[player].phys.teleport(spot.x, spot.z, 0.7);
      placed = true;
    }
    for (const r of g.robots) if (r.index !== player && pushTouch(r, r.phys.lastCmd.forward, touches(r, [g.robots[player]], 0.02))) pushing += 1 / 120;
  }
  return { m: g.match!, pushing };
}

describe('la IA no empuja al robot del jugador', () => {
  it('su compañero parado en el Laboratorio', () => {
    const { m, pushing } = parkedMatch(0, { x: 1.0, z: 1.9 });
    expect(pushing).toBeLessThan(1.5);
    expect(m.fouls.filter((f) => f.rule === 'PIN')).toEqual([]);
    expect(m.breakdown('blue').samplesTeleop).toBeGreaterThan(0);
  }, 120_000);

  it('un rival parado frente a la Cámara roja', () => {
    const { m, pushing } = parkedMatch(2, { x: 1.0, z: 1.9 });
    expect(pushing).toBeLessThan(1.5);
    // Antes: 13 s empujándolo y un Foul por pinning
    expect(m.fouls.filter((f) => f.rule === 'PIN' && f.offender === 'red')).toEqual([]);
    expect(m.breakdown('red').samplesTeleop).toBeGreaterThan(0);
  }, 120_000);
});
