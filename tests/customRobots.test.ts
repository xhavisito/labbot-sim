import { describe, expect, it } from 'vitest';
import { checkCustom, customFromSpec, customSpec, driveSpeed, estimateMass, motorCount, sanitizeCustom } from '../src/config/customRobots';
import { PIVOT_180_ROBOT, PIVOT_ROBOT, validateRobot } from '../src/config/robot';

const errors = (c: ReturnType<typeof customFromSpec>) => checkCustom(c).filter((x) => x.level === 'error');

describe('robot propio del editor', () => {
  it('el chasis del pivote da ~2.7 m/s con 4 CIM a 12.75:1 y ruedas de 6 in (sugerencia en MDF)', () => {
    const c = customFromSpec(PIVOT_ROBOT, 'Pivote');
    // 5330 rpm / 12.75 × π × 0.1524 m × 0.8 ≈ 2.67 m/s
    expect(driveSpeed(c)).toBeCloseTo(2.67, 1);
  });

  it('los presets copiados cumplen §7 y su spec pasa validateRobot', () => {
    for (const s of [PIVOT_ROBOT, PIVOT_180_ROBOT]) {
      const c = customFromSpec(s, 'x');
      expect(errors(c)).toEqual([]);
      expect(validateRobot(customSpec(c))).toEqual([]);
    }
  });

  it('chasis de más de 65 cm o más alto que 100 cm no pasa (§7.2)', () => {
    const c = customFromSpec(PIVOT_ROBOT, 'x');
    expect(errors({ ...c, lengthCm: 70 }).some((e) => e.text.includes('§7.2'))).toBe(true);
    expect(errors({ ...c, heightCm: 105 }).some((e) => e.text.includes('§7.2'))).toBe(true);
  });

  it('cuenta los motores de tracción y mecanismos contra §7.3', () => {
    const c = customFromSpec(PIVOT_ROBOT, 'x');
    expect(motorCount(c).cim).toBe(4);
    // 4 Kraken X60 (tracción) + 2 del brazo = 6 > 3
    const x60 = { ...c, driveMotor: 'x60' as const };
    expect(errors(x60).some((e) => e.text.includes('Kraken X60') && e.text.includes('§7.3'))).toBe(true);
    expect(errors({ ...c, driveCount: 8 }).some((e) => e.text.includes('CIM'))).toBe(true);
  });

  it('PLA arriba de 150 g no pasa (§7.1.1); la masa no tiene límite (§7.2)', () => {
    const c = customFromSpec(PIVOT_ROBOT, 'x');
    expect(errors({ ...c, plaG: 200 }).some((e) => e.text.includes('§7.1.1'))).toBe(true);
    const heavy = { ...c, massKg: 90 };
    expect(errors(heavy)).toEqual([]);
    expect(checkCustom(heavy).some((x) => x.level === 'info' && x.text.includes('no hay límite de peso'))).toBe(true);
    expect(customSpec(heavy).massKg).toBe(90);
  });

  it('la masa estimada suma MDF de 5.5 mm, motores y batería', () => {
    const c = customFromSpec(PIVOT_ROBOT, 'x');
    const m = estimateMass(c);
    expect(m.total).toBeGreaterThan(15);
    expect(m.total).toBeLessThan(45);
    // 1 m² de MDF de 5.5 mm a 750 kg/m³ = 4.125 kg
    expect(estimateMass({ ...c, mdfM2: 1 }).mdf).toBeCloseTo(4.125, 3);
  });

  it('sanitizeCustom recorta valores raros guardados en el navegador', () => {
    const c = sanitizeCustom({ name: '', mechanism: 'nope', lengthCm: 9999, driveMotor: 'falcon', gearRatio: -3, maxLevel: 7 })!;
    expect(c.mechanism).toBe('pivot');
    expect(c.lengthCm).toBe(120);
    expect(c.driveMotor).toBe('cim');
    expect(c.gearRatio).toBe(2);
    expect(c.maxLevel).toBe(3);
    expect(sanitizeCustom(null)).toBeNull();
  });

  it('un robot guardado de un tipo que ya no existe (torre, pivote con hopper) pasa a Pivote con su chasis', () => {
    for (const mechanism of ['tower', 'pivotHopper']) {
      const old = { ...customFromSpec(PIVOT_ROBOT, 'Mi robot viejo'), mechanism, lengthCm: 60, capacity: 5, armLengthCm: 45, intakeCm: 30 };
      const c = sanitizeCustom(old)!;
      expect(c.mechanism).toBe('pivot');
      expect(c.name).toBe('Mi robot viejo');
      expect(c.lengthCm).toBe(60);
      // Brazo y capacidad del preset (los suyos eran de otro mecanismo)
      expect(c.capacity).toBe(1);
      expect(c.armLengthCm).toBeCloseTo(PIVOT_ROBOT.arm.length * 100, 6);
      expect(validateRobot(customSpec(c))).toEqual([]);
    }
  });

  it('la variante de 180° conserva su recorrido al copiarla', () => {
    const s = customSpec(customFromSpec(PIVOT_180_ROBOT, 'x'));
    expect(s.mechanism).toBe('pivot180');
    expect(s.arm.stowAngle!).toBeCloseTo(PIVOT_180_ROBOT.arm.stowAngle!, 6);
  });

  it('un Pivote 180° guardado antes de voltearlo (eje detrás del centro) pasa el eje adelante', () => {
    const old = { ...customFromSpec(PIVOT_180_ROBOT, 'viejo'), v: undefined, armPivotXCm: -15 };
    const c = sanitizeCustom(JSON.parse(JSON.stringify(old)))!;
    expect(c.armPivotXCm).toBe(15);
    expect(validateRobot(customSpec(c))).toEqual([]);
    // Ya en el formato nuevo, un eje atrás se respeta
    expect(sanitizeCustom({ ...c, armPivotXCm: -5 })!.armPivotXCm).toBe(-5);
  });
});
