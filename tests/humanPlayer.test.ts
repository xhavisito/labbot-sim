import { beforeAll, describe, expect, it } from 'vitest';
import { GameSession } from '../src/game/GameSession';
import { initRapier } from '../src/physics/PhysicsWorld';
import { runMatch, AI_ALLIANCE_PLANS } from '../src/sim/batch';

beforeAll(async () => {
  await initRapier();
});

/** Sesión con los 4 robots lejos de la Campana roja; `put` acomoda alguno junto a la ranura. */
function setup(smart: boolean) {
  const g = new GameSession({ player: -1, preload: false, hp: { enabled: true, interval: 3, smart } });
  const hp = g.hps.red;
  const far = [
    [0, 0],
    [0.5, 2],
    [-1, 2],
    [-1, -2],
  ];
  g.robots.forEach((r, i) => r.phys.teleport(far[i][0], far[i][1], 0));
  /** Corre el HP `s` segundos (sin física: solo decide) y cuenta las que mete. */
  const run = (s: number) => {
    let n = 0;
    for (let t = 0; t < s; t += 1 / 120) if (hp.step(1 / 120)) n++;
    return n;
  };
  const nearSlot = (i: number) => {
    const s = hp.slot();
    g.robots[i].phys.teleport(s.x, s.z + s.dz * 0.9, 0);
  };
  return { g, hp, run, nearSlot };
}

describe('Human Player inteligente (§3.2.4, D26)', () => {
  it('con un robot rival junto a la ranura se guarda las Muestras', () => {
    const { hp, run, nearSlot } = setup(true);
    nearSlot(2); // azul
    expect(run(10)).toBe(0);
    expect(hp.held).toBeGreaterThan(0);
  });

  it('a ritmo fijo (apagado) se las sigue pasando aunque haya un rival', () => {
    const { run, nearSlot } = setup(false);
    nearSlot(2);
    expect(run(3.5)).toBe(1);
  });

  it('con su robot enfrente mete rápido aunque haya un rival cerca', () => {
    const { g, hp, run, nearSlot } = setup(true);
    nearSlot(0); // rojo
    const s = hp.slot();
    g.robots[2].phys.teleport(s.x + 1.2, s.z + s.dz * 1.2, 0);
    expect(run(1.3)).toBe(1);
  });

  it('si nadie viene por ella no amontona Muestras junto a la ranura', () => {
    const { run } = setup(true);
    // Sin física las Muestras se quedan donde salen: la primera bloquea las demás
    expect(run(12)).toBe(1);
  });
});

describe('IA Experto', () => {
  it('juega un match completo sin faltas de cancha', () => {
    const plan = (id: string) => AI_ALLIANCE_PLANS.find((p) => p.id === id)!;
    const r = runMatch(plan('expert:pivot+pivot180'), plan('hard:pivot+pivot180'), 3);
    for (const a of [r.red, r.blue]) {
      expect(a.fouls.OUT_OF_BOUNDS ?? 0).toBe(0);
      expect(a.fouls.AUTO_CENTER ?? 0).toBe(0);
      expect(a.samples).toBeGreaterThan(8);
    }
  }, 60_000);
});
