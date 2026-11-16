/** Axiom: garra con pivote 180°, importada del STEP del equipo (16-nov). Lo que el CAD no dice es SUPUESTO (ver el JSON). */
import { existsSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { CAD_ROBOT_SPECS, CAD_ROBOT_PROBLEMS } from '../src/cad/cadRobots';
import { robotSpec } from '../src/config/robotIds';
import { GameSession } from '../src/game/GameSession';
import { emptyInput } from '../src/input/InputManager';
import { initRapier } from '../src/physics/PhysicsWorld';
import axiom from '../robots/axiom.robot.json';

beforeAll(async () => {
  await initRapier();
});

describe('Axiom tal cual el CAD', () => {
  const A = () => CAD_ROBOT_SPECS.axiom;
  it('lleva las medidas, las 4 llantas y el brazo del CAD', () => {
    const s = A();
    expect(s.mechanism).toBe('pivot180');
    expect(s.length).toBeCloseTo(0.561, 3); // 56 cm sin brazo (Xhavi)
    expect(s.width).toBeCloseTo(0.6511, 3);
    expect(s.wheel!.xs).toHaveLength(2); // 2 por lado = 4 llantas
    expect(s.wheel!.r).toBeCloseTo(0.0762, 4); // 6 in
    expect(s.arm.length).toBeCloseTo(0.6246, 3);
    expect(s.arm.pivotY).toBeCloseTo(0.2421, 3);
    expect(s.model?.url).toBe('robots/axiom.glb');
    expect(s.model?.staticWheels).toBe(true);
    expect(existsSync(new URL('../public/robots/axiom.glb', import.meta.url))).toBe(true);
  });
  it('es una garra de pinza al frente: sin lanzador de Phoenix ni rodillos', () => {
    const s = A();
    expect(s.intake?.kind).toBe('pinza');
    expect(s.intake?.shooter).toBeUndefined();
    expect(s.intake?.rollers).toBeFalsy();
    expect(s.arm.pickBack).toBe(false);
    expect(s.capacity).toBe(1);
  });
  it('solo se pasa del límite de ancho que dice el CAD (0.651 m) y declara sus SUPUESTOS', () => {
    expect(CAD_ROBOT_PROBLEMS.axiom).toEqual(['chasis mayor a 65 × 65 cm (§7.2)']);
    const t = (axiom as { supuestos: string[] }).supuestos.join(' ');
    expect(t).toMatch(/SUPUESTO \(Xhavi, 16-nov\)/);
    expect(t).toMatch(/pose de inicio del brazo a 60°/);
  });
  it('empieza dentro del perímetro con el brazo guardado', () => {
    const s = A();
    const tipX = s.arm.pivotX + s.arm.length * Math.cos(s.arm.stowAngle!);
    expect(Math.abs(tipX) + 0.075).toBeLessThanOrEqual(s.length / 2 + 1e-6);
  });
});

describe('IA con Axiom', () => {
  it('un match de solo IA con 4 Axiom: se mueven, sin trabarse, y anotan', () => {
    const P = robotSpec('cad:axiom');
    const g = new GameSession({ player: 0, preload: true, ai: true, specs: [P, P, P, P] });
    g.startMatch();
    for (let i = 0; i < 151 * 120 && !g.match!.finished; i++) {
      g.setInput(emptyInput());
      g.step();
    }
    const m = g.match!;
    const red = m.breakdown('red');
    const blue = m.breakdown('blue');
    console.log('AI-AXIOM', JSON.stringify({ red, blue }));
    expect(red.samplesAuto + red.samplesTeleop + blue.samplesAuto + blue.samplesTeleop).toBeGreaterThan(0);
  }, 240000);
});
