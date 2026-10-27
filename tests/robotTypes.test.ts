import { beforeAll, describe, expect, it } from 'vitest';
import { STRATEGY_OPTIONS } from '../src/ai/strategy';
import { COLLECT_HOME, LEAVE_ZONE } from '../src/auto/AutoRoutine';
import * as F from '../src/config/field';
import { armAngle, armTip, armTravelDeg, knownSpec, MECHANISM_KINDS, PIVOT_HOPPER_180_ROBOT, PIVOT_HOPPER_ROBOT, ROBOT_PRESETS, validateRobot, type RobotSpec } from '../src/config/robot';
import { GameSession } from '../src/game/GameSession';
import { emptyInput, type PlayerInput } from '../src/input/InputManager';
import { initRapier } from '../src/physics/PhysicsWorld';

beforeAll(async () => {
  await initRapier();
});

const S180 = PIVOT_HOPPER_180_ROBOT;
const session = (spec: RobotSpec, preload = true) => new GameSession({ player: 0, preload, specs: [spec] });

function run(g: GameSession, s: number, inp: Partial<PlayerInput> = {}): void {
  g.setInput({ ...emptyInput(), ...inp });
  const hold = { ...emptyInput(), forward: inp.forward ?? 0, turn: inp.turn ?? 0 };
  for (let i = 0; i < s * 120; i++) {
    if (i === 1) g.setInput(hold);
    g.step();
  }
}

/** Segundos hasta que la Muestra de la garra queda en el hopper (garra encendida desde el piso). */
function storeTime(spec: RobotSpec): number {
  const g = session(spec, false);
  const m = g.player.mech;
  const spot = F.labSpots()[0];
  g.player.phys.teleport(spot.x + 1.0, spot.z, Math.PI);
  g.setInput({ ...emptyInput(), toggleIntake: true });
  let grabbed = -1;
  for (let i = 0; i < 8 * 120; i++) {
    if (i === 1) g.setInput({ ...emptyInput(), forward: 0.2 });
    g.step();
    if (grabbed < 0 && m.inClaw) {
      grabbed = i;
      g.setInput(emptyInput());
    }
    if (grabbed >= 0 && m.inHopper === 1) return (i - grabbed) / 120;
  }
  return Infinity;
}

describe('tipos de robot: solo pivotes con hopper (27-oct)', () => {
  it('quedan el pivote con hopper y su variante de 180°, y los dos cumplen §7.2 y §4.1', () => {
    expect([...MECHANISM_KINDS]).toEqual(['pivotHopper', 'pivotHopper180']);
    for (const s of Object.values(ROBOT_PRESETS)) expect(validateRobot(s)).toEqual([]);
  });

  it('180°: el brazo recorre media vuelta del piso a la boca del hopper (el otro, 243°)', () => {
    expect(armTravelDeg(S180)).toBe(180);
    expect(armTravelDeg(PIVOT_HOPPER_ROBOT)).toBe(243);
    const a = S180.arm;
    // Boca arriba del centro: la Muestra en la garra cabe en el perímetro y bajo 100 cm (§4.1, §7.2)
    const tip = armTip(a, a.hopperAngle!);
    expect(Math.abs(tip.x) + 0.075).toBeLessThanOrEqual(S180.length / 2);
    expect(tip.y + 0.15).toBeLessThanOrEqual(1.0 + 1e-9);
    // Mismo chasis, alturas y alcance que el original
    for (const h of S180.elevatorHeights) expect(armTip(a, armAngle(a, h)).y).toBeCloseTo(h, 6);
    expect(S180.elevatorHeights).toEqual(PIVOT_HOPPER_ROBOT.elevatorHeights);
  });

  it('180°: guarda cada Muestra en el hopper más rápido', () => {
    const t180 = storeTime(S180);
    const t243 = storeTime(PIVOT_HOPPER_ROBOT);
    expect(t180).toBeLessThan(t243 - 0.15);
    expect(t180).toBeLessThan(1.5);
  });

  it('180°: junta en el hopper y anota en el Nivel 3 de frente', () => {
    const g = session(S180, false);
    const m = g.player.mech;
    let intake = false;
    for (const spot of F.labSpots().slice(0, 2)) {
      g.player.phys.teleport(spot.x + 1.0, spot.z, Math.PI);
      run(g, 3.0, { toggleIntake: !intake, forward: 0.2 });
      intake = true;
    }
    // Puede llevarse también una vecina al pasar
    const n = m.stored.length;
    expect(n).toBeGreaterThanOrEqual(2);
    expect(m.inHopper).toBeGreaterThanOrEqual(2);
    run(g, 0.1, { toggleIntake: true });
    const w = F.camaraWells()[3];
    g.player.phys.teleport((w.x0 + w.x1) / 2, F.CAMARA_Z_RED[0] - S180.length / 2 - 0.02, -Math.PI / 2);
    run(g, 2.0, { elevator: 3 });
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 400 && !(m.inClaw && m.atTarget); k++) run(g, 1 / 120);
      run(g, 0.4, { releaseSample: true });
    }
    run(g, 1.5);
    expect(m.stored).toHaveLength(0);
    expect(g.practiceCount.red).toBe(n);
  });

  it('una repetición vieja con un robot quitado se dibuja como pivote con hopper', () => {
    const old = { ...PIVOT_HOPPER_ROBOT, name: 'Torre', mechanism: 'tower', arm: undefined } as unknown as RobotSpec;
    const s = knownSpec(old);
    expect(s.mechanism).toBe('pivotHopper');
    expect(s.label).toBe('Torre');
    expect(knownSpec(S180)).toBe(S180);
  });
});

describe('estrategias por robot', () => {
  it('"Solo línea y Plataforma": cruzan la línea en AUTO y suben los dos a la Plataforma (§4.4)', () => {
    const specs = [PIVOT_HOPPER_ROBOT, S180, PIVOT_HOPPER_ROBOT, S180];
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
    const specs = [PIVOT_HOPPER_ROBOT, S180, S180, PIVOT_HOPPER_ROBOT];
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
