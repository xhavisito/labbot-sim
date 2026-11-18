/** Axiom (Xhavi, 18-nov): solo toma la Muestra Crítica si está en el piso; no de la rendija de la Campana ni de la Repisa (SUPUESTO, `IntakeSpec.critFloorOnly`). */
import { beforeAll, describe, expect, it } from 'vitest';
import { canHoldCritical, canTakeCriticalFromHolder, intakeOf } from '../src/config/robot';
import { robotSpec } from '../src/config/robotIds';
import { CRITICAL_HOLDER_RED, CRITICAL_SIZE } from '../src/config/field';
import { GameSession } from '../src/game/GameSession';
import { initRapier } from '../src/physics/PhysicsWorld';

beforeAll(async () => {
  await initRapier();
});

/** Axiom con el brazo en el piso y la Crítica de su alianza a `y` (centro), frente a la garra. */
function setup(y: number) {
  const g = new GameSession({ player: 0, preload: false, specs: [robotSpec('cad:axiom')] });
  const r = g.player;
  r.phys.teleport(0, 2.2, 0);
  const m = r.mech;
  m.target = 0;
  m.intakeOn = true;
  for (let i = 0; i < 6 * 120; i++) g.step();
  const c = g.pieces.critical(r.alliance);
  const at = r.phys.localToWorld(m.tipX() + 0.03, 0, 0);
  g.pieces.place(c, at.x, y, at.z, 0);
  return { g, r, m, c };
}

describe('Axiom: la Crítica solo desde el piso', () => {
  it('lo declara su ficha: sigue pudiendo llevarla, pero no la toma de la rendija', () => {
    const s = robotSpec('cad:axiom');
    expect(intakeOf(s).critFloorOnly).toBe(true);
    expect(canHoldCritical(s)).toBe(true);
    expect(canTakeCriticalFromHolder(s)).toBe(false);
    expect(canTakeCriticalFromHolder(robotSpec('cad:psycho'))).toBe(true);
  });

  it('la toma si está en el piso', () => {
    const { m, c } = setup(CRITICAL_SIZE / 2);
    expect(m.grabCritical([])).toBe(true);
    expect(m.critical).toBe(c);
  });

  it('no la toma a la altura de la rendija de la Campana (donde la ponen) aunque tenga la garra a su nivel', () => {
    const { m, r } = setup(CRITICAL_HOLDER_RED.y + CRITICAL_SIZE / 2);
    // La garra a esa altura: antes la tomaba si quedaba entre los dedos
    m.target = 4;
    expect(m.grabCritical([])).toBe(false);
    expect(m.critical).toBeNull();
    expect(r.mech.critical).toBeNull();
  });

  it('no la toma si está elevada unos centímetros (en la Repisa o sobre algo)', () => {
    const { m } = setup(CRITICAL_SIZE / 2 + 0.15);
    expect(m.grabCritical([])).toBe(false);
  });

  it('un robot que la toma de la rendija (Psycho) no cambia', () => {
    expect(intakeOf(robotSpec('cad:psycho')).critFloorOnly).toBeUndefined();
  });
});
