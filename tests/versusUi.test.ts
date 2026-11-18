import { describe, expect, it } from 'vitest';
import { emptyInput, InputManager } from '../src/input/InputManager';
import { DEFAULT_BINDINGS, keyLabel } from '../src/input/bindings';
import { sanitizeVersus } from '../src/config/settings';
import { deviceCodes, deviceHelp, devicesClash, lineup, swapStations, versusOutcome } from '../src/ui/versus';

const AUTOS = ['leave'];

function fakeWindow() {
  const t = new EventTarget();
  const key = (type: 'keydown' | 'keyup', code: string) => {
    const e = new Event(type) as Event & { code: string; repeat: boolean };
    Object.assign(e, { code, repeat: false });
    t.dispatchEvent(e);
  };
  return { win: t as unknown as Window, key };
}

describe('2 jugadores: pantallas', () => {
  it('acomodo: quién maneja cada estación según el modo', () => {
    expect(lineup(2, 'opp')).toEqual(['p2', 'ai', 'p1', 'ai']);
    expect(lineup(2, 'same')).toEqual(['ai', 'ai', 'p1', 'p2']);
    expect(lineup(1, 'opp')).toEqual(['ai', 'p1', 'ai', 'p2']);
  });

  it('intercambiar lugares deja a cada quien en la estación del otro', () => {
    for (const team of ['opp', 'same'] as const)
      for (let p = 0; p < 4; p++) {
        const before = lineup(p, team);
        const after = lineup(swapStations(p, team), team);
        expect(after.indexOf('p1')).toBe(before.indexOf('p2'));
        expect(after.indexOf('p2')).toBe(before.indexOf('p1'));
      }
  });

  it('resultado contado para las dos personas', () => {
    expect(versusOutcome('blue', 2, 'opp')).toBe('p1');
    expect(versusOutcome('red', 2, 'opp')).toBe('p2');
    expect(versusOutcome(null, 2, 'opp')).toBe('tie');
    expect(versusOutcome('blue', 3, 'same')).toBe('win');
    expect(versusOutcome('red', 3, 'same')).toBe('loss');
  });

  it('el touch se puede compartir (cada quien en su mitad); teclados y controles no', () => {
    expect(devicesClash('touch', 'touch')).toBe(false);
    expect(devicesClash('keys1', 'keys1')).toBe(true);
    expect(devicesClash('pad1', 'pad2')).toBe(false);
  });

  it('sanea la cámara y acepta touch como dispositivo', () => {
    const v = sanitizeVersus({ p1: { device: 'touch', camera: 'onboard' }, p2: { camera: 'free' } }, AUTOS);
    expect(v.p1.device).toBe('touch');
    expect(v.p1.camera).toBe('onboard');
    expect(v.p2.camera).toBe('follow');
  });

  it('la ayuda de cada dispositivo trae sus teclas reales', () => {
    const im = new InputManager(DEFAULT_BINDINGS, new EventTarget() as unknown as Window);
    const arrows = deviceHelp('keys2', im.deviceKeys('keys2'), DEFAULT_BINDINGS);
    expect(arrows[0].keys.map((k) => k.label)).toEqual(['↑', '↓', '←', '→']);
    expect(arrows[0].keys[0].code).toBe('ArrowUp');
    expect(deviceCodes(im.deviceKeys('keys2')).has('Enter')).toBe(true);
    // WASD no incluye las teclas de flechas (son del jugador 2)
    expect(deviceCodes(im.deviceKeys('keys1')).has('ArrowUp')).toBe(false);
    expect(deviceHelp('pad1', {}, DEFAULT_BINDINGS).length).toBeGreaterThan(2);
    expect(deviceHelp('touch', {}, DEFAULT_BINDINGS).length).toBe(4);
  });

  it('el jugador 2 con touch maneja con sus propios controles en pantalla', () => {
    const im = new InputManager(DEFAULT_BINDINGS, fakeWindow().win);
    im.versus = true;
    im.layout = { p1: 'touch', p2: 'touch' };
    im.touch2.forward = 0.8;
    im.touch2.held.add('intake');
    im.touch2.pressed.add('releaseSample');
    expect(im.poll()).toEqual(emptyInput());
    const p2 = im.poll2();
    expect(p2.forward).toBeCloseTo(0.8);
    expect(p2.intake).toBe(true);
    expect(p2.releaseSample).toBe(true);
    // un toque se usa una vez
    expect(im.poll() && im.poll2().releaseSample).toBe(false);
  });

  it('las teclas de signos se muestran como símbolo', () => {
    expect(keyLabel('Semicolon')).toBe(';');
    expect(keyLabel('Period')).toBe('.');
    expect(keyLabel('NumpadDecimal')).toBe('Num .');
    expect(keyLabel('PageUp')).toBe('RePág');
  });
});
