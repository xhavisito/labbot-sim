import { beforeAll, describe, expect, it } from 'vitest';
import { runAiMatch, summarize, type MatchResult } from '../src/ai/bench';
import { Bot } from '../src/ai/Bot';
import { DIFFICULTIES } from '../src/ai/difficulty';
import { initRapier } from '../src/physics/PhysicsWorld';

beforeAll(async () => {
  await initRapier();
});

describe('comparador de dificultades de la IA', () => {
  it('"dificil" son las opciones por defecto de Bot (el juego no cambia)', () => {
    const fake = { alliance: 'red', mech: { capacity: 3 } } as never;
    const def = new Bot(fake, null as never, []).opts;
    const dificil = new Bot(fake, null as never, [], DIFFICULTIES.dificil).opts;
    expect(dificil).toEqual(def);
  });

  it('summarize promedia puntos, faltas y RP por dificultad', () => {
    const side = (difficulty: 'facil' | 'dificil', points: number, fouls: number, rp: number, won: boolean) => ({ difficulty, alliance: 'red' as const, points, fouls, rp, won });
    const rs: MatchResult[] = [
      { sides: [side('dificil', 140, 1, 4, true), side('facil', 100, 0, 1, false)] },
      { sides: [side('dificil', 150, 0, 4, true), side('facil', 90, 2, 1, false)] },
    ];
    const s = Object.fromEntries(summarize(rs).map((x) => [x.difficulty, x]));
    expect(s.dificil).toMatchObject({ matches: 2, wins: 2, avgPoints: 145, avgFouls: 0.5, avgRp: 4 });
    expect(s.facil).toMatchObject({ matches: 2, wins: 0, avgPoints: 95, avgFouls: 1, avgRp: 1 });
  });

  it('un match de solo IA termina y reporta puntos, faltas y RP de ambos lados', () => {
    const r = runAiMatch('dificil', 'facil', true);
    expect(r.sides.map((s) => s.alliance)).toEqual(['red', 'blue']);
    for (const s of r.sides) {
      expect(s.points).toBeGreaterThan(0);
      expect(s.rp).toBeGreaterThanOrEqual(0);
      expect(s.fouls).toBeGreaterThanOrEqual(0);
    }
  }, 120_000);
});
