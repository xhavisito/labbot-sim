/** Hazmat 704 (elevador con intake de compliants, CAD del 17-nov): datos del CAD, límites de §7.2 y que juegue (recoge, sube y anota). */
import { beforeAll, describe, expect, it } from 'vitest';
import { CAD_ROBOT_PROBLEMS, CAD_ROBOT_SPECS } from '../src/cad/cadRobots';
import { allRobotIds, robotSpec } from '../src/config/robotIds';
import { posTip } from '../src/config/robot';
import { GameSession } from '../src/game/GameSession';
import { SAMPLE_SIZE } from '../src/config/field';
import { emptyInput } from '../src/input/InputManager';
import { initRapier } from '../src/physics/PhysicsWorld';
import robotFile from '../robots/hazmat-704.robot.json';

beforeAll(async () => {
  await initRapier();
});

const H = () => CAD_ROBOT_SPECS['hazmat-704'];

describe('Hazmat 704: robot del CAD', () => {
  it('se registra como robot elegible con su logo y su nombre', () => {
    expect(allRobotIds()).toContain('cad:hazmat-704');
    expect(H().label).toBe('Hazmat 704');
    expect(H().mechanism).toBe('elevator');
    expect(H().arm.linear).toBe(true);
    expect(H().model?.url).toBe('robots/hazmat-704.glb');
  });

  it('medidas del CAD: 0.654 × 0.65 m, 4 llantas de 6 in y recorrido del carro de 0.8 m', () => {
    const s = H();
    expect(s.length).toBeCloseTo(0.6535, 3);
    expect(s.width).toBeCloseTo(0.65, 3);
    expect(s.wheel).toMatchObject({ r: 0.0762, xs: [-0.1822, 0.1382] });
    const lo = posTip(s, 0).y;
    const hi = posTip(s, 3).y;
    expect(lo).toBeLessThan(0.05);
    expect(hi - lo).toBeGreaterThan(0.75);
    expect(s.elevatorHeights[3]).toBeLessThanOrEqual(s.arm.pivotY + s.arm.length + 1e-9);
  });

  it('el CAD pasa de 65 cm de largo (con los compliants) y de 100 cm de alto (§7.2): el menú los marca; lo demás cumple', () => {
    expect(CAD_ROBOT_PROBLEMS['hazmat-704']).toEqual(['chasis mayor a 65 × 65 cm (§7.2)', 'más alto que 100 cm (§7.2)']);
  });

  it('lo que el CAD no dice está marcado como SUPUESTO', () => {
    const t = (robotFile as { supuestos: string[] }).supuestos.join('\n');
    expect(t).toMatch(/SUPUESTO: alturas/);
    expect(t).toMatch(/SUPUESTO: capacidad 1/);
    expect(t).toMatch(/masa 40 kg/);
    expect(robotSpec('cad:hazmat-704').intake?.noCritical).toBe(true);
  });
});

describe('Hazmat 704: juega', () => {
  it('con la precarga sube a cada nivel y la Muestra sale de la garra', () => {
    for (const level of [1, 2, 3] as const) {
      const g = new GameSession({ player: 0, preload: true, specs: [H()] });
      const m = g.player.mech;
      g.player.phys.teleport(-1.5, 0, 0);
      for (let i = 0; i < 4 * 120; i++) {
        g.setInput({ ...emptyInput(), elevator: level });
        g.step();
      }
      expect(m.inClaw).toBe(true);
      expect(m.height).toBeCloseTo(H().elevatorHeights[level], 2); // el carro llegó a la altura del nivel
      for (let i = 0; i < 0.1 * 120; i++) {
        g.setInput({ ...emptyInput(), elevator: level, releaseSample: true });
        g.step();
      }
      expect(m.inClaw).toBe(false);
    }
  });

  it('recoge una Muestra del piso con los compliants al frente y no la suelta al subir', () => {
    const g = new GameSession({ player: 0, preload: false, specs: [H()] });
    for (const p of g.pieces.list) if (p.state.at === 'field' && p.kind === 'sample') g.pieces.stash(p, { at: 'hp', alliance: 'red' });
    g.player.phys.teleport(2.6, -1.2, 0);
    const p = g.pieces.list.find((x) => x.kind === 'sample')!;
    g.pieces.place(p, 2.6 + 0.202 + 0.21, SAMPLE_SIZE / 2 + 0.001, -1.2, 0);
    let t = Infinity;
    for (let i = 0; i < 5 * 120; i++) {
      g.setInput({ ...emptyInput(), forward: 0.3, intake: true, elevator: 0 });
      g.step();
      if (g.player.mech.inClaw) { t = i / 120; break; }
    }
    expect(t).toBeLessThan(4);
    for (let i = 0; i < 3 * 120; i++) {
      g.setInput({ ...emptyInput(), elevator: 2 });
      g.step();
    }
    expect(g.player.mech.inClaw).toBe(true);
  });

  it('4 Hazmat de la IA anotan en 100 s y no se levantan ni se inclinan', () => {
    const P = H();
    const g = new GameSession({ player: 0, preload: true, ai: true, specs: [P, P, P, P] });
    g.startMatch();
    let maxTilt = 0;
    for (let i = 0; i < 100 * 120 && !g.match!.finished; i++) {
      g.setInput(emptyInput());
      g.step();
      for (const r of g.robots) maxTilt = Math.max(maxTilt, r.phys.tilt());
    }
    expect(g.match!.score('red') + g.match!.score('blue')).toBeGreaterThan(10);
    expect(maxTilt).toBeLessThan((15 * Math.PI) / 180);
  }, 240000);
});
