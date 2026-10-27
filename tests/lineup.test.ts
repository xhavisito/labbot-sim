import { describe, expect, it } from 'vitest';
import { AI_LEVELS, AI_PROFILES } from '../src/ai/difficulty';
import { AI_TYPES, aiLineup } from '../src/ai/lineup';
import { rng } from '../src/core/rng';

describe('tipos de robot de la IA en cada match', () => {
  it('solo hay pivotes (el original y el de 180°) y la IA usa los dos', () => {
    expect([...AI_TYPES].sort()).toEqual(['pivot', 'pivot180']);
    const rand = rng(7);
    for (let n = 0; n < 50; n++) {
      for (const player of [0, 1, 2, 3]) {
        const types = aiLineup(player, 'pivot', rand);
        expect(types[player]).toBe('pivot');
        const bots = types.filter((_, i) => i !== player);
        // Con 2 tipos y 3 robots se repiten, pero salen los dos
        expect(new Set(bots).size).toBe(2);
        for (const k of bots) expect(AI_TYPES).toContain(k);
      }
    }
  });

  it('sin jugador, la IA usa los dos tipos', () => {
    const all = aiLineup(-1, 'pivot180', rng(3));
    expect(new Set(all).size).toBe(2);
  });

  it('varía de un match a otro', () => {
    const rand = rng(11);
    const seen = new Set<string>();
    for (let n = 0; n < 20; n++) seen.add(aiLineup(0, 'pivot', rand).join(','));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('dificultad de la IA', () => {
  it('cada nivel es al menos tan rápido y ambicioso como el anterior', () => {
    for (let i = 1; i < AI_LEVELS.length; i++) {
      const a = AI_PROFILES[AI_LEVELS[i - 1]];
      const b = AI_PROFILES[AI_LEVELS[i]];
      expect(b.speed).toBeGreaterThanOrEqual(a.speed);
      expect(b.level).toBeGreaterThanOrEqual(a.level);
      expect(b.reaction).toBeLessThanOrEqual(a.reaction);
    }
  });
});
