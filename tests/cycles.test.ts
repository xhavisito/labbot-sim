import { beforeAll, describe, expect, it } from 'vitest';
import * as F from '../src/config/field';
import { GAME } from '../src/config/game';
import { DEFAULT_ROBOT, type RobotSpec } from '../src/config/robot';
import { ATTEMPT_WINDOW, CycleStats, emptyBests, parseBests, updateBests } from '../src/core/cycles';
import { CycleTracker } from '../src/game/cycleTracker';
import { GameSession } from '../src/game/GameSession';
import { emptyInput } from '../src/input/InputManager';
import { initRapier } from '../src/physics/PhysicsWorld';

describe('ciclos y estadísticas por Muestra (lógica pura)', () => {
  it('ciclo = de recoger a anotar, con los puntos de TELEOP del manual (§4.4)', () => {
    const c = new CycleStats(GAME);
    c.pickup(7, 1);
    c.release(7, 'n3', 4);
    c.scored(7, 'n3', 4.5);
    c.pickup(8, 6);
    c.release(8, 'n1', 8);
    c.scored(8, 'n1', 8.2);
    const s = c.summary();
    expect(s.cycles).toBe(2);
    expect(s.byCat.n3).toMatchObject({ attempts: 1, scored: 1, accuracy: 1, best: 3.5, avg: 3.5, points: GAME.points.sampleTeleop[3] });
    expect(s.byCat.n1.best).toBeCloseTo(2.2);
    expect(s.best).toBeCloseTo(2.2);
    expect(s.last).toBeCloseTo(2.2);
    expect(s.avg).toBeCloseTo((3.5 + 2.2) / 2);
    expect(s.points).toBe(15 + 2);
    // 2 Muestras en 8.2 s
    expect(s.perMinute).toBeCloseTo((2 * 60) / 8.2);
  });

  it('un intento que no anota en la ventana falla, en el nivel al que apuntaba', () => {
    const c = new CycleStats(GAME);
    c.pickup(1, 0);
    c.release(1, 'n3', 2);
    c.advance(2 + ATTEMPT_WINDOW - 0.01);
    expect(c.summary().byCat.n3.attempts).toBe(0);
    c.advance(2 + ATTEMPT_WINDOW + 0.01);
    const s = c.summary();
    expect(s.byCat.n3).toMatchObject({ attempts: 1, scored: 0, accuracy: 0, best: null, avg: null });
    expect(s.accuracy).toBe(0);
  });

  it('volver a recoger la pieza antes de que cuente es un intento fallado y un ciclo nuevo', () => {
    const c = new CycleStats(GAME);
    c.pickup(1, 0);
    c.release(1, 'n2', 3);
    c.pickup(1, 4);
    c.release(1, 'n2', 6);
    c.scored(1, 'n2', 6.5);
    const s = c.summary();
    expect(s.byCat.n2).toMatchObject({ attempts: 2, scored: 1, accuracy: 0.5 });
    expect(s.byCat.n2.best).toBeCloseTo(2.5);
  });

  it('apuntando a N3 pero cayendo en N2: el acierto cuenta en N2 (donde dio puntos)', () => {
    const c = new CycleStats(GAME);
    c.pickup(1, 0);
    c.release(1, 'n3', 3);
    c.scored(1, 'n2', 3.4);
    const s = c.summary();
    expect(s.byCat.n3.attempts).toBe(0);
    expect(s.byCat.n2).toMatchObject({ attempts: 1, scored: 1, points: GAME.points.sampleTeleop[2] });
  });

  it('en la Cámara rival (D14) es fallo; soltarla abajo no es intento', () => {
    const c = new CycleStats(GAME);
    c.pickup(1, 0);
    c.release(1, 'n1', 2);
    c.missed(1, 2.5);
    c.pickup(2, 3);
    c.release(2, null, 4);
    c.advance(20);
    const s = c.summary();
    expect(s.byCat.n1).toMatchObject({ attempts: 1, scored: 0 });
    expect(s.attempts).toBe(1);
  });

  it('la precarga empieza su ciclo al arrancar; la Crítica vale 15 (§4.4)', () => {
    const c = new CycleStats(GAME);
    c.carrying(3, 0);
    c.release(3, 'n3', 5);
    c.scored(3, 'n3', 5.3);
    c.pickup(99, 10);
    c.release(99, 'critical', 18);
    c.scored(99, 'critical', 18.6);
    const s = c.summary();
    expect(s.byCat.n3.best).toBeCloseTo(5.3);
    expect(s.byCat.critical).toMatchObject({ attempts: 1, scored: 1, points: GAME.points.critical });
    expect(s.byCat.critical.best).toBeCloseTo(8.6);
    // Por minuto solo cuenta Muestras
    expect(s.perMinute).toBeCloseTo(60 / 18.6);
  });

  it('una pieza que entra sin intento (empujada) cuenta como acierto', () => {
    const c = new CycleStats(GAME);
    c.pickup(4, 1);
    c.scored(4, 'n1', 3);
    expect(c.summary().byCat.n1).toMatchObject({ attempts: 1, scored: 1, accuracy: 1 });
  });

  it('sin nada: todo vacío, sin dividir entre cero', () => {
    const s = new CycleStats(GAME).summary();
    expect(s).toMatchObject({ cycles: 0, attempts: 0, accuracy: null, avg: null, best: null, last: null, points: 0, perMinute: 0 });
  });

  it('mejor ciclo por robot: guarda solo si mejora; lo guardado se lee y lo raro se descarta', () => {
    const b = emptyBests();
    const run = (t: number) => {
      const c = new CycleStats(GAME);
      c.pickup(1, 0);
      c.release(1, 'n3', t);
      c.scored(1, 'n3', t);
      return c.summary();
    };
    expect(updateBests(b, 'pivot', run(6))).toEqual(['n3']);
    expect(updateBests(b, 'pivot', run(7))).toEqual([]);
    expect(updateBests(b, 'pivot', run(5.5))).toEqual(['n3']);
    expect(b.bests.pivot.n3).toBe(5.5);
    expect(parseBests(JSON.stringify(b))).toEqual(b);
    expect(parseBests('{"v":1,"bests":{"pivot":{"n3":"x","n1":-2,"n2":4}}}').bests.pivot).toEqual({ n2: 4 });
    expect(parseBests('basura')).toEqual(emptyBests());
    expect(parseBests(null)).toEqual(emptyBests());
  });
});

beforeAll(async () => {
  await initRapier();
});

describe('práctica 1 contra 1 en la física', () => {
  const session = (rival: 'none' | 'passive' | 'ai') => {
    const specs: RobotSpec[] = [];
    specs[0] = DEFAULT_ROBOT;
    specs[2] = DEFAULT_ROBOT;
    return new GameSession({ player: 0, preload: true, solo: true, rival, specs, hp: { enabled: true, interval: 3 } });
  };
  const drop = (g: GameSession, a: 'red' | 'blue', level: 1 | 2 | 3, robot: number) => {
    const w = F.rectFor(a, F.camaraWells()[level]);
    const p = g.pieces.list.find((x) => x.kind === 'sample' && x.state.at === 'hp')!;
    g.pieces.place(p, (w.x0 + w.x1) / 2, F.camaraWells()[level].rim + 0.2, (w.z0 + w.z1) / 2);
    p.lastRobot = robot;
    return p;
  };

  it('sin rival solo está tu robot; con rival, el de enfrente en la otra alianza', () => {
    expect(session('none').robots.map((r) => r.index)).toEqual([0]);
    const g = session('passive');
    expect(g.robots.map((r) => r.index)).toEqual([0, 2]);
    expect(g.rival?.alliance).toBe('blue');
    expect(g.bots.filter(Boolean).length).toBe(0);
    expect(new GameSession({ player: 3, preload: true, solo: true, rival: 'passive' }).rival?.index).toBe(1);
  });

  it('el rival pasivo no se mueve', () => {
    const g = session('passive');
    const p0 = g.rival!.phys.position();
    for (let i = 0; i < 240; i++) {
      g.setInput(emptyInput());
      g.step();
    }
    const p1 = g.rival!.phys.position();
    expect(Math.hypot(p1.x - p0.x, p1.z - p0.z)).toBeLessThan(0.01);
  });

  it('el rival de la IA sale a jugar y su HP le mete Muestras', () => {
    const g = session('ai');
    expect(g.bots[2]).toBeTruthy();
    const p0 = g.rival!.phys.position();
    for (let i = 0; i < 120 * 4; i++) {
      g.setInput(emptyInput());
      g.step();
    }
    const p1 = g.rival!.phys.position();
    expect(Math.hypot(p1.x - p0.x, p1.z - p0.z)).toBeGreaterThan(0.5);
    // Tu robot (sin mandos) no se mueve
    expect(Math.abs(g.player.phys.position().x - F.forAlliance('red', { x: 0, z: 0 }).x)).toBeGreaterThan(0);
  });

  it('el cronómetro cuenta lo tuyo en tu Cámara; en la rival es intento fallado', () => {
    const g = session('passive');
    const tr = new CycleTracker(g, null);
    g.tap = tr;
    const run = (n: number) => {
      for (let i = 0; i < n; i++) {
        g.setInput(emptyInput());
        g.step();
      }
    };
    run(60);
    drop(g, 'red', 3, 0);
    run(180);
    drop(g, 'red', 1, 0);
    run(180);
    // Una del rival en su Cámara no es tuya
    drop(g, 'blue', 2, 2);
    run(180);
    const s = tr.stats.summary();
    expect(s.byCat.n3.scored).toBe(1);
    expect(s.byCat.n1.scored).toBe(1);
    expect(s.byCat.n2.scored).toBe(0);
    expect(s.points).toBe(GAME.points.sampleTeleop[3] + GAME.points.sampleTeleop[1]);
    expect(tr.rivalScored).toBe(1);
  });

  it('con límite de tiempo, la práctica se acaba a los segundos pedidos', () => {
    const g = session('none');
    const tr = new CycleTracker(g, 2);
    g.tap = tr;
    for (let i = 0; i < 400; i++) {
      g.setInput(emptyInput());
      g.step();
    }
    expect(tr.ended).toBe(true);
    expect(tr.time).toBeCloseTo(2, 1);
  });
});
