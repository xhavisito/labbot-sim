import { beforeAll, describe, expect, it } from 'vitest';
import * as F from '../src/config/field';
import { GAME } from '../src/config/game';
import { DEFAULT_ROBOT, ROBOT_PRESETS } from '../src/config/robot';
import {
  bestOf,
  drillById,
  DRILLS,
  drillTargets,
  emptyProgress,
  medalCount,
  medalFor,
  parseProgress,
  recordRun,
  teleopPoints,
  type Drill,
} from '../src/core/training';
import { camaraStart, DrillTracker, drillSessionOptions, setupDrill } from '../src/game/drills';
import { GameSession } from '../src/game/GameSession';
import { emptyInput, type PlayerInput } from '../src/input/InputManager';
import { initRapier } from '../src/physics/PhysicsWorld';

const D = (id: string): Drill => drillById(id)!;

describe('retos (lógica pura)', () => {
  it('cada reto tiene cortes en orden y dentro del límite', () => {
    for (const d of DRILLS) {
      const [b, s, g] = d.medals;
      if (d.kind === 'time') {
        expect(b).toBeGreaterThanOrEqual(s);
        expect(s).toBeGreaterThan(g);
        expect(b).toBeLessThanOrEqual(d.limit);
      } else {
        expect(b).toBeLessThan(s);
        expect(s).toBeLessThan(g);
      }
    }
  });

  it('medallas de tiempo: menos es mejor; sin cumplir la meta no hay medalla', () => {
    const d = D('level3');
    // Al ritmo del pivote (×1.5): oro ≤ 52.5 s, plata ≤ 82.5 s, bronce ≤ 180 s
    expect(medalFor(d, 'pivot', 30)).toBe('gold');
    expect(medalFor(d, 'pivot', 52.5)).toBe('gold');
    expect(medalFor(d, 'pivot', 70)).toBe('silver');
    expect(medalFor(d, 'pivot', 150)).toBe('bronze');
    expect(medalFor(d, 'pivot', null)).toBeNull();
  });

  it('medallas de puntos: más es mejor', () => {
    const d = D('endgame');
    expect(medalFor(d, 'pivot', 5)).toBeNull();
    expect(medalFor(d, 'pivot', 10)).toBe('bronze');
    expect(medalFor(d, 'pivot', 25)).toBe('silver');
    expect(medalFor(d, 'pivot', 40)).toBe('gold');
  });

  it('los retos de Muestras se ajustan al ritmo del pivote (los dos tipos); los de manejo no', () => {
    for (const k of ['pivot', 'pivot180'] as const) {
      expect(drillTargets(D('level3'), k).medals[2]).toBeCloseTo(35 * 1.5);
      expect(drillTargets(D('level3'), k).limit).toBeCloseTo(120 * 1.5);
      expect(drillTargets(D('cycles'), k).medals[2]).toBe(70);
      expect(drillTargets(D('platform'), k)).toEqual({ limit: 10, medals: [10, 6, 4.5] });
    }
  });

  it('puntos con los valores de TELEOP del manual (§4.4)', () => {
    expect(teleopPoints(GAME, { 1: 1, 2: 1, 3: 2 }, false, false)).toBe(2 + 6 + 30);
    expect(teleopPoints(GAME, { 1: 0, 2: 0, 3: 1 }, true, true)).toBe(15 + 10 + 15);
  });

  it('récord personal: guarda la mejor marca y cuenta las corridas', () => {
    const p = emptyProgress();
    const d = D('level3');
    const a = recordRun(p, d, 'pivot', 'pivot', { completed: false, time: 120, points: 45 });
    expect(a).toMatchObject({ value: null, medal: null, improved: false, prev: null });
    expect(bestOf(p, 'level3', 'pivot')).toBeNull();
    const b = recordRun(p, d, 'pivot', 'pivot', { completed: true, time: 60.123, points: 75 });
    expect(b).toMatchObject({ value: 60.12, medal: 'silver', improved: true, prev: null });
    const c = recordRun(p, d, 'pivot', 'pivot', { completed: true, time: 70, points: 75 });
    expect(c.improved).toBe(false);
    const e = recordRun(p, d, 'pivot', 'pivot', { completed: true, time: 34, points: 75 });
    expect(e).toMatchObject({ improved: true, medal: 'gold' });
    expect(e.prev?.best).toBe(60.12);
    expect(bestOf(p, 'level3', 'pivot')).toMatchObject({ best: 34, medal: 'gold', runs: 4 });
    // Cada robot lleva su propio récord
    expect(bestOf(p, 'level3', 'pivot180')).toBeNull();
    expect(medalCount(p, 'pivot')).toEqual({ bronze: 0, silver: 0, gold: 1 });
  });

  it('el progreso se guarda y se lee; lo que no tiene forma se descarta', () => {
    const p = emptyProgress();
    recordRun(p, D('cycles'), 'pivot180', 'pivot180', { completed: true, time: 60, points: 45 });
    const back = parseProgress(JSON.stringify(p));
    expect(bestOf(back, 'cycles', 'pivot180')).toMatchObject({ best: 45, medal: 'silver' });
    expect(parseProgress('{malo')).toEqual(emptyProgress());
    expect(parseProgress(JSON.stringify({ v: 1, records: { 'nada:x': { best: 1, runs: 1 }, 'line:g': { best: 'x' } } })).records).toEqual({});
  });
});

// ------------------------------------------------------------------ en la física

beforeAll(async () => {
  await initRapier();
});

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
function drill(id: string, spec = DEFAULT_ROBOT) {
  const d = D(id);
  const g = new GameSession(drillSessionOptions(d, 0, spec, 3));
  setupDrill(g, d);
  const tr = new DrillTracker(d, drillTargets(d, spec.mechanism).limit);
  g.tap = tr;
  return { g, tr };
}
const step = (g: GameSession, inp: Partial<PlayerInput> = {}) => {
  g.setInput({ ...emptyInput(), ...inp });
  g.step();
};
/** Maneja hacia (x, z): gira en su lugar y avanza cuando ya ve al punto (+giro = rumbo crece). */
function goTo(g: GameSession, tr: DrillTracker, x: number, z: number, tol: number): void {
  for (let i = 0; i < 120 * 8 && !tr.ended; i++) {
    const p = g.player.phys.position();
    const dx = x - p.x;
    const dz = z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist < tol) return;
    const e = wrap(Math.atan2(-dz, dx) - g.player.phys.heading());
    step(g, { forward: Math.abs(e) > 0.5 ? 0 : Math.min(1, dist * 1.5), turn: Math.max(-1, Math.min(1, 2.5 * e)) });
  }
}
function face(g: GameSession, h: number): void {
  for (let i = 0; i < 240; i++) {
    const e = wrap(h - g.player.phys.heading());
    if (Math.abs(e) < 0.03) return;
    step(g, { turn: Math.max(-1, Math.min(1, 2.5 * e)) });
  }
}

describe('retos en la física', () => {
  it('línea de autónomo: a todo adelante sale de la Zona de Inicio en menos de 1 s (oro)', () => {
    const { g, tr } = drill('line');
    while (!tr.ended) step(g, { forward: 1 });
    const o = tr.outcome();
    expect(o.completed).toBe(true);
    expect(o.time).toBeLessThan(1);
    expect(o.points).toBe(GAME.points.autoLine);
    expect(medalFor(D('line'), 'pivot', o.time)).toBe('gold');
  });

  it('sin moverse: el reto se acaba al límite y sin medalla', () => {
    const { g, tr } = drill('line');
    while (!tr.ended) step(g);
    expect(tr.time).toBeCloseTo(15, 1);
    expect(tr.outcome().completed).toBe(false);
  });

  it('Plataforma: desde la Cámara sube por la rampa y cuenta al quedarse 1 s (D5)', () => {
    const { g, tr } = drill('platform');
    const s = camaraStart('red', DEFAULT_ROBOT);
    const p = g.player.phys.position();
    expect(p.x).toBeCloseTo(s.x, 2);
    expect(p.z).toBeCloseTo(s.z, 2);
    goTo(g, tr, 2.75, 0, 0.2);
    goTo(g, tr, 1, 0, 0.2);
    while (!tr.ended) step(g);
    const o = tr.outcome();
    expect(o.completed).toBe(true);
    expect(o.time).toBeLessThan(4.5);
    expect(o.points).toBe(GAME.points.platformOne);
  });

  it('Muestra Crítica: de la rendija de la Campana a la Repisa (§3.2.4, §3.2.5)', () => {
    const { g, tr } = drill('critical');
    // Sin precarga: la pinza va vacía
    expect(g.player.mech.stored.length).toBe(0);
    const c = F.CRITICAL_HOLDER_RED;
    step(g, { elevator: 4 });
    goTo(g, tr, c.x, c.z + 0.8, 0.1);
    face(g, Math.PI / 2);
    for (let i = 0; i < 120 && !g.player.mech.critical; i++) step(g, { intake: true, forward: 0.15 });
    expect(g.player.mech.critical).not.toBeNull();
    // Rodea la barra de la Campana y llega por un lado de la Repisa
    goTo(g, tr, 3.2, -1.5, 0.2);
    goTo(g, tr, 0, -1.6, 0.1);
    face(g, -Math.PI / 2);
    // Hasta que la viga del brazo topa con el borde de la Repisa (hitbox literal, D34); la Crítica ya
    // queda encima de ella
    goTo(g, tr, 0, -1.2, 0.05);
    face(g, -Math.PI / 2);
    for (let i = 0; i < 360 && g.player.mech.critical; i++) step(g, { releaseSample: true, forward: 0.1 });
    while (!tr.ended) step(g);
    const o = tr.outcome();
    expect(o.completed).toBe(true);
    expect(o.time).toBeLessThan(11);
    expect(o.points).toBe(GAME.points.critical);
  });

  it('solo cuentan las Muestras que entran a tu Cámara, con el valor de TELEOP', () => {
    const { g, tr } = drill('cycles');
    const drop = (a: 'red' | 'blue', level: 1 | 2 | 3) => {
      const w = F.rectFor(a, F.camaraWells()[level]);
      const p = g.pieces.list.find((x) => x.kind === 'sample' && x.state.at === 'hp')!;
      g.pieces.place(p, (w.x0 + w.x1) / 2, F.camaraWells()[level].rim + 0.2, (w.z0 + w.z1) / 2);
      for (let i = 0; i < 180; i++) step(g);
    };
    drop('red', 3);
    drop('red', 1);
    drop('blue', 3);
    expect(tr.samples).toEqual({ 1: 1, 2: 0, 3: 1 });
    expect(tr.points).toBe(15 + 2);
  });

  it('la variante de 180° empieza su reto de Muestras con la precarga', () => {
    const { g } = drill('level3', ROBOT_PRESETS.pivot180);
    expect(g.player.mech.stored.length).toBe(1);
  });
});
