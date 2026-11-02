import { describe, expect, it } from 'vitest';
import { emptyInput, InputManager } from '../src/input/InputManager';
import { DEFAULT_BINDINGS } from '../src/input/bindings';
import { DEFAULT_SETTINGS, sanitizeVersus } from '../src/config/settings';
import { partnerStation } from '../src/ui/VersusSetup';

const AUTOS = ['leave', 'preload'];

function fakeWindow() {
  const t = new EventTarget();
  const key = (type: 'keydown' | 'keyup', code: string) => {
    const e = new Event(type) as Event & { code: string; repeat: boolean };
    Object.assign(e, { code, repeat: false });
    t.dispatchEvent(e);
  };
  return { win: t as unknown as Window, key };
}

describe('2 jugadores: preparación', () => {
  it('el jugador 2 es el de la alianza contraria o el compañero según el equipo', () => {
    expect(partnerStation(0, 'opp')).toBe(2);
    expect(partnerStation(1, 'opp')).toBe(3);
    expect(partnerStation(2, 'opp')).toBe(0);
    expect(partnerStation(0, 'same')).toBe(1);
    expect(partnerStation(3, 'same')).toBe(2);
  });

  it('los ajustes por defecto son alianzas contrarias con teclado WASD y flechas', () => {
    const v = DEFAULT_SETTINGS.versus;
    expect(v.team).toBe('opp');
    expect(v.p1.device).toBe('keys1');
    expect(v.p2.device).toBe('keys2');
  });

  it('sanea lo guardado: valores raros vuelven al defecto y las posiciones quedan válidas', () => {
    const v = sanitizeVersus({ team: 'nope', p1: { robot: 'nada', auto: 'x', device: 'pad9', start: { dx: 9, dz: 9, turn: 0 } }, p2: { device: 'pad2', auto: 'preload' } }, AUTOS);
    expect(v.team).toBe('opp');
    expect(v.p1.robot).toBe(DEFAULT_SETTINGS.robotType);
    expect(v.p1.auto).toBe('leave');
    expect(v.p1.device).toBe('keys1');
    expect(Math.abs(v.p1.start.dx)).toBeLessThan(9);
    expect(v.p2.device).toBe('pad2');
    expect(v.p2.auto).toBe('preload');
    expect(sanitizeVersus(undefined, AUTOS).team).toBe('opp');
  });

  it('cada persona lee el dispositivo que eligió (WASD o flechas)', () => {
    const { win, key } = fakeWindow();
    const im = new InputManager(DEFAULT_BINDINGS, win);
    im.versus = true;
    im.layout = { p1: 'keys2', p2: 'keys1' };
    key('keydown', 'ArrowUp');
    key('keydown', 'KeyJ');
    expect(im.poll().forward).toBe(1);
    expect(im.poll2().turn).toBe(1);
    expect(im.poll2().forward).toBe(0);
  });

  it('un jugador en control no lee el teclado', () => {
    const { win, key } = fakeWindow();
    const im = new InputManager(DEFAULT_BINDINGS, win);
    im.versus = true;
    im.layout = { p1: 'pad1', p2: 'keys2' };
    key('keydown', 'KeyW');
    expect(im.poll()).toEqual(emptyInput());
  });
});
