/** Selección de robot: Axiom llega con la garra en la pose de piso (la misma que agarra la Crítica del piso). */
import { beforeAll, describe, expect, it } from 'vitest';
import { robotSpec } from '../src/config/robotIds';
import { posAngle, armTip } from '../src/config/robot';
import { GameSession } from '../src/game/GameSession';
import { initRapier } from '../src/physics/PhysicsWorld';

beforeAll(async () => {
  await initRapier();
});

describe('Axiom en la selección de robot', () => {
  it('la garra queda en la pose de piso, no plegada', () => {
    const g = new GameSession({ player: 0, preload: true, specs: [robotSpec('cad:axiom')] });
    const m = g.player.mech;
    const stow = g.player.spec.arm.stowAngle!;
    expect(m.angle).toBeCloseTo(stow, 3); // partida: plegada
    m.lowerForSelection();
    const floor = posAngle(g.player.spec, 0);
    expect(m.angle).toBeCloseTo(floor, 6);
    expect(m.height).toBeCloseTo(armTip(g.player.spec.arm, floor).y, 6);
    expect(m.stowed).toBe(false);
  });

  it('se queda en el piso mientras pasa el tiempo de selección', () => {
    const g = new GameSession({ player: 0, preload: true, specs: [robotSpec('cad:axiom')] });
    const m = g.player.mech;
    m.lowerForSelection();
    const floor = m.angle;
    for (let i = 0; i < 120 * 2; i++) g.step();
    expect(m.angle).toBeCloseTo(floor, 4);
  });

  it('una partida nueva empieza con la garra plegada', () => {
    const g = new GameSession({ player: 0, preload: true, specs: [robotSpec('cad:axiom')] });
    expect(g.player.mech.stowed).toBe(true);
  });
});
