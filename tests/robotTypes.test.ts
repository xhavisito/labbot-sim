import { beforeAll, describe, expect, it } from 'vitest';
import { COLLECT_HOME, SCORE_PRELOAD } from '../src/auto/AutoRoutine';
import * as F from '../src/config/field';
import { armAngle, armTip, CHASSIS_ROBOT, ELEVATOR_ROBOT, PIVOT_ROBOT, ROBOT_PRESETS, TOWER_ROBOT, validateRobot, type RobotSpec } from '../src/config/robot';
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
  it('todos cumplen los límites del manual', () => {
    for (const s of Object.values(ROBOT_PRESETS)) expect(validateRobot(s)).toEqual([]);
    // Un brazo más largo saca la garra más de 40 cm
    expect(validateRobot({ ...PIVOT_ROBOT, arm: { ...PIVOT_ROBOT.arm!, length: 0.85 } })).toContain('la garra sale más de 40 cm (§7.2)');
  });

  it('Pivote: guardado con la precarga cabe en el perímetro y bajo 100 cm (§4.1)', () => {
    // El brazo anterior (68 cm, pivote a 45 cm) no cabía guardado
    const old = { ...PIVOT_ROBOT, length: 0.65, width: 0.65, arm: { pivotX: -0.05, pivotY: 0.45, length: 0.68, speed: 4, stowAngle: (127 * Math.PI) / 180 } };
    expect(validateRobot(old)).toContain('el brazo guardado no cabe en el perímetro al inicio (§4.1)');
    const g = session(PIVOT_ROBOT);
    const m = g.player.mech;
    expect(m.stowed).toBe(true);
    run(g, 1.0);
    expect(m.stowed).toBe(true);
    run(g, 1.0, { elevator: 3 });
    expect(m.stowed).toBe(false);
    expect(m.height).toBeCloseTo(PIVOT_ROBOT.elevatorHeights[3], 6);
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

  it('Torre: junta varias Muestras y las anota todas en el Nivel 3 de reversa', () => {
    const g = session(TOWER_ROBOT, false);
    const spots = F.labSpots();
    for (const spot of spots.slice(0, 3)) {
      g.player.phys.teleport(spot.x + 0.75, spot.z, Math.PI);
      run(g, 1.5, { toggleIntake: g.player.mech.intakeOn ? false : true, forward: 0.3 });
    }
    const n = g.player.mech.stored.length;
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(TOWER_ROBOT.capacity);
    const w = F.camaraWells()[3];
    g.player.phys.teleport((w.x0 + w.x1) / 2, F.CAMARA_Z_RED[0] - TOWER_ROBOT.length / 2 - 0.02, Math.PI / 2);
    for (let i = 0; i < n; i++) run(g, 0.6, { releaseSample: true });
    run(g, 1.5);
    expect(g.player.mech.stored).toHaveLength(0);
    expect(g.practiceCount.red).toBe(n);
  });

  it('Torre: la pala toma la Crítica de la rendija con la columna llena', () => {
    const g = session(TOWER_ROBOT, true);
    const c = F.CRITICAL_HOLDER_RED;
    g.player.phys.teleport(c.x, -F.HALF_W + TOWER_ROBOT.length / 2 + 0.05, Math.PI / 2);
    run(g, 1.0, { elevator: 4 });
    run(g, 0.2, { grabCritical: true });
    expect(g.player.mech.critical).not.toBeNull();
    expect(g.player.mech.stored).toHaveLength(1);
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

  it('IA: dos elevadores del mismo carril dejan cada uno su Crítica en la Repisa (§4.3.1)', () => {
    // Rojo 2 y Azul 1 suben por el mismo lado de la Plataforma y sueltan de reversa, cara a cara
    const specs = [PIVOT_ROBOT, ELEVATOR_ROBOT, ELEVATOR_ROBOT, TOWER_ROBOT];
    const bots = [{}, { endgame: 'critical' as const }, { endgame: 'critical' as const }, {}];
    const g = new GameSession({ player: -1, preload: true, ai: true, specs, bots, autos: [COLLECT_HOME, COLLECT_HOME, COLLECT_HOME, COLLECT_HOME] });
    g.startMatch();
    for (let i = 0; i < 151 * 120 && !g.match!.finished; i++) g.step();
    const m = g.match!;
    for (const a of ['red', 'blue'] as const) {
      expect(m.breakdown(a).critical).toBe(15);
      expect(m.rankingPoints(a).critical).toBe(true);
    }
    expect(m.fouls.filter((f) => f.rule === 'PLATFORM_EARLY' || f.rule === 'OUT_OF_BOUNDS' || f.rule === 'AUTO_CENTER')).toEqual([]);
  }, 120_000);

  it('IA con torres y pivotes: anota y no pisa la Plataforma ni sale de la cancha', () => {
    const specs = [TOWER_ROBOT, PIVOT_ROBOT, PIVOT_ROBOT, TOWER_ROBOT];
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

  it('Chasis: lleva la precarga y no toma ni suelta piezas', () => {
    const g = session(CHASSIS_ROBOT, true);
    const m = g.player.mech;
    expect(m.stored).toHaveLength(1);
    run(g, 0.5, { releaseSample: true });
    expect(m.stored).toHaveLength(1);
    const spot = F.labSpots()[0];
    g.player.phys.teleport(spot.x + 0.75, spot.z, Math.PI);
    run(g, 1.5, { toggleIntake: true, forward: 0.3 });
    expect(m.stored).toHaveLength(1);
    const c = F.CRITICAL_HOLDER_RED;
    g.player.phys.teleport(c.x, -F.HALF_W + CHASSIS_ROBOT.length / 2 + 0.05, Math.PI / 2);
    run(g, 0.2, { grabCritical: true });
    expect(m.critical).toBeNull();
  });

  it('IA con chasis: cruzan la línea en AUTO y suben los dos a la Plataforma (§4.4)', () => {
    const specs = [CHASSIS_ROBOT, CHASSIS_ROBOT, TOWER_ROBOT, PIVOT_ROBOT];
    // Aunque les toque una rutina de IA, el chasis sale de la zona
    const g = new GameSession({ player: 3, preload: true, ai: true, specs, autos: [COLLECT_HOME, SCORE_PRELOAD, COLLECT_HOME, COLLECT_HOME] });
    g.startMatch();
    for (let i = 0; i < 151 * 120 && !g.match!.finished; i++) {
      g.setInput(emptyInput());
      g.step();
    }
    const m = g.match!;
    const red = m.breakdown('red');
    expect(red.autoLine).toBe(10);
    expect(red.platform).toBe(20);
    expect(red.samplesAuto + red.samplesTeleop).toBe(0);
    expect(m.fouls.filter((f) => f.offender === 'red')).toEqual([]);
  }, 120_000);
});
