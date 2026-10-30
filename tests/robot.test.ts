import { beforeAll, describe, expect, it } from 'vitest';
import * as F from '../src/config/field';
import { armAngle, armTip, DEFAULT_ROBOT, validateRobot } from '../src/config/robot';

/** Distancia del centro del robot a la rendija con el brazo en N4 (como la IA, `critDistance`). */
const critReach = () => armTip(DEFAULT_ROBOT.arm, armAngle(DEFAULT_ROBOT.arm, DEFAULT_ROBOT.elevatorHeights[4])).x - 0.05;
import { GameSession } from '../src/game/GameSession';
import { emptyInput, type PlayerInput } from '../src/input/InputManager';
import { initRapier } from '../src/physics/PhysicsWorld';

beforeAll(async () => {
  await initRapier();
});

const session = (preload = false) => new GameSession({ player: 0, preload });

/** Corre `s` segundos con la entrada dada (las acciones de un disparo se aplican una vez). */
function run(g: GameSession, s: number, inp: Partial<PlayerInput> = {}): void {
  g.setInput({ ...emptyInput(), ...inp });
  const hold = { ...emptyInput(), forward: inp.forward ?? 0, turn: inp.turn ?? 0, slow: inp.slow ?? false };
  for (let i = 0; i < s * 120; i++) {
    if (i === 1) g.setInput(hold);
    g.step();
  }
}

/** Pone al robot del jugador en una pose. */
function put(g: GameSession, x: number, z: number, heading: number): void {
  g.player.phys.teleport(x, z, heading);
}

describe('robot (§7.2)', () => {
  it('el robot por defecto cumple los límites del manual', () => {
    expect(validateRobot(DEFAULT_ROBOT)).toEqual([]);
    expect(validateRobot({ ...DEFAULT_ROBOT, length: 0.7 })).toContain('chasis mayor a 65 × 65 cm (§7.2)');
  });

  it('arranca dentro de su Zona de Inicio con la precarga (§4.1)', () => {
    const g = session(true);
    for (const r of g.robots) {
      const zone = F.rectFor(r.alliance, F.START_ZONES_RED[r.station]);
      for (const c of r.phys.footprint()) expect(F.inRect(zone, c.x, c.z)).toBe(true);
      expect(r.mech.stored).toHaveLength(1);
    }
    // 12 por alianza en la reserva menos 2 precargas = 10 para el HP (§4.1.1)
    expect(g.pieces.hpStock('red')).toHaveLength(F.HP_SAMPLES_PER_ALLIANCE);
    expect(g.pieces.hpStock('blue')).toHaveLength(F.HP_SAMPLES_PER_ALLIANCE);
  });

  it('avanza hasta su velocidad máxima y no se mueve de lado (tanque)', () => {
    const g = session();
    put(g, 2.5, 1.9, Math.PI); // viendo hacia −X, entre las Muestras y la Cámara
    run(g, 1.2, { forward: 1 });
    const v = g.player.phys.body.linvel();
    expect(Math.hypot(v.x, v.z)).toBeGreaterThan(DEFAULT_ROBOT.maxSpeed * 0.9);
    expect(Math.abs(v.z)).toBeLessThan(0.05);
  });

  it('sube la rampa de 15° a la Plataforma y queda sin tocar la alfombra', () => {
    const g = session();
    put(g, 2.6, 0, Math.PI); // frente a la rampa roja, viendo hacia el centro
    const p = g.player.phys;
    // Avanza a media velocidad hasta quedar centrado en la plataforma superior (X 0.2–1.0)
    for (let i = 0; i < 4 * 120 && p.position().x > 0.62; i++) {
      g.setInput({ ...emptyInput(), forward: 0.4 });
      g.step();
    }
    run(g, 1.5);
    expect(p.position().y).toBeCloseTo(F.PLATFORM_HEIGHT, 1);
    expect(p.wheelsOnCarpet).toBe(0);
  });

  it('la garra toma Muestras del piso y las cuenta como del robot', () => {
    const g = session();
    const spot = F.labSpots()[0]; // (0.46, −2.4)
    put(g, spot.x + 1.0, spot.z, Math.PI);
    run(g, 3.0, { toggleIntake: true, forward: 0.2 });
    expect(g.player.mech.stored.length).toBeGreaterThanOrEqual(1);
    expect(g.pieces.list.filter((p) => p.state.at === 'robot' && p.state.robot === 0)).toHaveLength(g.player.mech.stored.length);
  });

  it('suelta una Muestra en el Nivel 3 de la Cámara desde el frente (§3.2.3)', () => {
    const g = session(true);
    const w = F.camaraWells()[3];
    const x = (w.x0 + w.x1) / 2;
    // Robot de frente a la pared de la Cámara (viendo hacia +Z)
    put(g, x, F.CAMARA_Z_RED[0] - DEFAULT_ROBOT.length / 2 - 0.02, -Math.PI / 2);
    run(g, 1.0, { elevator: 3 });
    const piece = g.player.mech.stored[0];
    run(g, 2.0, { releaseSample: true });
    const t = piece.body.translation();
    expect(piece.state.at).toBe('field');
    expect(F.inRect(w, t.x, t.z)).toBe(true);
    expect(t.y).toBeLessThan(w.rim);
  });

  it('toma su Muestra Crítica de la rendija de la Campana y la deja en la Repisa', () => {
    const g = session();
    const c = F.CRITICAL_HOLDER_RED;
    // De frente a la Campana (viendo hacia −Z), a la distancia de la punta del brazo a la altura de la rendija
    put(g, c.x, c.z + critReach(), Math.PI / 2);
    run(g, 1.5, { elevator: 4 });
    run(g, 0.2, { toggleIntake: true });
    expect(g.player.mech.critical?.owner).toBe('red');
    // En la plataforma superior, de frente a la Repisa
    g.player.phys.teleport(F.REPISA_DEPTH / 2 + DEFAULT_ROBOT.length / 2 + 0.03, 0, Math.PI, F.PLATFORM_HEIGHT + 0.01);
    run(g, 1.0);
    const crit = g.player.mech.critical!;
    run(g, 2.0, { releaseSample: true });
    const t = crit.body.translation();
    expect(Math.abs(t.x)).toBeLessThan(F.REPISA_DEPTH / 2);
    expect(t.y).toBeCloseTo(F.REPISA_TOP + F.CRITICAL_SIZE / 2, 1);
  });
});
