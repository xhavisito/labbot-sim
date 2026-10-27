import { beforeAll, describe, expect, it } from 'vitest';
import { customFromSpec, customSpec } from '../src/config/customRobots';
import { PIVOT_ROBOT } from '../src/config/robot';
import { initRapier } from '../src/physics/PhysicsWorld';
import { botFor, compareAlliance } from '../src/sim/compare';

beforeAll(async () => {
  await initRapier();
});

describe('comparación de score del editor', () => {
  it('un pivote propio anota y uno lento anota menos contra la misma alianza', async () => {
    const rival = { spec: PIVOT_ROBOT, bot: botFor(PIVOT_ROBOT) };
    const mine = customSpec(customFromSpec(PIVOT_ROBOT, 'Mi pivote'));
    const slow = { ...mine, maxSpeed: 0.6, accel: 1.2 };
    let last = 0;
    const a = await compareAlliance({ spec: mine, bot: botFor(mine) }, rival, 1, (f) => (last = f));
    const b = await compareAlliance({ spec: slow, bot: botFor(slow) }, rival, 1);
    expect(last).toBe(1);
    expect(a.matches).toBe(1);
    expect(a.samples).toBeGreaterThan(0);
    expect(a.samples).toBeGreaterThan(b.samples);
  }, 60000);
});
