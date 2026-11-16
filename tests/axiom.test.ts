/** Axiom: aproximación visual hecha con las medidas de Xhavi y 4 capturas (16-nov), sin STEP. Lo demás es SUPUESTO (ver el JSON). */
import { existsSync } from 'node:fs';
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
  it('trae su modelo aproximado, 4 llantas y la garra del simulador', () => {
    const s = CAD_ROBOT_SPECS.axiom;
    expect(s.model?.url).toBe('robots/axiom.glb');
    expect(s.model?.simpleClaw).toBe(true);
    expect(existsSync(new URL('../public/robots/axiom.glb', import.meta.url))).toBe(true);
    expect(s.wheel!.xs).toHaveLength(2); // 2 por lado = 4 llantas
    expect(s.wheel!.r).toBeCloseTo(0.0762, 4);
  });
  it('el aviso de aproximación está en el JSON', () => {
    const t = (axiom as { supuestos: string[] }).supuestos.join(' ');
    expect(t).toMatch(/APROXIMACIÓN VISUAL/);
    expect(t).toMatch(/SUPUESTO \(capturas\)/);
  });
});
