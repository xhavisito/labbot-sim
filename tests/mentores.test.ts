/** Mentores 3478 (RBRI Alonso, CAD del 20-nov): brazo con pivote atrás y garra de rodillos. Datos del CAD, límites de §7.2 y que juegue. */
import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { CAD_ROBOT_PROBLEMS, CAD_ROBOT_SPECS } from '../src/cad/cadRobots';
import { allRobotIds, robotSpec } from '../src/config/robotIds';
import { posTip } from '../src/config/robot';
import { GameSession } from '../src/game/GameSession';
import { emptyInput } from '../src/input/InputManager';
import { initRapier } from '../src/physics/PhysicsWorld';
import robotFile from '../robots/mentores-3478.robot.json';

beforeAll(async () => {
  await initRapier();
});

const M = () => CAD_ROBOT_SPECS['mentores-3478'];

describe('Mentores 3478: robot del CAD', () => {
  it('se registra como robot elegible con su nombre, modelo y logo', () => {
    expect(allRobotIds()).toContain('cad:mentores-3478');
    expect(M().label).toBe('Mentores 3478');
    expect(M().mechanism).toBe('pivot');
    expect(M().model?.url).toBe('robots/mentores-3478.glb');
    expect(existsSync(new URL('../public/robots/mentores-3478.glb', import.meta.url))).toBe(true);
    expect(existsSync(new URL('../public/logos/mentores-3478.png', import.meta.url))).toBe(true);
  });

  it('medidas del CAD: chasis 0.58 × 0.58 m, 4 llantas de 6 in, eje del brazo atrás y brazo de 0.70 m', () => {
    const s = M();
    expect(s.length).toBeCloseTo(0.58, 3);
    expect(s.width).toBeCloseTo(0.58, 3);
    expect(s.wheel).toMatchObject({ r: 0.0762, xs: [-0.1725, 0.1725] });
    expect(s.arm.pivotX).toBeCloseTo(-0.2075, 3);
    expect(s.arm.length).toBeCloseTo(0.7, 2);
    expect(s.hitboxes?.length).toBeGreaterThan(5);
  });

  it('llega a los tres niveles; solo el brazo guardado al inicio se pasa del perímetro (marcado con ⚠)', () => {
    const s = M();
    for (const p of [1, 2, 3] as const) expect(posTip(s, p).y).toBeCloseTo(s.elevatorHeights[p], 2);
    expect(CAD_ROBOT_PROBLEMS['mentores-3478']).toEqual(['el brazo guardado no cabe en el perímetro al inicio (§4.1)']);
  });

  it('lo que el CAD no dice está marcado como SUPUESTO y las respuestas de Xhavi quedan anotadas', () => {
    const t = (robotFile as { supuestos: string[] }).supuestos.join('\n');
    expect(t).toMatch(/SUPUESTO: alturas/);
    expect(t).toMatch(/SUPUESTO: pose de inicio/);
    expect(t).toMatch(/masa 40 kg/);
    expect(t).toMatch(/tres niveles/);
    expect(M().intake?.noCritical).toBeFalsy(); // puede tomar la Crítica
  });
});

describe('Mentores 3478: juega', () => {
  it('con la precarga sube a cada nivel y suelta la Muestra', () => {
    for (const level of [1, 2, 3] as const) {
      const g = new GameSession({ player: 0, preload: true, specs: [M()] });
      const m = g.player.mech;
      g.player.phys.teleport(-1.5, 0, 0);
      for (let i = 0; i < 4 * 120; i++) {
        g.setInput({ ...emptyInput(), elevator: level });
        g.step();
      }
      expect(m.inClaw).toBe(true);
      for (let i = 0; i < 0.1 * 120; i++) {
        g.setInput({ ...emptyInput(), elevator: level, releaseSample: true });
        g.step();
      }
      expect(m.inClaw).toBe(false);
    }
  });

  it('cabe en su lugar de inicio y la partida corre sin errores', () => {
    const g = new GameSession({ player: 0, preload: true, specs: [robotSpec('cad:mentores-3478')] });
    for (let i = 0; i < 2 * 120; i++) {
      g.setInput(emptyInput());
      g.step();
    }
    expect(Number.isFinite(g.player.phys.position().x)).toBe(true);
  });
});

describe('IA con Mentores 3478', () => {
  it('un match de solo IA con 4 Mentores: se mueven y anotan', () => {
    const P = robotSpec('cad:mentores-3478');
    const g = new GameSession({ player: 0, preload: true, ai: true, specs: [P, P, P, P] });
    g.startMatch();
    for (let i = 0; i < 151 * 120 && !g.match!.finished; i++) {
      g.setInput(emptyInput());
      g.step();
    }
    const m = g.match!;
    const red = m.breakdown('red');
    const blue = m.breakdown('blue');
    console.log('AI-MENTORES', JSON.stringify({ red, blue }));
    expect(red.samplesAuto + red.samplesTeleop + blue.samplesAuto + blue.samplesTeleop).toBeGreaterThan(0);
  }, 240000);
});
