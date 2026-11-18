import { beforeAll, describe, expect, it } from 'vitest';
import * as F from '../src/config/field';
import { buildFieldColliders } from '../src/physics/FieldColliders';
import { CriticalShelf } from '../src/game/CriticalShelf';
import { Pieces, SAMPLE_POOL } from '../src/physics/Pieces';
import { initRapier, PhysicsWorld } from '../src/physics/PhysicsWorld';

beforeAll(async () => {
  await initRapier();
});

function world(): { pw: PhysicsWorld; pieces: Pieces } {
  const pw = new PhysicsWorld(120);
  buildFieldColliders(pw);
  new CriticalShelf('red', pw);
  new CriticalShelf('blue', pw);
  const pieces = new Pieces(pw);
  pieces.reset();
  return { pw, pieces };
}
const run = (pw: PhysicsWorld, s: number) => {
  for (let i = 0; i < s * 120; i++) pw.step();
};

describe('física de cancha y piezas', () => {
  it('pool: 16 + 2×10 (HP) + 4 precargas Muestras y 2 Muestras Críticas (§4.1, §4.1.1)', () => {
    const { pieces } = world();
    expect(SAMPLE_POOL).toBe(40);
    expect(pieces.list.filter((p) => p.kind === 'critical')).toHaveLength(2);
    expect(pieces.list.filter((p) => p.state.at === 'field' && p.kind === 'sample')).toHaveLength(16);
  });

  it('las Muestras del Laboratorio quedan quietas en sus marcas', () => {
    const { pw, pieces } = world();
    run(pw, 1);
    for (const p of pieces.list.filter((q) => q.state.at === 'field' && q.kind === 'sample')) {
      expect(p.body.translation().y).toBeCloseTo(F.SAMPLE_SIZE / 2, 2);
    }
  });

  it('la Muestra Crítica se queda en la rendija de su Campana', () => {
    const { pw, pieces } = world();
    run(pw, 2);
    const t = pieces.critical('red').body.translation();
    expect(t.y).toBeGreaterThan(F.CAMPANA_HEIGHT);
    expect(t.x).toBeCloseTo(F.CRITICAL_HOLDER_RED.x, 1);
  });

  it('la repisa de la Crítica mide poco más que la pieza y la lleva al deslizarse', () => {
    expect(F.CRITICAL_SHELF_LENGTH).toBeGreaterThan(F.CRITICAL_SIZE);
    expect(F.CRITICAL_SHELF_LENGTH).toBeLessThan(F.CRITICAL_SIZE + 0.1);
    expect(F.CRITICAL_SHELF_LENGTH).toBeLessThan(F.CAMPANA_LENGTH / 4);
    const pw = new PhysicsWorld(120);
    buildFieldColliders(pw);
    const shelf = new CriticalShelf('red', pw);
    const pieces = new Pieces(pw);
    pieces.reset();
    const target = F.CRITICAL_SHELF_X_RANGE[0] + 0.1;
    for (let i = 0; i < 6 * 120; i++) {
      shelf.step(1 / 120, target);
      pw.step();
    }
    expect(shelf.x).toBeCloseTo(target, 2);
    const t = pieces.critical('red').body.translation();
    expect(t.y).toBeGreaterThan(F.CAMPANA_HEIGHT);
    expect(t.x).toBeCloseTo(target, 1);
  });

  it('una Muestra soltada sobre el Nivel 3 cae dentro del pozo, abajo de la apertura', () => {
    const { pw, pieces } = world();
    const w = F.camaraWells()[3];
    const p = pieces.hpStock('red')[0];
    pieces.place(p, (w.x0 + w.x1) / 2, w.rim + 0.15, (w.z0 + w.z1) / 2);
    run(pw, 2);
    const t = p.body.translation();
    expect(t.y).toBeLessThan(w.rim);
    expect(F.inRect(w, t.x, t.z)).toBe(true);
  });

  it('una Muestra no atraviesa la Plataforma ni la barra de la Campana', () => {
    const { pw, pieces } = world();
    const p = pieces.hpStock('red')[0];
    pieces.place(p, 0.6, 1.0, 0);
    run(pw, 2);
    expect(p.body.translation().y).toBeCloseTo(F.PLATFORM_HEIGHT + F.SAMPLE_SIZE / 2, 2);
  });
});
