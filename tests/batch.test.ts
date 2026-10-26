import { beforeAll, describe, expect, it } from 'vitest';
import { initRapier } from '../src/physics/PhysicsWorld';
import { ALLIANCE_PLANS, MECH_ALLIANCE_PLANS, runMatch } from '../src/sim/batch';

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

describe('scouting de un match de solo robots con mecanismo', () => {
  it('cada robot trae su parte: Crítica del que la llevó, Plataforma de los que subieron, Muestras soltadas por él', () => {
    const mech = (id: string) => MECH_ALLIANCE_PLANS.find((p) => p.id === id)!;
    const r = runMatch(mech('torren3+pivcrit3'), mech('elevn3+elevn3'), 2);
    const [torre, piv] = r.red.robots;
    expect(piv.plan).toBe('pivcrit3');
    expect(torre.plan).toBe('torren3');
    expect(piv.critical).toBe(r.red.rpCritical);
    expect(torre.critical).toBe(false);
    // Las Muestras atribuidas no pasan de las que contó la Cámara (las empujadas no son de nadie)
    for (const a of [r.red, r.blue]) expect(a.robots[0].samples + a.robots[1].samples).toBeLessThanOrEqual(a.samples);
    expect(torre.samples).toBeGreaterThan(0);
    expect(r.red.robots.filter((x) => x.platform).length * 10).toBe(r.red.platform === 20 ? 20 : r.red.platform);
  }, 60_000);
});
