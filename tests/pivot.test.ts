import { beforeAll, describe, expect, it } from 'vitest';
import { SCORE_PRELOAD } from '../src/auto/AutoRoutine';
import * as F from '../src/config/field';
import { armAngle, armTip, PIVOT_180_ROBOT, PIVOT_ROBOT, ROBOT_LIMITS, validateRobot, type RobotSpec } from '../src/config/robot';
import { GameSession } from '../src/game/GameSession';
import { emptyInput, type PlayerInput } from '../src/input/InputManager';
import { initRapier } from '../src/physics/PhysicsWorld';

beforeAll(async () => {
  await initRapier();
});

const S = PIVOT_ROBOT;
const session = (spec: RobotSpec, preload = true) => new GameSession({ player: 0, preload, specs: [spec] });

function run(g: GameSession, s: number, inp: Partial<PlayerInput> = {}): void {
  g.setInput({ ...emptyInput(), ...inp });
  const hold = { ...emptyInput(), forward: inp.forward ?? 0, turn: inp.turn ?? 0 };
  for (let i = 0; i < s * 120; i++) {
    if (i === 1) g.setInput(hold);
    g.step();
  }
}

describe('Pivote', () => {
  it('cumple §7.2 en todas sus posiciones y cabe guardado al inicio (§4.1)', () => {
    expect(validateRobot(PIVOT_180_ROBOT)).toEqual([]);
    for (const spec of [S]) {
      expect(validateRobot(spec)).toEqual([]);
      const a = spec.arm;
      for (const h of spec.elevatorHeights) expect(armTip(a, armAngle(a, h)).y).toBeCloseTo(h, 6);
      // N3: la Muestra queda delante del chasis y su fondo arriba de la apertura (800 mm, §3.2.3)
      expect(armTip(a, armAngle(a, spec.elevatorHeights[3])).x - 0.075).toBeGreaterThan(spec.length / 2);
      expect(spec.elevatorHeights[3]).toBeGreaterThan(0.8);
      // Guardado con la precarga bajo 100 cm
      expect(armTip(a, a.stowAngle!).y + 0.15).toBeLessThanOrEqual(ROBOT_LIMITS.maxHeight + 1e-9);
    }
    // Un brazo más largo saca la garra más de 40 cm
    expect(validateRobot({ ...S, arm: { ...S.arm, length: 0.8 } })).toContain('la garra sale más de 40 cm (§7.2)');
  });

  it('lleva una pieza a la vez: con una en la garra no agarra otra', () => {
    const g = session(S, false);
    const m = g.player.mech;
    const spots = F.labSpots();
    let intake = false;
    for (const spot of spots.slice(0, 2)) {
      g.player.phys.teleport(spot.x + 1.0, spot.z, Math.PI);
      run(g, 3.0, { toggleIntake: !intake, forward: 0.2 });
      intake = true;
    }
    expect(m.stored).toHaveLength(1);
    expect(m.inClaw).toBe(true);
  });

  it('toma la Crítica con la garra vacía y no con la precarga en ella', () => {
    const g = session(S, true);
    const m = g.player.mech;
    const c = F.CRITICAL_HOLDER_RED;
    const a = S.arm;
    // La garra llega lejos: el robot se para a la distancia de su punta (como la IA, `critDistance`)
    g.player.phys.teleport(c.x, c.z + armTip(a, armAngle(a, S.elevatorHeights[4])).x - 0.05, Math.PI / 2);
    run(g, 1.5, { elevator: 4 });
    run(g, 0.2, { toggleIntake: true });
    expect(m.critical).toBeNull();
    // Suelta la precarga y ya la toma
    run(g, 0.5, { releaseSample: true });
    expect(m.stored).toHaveLength(0);
    run(g, 0.2, { toggleIntake: true });
    expect(m.critical).not.toBeNull();
  });

  it('IA con los dos tipos: anota y no pisa la Plataforma ni sale de la cancha', () => {
    const specs = [S, PIVOT_180_ROBOT, S, PIVOT_180_ROBOT];
    const g = new GameSession({ player: 0, preload: true, ai: true, specs, autos: [SCORE_PRELOAD, SCORE_PRELOAD, SCORE_PRELOAD, SCORE_PRELOAD] });
    g.startMatch();
    for (let i = 0; i < 151 * 120 && !g.match!.finished; i++) {
      g.setInput(emptyInput());
      g.step();
    }
    const m = g.match!;
    for (const a of ['red', 'blue'] as const) expect(m.breakdown(a).samplesAuto + m.breakdown(a).samplesTeleop).toBeGreaterThan(12);
    expect(m.fouls.filter((f) => f.rule === 'PLATFORM_EARLY' || f.rule === 'OUT_OF_BOUNDS' || f.rule === 'AUTO_CENTER')).toEqual([]);
  }, 120_000);
});
