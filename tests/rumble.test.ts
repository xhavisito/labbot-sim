import { describe, expect, it, vi } from 'vitest';
import { RUMBLE_PULSES, rumblePad } from '../src/input/rumble';
import { sanitizeSettings } from '../src/config/settings';

describe('rumblePad', () => {
  it('no hace nada sin control o sin vibrationActuator', () => {
    expect(() => rumblePad(null, 'score')).not.toThrow();
    expect(() => rumblePad({} as Gamepad, 'foul')).not.toThrow();
  });

  it('llama playEffect dual-rumble con el patrón de la falta', () => {
    const playEffect = vi.fn(() => Promise.resolve('complete'));
    rumblePad({ vibrationActuator: { playEffect } } as unknown as Gamepad, 'foul');
    expect(playEffect).toHaveBeenCalledWith('dual-rumble', expect.objectContaining({ duration: RUMBLE_PULSES.foul.duration, strongMagnitude: 1 }));
  });

  it('ignora errores del navegador al vibrar', () => {
    const playEffect = vi.fn(() => Promise.reject(new Error('no permitido')));
    expect(() => rumblePad({ vibrationActuator: { playEffect } } as unknown as Gamepad, 'score')).not.toThrow();
  });
});

describe('ajuste rumble', () => {
  it('viene encendido y acepta solo booleanos', () => {
    expect(sanitizeSettings({}, []).rumble).toBe(true);
    expect(sanitizeSettings({ rumble: false }, []).rumble).toBe(false);
    expect(sanitizeSettings({ rumble: 'no' }, []).rumble).toBe(true);
  });
});
