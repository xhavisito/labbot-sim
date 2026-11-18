import { describe, expect, it } from 'vitest';
import { emptyBests } from '../src/core/cycles';
import { addPerf, compareRows, emptyPerf, parsePerf, summarize } from '../src/core/robotCompare';
import { emptyShotLog } from '../src/core/scoreMap';

const shot = (ok: boolean) => ({ x: 0, z: 0, cat: 'n1' as const, ok, t: 0 });

describe('comparar robots', () => {
  it('sin datos todo es null (no inventa)', () => {
    const s = summarize('pivot', 'Pivote', emptyBests(), emptyShotLog(), emptyPerf());
    expect([s.avgCycle, s.bestCycle, s.accuracy, s.pointsPerMinute]).toEqual([null, null, null, null]);
    expect(s.shots).toBe(0);
  });

  it('junta mejores ciclos, tiros y rendimiento', () => {
    const bests = { v: 1 as const, bests: { a: { n1: 9, n3: 6 } } };
    const shots = { v: 1 as const, robots: { a: [shot(true), shot(true), shot(false), shot(true)] } };
    const perf = emptyPerf();
    addPerf(perf, 'a', { seconds: 60, points: 30, cycles: 2, cycleSeconds: 20 });
    addPerf(perf, 'a', { seconds: 60, points: 10, cycles: 2, cycleSeconds: 10 });
    const s = summarize('a', 'A', bests, shots, perf);
    expect(s.bestCycle).toBe(6);
    expect(s.avgCycle).toBe(7.5);
    expect(s.accuracy).toBe(0.75);
    expect(s.pointsPerMinute).toBe(20);
    expect(s.minutes).toBe(2);
  });

  it('menos de 30 s jugados → puntos por minuto sin datos; sesiones vacías no cuentan', () => {
    const perf = emptyPerf();
    addPerf(perf, 'a', { seconds: 20, points: 50, cycles: 0, cycleSeconds: 0 });
    addPerf(perf, 'b', { seconds: 0, points: 5, cycles: 1, cycleSeconds: 3 });
    expect(summarize('a', 'A', emptyBests(), emptyShotLog(), perf).pointsPerMinute).toBeNull();
    expect(perf.robots.b).toBeUndefined();
  });

  it('quién va mejor; con un dato faltante nadie', () => {
    const perf = emptyPerf();
    addPerf(perf, 'a', { seconds: 120, points: 40, cycles: 4, cycleSeconds: 20 });
    addPerf(perf, 'b', { seconds: 120, points: 60, cycles: 0, cycleSeconds: 0 });
    const shots = { v: 1 as const, robots: { a: [shot(true), shot(false)], b: [shot(true), shot(true)] } };
    const rows = Object.fromEntries(compareRows(summarize('a', 'A', emptyBests(), shots, perf), summarize('b', 'B', emptyBests(), shots, perf)).map((r) => [r.key, r]));
    expect(rows.avgCycle.better).toBeNull();
    expect(rows.accuracy.better).toBe('b');
    expect(rows.pointsPerMinute.better).toBe('b');
  });

  it('parsePerf descarta basura', () => {
    expect(parsePerf('no json')).toEqual(emptyPerf());
    expect(parsePerf(JSON.stringify({ v: 1, robots: { x: { seconds: -3, points: 'a', cycles: 2, cycleSeconds: 4 } } })).robots.x).toEqual({ seconds: 0, points: 0, cycles: 2, cycleSeconds: 4 });
  });
});
