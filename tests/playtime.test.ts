import { describe, expect, it } from 'vitest';
import { addPlaytime, emptyPlaytime, formatPlaytime, MAX_FRAME, parsePlaytime } from '../src/core/playtime';

describe('tiempo jugado', () => {
  it('suma por modo y en total', () => {
    const p = emptyPlaytime();
    addPlaytime(p, 'match', 0.1);
    addPlaytime(p, 'match', 0.1);
    addPlaytime(p, 'training', 0.05);
    expect(p.byMode.match).toBeCloseTo(0.2);
    expect(p.byMode.training).toBeCloseTo(0.05);
    expect(p.total).toBeCloseTo(0.25);
  });
  it('ignora valores inválidos y recorta cuadros enormes', () => {
    const p = emptyPlaytime();
    addPlaytime(p, 'auto', NaN);
    addPlaytime(p, 'auto', -1);
    addPlaytime(p, 'auto', Infinity);
    expect(p.total).toBe(0);
    addPlaytime(p, 'auto', 60);
    expect(p.total).toBe(MAX_FRAME);
  });
  it('guarda y lee; lo corrupto da cero', () => {
    const p = emptyPlaytime();
    addPlaytime(p, 'practice', 0.2);
    const back = parsePlaytime(JSON.stringify(p));
    expect(back.byMode.practice).toBeCloseTo(0.2);
    expect(back.total).toBeCloseTo(0.2);
    expect(parsePlaytime('basura').total).toBe(0);
    expect(parsePlaytime(null).total).toBe(0);
    expect(parsePlaytime(JSON.stringify({ byMode: { match: -5, auto: 'x', training: 30 } })).total).toBe(30);
  });
  it('da formato legible', () => {
    expect(formatPlaytime(5.9)).toBe('5 s');
    expect(formatPlaytime(750)).toBe('12 min');
    expect(formatPlaytime(3 * 3600 + 5 * 60)).toBe('3 h 05 min');
  });
});
