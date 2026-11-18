/** Axiom (Xhavi, 18-nov): toma la Muestra Crítica de la base (la rendija de la Campana, donde la ponen) y del piso. Reemplaza el «solo del piso» anterior (`IntakeSpec.critFloorOnly` ya no se usa en Axiom). */
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

describe('Axiom: la Crítica desde la base y desde el piso', () => {
  it('su ficha ya no limita el agarre al piso', () => {
    const s = robotSpec('cad:axiom');
    expect(intakeOf(s).critFloorOnly).toBeUndefined();
    expect(canHoldCritical(s)).toBe(true);
    expect(canTakeCriticalFromHolder(s)).toBe(true);
  });

  it('la toma si está en el piso', () => {
    const { m, c } = setup(CRITICAL_SIZE / 2);
    expect(m.grabCritical([])).toBe(true);
    expect(m.critical).toBe(c);
  });

  it('la toma de la base (la rendija de la Campana) con la garra a su nivel', () => {
    const { g, r, m, c } = setup(CRITICAL_HOLDER_RED.y + CRITICAL_SIZE / 2);
    m.target = 4;
    for (let i = 0; i < 4 * 120 && !m.atTarget; i++) m.step(1 / 120, []);
    // El brazo se movió: se vuelve a poner el cubo entre los dedos
    const at = r.phys.localToWorld(m.tipX(), 0, 0);
    g.pieces.place(c, at.x, CRITICAL_HOLDER_RED.y + CRITICAL_SIZE / 2, at.z, 0);
    expect(m.grabCritical([])).toBe(true);
    expect(m.critical).toBe(c);
  });

  it('no la toma si el cubo queda lejos de la garra', () => {
    const { g, r, m, c } = setup(CRITICAL_SIZE / 2);
    const at = r.phys.localToWorld(m.tipX() + 1, 0, 0);
    g.pieces.place(c, at.x, CRITICAL_SIZE / 2, at.z, 0);
    expect(m.grabCritical([])).toBe(false);
  });
});
