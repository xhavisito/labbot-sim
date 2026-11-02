import { describe, expect, it } from 'vitest';
import { emptyGhosts, ghostAt, GHOST_HZ, GhostRecorder, mirrorPose, parseGhosts, updateGhost } from '../src/core/ghost';

/** Robot que avanza en línea recta a `v` m/s, muestreado a 120 Hz. */
function run(rec: GhostRecorder, from: number, to: number, v: number): void {
  for (let t = from; t <= to + 1e-9; t += 1 / 120) rec.sample(t, { x: v * t, z: 0, heading: 0 });
}

describe('ghost del mejor ciclo', () => {
  it('corta el ciclo cuando cuenta una pieza y se queda con el más rápido', () => {
    const r = new GhostRecorder('red');
    run(r, 0, 6, 1);
    r.cycleDone(6);
    expect(r.best?.dur).toBe(6);
    run(r, 6, 10, 1);
    r.cycleDone(10); // 4 s: más rápido
    expect(r.best?.dur).toBe(4);
    // El ghost del segundo ciclo empieza donde acabó el primero (x = 6)
    expect(r.best!.pts[0]).toBeCloseTo(6, 1);
    run(r, 10, 18, 1);
    r.cycleDone(18); // 8 s: más lento, no reemplaza
    expect(r.best?.dur).toBe(4);
  });

  it('interpola, se queda en la meta y gira por el camino corto', () => {
    const g = { dur: 1, pts: [0, 0, 3.0, 1, 0, -3.0] };
    const mid = ghostAt(g, 0.5 / GHOST_HZ);
    expect(mid.x).toBeCloseTo(0.5);
    expect(Math.cos(mid.heading)).toBeCloseTo(-1, 1); // pasa por π, no por 0
    expect(ghostAt(g, 99).x).toBe(1);
  });

  it('en azul se guarda en el lado rojo y se rota de vuelta', () => {
    const r = new GhostRecorder('blue');
    r.sample(0, { x: -2, z: 1, heading: Math.PI });
    r.sample(1, { x: -3, z: 1, heading: Math.PI });
    r.cycleDone(1);
    expect(r.best!.pts.slice(0, 2)).toEqual([2, -1]);
    const back = mirrorPose({ x: 2, z: -1, heading: 0 }, 'blue');
    expect(back).toMatchObject({ x: -2, z: 1 });
  });

  it('guarda solo si es más rápido que el guardado y valida lo leído', () => {
    const s = emptyGhosts();
    const a = { dur: 5, pts: [0, 0, 0, 1, 0, 0] };
    expect(updateGhost(s, 'pivot', a)).toBe(true);
    expect(updateGhost(s, 'pivot', { ...a, dur: 6 })).toBe(false);
    expect(updateGhost(s, 'pivot', { ...a, dur: 4 })).toBe(true);
    expect(updateGhost(s, 'pivot', null)).toBe(false);
    expect(parseGhosts(JSON.stringify(s)).robots.pivot.dur).toBe(4);
    expect(parseGhosts('basura').robots).toEqual({});
    expect(parseGhosts(JSON.stringify({ v: 1, robots: { x: { dur: 3, pts: [1, 2] } } })).robots).toEqual({});
  });
});
