import { beforeAll, describe, expect, it } from 'vitest';
import { DO_NOTHING } from '../src/auto/AutoRoutine';
import { GameSession } from '../src/game/GameSession';
import { emptyInput, InputManager, type PlayerInput } from '../src/input/InputManager';
import { DEFAULT_BINDINGS } from '../src/input/bindings';
import { initRapier } from '../src/physics/PhysicsWorld';

beforeAll(async () => {
  await initRapier();
});

function fakeWindow() {
  const t = new EventTarget();
  const key = (type: 'keydown' | 'keyup', code: string) => {
    const e = new Event(type) as Event & { code: string; repeat: boolean };
    Object.assign(e, { code, repeat: false });
    t.dispatchEvent(e);
  };
  return { win: t as unknown as Window, key };
}

const still = [DO_NOTHING, DO_NOTHING, DO_NOTHING, DO_NOTHING];

describe('multijugador local: sesión', () => {
  const make = (player: number, player2?: number) => new GameSession({ player, player2, preload: true, autos: still, ai: true });
  const run = (g: GameSession, s: number, a: Partial<PlayerInput>, b: Partial<PlayerInput>) => {
    for (let i = 0; i < s * 120; i++) {
      g.setInput({ ...emptyInput(), ...a });
      g.setInput2({ ...emptyInput(), ...b });
      g.step();
    }
  };

  it('el jugador 2 solo vale en la alianza contraria', () => {
    expect(make(2, 0).player2Index).toBe(0);
    expect(make(2, 3).player2Index).toBe(-1);
    expect(make(2).player2Index).toBe(-1);
    expect(make(2, 0).humans).toEqual([2, 0]);
  });

  it('cada jugador maneja su robot y la IA no toca a ninguno', () => {
    const g = make(2, 0);
    g.startMatch();
    expect(g.bots[0]).toBeNull();
    expect(g.bots[2]).toBeNull();
    expect(g.bots[1]).not.toBeNull();
    g.match!.t = 16;
    g.match!.tick(0);
    const a0 = g.player.phys.position();
    const b0 = g.player2!.phys.position();
    run(g, 0.6, { forward: 1 }, { turn: 1 });
    const a1 = g.player.phys.position();
    const b1 = g.player2!.phys.position();
    expect(Math.hypot(a1.x - a0.x, a1.z - a0.z)).toBeGreaterThan(0.2);
    expect(Math.hypot(b1.x - b0.x, b1.z - b0.z)).toBeLessThan(0.05);
    expect(Math.abs(g.player2!.phys.heading() - 0)).toBeGreaterThan(0.05);
  });

  it('la garra del jugador 2 trabaja solo mientras mantiene el botón', () => {
    const g = make(2, 0);
    g.startMatch();
    g.match!.t = 16;
    g.match!.tick(0);
    run(g, 0.3, {}, { intake: true });
    expect(g.player2!.mech.intakeOn).toBe(true);
    expect(g.player.mech.intakeOn).toBe(false);
    run(g, 0.1, {}, {});
    expect(g.player2!.mech.intakeOn).toBe(false);
  });
});

describe('multijugador local: entrada', () => {
  it('en versus el teclado se reparte: WASD al 1, flechas al 2', () => {
    const { win, key } = fakeWindow();
    const im = new InputManager(DEFAULT_BINDINGS, win);
    im.versus = true;
    key('keydown', 'KeyW');
    key('keydown', 'ArrowLeft');
    key('keydown', 'Enter');
    const p1 = im.poll();
    const p2 = im.poll2();
    expect(p1.forward).toBe(1);
    expect(p1.turn).toBe(0);
    expect(p2.forward).toBe(0);
    expect(p2.turn).toBe(1);
    expect(p2.intake).toBe(true);
    expect(p1.intake).toBe(false);
  });

  it('sin versus las flechas siguen siendo del jugador 1', () => {
    const { win, key } = fakeWindow();
    const im = new InputManager(DEFAULT_BINDINGS, win);
    key('keydown', 'ArrowUp');
    expect(im.poll().forward).toBe(1);
    expect(im.poll2().forward).toBe(0);
  });
});
