import { beforeAll, describe, expect, it } from 'vitest';
import { customFromSpec, customSpec } from '../src/config/customRobots';
import { CHASSIS_ROBOT, TOWER_ROBOT } from '../src/config/robot';
import { initRapier } from '../src/physics/PhysicsWorld';
import { botFor, compareAlliance } from '../src/sim/compare';

beforeAll(async () => {
  await initRapier();
});

describe('comparación de score del editor', () => {
  it('una torre propia anota más que dos chasis contra la misma alianza', async () => {
    const rival = { spec: TOWER_ROBOT, bot: botFor(TOWER_ROBOT) };
    const mine = customSpec(customFromSpec(TOWER_ROBOT, 'Mi torre'));
    let last = 0;
    const a = await compareAlliance({ spec: mine, bot: botFor(mine) }, rival, 1, (f) => (last = f));
    const b = await compareAlliance({ spec: CHASSIS_ROBOT, bot: botFor(CHASSIS_ROBOT) }, rival, 1);
    expect(last).toBe(1);
    expect(a.matches).toBe(1);
    expect(a.samples).toBeGreaterThan(b.samples);
    expect(b.samples).toBe(0);
  }, 60000);
});
