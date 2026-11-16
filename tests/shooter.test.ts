/** Lanzador de Phoenix: tira la Muestra por arriba de la pared de la Cámara y cae en el pozo del nivel pedido. */
import { beforeAll, describe, expect, it } from 'vitest';
import * as F from '../src/config/field';
import { robotSpec } from '../src/config/robotIds';
import { GameSession } from '../src/game/GameSession';
import { maxSpeedFor, solveSpeed } from '../src/game/shooter';
import { canHoldCritical, canPassCritical, shooterCapacity } from '../src/config/robot';
import { emptyInput } from '../src/input/InputManager';
import type { Level } from '../src/core/types';
import { initRapier } from '../src/physics/PhysicsWorld';

beforeAll(async () => {
  await initRapier();
});

const SEEDS = 12;

/** Un tiro desde `range` m del centro del pozo, con `dx` m de lado y `dyawDeg` grados de error de rumbo; devuelve si cayó en el nivel. */
function shoot(level: Level, range: number, seed: number, dx = 0, dyawDeg = 0): { level: Level | null; y: number; x: number; z: number } {
  const g = new GameSession({ player: 0, preload: false, specs: [robotSpec('cad:phoenix')], seed });
  for (const p of g.pieces.list) if (p.state.at === 'field' && p.kind === 'sample') g.pieces.stash(p, { at: 'hp', alliance: 'red' });
  const a = g.player.alliance;
  const w = F.camaraWells()[level];
  const c = F.forCamara(a, { x: (w.x0 + w.x1) / 2 + dx, z: (w.z0 + w.z1) / 2 - range });
  g.player.phys.teleport(c.x, c.z, F.camaraHeading(a) + (dyawDeg * Math.PI) / 180);
  const piece = g.pieces.list.find((p) => p.kind === 'sample')!;
  g.player.mech.load(piece);
  for (let i = 0; i < 120 * 3; i++) {
    g.setInput({ ...emptyInput(), elevator: level });
    g.step();
  }
  g.setInput({ ...emptyInput(), elevator: level, releaseSample: true });
  g.step();
  for (let i = 0; i < 120 * 3; i++) {
    g.setInput({ ...emptyInput(), elevator: level });
    g.step();
  }
  const t = piece.body.translation();
  return { level: g.sensors.scored.get(piece.index)?.level ?? null, y: t.y, x: t.x, z: t.z };
}

describe('lanzador de Phoenix', () => {
  it('solveSpeed pasa por el punto pedido', () => {
    const th = 1.159;
    const v = solveSpeed(1.5, -0.2, th)!;
    const t = 1.5 / (v * Math.cos(th));
    expect(0.0 + v * Math.sin(th) * t - 4.905 * t * t).toBeCloseTo(-0.2, 3);
    expect(solveSpeed(1, 10, th)).toBeNull();
  });

  for (const level of [1, 2, 3] as Level[]) {
    it(`N${level}: anota casi siempre a 1.5 m, centrado`, () => {
      let ok = 0;
      const miss: string[] = [];
      for (let s = 1; s <= SEEDS; s++) {
        const r = shoot(level, 1.5, s);
        if (r.level === level) ok++;
        else miss.push(`seed ${s}: ${r.level} y=${r.y.toFixed(2)}`);
      }
      console.log(`N${level} 1.5 m: ${ok}/${SEEDS}`, miss.join(' | '));
      expect(ok).toBeGreaterThanOrEqual(SEEDS - 1);
    }, 60000);
  }
});

describe('lanzador de Phoenix: ventana de tiro', () => {
  it('anota de 1 a 1.5 m del pozo y con hasta 8° de error de rumbo, y no con 18° (hay que apuntar)', () => {
    for (const level of [1, 2, 3] as Level[]) {
      for (const range of [1.0, 1.5]) for (let s = 1; s <= 4; s++) expect(shoot(level, range, s).level, `N${level} a ${range} m`).toBe(level);
      for (let s = 1; s <= 4; s++) expect(shoot(level, 1.5, s, 0, 8).level, `N${level} 8°`).toBe(level);
      for (let s = 1; s <= 4; s++) expect(shoot(level, 1.5, s, 0, 18).level, `N${level} 18°`).not.toBe(level);
    }
  }, 120000);

  it('cada tiro varía un poco: la Muestra no cae siempre en el mismo lugar', () => {
    const spots = new Set<string>();
    for (let s = 1; s <= 4; s++) {
      const r = shoot(3, 1.5, s);
      spots.add(`${r.x.toFixed(2)},${r.z.toFixed(2)}`);
    }
    expect(spots.size).toBeGreaterThan(1);
  });
});

describe('IA con Phoenix', () => {
  it('un match de solo IA con 4 Phoenix: anotan lanzando y no se quedan trabados', () => {
    const P = robotSpec('cad:phoenix');
    const g = new GameSession({ player: 0, preload: true, ai: true, specs: [P, P, P, P] });
    g.startMatch();
    for (let i = 0; i < 151 * 120 && !g.match!.finished; i++) {
      g.setInput(emptyInput());
      g.step();
    }
    const m = g.match!;
    const red = m.breakdown('red');
    const blue = m.breakdown('blue');
    console.log('AI-PHOENIX', JSON.stringify({ red, blue }));
    expect(red.samplesTeleop + blue.samplesTeleop).toBeGreaterThan(0);
  }, 240000);
});

describe('Phoenix tal cual el CAD', () => {
  const P = () => robotSpec('cad:phoenix');
  it('lleva las medidas, las 6 llantas y la rampa del CAD (no las del preset)', () => {
    const s = P();
    expect(s.length).toBeCloseTo(0.6684, 3);
    expect(s.width).toBeCloseTo(0.64, 3);
    expect(s.baseHeight).toBeCloseTo(0.7295, 3);
    expect(s.wheel!.r).toBeCloseTo(0.0762, 4); // llanta de 6 in
    expect(s.wheel!.xs).toHaveLength(3); // 3 por lado
    expect((s.intake!.shooter!.pitch * 180) / Math.PI).toBeCloseTo(66.4, 1); // rampa de rodillos a 66.4°
    expect(s.model?.url).toBe('robots/phoenix.glb');
  });

  it('recoge de reversa por el canal trasero', () => {
    const g = new GameSession({ player: 0, preload: false, specs: [P()] });
    for (const p of g.pieces.list) if (p.state.at === 'field' && p.kind === 'sample') g.pieces.stash(p, { at: 'hp', alliance: 'red' });
    g.player.phys.teleport(2.6, -1.2, 0);
    const piece = g.pieces.list.find((p) => p.kind === 'sample')!;
    g.pieces.place(piece, 2.6 - 0.9, 0.076, -1.2);
    for (let i = 0; i < 120 * 5 && g.player.mech.stored.length < 1; i++) {
      g.setInput({ ...emptyInput(), forward: -0.3, intake: true });
      g.step();
    }
    expect(g.player.mech.stored.length).toBe(1);
  });
});

describe('Phoenix con varias Muestras', () => {
  const P = () => robotSpec('cad:phoenix');

  it('la capacidad sale del espacio de la rampa (4) y no de un número fijo', () => {
    const s = P();
    expect(shooterCapacity(s)).toBe(4);
    expect(s.capacity).toBe(4);
    expect(s.arm.holdsTwo).toBe(true);
  });

  it('la potencia baja 10 % por Muestra de más', () => {
    const sh = P().intake!.shooter!;
    expect(maxSpeedFor(sh, 1)).toBeCloseTo(5, 6);
    expect(maxSpeedFor(sh, 2)).toBeCloseTo(4.5, 6);
    expect(maxSpeedFor(sh, 4)).toBeCloseTo(3.5, 6);
    // Con más de las que caben nunca baja del 20 %
    expect(maxSpeedFor(sh, 50)).toBeCloseTo(1, 6);
  });

  it('recoge hasta llenar la rampa y no más', () => {
    const g = new GameSession({ player: 0, preload: false, specs: [P()] });
    const m = g.player.mech;
    const pieces = g.pieces.list.filter((p) => p.kind === 'sample').slice(0, 6);
    for (const p of g.pieces.list) if (p.state.at === 'field' && p.kind === 'sample') g.pieces.stash(p, { at: 'hp', alliance: 'red' });
    for (const p of pieces.slice(0, 5)) m.load(p);
    expect(m.stored.length).toBe(5); // `load` no limita (precarga); el intake sí:
    m.stored.length = 0;
    g.player.phys.teleport(2.6, -1.2, 0);
    for (let k = 0; k < 6; k++) g.pieces.place(pieces[k], 2.6 - 0.9, 0.076, -1.2 + k * 0.3);
    // Las trae una por una al canal trasero
    for (let k = 0; k < 6; k++) {
      g.player.phys.teleport(2.6, -1.2 + k * 0.3, 0);
      for (let i = 0; i < 120 * 3 && m.stored.length < Math.min(k + 1, 4); i++) {
        g.setInput({ ...emptyInput(), forward: -0.3, intake: true });
        g.step();
      }
    }
    expect(m.stored.length).toBe(4);
  });

  /** Un tiro a `range` m con `n` Muestras cargadas; devuelve si cayó en el nivel y la velocidad de salida. */
  function shootLoaded(level: Level, range: number, n: number, seed: number): { ok: boolean; speed: number } {
    const g = new GameSession({ player: 0, preload: false, specs: [P()], seed });
    for (const p of g.pieces.list) if (p.state.at === 'field' && p.kind === 'sample') g.pieces.stash(p, { at: 'hp', alliance: 'red' });
    const a = g.player.alliance;
    const w = F.camaraWells()[level];
    const c = F.forCamara(a, { x: (w.x0 + w.x1) / 2, z: (w.z0 + w.z1) / 2 - range });
    g.player.phys.teleport(c.x, c.z, F.camaraHeading(a));
    const ps = g.pieces.list.filter((p) => p.kind === 'sample').slice(0, n);
    for (const p of ps) g.player.mech.load(p);
    for (let i = 0; i < 120 * 3; i++) {
      g.setInput({ ...emptyInput(), elevator: level });
      g.step();
    }
    const shot = g.player.mech.stored[g.player.mech.stored.length - 1];
    g.setInput({ ...emptyInput(), elevator: level, releaseSample: true });
    g.step();
    const v = shot.body.linvel();
    const speed = Math.hypot(v.x, v.y, v.z);
    for (let i = 0; i < 120 * 3; i++) {
      g.setInput({ ...emptyInput(), elevator: level });
      g.step();
    }
    return { ok: g.sensors.scored.get(shot.index)?.level === level, speed };
  }

  it('lleno tira más flojo y a 1.5 m ya no llega', () => {
    const one = shootLoaded(3, 1.5, 1, 3);
    const four = shootLoaded(3, 1.5, 4, 3);
    console.log('PHOENIX-CARGA', JSON.stringify({ one, four }));
    expect(one.ok).toBe(true);
    expect(four.speed).toBeLessThan(one.speed);
    expect(four.speed).toBeLessThanOrEqual(3.5 * 1.2);
    expect(four.ok).toBe(false);
  });

  it('con dos de cerca todavía anota (la velocidad que pide la distancia alcanza)', () => {
    // Con 2 (4.5 m/s) alcanza N1–N3 a 1 m (piden 3.5–4 m/s)
    for (const level of [1, 2, 3] as Level[]) expect(shootLoaded(level, 1.0, 2, 5).ok).toBe(true);
  });
});

describe('Phoenix pasa la Muestra Crítica', () => {
  const P = () => robotSpec('cad:phoenix');
  function setup() {
    const g = new GameSession({ player: 0, preload: false, specs: [P()] });
    for (const p of g.pieces.list) if (p.state.at === 'field' && p.kind === 'sample') g.pieces.stash(p, { at: 'hp', alliance: 'red' });
    return g;
  }

  it('la toma del piso (de reversa) pero no cuenta como robot que anota Críticas', () => {
    const s = P();
    expect(canHoldCritical(s)).toBe(false);
    expect(canPassCritical(s)).toBe(true);
    const g = setup();
    g.player.phys.teleport(1.2, 1.0, 0);
    const c = g.pieces.critical(g.player.alliance);
    g.pieces.place(c, 1.2 - 0.85, 0.1, 1.0);
    for (let i = 0; i < 120 * 3 && !g.player.mech.critical; i++) {
      g.setInput({ ...emptyInput(), forward: -0.3, intake: true });
      g.step();
    }
    expect(g.player.mech.critical).toBe(c);
  });

  it('al soltar la lanza hacia la zona de entrega y no la anota', () => {
    const g = setup();
    const a = g.player.alliance;
    const c = g.pieces.critical(a);
    const side = a === 'red' ? 1 : -1;
    // Parado a 1.5 m de la zona de entrega, apuntando a ella
    g.player.phys.teleport(side * 2.2, 0, a === 'red' ? Math.PI : 0);
    g.player.mech.critical = c;
    g.pieces.stash(c, { at: 'robot', robot: g.player.index });
    for (let i = 0; i < 60; i++) {
      g.setInput({ ...emptyInput() });
      g.step();
    }
    g.setInput({ ...emptyInput(), releaseSample: true });
    g.step();
    for (let i = 0; i < 120 * 4; i++) {
      g.setInput({ ...emptyInput() });
      g.step();
    }
    const t = c.body.translation();
    console.log('PASE', JSON.stringify(t));
    expect(c.state.at).toBe('field');
    // Cayó cerca de la zona de entrega (a ≤ 0.7 m), a ras de plataforma o piso, no en la Repisa
    expect(Math.hypot(t.x - side * 0.7, t.z)).toBeLessThan(0.9);
    expect(g.sensors.criticalOnRepisa(a)).toBe(false);
  });
});

describe('Phoenix: tiro flojo', () => {
  it('solo anota de cerca: a 2.5 m ni un tiro solo llega a N3, a 1 m sí', () => {
    expect(shootLoaded3(2.5)).toBe(false);
    expect(shootLoaded3(1.0)).toBe(true);
  });
  function shootLoaded3(range: number): boolean {
    return shoot(3, range, 4).level === 3;
  }
});
