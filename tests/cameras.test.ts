import { describe, it, expect } from 'vitest';
import * as C from '../src/config/cameras';
import * as F from '../src/config/field';

describe('cámaras del conductor (SUPUESTO D41)', () => {
  it('el conductor queda fuera de la cancha, detrás de su mesa, a la altura de los ojos', () => {
    const r = C.driverEye('red', 0);
    expect(r.x).toBeGreaterThan(C.DRIVER_TABLE_X + F.DRIVER_STATION_DEPTH / 2);
    expect(r.y).toBe(C.DRIVER_EYE_HEIGHT);
  });
  it('azul es la rotación de 180° de rojo', () => {
    const r = C.driverEye('red', 1);
    const b = C.driverEye('blue', 1);
    expect(b.x).toBeCloseTo(-r.x);
    expect(b.z).toBeCloseTo(-r.z);
    const rc = C.cornerEye('red', 0);
    const bc = C.cornerEye('blue', 0);
    expect(bc.x).toBeCloseTo(-rc.x);
    expect(bc.z).toBeCloseTo(-rc.z);
  });
  it('las dos estaciones quedan en lados opuestos y la esquina fuera de la pared', () => {
    expect(Math.sign(C.driverEye('red', 0).z)).toBe(-Math.sign(C.driverEye('red', 1).z));
    const c = C.cornerEye('red', 1);
    expect(c.x).toBeGreaterThan(F.HALF_L);
    expect(Math.abs(c.z)).toBeGreaterThan(F.HALF_W);
  });
  it('la cámara a bordo va al frente y sobre la estructura', () => {
    const m = C.onboardMount({ length: 0.6, baseHeight: 0.4 });
    expect(m.forward).toBeCloseTo(0.26);
    expect(m.up).toBeCloseTo(0.52);
  });
});
