import { describe, expect, it } from 'vitest';
import { ACTIONS, assign, clearAction, DEFAULT_BINDINGS, keyLabel, MAX_PER_ACTION, PAD, sanitizeBindings } from '../src/input/bindings';
import { InputManager } from '../src/input/InputManager';
import { keyboardHelp, padHelp } from '../src/ui/controlsHelp';

/** Ventana falsa para el InputManager (Vitest corre sin DOM). */
function fakeWindow() {
  const t = new EventTarget();
  const key = (type: 'keydown' | 'keyup', code: string) => {
    const e = new Event(type) as Event & { code: string; repeat: boolean };
    Object.assign(e, { code, repeat: false });
    t.dispatchEvent(e);
  };
  return { win: t as unknown as Window, key };
}

describe('asignación de controles', () => {
  it('por defecto: cada tecla y botón hace una sola cosa', () => {
    for (const dev of ['keys', 'pad'] as const) {
      const all = ACTIONS.flatMap((a) => DEFAULT_BINDINGS[dev][a] as Array<string | number>);
      expect(new Set(all).size).toBe(all.length);
    }
  });

  it('asignar mueve la tecla de otra acción y respeta el máximo por acción', () => {
    let b = assign(DEFAULT_BINDINGS, 'keys', 'intake', 'KeyE'); // E era "soltar Muestra"
    expect(b.keys.intake).toEqual(['Space', 'KeyE']);
    expect(b.keys.releaseSample).toEqual([]);
    b = assign(b, 'keys', 'intake', 'KeyQ');
    expect(b.keys.intake).toEqual(['KeyE', 'KeyQ']); // se va la más vieja
    expect(b.keys.intake.length).toBeLessThanOrEqual(MAX_PER_ACTION);
    // No cambia el original
    expect(DEFAULT_BINDINGS.keys.intake).toEqual(['Space']);
  });

  it('botones del control y quitar una acción', () => {
    const b = assign(DEFAULT_BINDINGS, 'pad', 'releaseSample', PAD.RT);
    expect(b.pad.releaseSample).toEqual([PAD.B, PAD.RT]);
    expect(clearAction(b, 'pad', 'releaseSample').pad.releaseSample).toEqual([]);
  });

  it('lo guardado se valida: basura → por defecto, repetidos fuera', () => {
    expect(sanitizeBindings(null)).toEqual(DEFAULT_BINDINGS);
    expect(sanitizeBindings({ keys: { forward: [3] }, pad: { pause: ['x'] }, padDrive: 'raro' })).toEqual(DEFAULT_BINDINGS);
    const s = sanitizeBindings({ keys: { forward: ['KeyI'], back: ['KeyI', 'KeyK'] }, padDrive: 'split', invertForward: true });
    expect(s.keys.forward).toEqual(['KeyI']);
    expect(s.keys.back).toEqual(['KeyK']);
    expect(s.padDrive).toBe('split');
    expect(s.invertForward).toBe(true);
  });

  it('nombres cortos de teclas', () => {
    expect(keyLabel('KeyW')).toBe('W');
    expect(keyLabel('Digit3')).toBe('3');
    expect(keyLabel('ArrowUp')).toBe('↑');
  });

  it('la ayuda refleja la asignación', () => {
    const b = assign(DEFAULT_BINDINGS, 'keys', 'intake', 'KeyQ');
    expect(keyboardHelp(b).flatMap((i) => i.keys)).toContain('Q');
    expect(padHelp(DEFAULT_BINDINGS)).toContain('RB');
  });
});

describe('InputManager con asignación', () => {
  it('una tecla reasignada dispara su acción y la vieja ya no', () => {
    const { win, key } = fakeWindow();
    const im = new InputManager(assign(DEFAULT_BINDINGS, 'keys', 'intake', 'KeyQ'), win);
    key('keydown', 'KeyQ');
    expect(im.poll().intake).toBe(true);
    expect(im.poll().intake).toBe(true); // se mantiene mientras siga presionada
    key('keyup', 'KeyQ');
    expect(im.poll().intake).toBe(false);
    key('keydown', 'KeyE'); // las demás teclas no cambian
    expect(im.poll().releaseSample).toBe(true);
    key('keydown', 'KeyW');
    expect(im.poll().forward).toBe(1);
    key('keyup', 'KeyW');
    expect(im.poll().forward).toBe(0);
  });

  it('capturar la siguiente tecla (para reasignar) no dispara acciones; Esc cancela', () => {
    const { win, key } = fakeWindow();
    const im = new InputManager(DEFAULT_BINDINGS, win);
    let got: unknown = 'nada';
    im.captureNext((c) => (got = c));
    key('keydown', 'KeyC'); // cámara por defecto
    expect(got).toEqual({ device: 'keys', code: 'KeyC' });
    expect(im.poll()).toMatchObject({ forward: 0 });
    expect(im.camera).toBe(false);
    im.captureNext((c) => (got = c));
    key('keydown', 'Escape');
    expect(got).toBeNull();
    expect(im.pause).toBe(false);
  });

  it('pausa y cámara salen de la asignación; el touch suma ejes y botones', () => {
    const { win, key } = fakeWindow();
    const im = new InputManager(DEFAULT_BINDINGS, win);
    key('keydown', 'Escape');
    im.poll();
    expect(im.pause).toBe(true);
    im.touch.forward = 0.6;
    im.touch.turn = -0.3;
    im.touch.pressed.add('elevatorUp');
    const inp = im.poll();
    expect(inp.forward).toBeCloseTo(0.6);
    expect(inp.turn).toBeCloseTo(-0.3);
    expect(inp.elevator).toBe(1);
    expect(im.poll().elevator).toBeNull(); // se consumió
  });

  it('la garra del touch trabaja mientras el dedo sigue en el botón', () => {
    const { win } = fakeWindow();
    const im = new InputManager(DEFAULT_BINDINGS, win);
    im.touch.held.add('intake');
    expect(im.poll().intake).toBe(true);
    expect(im.poll().intake).toBe(true);
    im.touch.held.delete('intake');
    expect(im.poll().intake).toBe(false);
  });

  it('la asignación guardada con el nombre viejo (`toggleIntake`) se respeta', () => {
    const b = sanitizeBindings({ keys: { toggleIntake: ['KeyQ'] }, pad: { toggleIntake: [PAD.X] } });
    expect(b.keys.intake).toEqual(['KeyQ']);
    expect(b.pad.intake).toEqual([PAD.X]);
  });
});
