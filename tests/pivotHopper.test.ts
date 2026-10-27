import { beforeAll, describe, expect, it } from 'vitest';
import { SCORE_PRELOAD } from '../src/auto/AutoRoutine';
import * as F from '../src/config/field';
import { armAngle, armTip, PIVOT_HOPPER_180_ROBOT, PIVOT_HOPPER_ROBOT, ROBOT_LIMITS, validateRobot, type RobotSpec } from '../src/config/robot';
import { GameSession } from '../src/game/GameSession';
import { emptyInput, type PlayerInput } from '../src/input/InputManager';
import { initRapier } from '../src/physics/PhysicsWorld';

beforeAll(async () => {
  await initRapier();
});

const S = PIVOT_HOPPER_ROBOT;
const session = (spec: RobotSpec, preload = true) => new GameSession({ player: 0, preload, specs: [spec] });

function run(g: GameSession, s: number, inp: Partial<PlayerInput> = {}): void {
  g.setInput({ ...emptyInput(), ...inp });
  const hold = { ...emptyInput(), forward: inp.forward ?? 0, turn: inp.turn ?? 0 };
  for (let i = 0; i < s * 120; i++) {
    if (i === 1) g.setInput(hold);
    g.step();
  }
}

describe('Pivote con hopper', () => {
  it('cumple §7.2 en todas sus posiciones, también al pasar por arriba con una Muestra', () => {
    expect(validateRobot(S)).toEqual([]);
    const a = S.arm!;
    // Punta más alta del brazo (vertical) con una Muestra de 150 mm: 100 cm justos (D24)
    expect(a.pivotY + a.length + 0.15).toBeLessThanOrEqual(ROBOT_LIMITS.maxHeight + 1e-9);
    for (const h of S.elevatorHeights) expect(armTip(a, armAngle(a, h)).y).toBeCloseTo(h, 6);
    // N3: la Muestra queda delante del chasis y su fondo arriba de la apertura (800 mm, §3.2.3)
    expect(armTip(a, armAngle(a, S.elevatorHeights[3])).x - 0.075).toBeGreaterThan(S.length / 2);
    expect(S.elevatorHeights[3]).toBeGreaterThan(0.8);
    // Un brazo más largo pasaría de 100 cm al guardar
    expect(validateRobot({ ...S, arm: { ...a, length: 0.55 } })).toContain('el brazo con la Muestra pasa de 100 cm al pasar por arriba (§7.2)');
  });

  it('junta varias Muestras: la garra las pasa al hopper hasta llenarlo', () => {
    const g = session(S, false);
    const m = g.player.mech;
    const spots = F.labSpots();
    let intake = false;
    for (const spot of spots.slice(0, 3)) {
      g.player.phys.teleport(spot.x + 1.0, spot.z, Math.PI);
      run(g, 3.0, { toggleIntake: !intake, forward: 0.2 });
      intake = true;
    }
    expect(m.stored).toHaveLength(3);
    // Con la garra encendida, todas quedan en el hopper y la garra vacía para la siguiente
    expect(m.inHopper).toBe(3);
    expect(m.inClaw).toBe(false);
  });

  it('anota todo el hopper en el Nivel 3 de frente: el brazo saca cada Muestra solo', () => {
    const g = session(S, false);
    const m = g.player.mech;
    const spots = F.labSpots();
    let intake = false;
    for (const spot of spots.slice(0, 3)) {
      g.player.phys.teleport(spot.x + 1.0, spot.z, Math.PI);
      run(g, 3.0, { toggleIntake: !intake, forward: 0.2 });
      intake = true;
    }
    run(g, 0.1, { toggleIntake: true });
    expect(m.intakeOn).toBe(false);
    const w = F.camaraWells()[3];
    g.player.phys.teleport((w.x0 + w.x1) / 2, F.CAMARA_Z_RED[0] - S.length / 2 - 0.02, -Math.PI / 2);
    run(g, 2.0, { elevator: 3 });
    expect(m.inClaw).toBe(true);
    for (let i = 0; i < 3; i++) {
      // Espera a que el brazo esté arriba con la siguiente y la suelta
      for (let k = 0; k < 400 && !(m.inClaw && m.atTarget); k++) run(g, 1 / 120);
      run(g, 0.4, { releaseSample: true });
    }
    run(g, 1.5);
    expect(m.stored).toHaveLength(0);
    expect(g.practiceCount.red).toBe(3);
  });

  it('toma la Crítica con Muestras en el hopper (la garra va vacía)', () => {
    const g = session(S, true);
    const m = g.player.mech;
    // La precarga va al hopper con la garra encendida
    run(g, 2.5, { toggleIntake: true });
    expect(m.inHopper).toBe(1);
    const c = F.CRITICAL_HOLDER_RED;
    // La garra llega lejos: el robot se para a la distancia de su punta (como la IA, `critDistance`)
    const a = S.arm!;
    g.player.phys.teleport(c.x, c.z + armTip(a, armAngle(a, S.elevatorHeights[4])).x - 0.05, Math.PI / 2);
    run(g, 1.5, { elevator: 4 });
    run(g, 0.2, { grabCritical: true });
    expect(m.critical).not.toBeNull();
    expect(m.stored).toHaveLength(1);
    // Con la Crítica en la garra no saca Muestras del hopper
    run(g, 0.1, { toggleIntake: true });
    run(g, 1.5, { elevator: 3 });
    expect(m.inClaw).toBe(false);
    expect(m.inHopper).toBe(1);
  });

  it('IA con los dos tipos: anota y no pisa la Plataforma ni sale de la cancha', () => {
    const specs = [S, PIVOT_HOPPER_180_ROBOT, S, PIVOT_HOPPER_180_ROBOT];
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
