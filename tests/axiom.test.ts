/** Axiom: robot hecho solo con las medidas de Xhavi (16-nov), sin STEP. Lo demás es SUPUESTO (ver el JSON). */
import { describe, expect, it } from 'vitest';
import { CAD_ROBOT_SPECS, CAD_ROBOT_PROBLEMS } from '../src/cad/cadRobots';
import axiom from '../robots/axiom.robot.json';

describe('Axiom', () => {
  it('lleva las medidas de Xhavi y se registra solo', () => {
    const s = CAD_ROBOT_SPECS.axiom;
    expect(s).toBeDefined();
    expect(s.name).toBe('Axiom');
    expect(s.width).toBeCloseTo(0.65, 3);
    expect(s.length).toBeCloseTo(0.56, 3);
    expect(s.baseHeight).toBeCloseTo(0.64, 3);
    expect(s.mechanism).toBe('pivot');
  });
  it('cumple §7.2 y declara sus SUPUESTOS', () => {
    expect(CAD_ROBOT_PROBLEMS.axiom).toEqual([]);
    expect((axiom as { supuestos: string[] }).supuestos.some((x) => x.startsWith('SIN CAD'))).toBe(true);
  });
});
