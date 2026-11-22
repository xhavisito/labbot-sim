/** Estratega de alianza de la IA nueva (`ai/Team.ts`) y lo que el Bot aprende en el match (`levelOdds`). */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Bot } from '../src/ai/Bot';
import { PLAYBOOKS, Team, critPrior } from '../src/ai/Team';
import { CAD_ROBOT_SPECS } from '../src/cad/cadRobots';
import { ROBOT_PRESETS } from '../src/config/robot';
import { GameSession } from '../src/game/GameSession';
import { emptyInput } from '../src/input/InputManager';
import { initRapier } from '../src/physics/PhysicsWorld';

beforeAll(async () => {
  await initRapier();
});

/** Bot mínimo: solo lo que lee `Team.plan` (`pps` = puntos por segundo que va anotando en este match). */
const stub = (index: number, pps = 0, capacity = 1, kind: keyof typeof ROBOT_PRESETS = 'pivot'): Bot =>
  ({
    robot: { index, spec: ROBOT_PRESETS[kind], mech: { critical: null, capacity } },
    opts: { role: 'score', teleop: true },
    profile: { critical: true, teamwork: true },
    pointsPerSecond: () => pps,
  }) as unknown as Bot;

describe('Team: decide por lo que vale cada cosa en el match', () => {
  it('la Crítica la lleva quien más gana con ella; si anotar rinde más que la Crítica, nadie va', () => {
    const t = new Team('red');
    const fast = stub(0, 1.5);
    const slow = stub(1, 0.2);
    t.join(fast);
    t.join(slow);
    expect(t.critBy).toBe(1); // el rápido sigue anotando
    expect(t.critGain(fast)).toBeLessThan(t.critGain(slow));
    // Los dos anotan tanto que 35 pts + el RP no compensan ~17 s sin anotar
    const busy = new Team('red');
    busy.join(stub(0, 4));
    busy.join(stub(1, 4));
    expect(busy.critBy).toBeNull();
  });

  it('si un robot falla la Crítica ya no se la asigna y pasa al compañero', () => {
    const t = new Team('red');
    t.join(stub(0, 0.2));
    t.join(stub(1, 0.3));
    const first = t.critBy;
    expect(first).not.toBeNull();
    t.critFailed(first as number);
    expect(t.critBy).not.toBe(first);
    expect(t.critBy).not.toBeNull();
    t.critFailed(t.critBy as number);
    expect(t.critBy).toBeNull();
  });

  it('sube a la Plataforma salvo que en ese tiempo anote más de lo que vale subir (10 pts, §4.4)', () => {
    const t = new Team('red');
    expect(t.climbWorth(stub(0, 0.3), 10)).toBe(true);
    expect(t.climbWorth(stub(0, 3), 10)).toBe(false);
  });

  it('el robot que más guarda atiende la Campana; con el plan "feeder", el que menos rinde en el Laboratorio', () => {
    const t = new Team('red');
    t.join(stub(0, 0.9, 1));
    t.join(stub(1, 0.2, 2));
    expect(t.hpBy).toBe(1);
    const f = new Team('red');
    f.choosePlaybook('feeder');
    f.join(stub(0, 0.1, 1));
    f.join(stub(1, 1.2, 2));
    expect(f.hpBy).toBe(0);
  });

  it('el plan del match cambia entre matches (no siempre el mismo patrón)', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 40; seed++) seen.add(new Team('red', undefined, seed).choosePlaybook());
    expect([...seen].sort()).toEqual(PLAYBOOKS.map(([p]) => p).sort());
    // Misma semilla → mismo plan (los matches se pueden repetir para depurar)
    expect(new Team('blue', undefined, 7).choosePlaybook()).toBe(new Team('blue', undefined, 7).choosePlaybook());
  });

  it('la probabilidad inicial de la Crítica sale de cómo la agarra cada robot del CAD', () => {
    expect(critPrior(CAD_ROBOT_SPECS.psycho)).toBeGreaterThan(critPrior(CAD_ROBOT_SPECS.axiom));
    expect(critPrior(CAD_ROBOT_SPECS.axiom)).toBeGreaterThan(critPrior(CAD_ROBOT_SPECS['mentores-3478']));
  });
});

describe('Bot: aprende en el match qué nivel le entra', () => {
  it('los fallos en un nivel bajan su probabilidad y los aciertos la suben', () => {
    const g = new GameSession({ player: 3, preload: true, ai: true });
    g.startMatch();
    g.setInput(emptyInput());
    g.step();
    const bot = g.bots[0] as unknown as { levelOdds(l: number): number; levelStats: Map<number, { tries: number; ok: number }> };
    const p0 = bot.levelOdds(3);
    bot.levelStats.set(3, { tries: 4, ok: 0 });
    expect(bot.levelOdds(3)).toBeLessThan(p0 / 2);
    bot.levelStats.set(3, { tries: 4, ok: 4 });
    expect(bot.levelOdds(3)).toBeGreaterThan(0.9);
    g.dispose();
  });
});
