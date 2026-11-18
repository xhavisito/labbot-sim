import { describe, expect, it } from 'vitest';
import * as F from '../src/config/field';
import { GAME } from '../src/config/game';
import { CycleStats } from '../src/core/cycles';
import { addShots, asRed, distToRect, emptyShotLog, MAX_SHOTS, parseShotLog, shotCells, SHOT_CELL, zoneOf, zoneStats, ZONE_MID, ZONE_NEAR, type Shot } from '../src/core/scoreMap';
import { accuracyRgb } from '../src/ui/shotMap';

const shot = (x: number, z: number, ok: boolean, cat: Shot['cat'] = 'n1', t = 0): Shot => ({ x, z, ok, cat, t });

describe('ciclos partidos en buscar y llevar', () => {
  it('buscar = de que contó la anterior (o del arranque) a recoger; llevar = de recoger a anotar', () => {
    const c = new CycleStats(GAME);
    c.carrying(1, 0);
    c.release(1, 'n3', 3, { x: 3, z: 2 });
    c.scored(1, 'n3', 3.5);
    c.pickup(2, 6);
    c.release(2, 'n1', 9, { x: 3.4, z: 2.4 });
    c.scored(2, 'n1', 9.2);
    const [a, b] = c.records;
    expect(a).toMatchObject({ search: 0 });
    expect(a.time).toBeCloseTo(3.5);
    expect(b.search).toBeCloseTo(2.5);
    expect(b.time).toBeCloseTo(3.2);
    const s = c.summary();
    expect(s.avgSearch).toBeCloseTo(1.25);
    expect(s.avgFull).toBeCloseTo((3.5 + 5.7) / 2);
    // El tiro queda donde SOLTÓ, no donde contó
    expect(c.shots).toEqual([
      { x: 3, z: 2, cat: 'n3', ok: true, t: 3.5 },
      { x: 3.4, z: 2.4, cat: 'n1', ok: true, t: 9.2 },
    ]);
  });

  it('un intento fallado deja un tiro con ×; sin posición no hay tiro', () => {
    const c = new CycleStats(GAME);
    c.pickup(1, 0);
    c.release(1, 'n2', 2, { x: 1, z: 1 });
    c.advance(10);
    c.pickup(2, 11);
    c.release(2, 'n2', 12);
    c.advance(20);
    expect(c.shots).toEqual([{ x: 1, z: 1, cat: 'n2', ok: false, t: 2 }]);
    expect(c.summary()).toMatchObject({ avgSearch: null, avgFull: null });
  });

  it('empujada sin soltar: el tiro va donde estaba el robot al contar', () => {
    const c = new CycleStats(GAME);
    c.pickup(4, 1);
    c.scored(4, 'n1', 3, { x: 2, z: 3 });
    expect(c.shots).toEqual([{ x: 2, z: 3, cat: 'n1', ok: true, t: 3 }]);
  });
});

describe('mapa de tiro (lógica pura)', () => {
  const cam = F.camaraRect('red');

  it('la Cámara roja es la del layout (§3.2.3) y la azul su rotación de 180°', () => {
    // La Cámara en la que anota el rojo es la del extremo azul (−X, −Z); la del azul, la del extremo rojo
    const base = { x0: F.CAMARA_X_END_RED - F.CAMARA_LENGTH, x1: F.CAMARA_X_END_RED, z0: F.CAMARA_Z_RED[0], z1: F.CAMARA_Z_RED[1] };
    expect(F.camaraRect('blue')).toEqual(base);
    expect(cam).toEqual({ x0: -base.x1, x1: -base.x0, z0: -base.z1, z1: -base.z0 });
  });

  it('distancia a la orilla de la Cámara y zonas', () => {
    expect(distToRect(cam.x0 + 0.1, cam.z0 + 0.1, cam)).toBe(0);
    expect(distToRect(cam.x0, cam.z0 - 0.5, cam)).toBeCloseTo(0.5);
    expect(distToRect(cam.x0 - 0.3, cam.z0 - 0.4, cam)).toBeCloseTo(0.5);
    expect(zoneOf(cam.x0, cam.z0 - ZONE_NEAR + 0.01, cam)).toBe('near');
    expect(zoneOf(cam.x0, cam.z0 - ZONE_NEAR - 0.02, cam)).toBe('mid');
    expect(zoneOf(cam.x0, cam.z0 - ZONE_MID - 0.01, cam)).toBe('far');
  });

  it('acierto por zona y mejor zona con al menos 3 tiros', () => {
    const near = cam.z0 - 0.4;
    const mid = cam.z0 - 1;
    const far = cam.z0 - 2.5;
    const x = (cam.x0 + cam.x1) / 2;
    const shots = [shot(x, near, true), shot(x, near, true), shot(x, near, false), shot(x, mid, true), shot(x, mid, true), shot(x, far, true), shot(x, far, true), shot(x, far, true), shot(x, far, true)];
    const z = zoneStats(shots, cam);
    expect(z.byZone.near).toMatchObject({ tried: 3, made: 2 });
    expect(z.byZone.near.accuracy).toBeCloseTo(2 / 3);
    // Media tiene 100 % pero solo 2 tiros: no cuenta para la mejor
    expect(z.byZone.mid).toMatchObject({ tried: 2, made: 2, accuracy: 1 });
    expect(z.best).toBe('far');
    expect(zoneStats([], cam)).toMatchObject({ best: null, byZone: { near: { tried: 0, accuracy: null } } });
  });

  it('juntar alianzas: azul se lleva al lado rojo y cae en la misma zona', () => {
    const blueCam = F.camaraRect('blue');
    const s = shot(blueCam.x0 + 0.3, blueCam.z1 + 0.5, true);
    const r = asRed(s, 'blue');
    expect(r).toMatchObject({ x: -s.x, z: -s.z });
    expect(zoneOf(r.x, r.z, cam)).toBe(zoneOf(s.x, s.z, blueCam));
    expect(asRed(s, 'red')).toBe(s);
  });

  it('celdas de 25 cm con tiros y aciertos; lo de afuera se pega a la orilla', () => {
    const c = shotCells([shot(0.01, 0.01, true), shot(0.2, 0.2, false), shot(-0.01, 0.01, true), shot(99, -99, true)], F.FIELD_LENGTH, F.FIELD_WIDTH);
    const at = (x: number, z: number) => c.find((k) => k.col === Math.floor((x + F.HALF_L) / SHOT_CELL) && k.row === Math.floor((z + F.HALF_W) / SHOT_CELL));
    expect(at(0.01, 0.01)).toMatchObject({ tried: 2, made: 1 });
    expect(at(-0.01, 0.01)).toMatchObject({ tried: 1, made: 1 });
    expect(c.find((k) => k.col === Math.round(F.FIELD_LENGTH / SHOT_CELL) - 1 && k.row === 0)).toMatchObject({ tried: 1 });
    expect(c).toHaveLength(3);
  });

  it('acumulado por robot: guarda los últimos MAX_SHOTS, se lee igual y descarta lo raro', () => {
    const log = emptyShotLog();
    addShots(log, 'pivot', Array.from({ length: MAX_SHOTS + 10 }, (_, i) => shot(1.234567, 2, i % 2 === 0, 'n3', i)));
    expect(log.robots.pivot).toHaveLength(MAX_SHOTS);
    expect(log.robots.pivot[0].t).toBe(10);
    expect(log.robots.pivot[0].x).toBe(1.23);
    expect(parseShotLog(JSON.stringify(log))).toEqual(log);
    const bad = '{"v":1,"robots":{"a":[{"x":1,"z":2,"cat":"n1","ok":true,"t":0},{"x":"1","z":2,"cat":"n1","ok":true,"t":0},{"x":1,"z":2,"cat":"n9","ok":true,"t":0}],"b":5}}';
    expect(parseShotLog(bad).robots).toEqual({ a: [{ x: 1, z: 2, cat: 'n1', ok: true, t: 0 }] });
    expect(parseShotLog('basura')).toEqual(emptyShotLog());
    expect(parseShotLog(null)).toEqual(emptyShotLog());
  });

  it('color de acierto: rojo con 0, verde con 1', () => {
    expect(accuracyRgb(0)).toEqual([229, 65, 58]);
    expect(accuracyRgb(1)).toEqual([46, 204, 113]);
    expect(accuracyRgb(2)).toEqual(accuracyRgb(1));
  });
});
