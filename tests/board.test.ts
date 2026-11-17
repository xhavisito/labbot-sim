import { describe, expect, it } from 'vitest';
import * as F from '../src/config/field';
import { Board, MAX_POINTS, MAX_STROKES, MIN_STEP, strokeLength } from '../src/core/board';

describe('pizarra táctica', () => {
  it('dibuja un trazo y filtra puntos muy cercanos', () => {
    const b = new Board();
    b.begin('white', { x: 0, z: 0 });
    b.extend({ x: MIN_STEP / 2, z: 0 });
    b.extend({ x: 1, z: 0 });
    expect(b.strokes).toHaveLength(1);
    expect(b.strokes[0].pts).toHaveLength(2);
    expect(strokeLength(b.strokes[0])).toBeCloseTo(1, 1);
  });

  it('mantiene los puntos dentro de la cancha', () => {
    const b = new Board();
    b.begin('cyan', { x: 99, z: -99 });
    expect(b.strokes[0].pts[0]).toEqual({ x: F.HALF_L, z: -F.HALF_W });
  });

  it('ignora puntos no finitos y extend sin trazo', () => {
    const b = new Board();
    b.extend({ x: 1, z: 1 });
    b.begin('white', { x: NaN, z: 0 });
    expect(b.empty).toBe(true);
  });

  it('limita puntos por trazo y trazos totales (borra el más viejo)', () => {
    const b = new Board();
    b.begin('yellow', { x: -4, z: 0 });
    for (let i = 1; i < MAX_POINTS + 50; i++) b.extend({ x: -4 + i * 0.03, z: (i % 2) * 0.5 });
    expect(b.strokes[0].pts.length).toBe(MAX_POINTS);
    const first = new Board();
    for (let i = 0; i < MAX_STROKES + 3; i++) first.begin(i === 0 ? 'green' : 'white', { x: i * 0.01, z: 0 });
    expect(first.strokes).toHaveLength(MAX_STROKES);
    expect(first.strokes[0].color).toBe('white');
  });

  it('deshacer y borrar todo', () => {
    const b = new Board();
    b.begin('white', { x: 0, z: 0 });
    b.begin('magenta', { x: 1, z: 1 });
    b.undo();
    expect(b.strokes).toHaveLength(1);
    b.clear();
    expect(b.empty).toBe(true);
  });
});
