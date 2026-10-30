import { beforeAll, describe, expect, it } from 'vitest';
import { planAutoRoutine, planBotOptions, planDriver } from '../src/ai/plan';
import { SECRET_STRATEGIES, weighted } from '../src/ai/strategy';
import { LEAVE_ZONE } from '../src/auto/AutoRoutine';
import { activeStep, newPlan, nextStep, planIssues, sanitizePlan, sanitizePlans, TELEOP_FROM, type StrategyPlan } from '../src/core/plan';
import { GameSession } from '../src/game/GameSession';
import { emptyInput } from '../src/input/InputManager';
import { initRapier } from '../src/physics/PhysicsWorld';
import { obstructZones } from '../src/referee/Referee';

beforeAll(async () => {
  await initRapier();
});

const plan = (f: (p: StrategyPlan) => void): StrategyPlan => {
  const p = newPlan('Prueba', 'p1');
  f(p);
  return sanitizePlan(JSON.parse(JSON.stringify(p)))!;
};

describe('estrategias de alianza (core/plan)', () => {
  it('sanea lo guardado: puntos dentro de la cancha, en AUTO de su lado (§4.2), turnos en orden', () => {
    const p = sanitizePlan({
      id: 'x',
      name: '  Mi plan  ',
      auto: 'volar',
      steps: {
        AUTO: { partner: { route: [{ x: -2, z: 0 }, { x: 9, z: -9 }, 'basura'], source: 'lab', level: 3 } },
        TELEOP: [{ from: 50, partner: {} }, { from: 90 }, { from: 90 }, { from: 77 }],
        ENDGAME: { me: { note: 'x'.repeat(500) } },
      },
    })!;
    expect(p.name).toBe('Mi plan');
    expect(p.auto).toBe('leave');
    expect(p.steps.AUTO.partner.route).toEqual([
      { x: 0.5, z: 0 },
      { x: 4.5, z: -3.5 },
    ]);
    expect(p.steps.AUTO.partner.source).toBe('lab');
    // El primero siempre empieza con el TELEOP; 90 repetido y 77 (no es hora válida) se descartan
    expect(p.steps.TELEOP.map((s) => s.from)).toEqual([TELEOP_FROM, 90]);
    expect(p.steps.ENDGAME.me.note.length).toBe(140);
    expect(sanitizePlan({ name: 'sin id' })).toBeNull();
    expect(sanitizePlans([{ id: 'a' }, { id: 'a' }, null]).length).toBe(1);
  });

  it('da el paso de cada fase y el turno del TELEOP según el reloj', () => {
    const p = plan((x) => {
      x.steps.TELEOP.push({ ...structuredClone(x.steps.TELEOP[0]), from: 90 }, { ...structuredClone(x.steps.TELEOP[0]), from: 60 });
    });
    expect(activeStep(p, 'PRE', 150)).toBeNull();
    expect(activeStep(p, 'AUTO', 140)?.key).toBe('AUTO');
    expect(activeStep(p, 'TELEOP', 135)?.key).toBe('TELEOP0');
    expect(activeStep(p, 'TELEOP', 90.5)?.key).toBe('TELEOP0');
    expect(activeStep(p, 'TELEOP', 90)?.key).toBe('TELEOP1');
    expect(activeStep(p, 'TELEOP', 45)?.key).toBe('TELEOP2');
    expect(activeStep(p, 'ENDGAME', 20)?.key).toBe('ENDGAME');
    expect(activeStep(p, 'DONE', 0)).toBeNull();
  });

  it('pizarra del match: paso que sigue y en cuántos segundos (AUTO → TELEOP 1 → … → ENDGAME)', () => {
    const p = plan((x) => {
      x.steps.TELEOP.push({ ...structuredClone(x.steps.TELEOP[0]), from: 90 });
    });
    expect(nextStep(p, 'PRE', 150)).toBeNull();
    expect(nextStep(p, 'AUTO', 140)).toMatchObject({ key: 'TELEOP0', in: 5 });
    expect(nextStep(p, 'PAUSE', 135)).toMatchObject({ key: 'TELEOP0', in: 0 });
    expect(nextStep(p, 'TELEOP', 94)).toMatchObject({ key: 'TELEOP1', turn: 1, in: 4 });
    expect(nextStep(p, 'TELEOP', 60)).toMatchObject({ key: 'ENDGAME', in: 30 });
    expect(nextStep(p, 'ENDGAME', 20)).toBeNull();
    expect(nextStep(p, 'DONE', 0)).toBeNull();
  });

  it('avisa de Plataforma antes del ENDGAME, zonas rivales (§4.6, D17) y AUTO sin salir de la zona (§4.4)', () => {
    const p = plan((x) => {
      x.steps.AUTO.partner.route = [{ x: 3.4, z: 0.5 }];
      x.steps.TELEOP[0].me.route = [{ x: 0.2, z: 0.1 }];
      x.steps.TELEOP[0].partner.zone = { x0: -3.9, x1: -2, z0: -3.4, z1: -2.5 };
      x.steps.ENDGAME.partner.route = [{ x: 0.5, z: 0.3 }];
    });
    const codes = planIssues(p, obstructZones('blue')).map((i) => `${i.key}:${i.code}`);
    expect(codes).toContain('TELEOP0:platform');
    expect(codes).toContain('TELEOP0:rivalZone');
    expect(codes).toContain('AUTO:noLeave');
    expect(codes.some((c) => c.startsWith('ENDGAME'))).toBe(false);
  });

  it('la guía del compañero gira el plan 180° para azul', () => {
    const p = plan((x) => {
      x.steps.TELEOP[0].partner.route = [{ x: 1, z: 2 }];
      x.steps.TELEOP[0].partner.zone = { x0: 1, x1: 2, z0: 0.5, z1: 1 };
      x.steps.TELEOP[0].partner.level = 2;
    });
    const d = planDriver(p, 'blue').at('TELEOP', 100)!;
    expect(d.route).toEqual([{ x: -1, z: -2 }]);
    expect(d.zone).toEqual({ x0: -2, x1: -1, z0: -1, z1: -0.5 });
    expect(d.level).toBe(2);
    expect(d.source).toBeUndefined();
    expect(planAutoRoutine(p)).toBe(LEAVE_ZONE);
  });

  it('la estrategia secreta de un rival sale con sus pesos', () => {
    const seq = [0, 0.999];
    let k = 0;
    const rand = () => seq[k++];
    expect(weighted(SECRET_STRATEGIES, rand)).toBe('auto');
    expect(weighted(SECRET_STRATEGIES, rand)).toBe('noEndgame');
  });
});

describe('la IA del compañero sigue la estrategia', () => {
  it('recorre su ruta de AUTO sin cruzar la línea central y la de cada turno del TELEOP', () => {
    const p = plan((x) => {
      x.auto = 'leave';
      x.steps.AUTO.partner.route = [{ x: 2.2, z: 1.2 }, { x: 1.2, z: 2.4 }];
      x.steps.TELEOP.push({ ...structuredClone(x.steps.TELEOP[0]), from: 90 });
      x.steps.TELEOP[1].partner.route = [{ x: 1.5, z: -2.3 }];
    });
    // Juegas el azul 1 (índice 2) quieto: tu compañero es el azul 2 (índice 3)
    const autos = [LEAVE_ZONE, LEAVE_ZONE, LEAVE_ZONE, planAutoRoutine(p)];
    const g = new GameSession({ player: 2, preload: true, ai: true, autos, bots: [undefined, undefined, undefined, { ...planBotOptions(p, 'blue'), ai: 'hard' }] });
    g.startMatch();
    const mate = g.robots[3];
    const target = { auto: { x: -1.2, z: -2.4 }, turn: { x: -1.5, z: 2.3 } };
    let minAuto = Infinity;
    let minTurn = Infinity;
    let maxX = -Infinity;
    let moved = false;
    for (let i = 0; i < 70 * 120 && !g.match!.finished; i++) {
      g.setInput(emptyInput());
      g.step();
      const q = mate.phys.position();
      const m = g.match!;
      // Tu robot quieto, fuera del camino de la ruta del TELEOP (si estorba, el compañero la rodea y
      // el resultado depende de por qué lado se va)
      if (m.phase === 'TELEOP' && !moved) {
        g.player.phys.teleport(-2.2, -1.4, 0);
        moved = true;
      }
      if (m.phase === 'AUTO') {
        maxX = Math.max(maxX, q.x);
        minAuto = Math.min(minAuto, Math.hypot(q.x - target.auto.x, q.z - target.auto.z));
      }
      if (m.phase === 'TELEOP' && m.remaining <= 90 && m.remaining > 78) minTurn = Math.min(minTurn, Math.hypot(q.x - target.turn.x, q.z - target.turn.z));
    }
    expect(minAuto).toBeLessThan(0.45);
    // Azul está en −X: en AUTO nunca pasa al lado rojo (§4.2)
    expect(maxX).toBeLessThan(0);
    expect(g.match!.breakdown('blue').autoLine).toBeGreaterThanOrEqual(5);
    expect(minTurn).toBeLessThan(0.45);
    expect(g.match!.fouls.filter((f) => f.robot === 3 && (f.rule === 'AUTO_CENTER' || f.rule === 'PLATFORM_EARLY'))).toEqual([]);
  }, 120_000);
});
