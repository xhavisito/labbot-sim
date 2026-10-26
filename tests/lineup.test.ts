import { describe, expect, it } from 'vitest';
import { AI_LEVELS, AI_PROFILES } from '../src/ai/difficulty';
import { AI_TYPES, aiLineup } from '../src/ai/lineup';
import { rng } from '../src/core/rng';

describe('tipos de robot de la IA en cada match', () => {
  it('los 3 robots de la IA usan tipos distintos entre sí y del tuyo', () => {
    const rand = rng(7);
    for (let n = 0; n < 50; n++) {
      for (const player of [0, 1, 2, 3]) {
        const types = aiLineup(player, 'pivot', rand);
        expect(types[player]).toBe('pivot');
        const bots = types.filter((_, i) => i !== player);
        expect(new Set(bots).size).toBe(3);
        expect(bots).not.toContain('pivot');
        for (const k of bots) expect(AI_TYPES).toContain(k);
      }
    }
  });

  it('con el chasis (que la IA no usa) o sin jugador, todos los tipos de la IA salen', () => {
    const rand = rng(3);
    expect(new Set(aiLineup(1, 'chassis', rand).filter((_, i) => i !== 1)).size).toBe(3);
    const all = aiLineup(-1, 'generic', rand);
    expect(new Set(all).size).toBe(4);
    expect(all).not.toContain('chassis');
  });

  it('varía de un match a otro', () => {
    const rand = rng(11);
    const seen = new Set<string>();
    for (let n = 0; n < 20; n++) seen.add(aiLineup(0, 'generic', rand).join(','));
    expect(seen.size).toBeGreaterThan(3);
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
