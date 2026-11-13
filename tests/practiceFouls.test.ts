import { describe, expect, it } from 'vitest';
import { GAME } from '../src/config/game';
import { PracticeFouls } from '../src/core/practiceFouls';
import { callForEvent } from '../src/core/refCalls';
import { RULES } from '../src/core/fouls';

describe('árbitro en la práctica 1 contra 1', () => {
  it('Foul 4 y Tech Foul 8 para el contrario, con su sección', () => {
    const p = new PracticeFouls(GAME);
    p.foul('CONTACT', 'red', 0);
    p.foul('OUT_OF_BOUNDS', 'blue', 2);
    const tl = p.tally();
    expect(tl.received.blue).toBe(GAME.fouls.foul);
    expect(tl.received.red).toBe(GAME.fouls.tech);
    const calls = p.drain().map((e) => callForEvent(e, GAME));
    expect(calls[0]).toMatchObject({ kind: 'foul', section: RULES.CONTACT.section, points: 4 });
    expect(calls[1]).toMatchObject({ kind: 'tech', section: RULES.OUT_OF_BOUNDS.section, points: 8 });
    expect(p.drain()).toHaveLength(0);
  });

  it('el 2.º Tech Foul del robot es Yellow; 2 Yellow = Red y pierde los puntos', () => {
    const p = new PracticeFouls(GAME);
    p.foul('OUT_OF_BOUNDS', 'red', 0);
    expect(p.cards).toHaveLength(0);
    p.foul('OUT_OF_BOUNDS', 'red', 0);
    expect(p.cards.map((c) => c.type)).toEqual(['YELLOW']);
    expect(p.score('red', 30)).toBe(30);
    p.foul('ZONE_CONTACT', 'red', 0);
    p.foul('ZONE_CONTACT', 'red', 0);
    expect(p.cards.map((c) => c.type)).toEqual(['YELLOW', 'YELLOW', 'RED']);
    expect(p.tally().redCard.red).toBe(true);
    expect(p.score('red', 30)).toBe(0);
    expect(p.score('blue', 10)).toBe(10 + 4 * 8);
  });

  it('reset limpia todo', () => {
    const p = new PracticeFouls(GAME);
    p.foul('CONTACT', 'red', 0);
    p.reset();
    expect(p.fouls).toHaveLength(0);
    expect(p.tally().received.blue).toBe(0);
  });
});
