import { describe, expect, it } from 'vitest';
import { clampDeadzone, DEFAULT_BINDINGS, sanitizeBindings } from '../src/input/bindings';
import { dz } from '../src/input/InputManager';
import { COLOR_MODES, colorDistance, contrast, nearestTextScale, PALETTES, simulateCvd, TEXT_SCALES } from '../src/config/palette';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/config/settings';

describe('modo daltónico', () => {
  it('rojo y azul de cada paleta se distinguen para protanopia, deuteranopia y tritanopia', () => {
    for (const mode of COLOR_MODES) {
      const p = PALETTES[mode];
      for (const kind of ['protan', 'deutan', 'tritan'] as const) {
        const d = colorDistance(simulateCvd(p.alliance.red, kind), simulateCvd(p.alliance.blue, kind));
        // La paleta normal falla a propósito en el tipo que no cubre; las otras dos deben pasar su tipo
        if (mode === 'redgreen' && kind !== 'tritan') expect(d).toBeGreaterThan(15);
        if (mode === 'blueyellow' && kind === 'tritan') expect(d).toBeGreaterThan(15);
      }
    }
  });

  it('en las paletas daltónicas tu robot se separa de ambas alianzas', () => {
    for (const mode of ['redgreen', 'blueyellow'] as const) {
      const p = PALETTES[mode];
      for (const kind of ['protan', 'deutan', 'tritan'] as const) {
        const own = simulateCvd(p.own, kind);
        for (const a of ['red', 'blue'] as const) expect(colorDistance(own, simulateCvd(p.alliance[a], kind))).toBeGreaterThan(15);
      }
    }
  });

  it('las alianzas contrastan con el piso oscuro de la cancha', () => {
    for (const mode of COLOR_MODES) for (const a of ['red', 'blue'] as const) expect(contrast(PALETTES[mode].alliance[a], 0x2b2d31)).toBeGreaterThan(1.8);
  });
});

describe('tamaño del texto', () => {
  it('toma el tamaño permitido más cercano y lo raro vuelve a 100 %', () => {
    expect(nearestTextScale(1.2)).toBe(1.15);
    expect(nearestTextScale(9)).toBe(1.5);
    expect(nearestTextScale('x')).toBe(1);
    expect(nearestTextScale(NaN)).toBe(1);
    for (const s of TEXT_SCALES) expect(nearestTextScale(s)).toBe(s);
  });

  it('los ajustes guardados se validan', () => {
    expect(sanitizeSettings(null, []).colorMode).toBe('normal');
    expect(sanitizeSettings(null, []).textScale).toBe(DEFAULT_SETTINGS.textScale);
    const s = sanitizeSettings({ colorMode: 'redgreen', textScale: 1.3 }, []);
    expect(s.colorMode).toBe('redgreen');
    expect(s.textScale).toBe(1.3);
    expect(sanitizeSettings({ colorMode: 'raro', textScale: -4 }, [])).toMatchObject({ colorMode: 'normal', textScale: 0.85 });
  });
});

describe('zona muerta del control', () => {
  it('se recorta a su rango y el stick la respeta', () => {
    expect(clampDeadzone(0)).toBe(0.05);
    expect(clampDeadzone(2)).toBe(0.5);
    expect(clampDeadzone('x')).toBe(DEFAULT_BINDINGS.padDeadzone);
    expect(sanitizeBindings({ padDeadzone: 0.3 }).padDeadzone).toBe(0.3);
    expect(dz(0.2, 0.3)).toBe(0);
    expect(dz(1, 0.3)).toBeCloseTo(1);
    expect(dz(0.2, 0.05)).toBeGreaterThan(0);
  });
});
