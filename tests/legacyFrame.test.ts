import { describe, expect, it } from 'vitest';
import { rle, sanitizeRoute } from '../src/auto/recorded';
import { CAMARA_FRAME, frameOf, isLegacyFrame, newPath, sanitizePath, sanitizePaths } from '../src/core/autoPath';

/** Rutas guardadas antes del PR #104 (la Cámara cambió de dueño): sin `frame` = marco viejo, se avisa. */
describe('marco de la Cámara en rutas de AUTO guardadas', () => {
  it('lo guardado sin versión es del marco viejo y se avisa; lo nuevo no', () => {
    expect(isLegacyFrame(undefined)).toBe(true);
    expect(isLegacyFrame(1)).toBe(true);
    expect(isLegacyFrame(CAMARA_FRAME)).toBe(false);
    expect(newPath('x').frame).toBe(CAMARA_FRAME);
  });

  it('frameOf sanea valores raros como marco viejo', () => {
    for (const v of ['2', 2.5, -1, 0, NaN, null, {}, 99]) expect(frameOf(v)).toBe(1);
    expect(frameOf(CAMARA_FRAME)).toBe(CAMARA_FRAME);
  });

  it('rutina dibujada vieja: se conserva tal cual (sin mover puntos) y queda marcada', () => {
    const old = { id: 'viejo', name: 'Vieja', updated: 5, station: 0, points: [{ x: 3, z: 1.5, release: true }] };
    const p = sanitizePath(old)!;
    expect(isLegacyFrame(p.frame)).toBe(true);
    expect(p.points[0].x).toBe(3);
    expect(p.points[0].z).toBe(1.5);
    expect(isLegacyFrame(sanitizePath({ ...old, frame: CAMARA_FRAME })!.frame)).toBe(false);
  });

  it('el marco sobrevive guardar y volver a leer; marcar como revisada lo actualiza', () => {
    const p = sanitizePath({ id: 'a', points: [] })!;
    expect(isLegacyFrame(p.frame)).toBe(true);
    p.frame = CAMARA_FRAME;
    const back = sanitizePaths(JSON.parse(JSON.stringify([p])))[0];
    expect(isLegacyFrame(back.frame)).toBe(false);
  });

  it('ruta grabada vieja: se conserva y queda marcada; la nueva con marco actual no', () => {
    const track = { hz: 120, forward: rle([0, 500]), turn: rle([0, 0]), actions: [] };
    const old = sanitizeRoute({ id: 'r1', name: 'Vieja', station: 0, track })!;
    expect(isLegacyFrame(old.frame)).toBe(true);
    expect(old.track.forward).toEqual([0, 500]);
    expect(isLegacyFrame(sanitizeRoute({ id: 'r2', frame: CAMARA_FRAME, track })!.frame)).toBe(false);
  });
});
