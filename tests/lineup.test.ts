import { describe, expect, it } from 'vitest';
import { AI_LEVELS, AI_PROFILES } from '../src/ai/difficulty';
import { AI_TYPES, aiLineup } from '../src/ai/lineup';
import { rng } from '../src/core/rng';

describe('tipos de robot de la IA en cada match', () => {
  it('la IA usa solo los robots CAD (Phoenix, Axiom, Psycho, Hazmat 704) y reparte tipos distintos entre sí', () => {
    expect([...AI_TYPES].sort()).toEqual(['cad:axiom', 'cad:hazmat-704', 'cad:phoenix', 'cad:psycho']);
    const rand = rng(7);
    for (let n = 0; n < 50; n++) {
      for (const player of [0, 1, 2, 3]) {
        const types = aiLineup(player, 'cad:psycho', rand);
        expect(types[player]).toBe('cad:psycho');
        const bots = types.filter((_, i) => i !== player);
        // Con 3 tipos disponibles y 3 robots no se repite ninguno ni el del jugador
        expect(new Set(bots).size).toBe(3);
        for (const k of bots) expect(AI_TYPES).toContain(k);
      }
    }
  });

  it('sin jugador, los cuatro robots salen de los robots CAD (tres tipos; se repiten si hace falta)', () => {
    const all = aiLineup(-1, 'cad:axiom', rng(3));
    for (const k of all) expect(AI_TYPES).toContain(k);
    expect(new Set(all).size).toBeGreaterThanOrEqual(3);
  });

  it('varía de un match a otro', () => {
    const rand = rng(11);
    const seen = new Set<string>();
    for (let n = 0; n < 20; n++) seen.add(aiLineup(0, 'cad:psycho', rand).join(','));
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
