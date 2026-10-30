import { beforeAll, describe, expect, it } from 'vitest';
import { STRATEGY_OPTIONS } from '../src/ai/strategy';
import { COLLECT_HOME, LEAVE_ZONE } from '../src/auto/AutoRoutine';
import * as F from '../src/config/field';
import { armTip, knownSpec, posTip, MECHANISM_KINDS, PIVOT_180_ROBOT, PIVOT_ROBOT, ROBOT_PRESETS, validateRobot, type RobotSpec } from '../src/config/robot';
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

  it('180° (volteado el 29-oct): recoge atrás y voltea el brazo para anotar al frente; todo dentro de §7.2', () => {
    const half = S180.length / 2;
    // Piso atrás, la Muestra fuera del chasis
    expect(-posTip(S180, 0).x - 0.075).toBeGreaterThan(half);
    // N1–N3 al frente: la Muestra delante del chasis, con el fondo arriba de la apertura (§3.2.3)
    for (const l of [1, 2, 3] as const) {
      const t = posTip(S180, l);
      expect(t.x - 0.075).toBeGreaterThan(half);
      expect(t.y).toBeCloseTo(S180.elevatorHeights[l], 6);
    }
    expect(S180.elevatorHeights[3]).toBeGreaterThan(0.8);
    // La Crítica (posición 4) atrás, del lado donde recoge
    expect(-posTip(S180, 4).x - 0.1).toBeGreaterThan(half);
    // Guardado con la precarga dentro del perímetro y bajo 100 cm (§4.1)
    const st = armTip(S180.arm, S180.arm.stowAngle!);
    expect(Math.abs(st.x) + 0.075).toBeLessThanOrEqual(half);
    expect(st.y + 0.15).toBeLessThanOrEqual(1.0 + 1e-9);
    // Al voltear con una Muestra pasa poco de 100 cm (SUPUESTO D24): se documenta, no se esconde
    expect(S180.arm.pivotY + S180.arm.length + 0.15).toBeCloseTo(1.03, 6);
  });

  it('180°: agarra atrás y anota en N3 de frente a la Cámara, sin girar el chasis', () => {
    const g = session(S180, false);
    const m = g.player.mech;
    const w = F.camaraWells()[3];
    // De frente a la Cámara (viendo hacia +Z) con una Muestra en el piso detrás
    const z = F.CAMARA_Z_RED[0] - S180.length / 2 - 0.02;
    const x = (w.x0 + w.x1) / 2;
    g.player.phys.teleport(x, z, -Math.PI / 2);
    g.pieces.place(g.pieces.list.find((p) => p.kind === 'sample' && p.state.at === 'field')!, x, F.SAMPLE_SIZE / 2, z + posTip(S180, 0).x, 0);
    const h0 = g.player.phys.heading();
    run(g, 1.5, { toggleIntake: true });
    expect(m.inClaw).toBe(true);
    run(g, 2.0, { elevator: 3 });
    expect(m.atTarget).toBe(true);
    run(g, 0.4, { releaseSample: true });
    run(g, 1.5);
    expect(m.stored).toHaveLength(0);
    expect(g.practiceCount.red).toBe(1);
    expect(Math.abs(g.player.phys.heading() - h0)).toBeLessThan(0.05);
  });

  it('180°: avanzando de frente llega a la Cámara con la precarga y la anota en N3', () => {
    const g = session(S180, true);
    const m = g.player.mech;
    const w = F.camaraWells()[3];
    // 1 m antes de la Cámara, viéndola: avanza hacia adelante hasta quedar pegado
    g.player.phys.teleport((w.x0 + w.x1) / 2, F.CAMARA_Z_RED[0] - S180.length / 2 - 1.0, -Math.PI / 2);
    run(g, 2.0, { elevator: 3, forward: 0.5 });
    expect(m.atTarget).toBe(true);
    run(g, 0.4, { releaseSample: true });
    run(g, 1.5);
    expect(g.practiceCount.red).toBe(1);
  });

  for (const spec of [PIVOT_ROBOT]) {
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
