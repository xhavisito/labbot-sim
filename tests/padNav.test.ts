import { describe, expect, it } from 'vitest';
import { pickNext, type Box } from '../src/ui/padNav';

const b = (x: number, y: number, w = 100, h = 40): Box => ({ x, y, w, h });

describe('pickNext (navegación con el control)', () => {
  // Rejilla 2×2 y un botón ancho abajo
  const grid = [b(0, 0), b(200, 0), b(0, 100), b(200, 100), b(0, 200, 300)];

  it('se mueve al vecino en cada dirección', () => {
    expect(pickNext(grid[0], grid, 'right')).toBe(1);
    expect(pickNext(grid[0], grid, 'down')).toBe(2);
    expect(pickNext(grid[3], grid, 'left')).toBe(2);
    expect(pickNext(grid[3], grid, 'up')).toBe(1);
  });

  it('abajo prefiere la misma columna aunque la diagonal esté cerca', () => {
    const c = [b(0, 0), b(130, 50), b(0, 120)];
    expect(pickNext(c[0], c, 'down')).toBe(2);
  });

  it('el botón ancho se alcanza desde ambas columnas', () => {
    expect(pickNext(grid[2], grid, 'down')).toBe(4);
    expect(pickNext(grid[3], grid, 'down')).toBe(4);
  });

  it('sin nada en esa dirección da −1', () => {
    expect(pickNext(grid[0], grid, 'up')).toBe(-1);
    expect(pickNext(grid[1], grid, 'right')).toBe(-1);
  });
});
