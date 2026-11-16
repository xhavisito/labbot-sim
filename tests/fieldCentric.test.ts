import { describe, expect, it } from 'vitest';
import { fieldCentricDrive, fieldUpAngle } from '../src/input/fieldCentric';
import { DEFAULT_BINDINGS, sanitizeBindings } from '../src/input/bindings';

describe('manejo centrado en el campo', () => {
  it('apagado por defecto y se valida lo guardado', () => {
    expect(DEFAULT_BINDINGS.fieldCentric).toBe(false);
    expect(sanitizeBindings({ fieldCentric: true }).fieldCentric).toBe(true);
    expect(sanitizeBindings({ fieldCentric: 'sí' }).fieldCentric).toBe(false);
  });
  it('"arriba" es hacia +X para azul y −X para roja (SUPUESTO)', () => {
    expect(fieldUpAngle('blue')).toBe(0);
    expect(fieldUpAngle('red')).toBeCloseTo(Math.PI);
  });
  it('stick soltado: no se mueve', () => {
    expect(fieldCentricDrive(0, 0, 1.2, 0)).toEqual({ forward: 0, turn: 0 });
  });
  it('ya mirando hacia arriba: avanza recto', () => {
    const o = fieldCentricDrive(1, 0, 0, 0);
    expect(o.forward).toBeCloseTo(1);
    expect(o.turn).toBeCloseTo(0);
  });
  it('mirando de lado: gira hacia arriba del campo antes de avanzar', () => {
    const o = fieldCentricDrive(1, 0, Math.PI / 4, 0); // mira 45° a la izquierda del campo-arriba
    expect(o.turn).toBeLessThan(0); // gira a la derecha
    expect(o.forward).toBeGreaterThan(0);
    expect(o.forward).toBeLessThan(1);
  });
  it('de espaldas a la dirección: da reversa en vez de girar 180°', () => {
    const o = fieldCentricDrive(1, 0, Math.PI, 0);
    expect(o.forward).toBeLessThan(0);
    const p = fieldCentricDrive(1, 0, Math.PI - 0.1, 0);
    expect(p.forward).toBeLessThan(0);
  });
  it('stick a la izquierda apunta 90° antihorario del "arriba"', () => {
    const o = fieldCentricDrive(0, 1, Math.PI / 2, 0);
    expect(o.forward).toBeCloseTo(1);
    expect(o.turn).toBeCloseTo(0);
  });
  it('la alianza roja usa su propio "arriba"', () => {
    const o = fieldCentricDrive(1, 0, Math.PI, fieldUpAngle('red'));
    expect(o.forward).toBeCloseTo(1);
  });
});
