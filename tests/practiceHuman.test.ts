import { beforeAll, describe, expect, it } from 'vitest';
import { DO_NOTHING } from '../src/auto/AutoRoutine';
import { CycleTracker } from '../src/game/cycleTracker';
import { GameSession } from '../src/game/GameSession';
import { initRapier } from '../src/physics/PhysicsWorld';
import { sanitizePractice } from '../src/config/settings';
import { emptyInput } from '../src/input/InputManager';

beforeAll(async () => {
  await initRapier();
});

const still = [DO_NOTHING, DO_NOTHING, DO_NOTHING, DO_NOTHING];

/** Práctica 1 contra 1 con el rival elegido (como `App.practice1v1Options`). */
const practice = (player: number, rival: 'none' | 'passive' | 'ai' | 'human') =>
  new GameSession({ player, preload: true, solo: true, ai: false, autos: still, rival });

describe('práctica 1 contra 1: otra persona como rival', () => {
  it('la configuración guarda "otra persona" y deja pasar los valores válidos', () => {
    expect(sanitizePractice({ rival: 'human' }).rival).toBe('human');
    expect(sanitizePractice({ rival: 'alien' }).rival).toBe('passive');
  });

  it('el rival humano queda en la otra alianza y es el jugador 2 (misma pantalla)', () => {
    const g = practice(0, 'human');
    expect(g.rivalIndex).toBe(2);
    expect(g.player2Index).toBe(2);
    expect(g.player2?.index).toBe(2);
    expect(g.humans).toEqual([0, 2]);
    expect(g.duel).toBe(true);
  });

  it('con IA o quieto no hay jugador 2, y sin rival tampoco', () => {
    for (const rival of ['ai', 'passive', 'none'] as const) {
      const g = practice(1, rival);
      expect(g.player2Index).toBe(-1);
      expect(g.player2).toBeNull();
    }
    expect(practice(1, 'ai').duel).toBe(true);
    expect(practice(1, 'passive').duel).toBe(false);
  });

  it('cada jugador tiene su propio cronómetro de ciclos', () => {
    const g = practice(0, 'human');
    const mine = new CycleTracker(g, null);
    const theirs = new CycleTracker(g, null, g.player2Index);
    expect(mine.who).toBe(0);
    expect(theirs.who).toBe(2);
    for (let i = 0; i < 120; i++) {
      g.setInput(emptyInput());
      g.setInput2(emptyInput());
      g.step();
      mine.step(g, [], []);
      theirs.step(g, [], []);
    }
    expect(mine.time).toBeCloseTo(1, 2);
    expect(theirs.time).toBeCloseTo(1, 2);
  });
});
