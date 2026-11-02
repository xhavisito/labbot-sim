import { describe, expect, it } from 'vitest';
import { REF_SOUND_GAP, refSoundDue } from '../src/audio/FieldAudio';
import { GAME } from '../src/config/game';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/config/settings';
import { beneficiary, callForEvent, CARD_SECTION, ENDGAME_HOLD, EndgameWatcher, platformPoints, type RefCall } from '../src/core/refCalls';
import { Match } from '../src/core/match';
import { refText } from '../src/ui/refText';

const none = { red: 0, blue: 0 };
const noCrit = { red: false, blue: false };

/** Corre el vigilante `secs` segundos en pasos de 0.1 s con el mismo estado. */
function hold(w: EndgameWatcher, secs: number, platform = none, critical = noCrit, phase: 'ENDGAME' | 'TELEOP' = 'ENDGAME'): RefCall[] {
  const out: RefCall[] = [];
  for (let k = 0; k < Math.round(secs / 0.1); k++) out.push(...w.update(0.1, phase, platform, critical));
  return out;
}

describe('avisos del árbitro: faltas y tarjetas', () => {
  it('Foul: 4 puntos al contrario, un silbato y su sección del catálogo', () => {
    const m = new Match(GAME);
    m.start();
    m.foul('CONTACT', 'red', 1);
    const [e] = m.tick(0).filter((x) => x.type === 'foul');
    const c = callForEvent(e, GAME)!;
    expect(c).toMatchObject({ kind: 'foul', alliance: 'red', robot: 1, points: 4, section: '§4.5', sound: 'whistle' });
    expect(beneficiary(c)).toBe('blue');
    const txt = refText(c);
    expect(txt.title).toBe('FOUL');
    expect(txt.section).toBe('§4.5');
    expect(txt.detail).toContain('+4 para Azul');
  });

  it('Tech Foul: 8 puntos al contrario y doble silbato (§4.6)', () => {
    const m = new Match(GAME);
    m.start();
    m.foul('PLATFORM_EARLY', 'blue', 2);
    const c = callForEvent(m.tick(0).find((x) => x.type === 'foul')!, GAME)!;
    expect(c).toMatchObject({ kind: 'tech', points: 8, section: '§4.6', sound: 'whistle2' });
    expect(beneficiary(c)).toBe('red');
    expect(refText(c).title).toBe('TECH FOUL');
  });

  it('Yellow cita §4.3.2; la segunda Yellow da Red (§4.3.3) con su propio aviso', () => {
    const m = new Match(GAME);
    m.start();
    m.tick(0);
    m.card('YELLOW', 0, 'red', 'Safety');
    const first = m.tick(0).map((e) => callForEvent(e, GAME));
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ kind: 'yellow', section: CARD_SECTION.YELLOW, sound: 'card' });
    m.card('YELLOW', 0, 'red', 'Safety');
    const second = m.tick(0).map((e) => callForEvent(e, GAME)!);
    expect(second.map((c) => c.kind)).toEqual(['yellow', 'red']);
    expect(second[1].section).toBe('§4.3.3');
    expect(refText(second[1]).detail).toContain('pierde todos los puntos');
  });

  it('los demás eventos del match no son avisos del árbitro', () => {
    expect(callForEvent({ type: 'phase', phase: 'ENDGAME', prev: 'TELEOP' }, GAME)).toBeNull();
    expect(callForEvent({ type: 'sample', alliance: 'red', level: 1, points: 2 }, GAME)).toBeNull();
    expect(callForEvent({ type: 'end' }, GAME)).toBeNull();
  });
});

describe('avisos del árbitro: Plataforma y Muestra Crítica en el ENDGAME', () => {
  it('puntos de la Plataforma no acumulables (§4.4): 0, 10, 20', () => {
    expect([0, 1, 2, 3].map((n) => platformPoints(n, GAME))).toEqual([0, 10, 20, 20]);
  });

  it('avisa al subir un robot y luego el segundo, con los puntos que valdrían', () => {
    const w = new EndgameWatcher(GAME);
    const a = hold(w, 1, { red: 1, blue: 0 });
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ kind: 'platform', alliance: 'red', count: 1, points: 10, section: '§4.4, §4.3.1', sound: 'chime' });
    expect(hold(w, 2, { red: 1, blue: 0 })).toHaveLength(0); // sin repetir
    const b = hold(w, 1, { red: 2, blue: 0 });
    expect(b[0]).toMatchObject({ kind: 'platform', count: 2, points: 20 });
    expect(refText(b[0]).detail).toContain('2 robots');
  });

  it('un rebote más corto que ENDGAME_HOLD no se anuncia', () => {
    const w = new EndgameWatcher(GAME);
    expect(hold(w, ENDGAME_HOLD - 0.2, { red: 0, blue: 1 })).toHaveLength(0);
    expect(hold(w, 1)).toHaveLength(0);
  });

  it('avisa al bajar de la Plataforma', () => {
    const w = new EndgameWatcher(GAME);
    hold(w, 1, { red: 0, blue: 2 });
    const down = hold(w, 1, { red: 0, blue: 1 });
    expect(down[0]).toMatchObject({ kind: 'platformLost', alliance: 'blue', count: 1, points: 10, sound: 'chimeDown' });
    const off = hold(w, 1);
    expect(off[0]).toMatchObject({ kind: 'platformLost', count: 0, points: 0 });
    expect(refText(off[0]).detail).toContain('ya no hay robots');
  });

  it('Muestra Crítica en la Repisa: 15 pts y aviso al salir', () => {
    const w = new EndgameWatcher(GAME);
    const on = hold(w, 1, none, { red: false, blue: true });
    expect(on[0]).toMatchObject({ kind: 'critical', alliance: 'blue', points: 15, sound: 'chime' });
    expect(refText(on[0]).detail).toContain('1 RP');
    const off = hold(w, 1);
    expect(off[0]).toMatchObject({ kind: 'criticalLost', alliance: 'blue', points: 0 });
  });

  it('antes del ENDGAME no anuncia (subir antes ya es Tech Foul, §4.6)', () => {
    const w = new EndgameWatcher(GAME);
    expect(hold(w, 2, { red: 1, blue: 1 }, { red: true, blue: false }, 'TELEOP')).toHaveLength(0);
    // Y un match nuevo empieza limpio: el robot que ya estaba arriba se anuncia otra vez en su ENDGAME
    hold(w, 1, { red: 1, blue: 0 });
    hold(w, 1, none, noCrit, 'TELEOP');
    expect(hold(w, 1, { red: 1, blue: 0 })).toHaveLength(1);
  });

  it('al sonar la bocina (DONE) ya no avisa nada', () => {
    const w = new EndgameWatcher(GAME);
    hold(w, 1, { red: 1, blue: 0 });
    expect(w.update(0.1, 'DONE', none, noCrit)).toHaveLength(0);
  });
});

describe('sonido de los avisos', () => {
  it('dos avisos iguales casi a la vez suenan una vez', () => {
    const last = new Map();
    expect(refSoundDue(last, 'whistle', 10)).toBe(true);
    expect(refSoundDue(last, 'whistle', 10 + REF_SOUND_GAP / 2)).toBe(false);
    expect(refSoundDue(last, 'whistle2', 10.05)).toBe(true);
    expect(refSoundDue(last, 'whistle', 10 + REF_SOUND_GAP + 0.01)).toBe(true);
  });

  it('el modo se guarda en Ajustes y lo inválido vuelve al silbato', () => {
    expect(DEFAULT_SETTINGS.refAudio).toBe('whistle');
    expect(sanitizeSettings({ refAudio: 'voice' }, []).refAudio).toBe('voice');
    expect(sanitizeSettings({ refAudio: 'off' }, []).refAudio).toBe('off');
    expect(sanitizeSettings({ refAudio: 'gritos' }, []).refAudio).toBe('whistle');
  });
});
