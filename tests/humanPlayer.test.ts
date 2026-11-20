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

describe('Human Player destraba la ranura (§3.2.4)', () => {
  /** Práctica libre (sin match): su HP corre con la física. Robots lejos de la Campana. */
  function practice() {
    const g = new GameSession({ player: 0, preload: false, solo: true, hp: { enabled: true, interval: 3, smart: true } });
    g.robots.forEach((r, i) => r.phys.teleport(-2 + i * 0.3, 2, 0));
    const hp = g.hps[g.player.alliance];
    const slot = hp.slot();
    // Sin reserva: solo cuenta lo que empuja
    for (const p of g.pieces.hpStock(g.player.alliance)) g.pieces.stash(p, { at: 'robot', robot: 9 });
    return { g, hp, slot };
  }

  it('empuja a la cancha una Muestra atorada sobre la repisa de la ranura', () => {
    const { g, hp, slot } = practice();
    const p = g.pieces.list.find((q) => q.kind === 'sample' && q.state.at === 'field')!;
    // Adentro de la Campana, sobre la repisa interior (a 20 cm de la cara de la pared)
    const S = 0.15;
    g.pieces.place(p, slot.x + 0.4, 0.2 + S / 2 + 0.002, slot.z - slot.dz * (S / 2 + 0.01 + 0.2), 0.3);
    expect(hp.inSlot(p.body.translation().x, p.body.translation().y, p.body.translation().z)).toBe(true);
    for (let i = 0; i < 120 * 3; i++) g.step();
    expect(hp.unstuck).toBeGreaterThan(0);
    const t = p.body.translation();
    expect(hp.inSlot(t.x, t.y, t.z)).toBe(false);
    // Quedó en el piso de la cancha, frente a la ranura
    expect((t.z - (slot.z - slot.dz * (S / 2 + 0.01))) * slot.dz).toBeGreaterThan(0.05);
    expect(t.y).toBeLessThan(S / 2 + 0.02);
  });

  it('no toca las que acaba de meter (van saliendo) ni las del piso', () => {
    const { g, hp, slot } = practice();
    const p = g.pieces.list.find((q) => q.kind === 'sample' && q.state.at === 'field')!;
    g.pieces.place(p, slot.x, 0.075, slot.z + slot.dz * 0.3, 0);
    for (let i = 0; i < 120 * 2; i++) g.step();
    expect(hp.unstuck).toBe(0);
  });
});
