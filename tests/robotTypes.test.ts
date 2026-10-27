import { beforeAll, describe, expect, it } from 'vitest';
import { STRATEGY_OPTIONS } from '../src/ai/strategy';
import { COLLECT_HOME, LEAVE_ZONE } from '../src/auto/AutoRoutine';
import * as F from '../src/config/field';
import { armAngle, armTip, armTravelDeg, knownSpec, MECHANISM_KINDS, PIVOT_180_ROBOT, PIVOT_ROBOT, ROBOT_PRESETS, validateRobot, type RobotSpec } from '../src/config/robot';
import { GameSession } from '../src/game/GameSession';
import { emptyInput, type PlayerInput } from '../src/input/InputManager';
import { initRapier } from '../src/physics/PhysicsWorld';

beforeAll(async () => {
  await initRapier();
});

const S180 = PIVOT_180_ROBOT;
const session = (spec: RobotSpec, preload = true) => new GameSession({ player: 0, preload, specs: [spec] });

function run(g: GameSession, s: number, inp: Partial<PlayerInput> = {}): void {
  g.setInput({ ...emptyInput(), ...inp });
  const hold = { ...emptyInput(), forward: inp.forward ?? 0, turn: inp.turn ?? 0 };
  for (let i = 0; i < s * 120; i++) {
    if (i === 1) g.setInput(hold);
    g.step();
  }
}

describe('tipos de robot: solo el pivote y su variante de 180° (27-oct)', () => {
  it('quedan el pivote y su variante de 180°, y los dos cumplen §7.2 y §4.1', () => {
    expect([...MECHANISM_KINDS]).toEqual(['pivot', 'pivot180']);
    for (const s of Object.values(ROBOT_PRESETS)) expect(validateRobot(s)).toEqual([]);
    // Una pieza a la vez, sin hopper
    for (const s of Object.values(ROBOT_PRESETS)) expect(s.capacity).toBe(1);
  });

  it('180°: el brazo recorre media vuelta del piso a guardado (el pivote, 189°)', () => {
    expect(armTravelDeg(S180)).toBe(180);
    expect(armTravelDeg(PIVOT_ROBOT)).toBe(189);
    const a = S180.arm;
    // Guardado arriba y atrás con la precarga: dentro del perímetro y bajo 100 cm (§4.1, §7.2)
    const tip = armTip(a, a.stowAngle!);
    expect(Math.abs(tip.x) + 0.075).toBeLessThanOrEqual(S180.length / 2);
    expect(tip.y + 0.15).toBeLessThanOrEqual(1.0 + 1e-9);
    // Con el eje del pivote original, a 180° del piso la precarga pasaría de 100 cm
    const orig = { ...PIVOT_ROBOT.arm, stowAngle: armAngle(PIVOT_ROBOT.arm, 0) + Math.PI };
    expect(armTip(orig, orig.stowAngle).y + 0.15).toBeGreaterThan(1.0);
    // Mismas alturas en cada posición
    for (const h of S180.elevatorHeights) expect(armTip(a, armAngle(a, h)).y).toBeCloseTo(h, 6);
    expect(S180.elevatorHeights).toEqual(PIVOT_ROBOT.elevatorHeights);
  });

  for (const spec of [PIVOT_ROBOT, S180]) {
    it(`${spec.name}: agarra una Muestra del piso y la anota en el Nivel 3 de frente`, () => {
      const g = session(spec, false);
      const m = g.player.mech;
      const spot = F.labSpots()[0];
      g.player.phys.teleport(spot.x + 1.0, spot.z, Math.PI);
      run(g, 3.0, { toggleIntake: true, forward: 0.2 });
      expect(m.stored).toHaveLength(1);
      expect(m.inClaw).toBe(true);
      const w = F.camaraWells()[3];
      g.player.phys.teleport((w.x0 + w.x1) / 2, F.CAMARA_Z_RED[0] - spec.length / 2 - 0.02, -Math.PI / 2);
      run(g, 2.0, { elevator: 3 });
      run(g, 0.4, { releaseSample: true });
      run(g, 1.5);
      expect(m.stored).toHaveLength(0);
      expect(g.practiceCount.red).toBe(1);
    });
  }

  it('una repetición vieja con un robot quitado (también el pivote con hopper) se dibuja como pivote', () => {
    for (const mechanism of ['tower', 'pivotHopper']) {
      const old = { ...PIVOT_ROBOT, name: 'Viejo', mechanism, arm: mechanism === 'tower' ? undefined : PIVOT_ROBOT.arm } as unknown as RobotSpec;
      const s = knownSpec(old);
      expect(s.mechanism).toBe('pivot');
      expect(s.label).toBe('Viejo');
    }
    expect(knownSpec(S180)).toBe(S180);
  });
});

describe('estrategias por robot', () => {
  it('"Solo línea y Plataforma": cruzan la línea en AUTO y suben los dos a la Plataforma (§4.4)', () => {
    const specs = [PIVOT_ROBOT, S180, PIVOT_ROBOT, S180];
    const park = STRATEGY_OPTIONS.park;
    const g = new GameSession({ player: -1, preload: true, ai: true, specs, bots: [park, park, {}, {}], autos: [LEAVE_ZONE, LEAVE_ZONE, COLLECT_HOME, COLLECT_HOME] });
    g.startMatch();
    for (let i = 0; i < 151 * 120 && !g.match!.finished; i++) g.step();
    const m = g.match!;
    const red = m.breakdown('red');
    expect(red.autoLine).toBe(10);
    expect(red.platform).toBe(20);
    expect(red.samplesAuto + red.samplesTeleop).toBe(0);
    // La otra alianza sí anota
    expect(m.breakdown('blue').samplesAuto + m.breakdown('blue').samplesTeleop).toBeGreaterThan(5);
    expect(m.fouls.filter((f) => f.rule === 'PLATFORM_EARLY' || f.rule === 'OUT_OF_BOUNDS' || f.rule === 'AUTO_CENTER')).toEqual([]);
  }, 120_000);

  it('"N3 + Muestra Crítica" la deja en la Repisa (§4.3.1) y la dificultad se elige por robot', () => {
    const specs = [PIVOT_ROBOT, S180, S180, PIVOT_ROBOT];
    const bots = [
      { ...STRATEGY_OPTIONS.critical, ai: 'hard' as const },
      { ...STRATEGY_OPTIONS.n3, ai: 'hard' as const },
      { ...STRATEGY_OPTIONS.n3, ai: 'easy' as const },
      { ...STRATEGY_OPTIONS.n3, ai: 'easy' as const },
    ];
    const g = new GameSession({ player: -1, preload: true, ai: true, specs, bots, autos: specs.map(() => COLLECT_HOME) });
    g.startMatch();
    expect(g.bots.map((b) => (b as unknown as { opts: { ai: string } }).opts.ai)).toEqual(['hard', 'hard', 'easy', 'easy']);
    for (let i = 0; i < 151 * 120 && !g.match!.finished; i++) g.step();
    const m = g.match!;
    expect(m.breakdown('red').critical).toBe(15);
    // La IA difícil le gana a la fácil
    expect(m.score('red')).toBeGreaterThan(m.score('blue'));
  }, 120_000);
});
