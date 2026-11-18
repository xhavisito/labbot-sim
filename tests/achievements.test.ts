import { describe, expect, it } from 'vitest';
import { GAME } from '../src/config/game';
import { ACHIEVEMENTS, emptyAch, matchFacts, parseAch, recordMatch, type MatchFacts } from '../src/core/achievements';
import { Match } from '../src/core/match';

const facts = (o: Partial<MatchFacts> = {}): MatchFacts => ({
  won: false, tie: false, score: 0, samples: [0, 0, 0], samplesAuto: 0, allianceSamples: 0, autoLine: false, bothAutoLine: false,
  onPlatform: false, bothPlatform: false, critical: false, dominance: false, fouls: 0, cards: 0, redCard: false, rp: 0, ...o,
});

describe('logros (§2, §4.4)', () => {
  it('cada logro tiene sección del manual y meta positiva', () => {
    for (const a of ACHIEVEMENTS) {
      expect(a.section).toMatch(/§/);
      expect(a.progress(emptyAch()).goal).toBeGreaterThan(0);
    }
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
  });

  it('el primer match da "Primer match" y no se repite', () => {
    const a = recordMatch(emptyAch(), facts());
    expect(a.earned.map((x) => x.id)).toContain('firstMatch');
    expect(recordMatch(a.progress, facts()).earned.map((x) => x.id)).not.toContain('firstMatch');
  });

  it('primera Muestra Crítica, Dominio y 20 de Plataforma', () => {
    let p = emptyAch();
    const r = recordMatch(p, facts({ critical: true, dominance: true, onPlatform: true }));
    expect(r.earned.map((x) => x.id)).toEqual(expect.arrayContaining(['firstCritical', 'dominance', 'platform']));
    p = r.progress;
    for (let i = 0; i < 18; i++) p = recordMatch(p, facts({ onPlatform: true })).progress;
    expect(p.unlocked.platform20).toBeUndefined();
    expect(recordMatch(p, facts({ onPlatform: true })).earned.map((x) => x.id)).toContain('platform20');
  });

  it('la racha se corta con una derrota y juego limpio exige sin faltas', () => {
    let p = emptyAch();
    for (const won of [true, true, false, true, true]) p = recordMatch(p, facts({ won })).progress;
    expect(p.bestStreak).toBe(2);
    expect(p.unlocked.streak3).toBeUndefined();
    p = recordMatch(p, facts({ won: true })).progress;
    expect(p.unlocked.streak3).toBeDefined();
    expect(recordMatch(emptyAch(), facts({ fouls: 1 })).progress.clean).toBe(0);
  });

  it('matchFacts toma solo lo de tu robot', () => {
    const m = new Match(GAME);
    m.start();
    m.crossAutoLine('red', 0);
    m.scoreSample('red', 3, 0);
    m.scoreSample('red', 1, 1);
    m.finish({ red: 1, blue: 0 }, { red: true, blue: false }, { onPlatform: [0], criticalBy: { red: 0, blue: undefined } });
    const f = matchFacts(m, 0, GAME);
    expect(f.samples).toEqual([0, 0, 1]);
    expect(f.samplesAuto).toBe(1);
    expect(f.autoLine).toBe(true);
    expect(f.bothAutoLine).toBe(false);
    expect(f.onPlatform).toBe(true);
    expect(f.critical).toBe(true);
    expect(f.won).toBe(true);
    expect(matchFacts(m, 1, GAME).critical).toBe(false);
    expect(matchFacts(m, 2, GAME).won).toBe(false);
  });

  it('parseAch descarta basura y logros desconocidos', () => {
    expect(parseAch('no json')).toEqual(emptyAch());
    expect(parseAch(null)).toEqual(emptyAch());
    const p = parseAch(JSON.stringify({ format: 'labbot-achievements', matches: 3, wins: -1, unlocked: { firstMatch: '2026-01-01', nope: 'x' } }));
    expect(p.matches).toBe(3);
    expect(p.wins).toBe(0);
    expect(Object.keys(p.unlocked)).toEqual(['firstMatch']);
  });
});
