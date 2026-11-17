import { describe, expect, it } from 'vitest';
import { GAME } from '../src/config/game';
import { Match } from '../src/core/match';
import { buildSummary } from '../src/ui/summaryImage';

describe('resumen del match', () => {
  it('sin faltas: marcador, RP y "Sin faltas"', () => {
    const s = buildSummary(new Match(GAME));
    expect(s.fouls).toEqual(['Sin faltas']);
    expect(s.rows.some((r) => r.section)).toBe(true);
    expect(s.rows.filter((r) => r.bold)).toHaveLength(2);
  });
  it('las faltas llevan su § del manual', () => {
    const m = new Match(GAME);
    m.foul('CONTACT', 'red', 0);
    const s = buildSummary(m);
    expect(s.fouls[0]).toMatch(/Foul · .*\(§/);
  });
  it('recorta la lista larga de faltas', () => {
    const m = new Match(GAME);
    for (let i = 0; i < 20; i++) m.foul('CONTACT', 'blue', 1);
    const s = buildSummary(m);
    expect(s.fouls).toHaveLength(13);
    expect(s.fouls[12]).toContain('8');
  });
});
