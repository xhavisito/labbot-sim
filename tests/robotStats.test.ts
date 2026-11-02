import { describe, expect, it } from 'vitest';
import { compareRobots, emptyRecord, metrics, robotId, SessionStats } from '../src/core/robotStats';

describe('estadísticas por robot', () => {
  it('sin datos → null, nunca inventa', () => {
    const m = metrics(emptyRecord('x', 'x'));
    expect(m).toEqual({ cycleTime: null, accuracy: null, pointsPerMinute: null });
  });

  it('ciclo, precisión y puntos/min', () => {
    const s = new SessionStats();
    s.tick(60, true);
    s.tick(10, false); // deshabilitado no cuenta
    s.intake(1, 10);
    s.shot(1);
    s.scored(1, 6, 18); // ciclo de 8 s
    s.shot(2); // fallado
    s.shot(3); // precarga anotada: sin intake → sin ciclo
    s.scored(3, 2, 30);
    s.scored(99, 15, 31); // lo anotó otro: no cuenta
    const m = metrics(s.addTo(emptyRecord('x', 'x')));
    expect(m.cycleTime).toBe(8);
    expect(m.accuracy).toBeCloseTo(2 / 3);
    expect(m.pointsPerMinute).toBe(8);
  });

  it('pocos segundos → puntos/min sin datos', () => {
    const s = new SessionStats();
    s.tick(10, true);
    expect(metrics(s.addTo(emptyRecord('x', 'x'))).pointsPerMinute).toBeNull();
  });

  it('compara: menos ciclo y más precisión es mejor; con faltante no hay ganador', () => {
    const a = { ...emptyRecord('a', 'A'), seconds: 120, shots: 10, hits: 8, points: 40, cycles: 4, cycleSeconds: 20 };
    const b = { ...emptyRecord('b', 'B'), seconds: 120, shots: 10, hits: 5, points: 60, cycles: 0 };
    const r = Object.fromEntries(compareRobots(a, b).map((x) => [x.key, x]));
    expect(r.cycleTime.better).toBeNull();
    expect(r.cycleTime.b).toBeNull();
    expect(r.accuracy.better).toBe('a');
    expect(r.pointsPerMinute.better).toBe('b');
  });

  it('id estable', () => {
    expect(robotId({ mechanism: 'pivot', maxSpeed: 3, capacity: 1 })).toBe('pivot|3|1');
  });
});
