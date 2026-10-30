import { beforeAll, describe, expect, it } from 'vitest';
import * as F from '../src/config/field';
import { PIVOT_ROBOT } from '../src/config/robot';
import { GameSession } from '../src/game/GameSession';
import { emptyInput, type PlayerInput } from '../src/input/InputManager';
import { initRapier } from '../src/physics/PhysicsWorld';
import { obstructZones } from '../src/referee/Referee';

beforeAll(async () => {
  await initRapier();
});

function run(g: GameSession, s: number, inp: Partial<PlayerInput> = {}): void {
  g.setInput({ ...emptyInput(), ...inp });
  const hold = { ...emptyInput(), forward: inp.forward ?? 0, turn: inp.turn ?? 0 };
  for (let i = 0; i < s * 120; i++) {
    if (i === 1) g.setInput(hold);
    g.step();
  }
}

describe('hitbox de la garra contra la madera (D34, 30-oct)', () => {
  it('con la garra baja no atraviesa la pared de la Cámara: el robot se queda antes', () => {
    const g = new GameSession({ player: 0, preload: false, specs: [PIVOT_ROBOT] });
    const w = F.camaraWells()[3];
    const flush = F.CAMARA_Z_RED[0] - PIVOT_ROBOT.length / 2;
    g.player.phys.teleport((w.x0 + w.x1) / 2, flush - 1.0, -Math.PI / 2);
    // N1 (26 cm): la garra queda abajo de la pared de 80 cm del Nivel 3 y sale del chasis
    run(g, 1.5, { elevator: 1 });
    run(g, 3, { forward: 0.4 });
    const tip = g.player.mech.tipX() - PIVOT_ROBOT.length / 2;
    expect(tip).toBeGreaterThan(0.05);
    // El chasis no llega a la pared: la garra lo detiene (antes la atravesaba y quedaba pegado)
    expect(g.player.phys.position().z).toBeLessThan(flush - tip + 0.06);
  });
});

describe('el Human Player centra la Muestra Crítica (D39)', () => {
  it('la desliza por la rendija hasta quedar frente a la garra de su robot', () => {
    const g = new GameSession({ player: 0, preload: false, solo: true, specs: [PIVOT_ROBOT] });
    const h = F.CRITICAL_HOLDER_RED;
    const tip = 0.5; // aproximado: se mide abajo
    g.player.phys.teleport(h.x - 0.45, h.z + tip + 0.35, Math.PI / 2);
    run(g, 2.5, { elevator: 4 });
    const claw = g.player.phys.localToWorld(g.player.mech.tipX(), 0, 0);
    const c = g.pieces.critical('red').body.translation();
    expect(Math.abs(c.x - claw.x)).toBeLessThan(0.03);
    // Sigue en la rendija
    expect(c.y).toBeGreaterThan(h.y);
  });

  it('no la mueve si la garra no está a la altura de la rendija', () => {
    const g = new GameSession({ player: 0, preload: false, solo: true, specs: [PIVOT_ROBOT] });
    const h = F.CRITICAL_HOLDER_RED;
    // El brazo ya abajo (al bajar pasa un instante por la altura de la rendija)
    run(g, 1.5, { elevator: 1 });
    g.player.phys.teleport(h.x - 0.45, h.z + 0.85, Math.PI / 2);
    run(g, 2.5);
    expect(g.pieces.critical('red').body.translation().x).toBeCloseTo(h.x, 2);
  });
});

describe('obstruir zonas de anotación rivales (§4.6, D17)', () => {
  it('las zonas incluyen el frente de la Cámara, el de la Campana y la rampa de la alianza', () => {
    const inAny = (a: 'red' | 'blue', x: number, z: number) => obstructZones(a).some((r) => F.inRect(r, x, z));
    expect(inAny('blue', -1.2, 0.2)).toBe(true); // rampa azul
    expect(inAny('blue', 1.2, 0.2)).toBe(false); // rampa roja
    expect(inAny('blue', 0, 0)).toBe(false); // Repisa compartida
    expect(inAny('blue', -3.5, 3.1)).toBe(true); // frente de la Campana azul
    expect(inAny('blue', -2.6, -2.5)).toBe(true); // frente de la Cámara azul
  });

  it('quedarse frente a la Campana rival en el TELEOP es Tech Foul', () => {
    const g = new GameSession({ player: 0, preload: false, ai: false });
    g.startMatch();
    const m = g.match!;
    while (m.phase !== 'TELEOP') g.step();
    g.player.phys.teleport(-3.5, 2.95, Math.PI / 2);
    run(g, 3.5);
    expect(m.fouls.some((f) => f.rule === 'OBSTRUCT' && f.offender === 'red')).toBe(true);
  }, 60_000);
});
