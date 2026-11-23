import { describe, expect, it } from 'vitest';
import { effectiveSecret } from '../src/ai/strategy';

describe('modo secreto en el torneo', () => {
  it('en el torneo siempre está activo, aunque el ajuste esté apagado', () => {
    expect(effectiveSecret(false, true)).toBe(true);
    expect(effectiveSecret(true, true)).toBe(true);
  });
  it('fuera del torneo manda el ajuste', () => {
    expect(effectiveSecret(false, false)).toBe(false);
    expect(effectiveSecret(true, false)).toBe(true);
  });
});
