import { beforeAll, describe, expect, it } from 'vitest';
import { SCORE_PRELOAD } from '../src/auto/AutoRoutine';
import * as F from '../src/config/field';
import { armAngle, armTip, ELEVATOR_ROBOT, PIVOT_ROBOT, ROBOT_PRESETS, validateRobot, type RobotSpec } from '../src/config/robot';
import { GameSession } from '../src/game/GameSession';
import { emptyInput, type PlayerInput } from '../src/input/InputManager';
import { initRapier } from '../src/physics/PhysicsWorld';

beforeAll(async () => {
  await initRapier();
});

const session = (spec: RobotSpec, preload = true) => new GameSession({ player: 0, preload, specs: [spec] });

function run(g: GameSession, s: number, inp: Partial<PlayerInput> = {}): void {
  g.setInput({ ...emptyInput(), ...inp });
  const hold = { ...emptyInput(), forward: inp.forward ?? 0, turn: inp.turn ?? 0 };
  for (let i = 0; i < s * 120; i++) {
    if (i === 1) g.setInput(hold);
    g.step();
  }
}

describe('tipos de robot (§7.2)', () => {
  it('los tres cumplen los límites del manual', () => {
    for (const s of Object.values(ROBOT_PRESETS)) expect(validateRobot(s)).toEqual([]);
    // Un brazo más largo saca la garra más de 40 cm
    expect(validateRobot({ ...PIVOT_ROBOT, arm: { ...PIVOT_ROBOT.arm!, length: 0.85 } })).toContain('la garra sale más de 40 cm (§7.2)');
  });

  it('la garra del pivote llega al piso y al Nivel 3 a la altura pedida', () => {
    const a = PIVOT_ROBOT.arm!;
    for (const h of PIVOT_ROBOT.elevatorHeights) expect(armTip(a, armAngle(a, h)).y).toBeCloseTo(h, 6);
  });

  it('Elevador: anota en el Nivel 3 de reversa, empujando por atrás', () => {
    const g = session(ELEVATOR_ROBOT);
    const w = F.camaraWells()[3];
    // De espaldas a la pared de la Cámara (viendo hacia −Z)
    g.player.phys.teleport((w.x0 + w.x1) / 2, F.CAMARA_Z_RED[0] - ELEVATOR_ROBOT.length / 2 - 0.02, Math.PI / 2);
    run(g, 1.0, { elevator: 3 });
    const piece = g.player.mech.stored[0];
    run(g, 2.0, { releaseSample: true });
    const t = piece.body.translation();
    expect(F.inRect(w, t.x, t.z)).toBe(true);
    expect(g.practiceCount.red).toBe(1);
  });

  it('Pivote: agarra una sola Muestra del piso y la anota en el Nivel 3', () => {
    const g = session(PIVOT_ROBOT, false);
    const spot = F.labSpots()[0];
    g.player.phys.teleport(spot.x + 1.0, spot.z, Math.PI);
    run(g, 2.0, { toggleIntake: true, forward: 0.25 });
    expect(g.player.mech.stored).toHaveLength(1);
    const piece = g.player.mech.stored[0];
    const w = F.camaraWells()[3];
    g.player.phys.teleport((w.x0 + w.x1) / 2, F.CAMARA_Z_RED[0] - PIVOT_ROBOT.length / 2 - 0.02, -Math.PI / 2);
    run(g, 1.0, { elevator: 3 });
    run(g, 2.0, { releaseSample: true });
    const t = piece.body.translation();
    expect(F.inRect(w, t.x, t.z)).toBe(true);
    expect(g.practiceCount.red).toBe(1);
  });

  it('Pivote: con una Muestra en la garra no puede tomar la Crítica', () => {
    const g = session(PIVOT_ROBOT, true);
    const c = F.CRITICAL_HOLDER_RED;
    g.player.phys.teleport(c.x, -F.HALF_W + PIVOT_ROBOT.length / 2 + 0.05, Math.PI / 2);
    run(g, 1.0, { elevator: 4 });
    run(g, 0.2, { grabCritical: true });
    expect(g.player.mech.critical).toBeNull();
  });

  it('IA con elevadores y pivotes: anota y no pisa la Plataforma ni sale de la cancha', () => {
    const specs = [ELEVATOR_ROBOT, PIVOT_ROBOT, PIVOT_ROBOT, ELEVATOR_ROBOT];
    const g = new GameSession({ player: 0, preload: true, ai: true, specs, autos: [SCORE_PRELOAD, SCORE_PRELOAD, SCORE_PRELOAD, SCORE_PRELOAD] });
    g.startMatch();
    for (let i = 0; i < 151 * 120 && !g.match!.finished; i++) {
      g.setInput(emptyInput());
      g.step();
    }
    const m = g.match!;
    for (const a of ['red', 'blue'] as const) expect(m.breakdown(a).samplesAuto + m.breakdown(a).samplesTeleop).toBeGreaterThan(18);
    expect(m.fouls.filter((f) => f.rule === 'PLATFORM_EARLY' || f.rule === 'OUT_OF_BOUNDS' || f.rule === 'AUTO_CENTER')).toEqual([]);
  }, 120_000);
});
