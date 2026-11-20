/**
 * Psycho en AUTO: la flecha del diseñador es el lado del intake. Psycho recoge atrás (`ArmSpec.pickBack`), así que
 * el ejecutor debe llevar ese lado (no el frente del chasis) hacia donde avanza la ruta, igual que al manejar.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DO_NOTHING } from '../src/auto/AutoRoutine';
import { designRoutine, type DesignedAuto } from '../src/auto/designed';
import { robotSpec } from '../src/config/robotIds';
import { GameSession } from '../src/game/GameSession';
import { emptyInput } from '../src/input/InputManager';
import { initRapier } from '../src/physics/PhysicsWorld';

beforeAll(async () => {
  await initRapier();
});

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

describe('Psycho: el intake es el frente de la rutina de AUTO', () => {
  it('avanza con el intake (atrás del chasis) hacia el waypoint y lo prende al llegar', () => {
    const spec = robotSpec('cad:psycho');
    expect(spec.arm.pickBack).toBe(true);
    const d: DesignedAuto = { id: 'p', name: 'p', spline: true, speed: 1, waypoints: [{ x: -1.6, z: 0.495, heading: 0, intake: true }] };
    const g = new GameSession({ player: 2, preload: true, ai: false, specs: [spec, spec, spec, spec], autos: [DO_NOTHING, DO_NOTHING, designRoutine(d), DO_NOTHING] });
    g.startMatch();
    let maxIntakeOn = false;
    for (let i = 0; i < 12 * 120; i++) {
      g.setInput(emptyInput());
      g.step();
      if (g.player.mech.intakeOn) maxIntakeOn = true;
    }
    const p = g.player.phys.position();
    // Llegó (la salida de la zona es x ≈ −2.7) y el intake mira hacia +X: el chasis mira a −X (rumbo π)
    expect(p.x).toBeGreaterThan(-1.8);
    expect(Math.abs(wrap(g.player.phys.heading() - Math.PI))).toBeLessThan(0.3);
    expect(maxIntakeOn).toBe(true);
  });
});
