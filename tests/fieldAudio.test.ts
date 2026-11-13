import { describe, expect, it } from 'vitest';
import { cueFor } from '../src/audio/FieldAudio';
import { DEFAULT_SETTINGS, sanitizeSettings, SETTINGS_RANGE } from '../src/config/settings';

describe('sonidos del campo', () => {
  it('cada inicio de periodo toca su cue de FRC', () => {
    expect(cueFor({ type: 'phase', phase: 'AUTO', prev: 'PRE' })).toBe('start');
    expect(cueFor({ type: 'phase', phase: 'TELEOP', prev: 'AUTO' })).toBe('teleop');
    expect(cueFor({ type: 'phase', phase: 'ENDGAME', prev: 'TELEOP' })).toBe('endgame');
    expect(cueFor({ type: 'end' })).toBe('end');
  });

  it('DONE no repite el buzzer del fin (ya lo toca el evento end) y otros eventos no suenan', () => {
    expect(cueFor({ type: 'phase', phase: 'DONE', prev: 'ENDGAME' })).toBeNull();
    expect(cueFor({ type: 'autoLine', alliance: 'red', robot: 0 })).toBeNull();
  });

  it('el volumen se recorta a 0–100 y por defecto suena', () => {
    expect(DEFAULT_SETTINGS.volume).toBeGreaterThan(0);
    expect(sanitizeSettings({ volume: 250 }, []).volume).toBe(SETTINGS_RANGE.volume.max);
    expect(sanitizeSettings({ volume: -5 }, []).volume).toBe(0);
    expect(sanitizeSettings({ volume: 'fuerte' }, []).volume).toBe(DEFAULT_SETTINGS.volume);
  });
});
