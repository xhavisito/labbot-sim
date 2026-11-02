import { describe, expect, it } from 'vitest';
import { checkCustom, customFromSpec, customSpec, sanitizeCustom } from '../src/config/customRobots';
import { canHoldCritical, clawOf, DEFAULT_INTAKE, intakeOf, PIVOT_180_ROBOT, PIVOT_ROBOT, validateRobot } from '../src/config/robot';
import { mm } from '../src/config/field';

const errors = (c: ReturnType<typeof customFromSpec>) => checkCustom(c).filter((x) => x.level === 'error');
const warns = (c: ReturnType<typeof customFromSpec>) => checkCustom(c).filter((x) => x.level === 'warn').map((x) => x.text);

describe('constructor de robots: intake', () => {
  it('sin intake explícito, los presets usan la garra de siempre (compliants, 23 cm, dedos de 20 cm)', () => {
    expect(intakeOf(PIVOT_ROBOT)).toEqual(DEFAULT_INTAKE);
    const claw = clawOf(PIVOT_ROBOT);
    expect(claw.fingerLength).toBeCloseTo(0.2);
    // fingerZ = apertura/2 + grosor/2 -> la misma medida que CLAW
    expect(claw.fingerZ).toBeCloseTo(0.125);
  });

  it('el robot copiado de un preset conserva el intake y cumple §7', () => {
    for (const s of [PIVOT_ROBOT, PIVOT_180_ROBOT]) {
      const c = customFromSpec(s, 'x');
      expect(c.gapCm).toBeCloseTo(23);
      expect(c.fingerCm).toBeCloseTo(20);
      expect(errors(c)).toEqual([]);
      expect(validateRobot(customSpec(c))).toEqual([]);
    }
  });

  it('dedos largos sacan la garra de los 40 cm (§7.2)', () => {
    const c = customFromSpec(PIVOT_ROBOT, 'x');
    // el pivote ya llega a ~29.7 cm: dedos de 32 cm pasan los 40 cm
    expect(errors({ ...c, fingerCm: 32 }).some((e) => e.text.includes('40 cm'))).toBe(true);
    expect(errors({ ...c, fingerCm: 10 })).toEqual([]);
  });

  it('una apertura de menos de 20 cm no lleva la Crítica (§4.1.1) y avisa', () => {
    const c = customFromSpec(PIVOT_ROBOT, 'x');
    const narrow = { ...c, gapCm: 17 };
    expect(canHoldCritical(customSpec(narrow))).toBe(false);
    expect(warns(narrow).some((w) => w.includes('Crítica'))).toBe(true);
    expect(canHoldCritical(customSpec(c))).toBe(true);
  });

  it('una apertura menor a 15.5 cm avisa que la Muestra casi no entra (§4.1.1)', () => {
    const c = customFromSpec(PIVOT_ROBOT, 'x');
    expect(warns({ ...c, gapCm: 15 }).some((w) => w.includes('15 cm'))).toBe(true);
  });

  it('customSpec lleva el intake a la simulación', () => {
    const c = { ...customFromSpec(PIVOT_ROBOT, 'x'), intakeKind: 'pinza' as const, gapCm: 18, fingerCm: 15, closeTime: 0.3 };
    const i = customSpec(c).intake!;
    expect(i.kind).toBe('pinza');
    expect(i.gap).toBeCloseTo(mm(180));
    expect(i.fingerLength).toBeCloseTo(mm(150));
    expect(i.closeTime).toBe(0.3);
  });

  it('sanitizeCustom limita los valores y completa robots guardados antes del constructor', () => {
    const old = sanitizeCustom({ id: 'abc', name: 'Viejo', mechanism: 'pivot' })!;
    expect(old.intakeKind).toBe('compliant');
    expect(old.gapCm).toBeCloseTo(23);
    const wild = sanitizeCustom({ id: 'abc', mechanism: 'pivot', intakeKind: 'raro', gapCm: 900, fingerCm: -3, rollerSpeed: 50, closeTime: 0 })!;
    expect(wild.intakeKind).toBe('compliant');
    expect(wild.gapCm).toBe(34);
    expect(wild.fingerCm).toBe(10);
    expect(wild.rollerSpeed).toBe(3);
    expect(wild.closeTime).toBe(0.05);
  });
});
