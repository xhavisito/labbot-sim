import { beforeAll, describe, expect, it } from 'vitest';
import { SCORE_PRELOAD } from '../src/auto/AutoRoutine';
import { LONG_ARM_ROBOT, PIVOT_180_ROBOT, PIVOT_ROBOT, type RobotSpec } from '../src/config/robot';
import { GameSession } from '../src/game/GameSession';
import { emptyInput } from '../src/input/InputManager';
import { initRapier } from '../src/physics/PhysicsWorld';

beforeAll(async () => {
  await initRapier();
});

/** Match completo de solo IA con la semilla y los robots dados; devuelve las faltas PLATFORM_EARLY (§4.5/4.6). */
function platformFouls(seed: number, specs: RobotSpec[]): number {
  const g = new GameSession({ player: 0, preload: true, ai: true, seed, specs, autos: [SCORE_PRELOAD, SCORE_PRELOAD, SCORE_PRELOAD, SCORE_PRELOAD] });
  g.startMatch();
  for (let i = 0; i < 151 * 120 && !g.match!.finished; i++) {
    g.setInput(emptyInput());
    g.step();
  }
  expect(g.match!.finished).toBe(true);
  return g.match!.fouls.filter((f) => f.rule === 'PLATFORM_EARLY').length;
}

describe('IA y Plataforma antes del ENDGAME (por lotes)', () => {
  const combos: Array<[string, RobotSpec[]]> = [
    ['brazos largos', [LONG_ARM_ROBOT, LONG_ARM_ROBOT, LONG_ARM_ROBOT, LONG_ARM_ROBOT]],
    ['mezcla de pivotes y brazo largo', [LONG_ARM_ROBOT, PIVOT_180_ROBOT, PIVOT_ROBOT, LONG_ARM_ROBOT]],
  ];
  for (const [name, specs] of combos) {
    it(`0 faltas PLATFORM_EARLY con varias semillas (${name})`, () => {
      const bad: Record<number, number> = {};
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const n = platformFouls(seed, specs);
        if (n > 0) bad[seed] = n;
      }
      expect(bad).toEqual({});
    }, 600_000);
  }
});
