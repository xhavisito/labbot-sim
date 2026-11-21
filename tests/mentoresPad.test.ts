/** Botones por defecto de Mentores 3478 (pedido de Xhavi): solo ese robot cambia. */
import { describe, expect, it } from 'vitest';
import { ACTIONS, DEFAULT_BINDINGS, PAD, cloneBindings, padFor } from '../src/input/bindings';

describe('botones por robot', () => {
  it('Mentores 3478: LB/RB/A/B/Y = posiciones del brazo, LT comer, RT soltar, cruceta sube y baja', () => {
    const P = padFor(DEFAULT_BINDINGS, 'cad:mentores-3478');
    expect(P.elevator4).toEqual([PAD.LB]);
    expect(P.elevator0).toEqual([PAD.RB]);
    expect(P.elevator1).toEqual([PAD.A]);
    expect(P.elevator2).toEqual([PAD.B]);
    expect(P.elevator3).toEqual([PAD.Y]);
    expect(P.intake).toEqual([PAD.LT]);
    expect(P.releaseSample).toEqual([PAD.RT]);
    expect(P.elevatorUp).toEqual([PAD.UP]);
    expect(P.elevatorDown).toEqual([PAD.DOWN]);
  });

  it('ningún botón hace dos cosas en Mentores', () => {
    const P = padFor(DEFAULT_BINDINGS, 'cad:mentores-3478');
    const all = ACTIONS.flatMap((a) => P[a]);
    expect(new Set(all).size).toBe(all.length);
  });

  it('los demás robots no cambian (mismo objeto de botones)', () => {
    expect(padFor(DEFAULT_BINDINGS, 'cad:phoenix')).toBe(DEFAULT_BINDINGS.pad);
    expect(padFor(DEFAULT_BINDINGS, '')).toBe(DEFAULT_BINDINGS.pad);
  });

  it('en Mentores, lo del usuario sigue en las acciones que el robot no toca, sin botones repetidos', () => {
    const b = cloneBindings(DEFAULT_BINDINGS);
    b.pad.camera = [PAD.X];
    const P = padFor(b, 'cad:mentores-3478');
    expect(P.camera).toEqual([PAD.X]);
    expect(P.pause).toEqual(DEFAULT_BINDINGS.pad.pause);
    const all = ACTIONS.flatMap((a) => P[a]);
    expect(new Set(all).size).toBe(all.length);
  });
});
