/**
 * Garra-caja con rodillos (Psycho): los rodillos jalan la Muestra por fricción en cuanto toca la boca,
 * la centran y la enderezan, y la dan por agarrada cuando llega a la placa del fondo (o a la primera
 * Muestra). La segunda queda en fila detrás de la primera. Números de rodillos: SUPUESTOS (`ROLLERS`).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { SAMPLE_SIZE } from '../src/config/field';
import { clawOf, posAngle, posTip, seatX } from '../src/config/robot';
import { robotSpec } from '../src/config/robotIds';
import { GameSession } from '../src/game/GameSession';
import { emptyInput } from '../src/input/InputManager';
import type { Piece } from '../src/physics/Pieces';
import { initRapier } from '../src/physics/PhysicsWorld';

beforeAll(async () => {
  await initRapier();
});

const PSYCHO = () => robotSpec('cad:psycho');
/** Lugar despejado de la cancha (entre la Plataforma y la Campana roja) con el robot viendo a +x. */
const RX = 2.6;
const RZ = -1.2;

function setup(): { g: GameSession; free: Piece[] } {
  const g = new GameSession({ player: 0, preload: false, specs: [PSYCHO()] });
  for (const p of g.pieces.list) if (p.state.at === 'field' && p.kind === 'sample') g.pieces.stash(p, { at: 'hp', alliance: 'red' });
  g.player.phys.teleport(RX, RZ, 0);
  return { g, free: g.pieces.list.filter((p) => p.kind === 'sample') };
}

/** Pone una Muestra detrás del robot: `back` m del centro, `side` m de lado (z local), girada `yawDeg`. */
function behind(g: GameSession, p: Piece, back: number, side = 0, yawDeg = 0): void {
  g.pieces.place(p, RX - back, SAMPLE_SIZE / 2 + 0.001, RZ + side, (yawDeg * Math.PI) / 180);
}

/** Corre `s` segundos con la garra presionada y avanzando hacia la garra (`forward`, −1…1). */
function run(g: GameSession, s: number, forward: number, intake = true, until?: () => boolean): number {
  for (let i = 0; i < s * 120; i++) {
    g.setInput({ ...emptyInput(), forward, intake });
    g.step();
    if (until?.()) return i / 120;
  }
  return Infinity;
}

describe('garra con rodillos (Psycho)', () => {
  it('la caja mide 25.5 cm de fondo: la segunda Muestra queda en fila y sobresale 4.5 cm de la boca', () => {
    const s = PSYCHO();
    expect(s.intake?.rollers).toBe(true);
    const tip = posTip(s, 0).x;
    const dir = -1; // recoge atrás
    const mouth = tip + dir * (clawOf(s).fingerLength / 2);
    const s0 = seatX(s, tip, dir, 0);
    const s1 = seatX(s, tip, dir, 1);
    expect(Math.abs(s1 - s0)).toBeCloseTo(SAMPLE_SIZE, 6);
    // La primera recargada en la placa del fondo; la segunda asoma por la boca
    expect((mouth - s0) * dir).toBeCloseTo(clawOf(s).fingerLength - SAMPLE_SIZE / 2, 6);
    expect((s1 - mouth) * dir + SAMPLE_SIZE / 2).toBeCloseTo(2 * SAMPLE_SIZE - clawOf(s).fingerLength, 6);
  });

  it('con el robot quieto, los rodillos meten solos una Muestra que apenas toca la boca', () => {
    const { g, free } = setup();
    const s = PSYCHO();
    const mouth = posTip(s, 0).x - clawOf(s).fingerLength / 2;
    // Su cara a 1 cm de la boca: las ruedas de enfrente (asoman ~1.6 cm) la alcanzan
    behind(g, free[0], -mouth + SAMPLE_SIZE / 2 + 0.01);
    const t = run(g, 2, 0, true, () => g.player.mech.stored.length > 0);
    expect(t).toBeLessThan(1);
    expect(g.player.mech.inClaw).toBe(true);
  });

  it('sin la garra presionada no la jala (se queda afuera aunque la toque)', () => {
    const { g, free } = setup();
    const s = PSYCHO();
    const mouth = posTip(s, 0).x - clawOf(s).fingerLength / 2;
    behind(g, free[0], -mouth + SAMPLE_SIZE / 2 + 0.01);
    run(g, 1, 0, false);
    expect(g.player.mech.stored).toHaveLength(0);
    expect(free[0].state.at).toBe('field');
  });

  it('agarra entrando de reversa, centrada, de lado (hasta 20 cm) y chueca (hasta 45°)', () => {
    const cases: Array<[number, number, number]> = [];
    for (const side of [-0.2, -0.12, -0.05, 0, 0.05, 0.12, 0.2]) for (const yaw of [0, 20, 45]) for (const v of [0.15, 0.5]) cases.push([side, yaw, v]);
    const misses: string[] = [];
    for (const [side, yaw, v] of cases) {
      const { g, free } = setup();
      behind(g, free[0], 0.9, side, yaw);
      const t = run(g, 3, v, true, () => g.player.mech.stored.length > 0);
      if (!Number.isFinite(t)) misses.push(`lado ${side} giro ${yaw}° v ${v}`);
    }
    expect(misses).toEqual([]);
    // 42 simulaciones: 2 s aquí, pero más de 5 s en el CI con las demás pruebas corriendo a la vez
  }, 60_000);

  it('la jala hasta el fondo: la agarra cuando llega a la placa, no antes', () => {
    const { g, free } = setup();
    const p = g.player.phys;
    const s = PSYCHO();
    const seat0 = seatX(s, posTip(s, 0).x, -1, 0);
    behind(g, free[0], 0.9, 0.06, 15);
    let last = 0;
    run(g, 3, 0.3, true, () => {
      if (free[0].state.at === 'field') {
        const t = free[0].body.translation();
        last = p.worldToLocalFlat(t.x, t.z).lx;
      }
      return g.player.mech.stored.length > 0;
    });
    expect(g.player.mech.stored).toHaveLength(1);
    // Su último lugar en la cancha: a menos de 4 cm de su lugar en la placa
    expect(Math.abs(last - seat0)).toBeLessThan(0.04);
  });

  it('agarra dos, una tras otra, y quedan en fila con hitbox (la segunda detrás de la primera)', () => {
    const { g, free } = setup();
    behind(g, free[0], 0.8, 0.03);
    behind(g, free[1], 1.4, -0.08, 30);
    const t = run(g, 4, 0.3, true, () => g.player.mech.stored.length >= 2);
    expect(t).toBeLessThan(4);
    const m = g.player.mech;
    expect(m.inClawCount).toBe(2);
    const { sample, sample2 } = g.player.phys.armColliders;
    expect(sample.isEnabled()).toBe(true);
    expect(sample2.isEnabled()).toBe(true);
    const ph = g.player.phys;
    const a = ph.worldToLocalFlat(sample.translation().x, sample.translation().z);
    const b = ph.worldToLocalFlat(sample2.translation().x, sample2.translation().z);
    // En fila sobre el eje de la boca (atrás del robot): la segunda 15 cm más afuera, a la misma altura
    expect(a.lx - b.lx).toBeCloseTo(SAMPLE_SIZE, 2);
    expect(Math.abs(a.lz - b.lz)).toBeLessThan(1e-3);
    expect(sample.translation().y).toBeCloseTo(sample2.translation().y, 3);
    // Ya no cabe una tercera: los rodillos no la tocan
    behind(g, free[2], 0.75);
    run(g, 1.5, 0.3);
    expect(m.stored).toHaveLength(2);
    expect(free[2].state.at).toBe('field');
  });

  it('suelta de una en una: primero la de afuera, desde su lugar en la fila, hacia afuera de la boca', () => {
    const { g, free } = setup();
    const m = g.player.mech;
    const ph = g.player.phys;
    const s = PSYCHO();
    behind(g, free[0], 0.8);
    behind(g, free[1], 1.3);
    run(g, 4, 0.3, true, () => m.stored.length >= 2);
    expect(m.stored).toHaveLength(2);
    run(g, 0.5, 0, false);
    const tip = posTip(s, 0).x;
    const outer = m.stored[1];
    g.setInput({ ...emptyInput(), releaseSample: true });
    g.step();
    expect(m.stored).toHaveLength(1);
    expect(outer.state.at).toBe('field');
    const t = outer.body.translation();
    expect(ph.worldToLocalFlat(t.x, t.z).lx).toBeCloseTo(seatX(s, tip, -1, 1), 1);
    // Sale empujada por los rodillos, hacia atrás del robot (por la boca)
    const v = outer.body.linvel();
    expect(v.x).toBeLessThan(-0.3);
    run(g, 0.6, 0, false);
    g.setInput({ ...emptyInput(), releaseSample: true });
    g.step();
    expect(m.stored).toHaveLength(0);
    expect(m.inClaw).toBe(false);
    expect(g.player.phys.armColliders.sample.isEnabled()).toBe(false);
    run(g, 1, 0, false);
    // Las dos quedan en el piso, fuera de la caja
    for (const p of [free[0], free[1]]) {
      expect(p.state.at).toBe('field');
      expect(ph.worldToLocalFlat(p.body.translation().x, p.body.translation().z).lx).toBeLessThan(-0.3);
    }
  });
  it('la escupe despacio: sale derecha, sin brincar, y queda junto a la boca', () => {
    const { g, free } = setup();
    const m = g.player.mech;
    const ph = g.player.phys;
    behind(g, free[0], 0.8);
    run(g, 4, 0.3, true, () => m.stored.length >= 1);
    expect(m.stored).toHaveLength(1);
    run(g, 0.5, 0, false);
    g.setInput({ ...emptyInput(), releaseSample: true });
    g.step();
    let vMax = 0;
    let yMax = 0;
    for (let i = 0; i < 240; i++) {
      g.setInput(emptyInput());
      g.step();
      const v = free[0].body.linvel();
      vMax = Math.max(vMax, Math.hypot(v.x, v.z));
      yMax = Math.max(yMax, free[0].body.translation().y);
    }
    // Escupida, no disparo: lenta, pegada al piso y a menos de 35 cm detrás de la boca
    expect(vMax).toBeLessThan(0.7);
    expect(yMax).toBeLessThan(SAMPLE_SIZE / 2 + 0.03);
    const t = free[0].body.translation();
    const lx = ph.worldToLocalFlat(t.x, t.z).lx;
    const mouth = posTip(PSYCHO(), 0).x - clawOf(PSYCHO()).fingerLength / 2;
    expect(lx).toBeLessThan(mouth - SAMPLE_SIZE / 2);
    expect(lx).toBeGreaterThan(mouth - 0.35);
    expect(Math.abs(free[0].body.linvel().x)).toBeLessThan(0.05);
  });
  it('suelta desde donde está la garra y con la velocidad del brazo si se está moviendo', () => {
    const { g, free } = setup();
    const m = g.player.mech;
    const ph = g.player.phys;
    behind(g, free[0], 0.8);
    run(g, 4, 0.3, true, () => m.stored.length >= 1);
    run(g, 0.4, 0, false);
    // El brazo sube a N3 y a la mitad del camino se suelta
    for (let i = 0; i < 120 * 0.45; i++) {
      g.setInput({ ...emptyInput(), elevator: 3 });
      g.step();
    }
    expect(m.angle).toBeLessThan(posAngle(PSYCHO(), 0) - 0.3);
    expect(Math.abs(m.armW)).toBeGreaterThan(1);
    const slotLocal = { x: m.tipX(), y: m.height + SAMPLE_SIZE / 2 };
    g.setInput({ ...emptyInput(), elevator: 3, releaseSample: true });
    g.step();
    // Salió de donde está la garra ahora (no de un punto fijo)...
    const t = free[0].body.translation();
    const want = ph.localToWorld(slotLocal.x, slotLocal.y, 0);
    expect(Math.hypot(t.x - want.x, t.z - want.z, t.y - want.y)).toBeLessThan(0.08);
    // ...y lleva la velocidad de la garra: el brazo gira, así que no sale quieta
    const v = free[0].body.linvel();
    expect(Math.hypot(v.x, v.y, v.z)).toBeGreaterThan(0.5);
  });
});
