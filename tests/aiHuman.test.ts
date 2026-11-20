import { beforeAll, describe, expect, it } from 'vitest';
import type { Bot } from '../src/ai/Bot';
import { AI_PROFILES } from '../src/ai/difficulty';
import { GameSession } from '../src/game/GameSession';
import { DUAL_INTAKE_ROBOT } from '../src/config/robot';
import { initRapier } from '../src/physics/PhysicsWorld';

beforeAll(async () => {
  await initRapier();
});

/** Un match de IA recién empezado: devuelve la sesión y el Bot de la estación `i` (por dentro, para medir sus decisiones). */
function bots(level: 'easy' | 'normal' | 'hard' | 'expert') {
  const g = new GameSession({ player: 0, preload: true, ai: true, aiLevel: level, specs: [DUAL_INTAKE_ROBOT, DUAL_INTAKE_ROBOT, DUAL_INTAKE_ROBOT, DUAL_INTAKE_ROBOT] });
  g.startMatch();
  return { g, bot: (i: number) => (g as unknown as { bots: Bot[] }).bots[i] as unknown as Record<string, (...a: unknown[]) => never> & Bot };
}
const call = <T>(b: unknown, name: string, ...a: unknown[]): T => (b as Record<string, (...x: unknown[]) => T>)[name](...a);
const set = (b: unknown, k: string, v: unknown) => ((b as Record<string, unknown>)[k] = v);

describe('IA con reacciones y errores de piloto (SUPUESTOS de diseño)', () => {
  it('la dificultad sube la precisión: menos duda, menos error y más lectura del partido', () => {
    const p = AI_PROFILES;
    expect(p.easy.reaction + p.easy.jitter).toBeGreaterThan(p.normal.reaction + p.normal.jitter);
    expect(p.normal.reaction + p.normal.jitter).toBeGreaterThan(p.hard.reaction + p.hard.jitter);
    expect(p.easy.aim).toBeGreaterThan(p.normal.aim);
    expect(p.normal.aim).toBeGreaterThan(p.hard.aim);
    expect(p.easy.clutch).toBe(0);
    expect(p.hard.clutch).toBe(1);
    // Difícil duda entre 150 y 300 ms (lo que tarda una persona en decidir)
    expect(p.hard.reaction).toBeGreaterThanOrEqual(0.15);
    expect(p.hard.reaction + p.hard.jitter).toBeLessThanOrEqual(0.3);
  });

  it('el Dominio de Cámara (≥10): si le faltan pocas, junta solo las justas y las anota ya', () => {
    const { bot } = bots('hard');
    const b = bot(1);
    set(b.team, 'situation', () => ({ lead: 0, samples: 9, need: 10 }));
    expect(call<number>(b, 'batchSize')).toBe(1); // le falta 1: no espera a la segunda
    set(b.team, 'situation', () => ({ lead: 0, samples: 0, need: 10 }));
    expect(call<number>(b, 'batchSize')).toBe(2);
  });

  it('sin marcador (Fácil) no cambia sus tandas ni su margen', () => {
    const { bot } = bots('easy');
    const b = bot(1);
    set(b.team, 'situation', () => ({ lead: 99, samples: 9, need: 10 }));
    expect(call<number>(b, 'batchSize')).toBe(Math.min(b.robot.mech.capacity, AI_PROFILES.easy.batch));
    expect(call<number>(b, 'climbMargin')).toBe(AI_PROFILES.easy.climbMargin);
  });

  it('al final del match hace tandas más cortas, y el margen de la Plataforma depende del marcador', () => {
    const { bot } = bots('hard');
    const b = bot(1);
    set(b.team, 'situation', () => ({ lead: 0, samples: 0, need: 10 }));
    set(b, 'clock', 200);
    const early = call<number>(b, 'batchSize');
    set(b, 'clock', 40);
    expect(call<number>(b, 'batchSize')).toBeLessThanOrEqual(early);
    set(b.team, 'situation', () => ({ lead: 60, samples: 0, need: 10 }));
    const ahead = call<number>(b, 'climbMargin');
    set(b.team, 'situation', () => ({ lead: -40, samples: 0, need: 10 }));
    const behind = call<number>(b, 'climbMargin');
    expect(ahead).toBeGreaterThan(behind);
    expect(behind).toBeGreaterThanOrEqual(1.2);
  });

  it('no va por una Muestra a la que un rival llega mucho antes', () => {
    const { g, bot } = bots('hard');
    const b = bot(1);
    const me = g.robots[1].phys.position();
    const rival = g.robots[2].phys.position();
    const at = { x: rival.x, z: rival.z };
    const myEta = Math.hypot(me.x - at.x, me.z - at.z) / 1.5;
    expect(call<number>(b, 'contestCost', at, myEta)).toBeGreaterThan(0);
    // Con Fácil no mira a los rivales
    const e = bots('easy').bot(1);
    expect(call<number>(e, 'contestCost', at, myEta)).toBe(0);
  });

  it('es reproducible: el mismo match da el mismo marcador', () => {
    const run = () => {
      const { g } = bots('normal');
      for (let i = 0; i < 40 * 120; i++) g.step();
      return [g.match!.score('red'), g.match!.score('blue')];
    };
    expect(run()).toEqual(run());
  }, 120_000);
});
