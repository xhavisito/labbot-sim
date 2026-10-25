import { beforeAll, describe, expect, it } from 'vitest';
import { initRapier } from '../src/physics/PhysicsWorld';
import { ALLIANCE_PLANS, runMatch } from '../src/sim/batch';

beforeAll(async () => {
  await initRapier();
});

const plan = (id: string) => ALLIANCE_PLANS.find((p) => p.id === id)!;

describe('simulación por lotes (estrategias de la IA)', () => {
  it('la torre con Crítica la deja en la Repisa (15 + 1 RP) y ambas suben a la Plataforma (§4.4)', () => {
    const r = runMatch(plan('torrecrit+torre'), plan('n3+n3'), 1);
    expect(r.red.critical).toBe(15);
    expect(r.red.rpCritical).toBe(true);
    expect(r.red.platform).toBe(20);
    // Junta también las Muestras del Human Player (más de las 8 de su mitad del Laboratorio y las precargas)
    expect(r.red.samples).toBeGreaterThan(10);
    expect(r.red.fouls.CRITICAL_EARLY ?? 0).toBe(0);
    expect(r.red.fouls.PLATFORM_EARLY ?? 0).toBe(0);
  }, 60_000);

  it('el bloqueo frente a la Cámara rival se cobra como Tech Foul (§4.6, D17)', () => {
    const r = runMatch(plan('torre+bloqueo'), plan('n3+n3'), 1);
    expect(r.red.fouls.OBSTRUCT).toBeGreaterThan(5);
    expect(r.blue.penaltiesIn).toBeGreaterThan(40);
  }, 60_000);
});
