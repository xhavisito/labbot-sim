import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PIVOT_180_ROBOT, PIVOT_ROBOT, type RobotSpec } from '../src/config/robot';
import { GameSession } from '../src/game/GameSession';
import { InputManager, type PlayerInput } from '../src/input/InputManager';
import { DEFAULT_BINDINGS } from '../src/input/bindings';
import { initRapier } from '../src/physics/PhysicsWorld';

/**
 * Sentido de avance (PR #106): el frente del robot es el lado del intake. Con teclado, control y touch,
 * "avanzar" mueve al Pivote 180° hacia su garra (atrás del chasis) y al Pivote normal hacia el frente;
 * lo mismo con cada jugador en la pantalla dividida de 2 jugadores.
 */
beforeAll(async () => {
  await initRapier();
});
afterEach(() => vi.unstubAllGlobals());

const S180 = PIVOT_180_ROBOT;
type Dev = 'keys' | 'pad' | 'touch';

function fakeWindow() {
  const t = new EventTarget();
  const key = (type: 'keydown' | 'keyup', code: string) => {
    const e = new Event(type) as Event & { code: string; repeat: boolean };
    Object.assign(e, { code, repeat: false });
    t.dispatchEvent(e);
  };
  return { win: t as unknown as Window, key };
}

/** Control falso: eje 1 = adelante (−1 es empujar el stick hacia arriba). */
function stubPads(axes: number[][]): void {
  const pad = (a: number[]) => ({ connected: true, axes: a, buttons: Array.from({ length: 17 }, () => ({ pressed: false })) });
  vi.stubGlobal('navigator', { getGamepads: () => axes.map(pad) });
}

/** Desplazamiento del robot a lo largo de su frente de chasis (+ = hacia el lado +x local). */
const along = (g: GameSession, i: number, from: { x: number; z: number }) => {
  const r = g.robots[i];
  const h = r.phys.heading();
  const p = r.phys.position();
  return (p.x - from.x) * Math.cos(h) - (p.z - from.z) * Math.sin(h);
};

function drive(g: GameSession, seconds: number, p1: () => PlayerInput, p2?: () => PlayerInput): void {
  for (let i = 0; i < seconds * 120; i++) {
    g.setInput(p1());
    if (p2) g.setInput2(p2());
    g.step();
  }
}

/** Pone la entrada "adelante" (+) con el dispositivo dado en el InputManager del jugador 1. */
function pressForward(im: InputManager, key: (t: 'keydown' | 'keyup', c: string) => void, dev: Dev): void {
  if (dev === 'keys') key('keydown', 'KeyW');
  else if (dev === 'pad') stubPads([[0, -1, 0, 0]]);
  else im.touch.forward = 1;
}

describe('Pivote 180°: "adelante" va hacia la garra con cada método de entrada', () => {
  for (const dev of ['keys', 'pad', 'touch'] as const) {
    for (const [spec, sign, name] of [[S180, -1, 'Pivote 180°'], [PIVOT_ROBOT, 1, 'Pivote']] as const) {
      it(`${dev}: ${name} se mueve ${sign < 0 ? 'hacia atrás del chasis (la garra)' : 'hacia el frente'}`, () => {
        const { win, key } = fakeWindow();
        const im = new InputManager(DEFAULT_BINDINGS, win);
        const g = new GameSession({ player: 0, preload: false, specs: [spec] });
        g.player.phys.teleport(0, 2.0, 0);
        const p0 = g.player.phys.position();
        pressForward(im, key, dev);
        drive(g, 0.5, () => im.poll());
        expect(im.poll().forward).toBeGreaterThan(0); // la entrada sigue siendo "adelante" (+)
        expect(Math.sign(along(g, 0, p0))).toBe(sign);
        expect(Math.abs(along(g, 0, p0))).toBeGreaterThan(0.1);
      });
    }
  }

  it('"atrás" (−) en el Pivote 180° va hacia el lado contrario: hacia el frente del chasis', () => {
    const { win, key } = fakeWindow();
    const im = new InputManager(DEFAULT_BINDINGS, win);
    const g = new GameSession({ player: 0, preload: false, specs: [S180] });
    g.player.phys.teleport(0, 2.0, 0);
    const p0 = g.player.phys.position();
    key('keydown', 'KeyS');
    drive(g, 0.5, () => im.poll());
    expect(along(g, 0, p0)).toBeGreaterThan(0.1);
  });

  it('el giro no se invierte', () => {
    const { win, key } = fakeWindow();
    const im = new InputManager(DEFAULT_BINDINGS, win);
    const g = new GameSession({ player: 0, preload: false, specs: [S180] });
    g.player.phys.teleport(0, 2.0, 0);
    const h0 = g.player.phys.heading();
    key('keydown', 'KeyJ'); // izquierda = turn +
    drive(g, 0.4, () => im.poll());
    expect(im.poll().turn).toBe(1);
    expect(g.player.phys.heading() - h0).toBeGreaterThan(0.05);
  });
});

describe('2 jugadores (pantalla dividida)', () => {
  // Jugador 1 = robot 0, jugador 2 = robot 1 (compañeros: no chocan al arrancar en carriles distintos)
  const setup = (spec1: RobotSpec, spec2: RobotSpec, p1: Dev, p2: Dev) => {
    const { win, key } = fakeWindow();
    const im = new InputManager(DEFAULT_BINDINGS, win);
    im.versus = true;
    im.layout = { p1: p1 === 'keys' ? 'keys1' : p1 === 'pad' ? 'pad1' : 'touch', p2: p2 === 'keys' ? 'keys2' : p2 === 'pad' ? 'pad2' : 'touch' };
    const g = new GameSession({ player: 0, player2: 1, preload: false, specs: [spec1, spec2] });
    g.robots[0].phys.teleport(-1.5, 2.0, 0);
    g.robots[1].phys.teleport(1.5, 2.0, 0);
    const p = [g.robots[0].phys.position(), g.robots[1].phys.position()];
    // Los dos empujan "adelante" con su dispositivo
    if (p1 === 'keys') key('keydown', 'KeyW');
    if (p2 === 'keys') key('keydown', 'ArrowUp');
    if (p1 === 'touch') im.touch.forward = 1;
    if (p2 === 'touch') im.touch2.forward = 1;
    if (p1 === 'pad' || p2 === 'pad') {
      const up = [0, -1, 0, 0];
      stubPads(p1 === 'pad' && p2 === 'pad' ? [up, up] : [up]);
    }
    drive(g, 0.5, () => im.poll(), () => im.poll2());
    return { g, p, im };
  };

  const combos: Array<[Dev, Dev]> = [['keys', 'keys'], ['pad', 'pad'], ['touch', 'touch'], ['keys', 'touch'], ['touch', 'keys']];
  for (const [d1, d2] of combos) {
    it(`J1 ${d1} + J2 ${d2}: cada robot avanza hacia su propio intake (180° y Pivote mezclados)`, () => {
      const a = setup(S180, PIVOT_ROBOT, d1, d2);
      expect(Math.sign(along(a.g, 0, a.p[0]))).toBe(-1); // J1 en el 180°: hacia la garra
      expect(Math.sign(along(a.g, 1, a.p[1]))).toBe(1); // J2 en el Pivote: al frente
      const b = setup(PIVOT_ROBOT, S180, d1, d2);
      expect(Math.sign(along(b.g, 0, b.p[0]))).toBe(1);
      expect(Math.sign(along(b.g, 1, b.p[1]))).toBe(-1);
    });
  }

  it('los dos con Pivote 180°: ambos van hacia su garra', () => {
    const { g, p } = setup(S180, S180, 'keys', 'keys');
    expect(Math.sign(along(g, 0, p[0]))).toBe(-1);
    expect(Math.sign(along(g, 1, p[1]))).toBe(-1);
  });
});
