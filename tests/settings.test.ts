import { describe, expect, it } from 'vitest';
import { AUTO_ROUTINES } from '../src/auto/AutoRoutine';
import { DEFAULT_SETTINGS, sanitizeSettings, SETTINGS_RANGE } from '../src/config/settings';
import { GAME } from '../src/config/game';
import { buildMatchLog, type TimedEvent } from '../src/core/matchLog';
import { Match } from '../src/core/match';

const ids = AUTO_ROUTINES.map((r) => r.id);

describe('ajustes', () => {
  it('basura o nada → valores por defecto', () => {
    expect(sanitizeSettings(null, ids)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('x', ids)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({ ai: 'si', playerAuto: 'volar', maxSpeed: 'rápido', capacity: NaN }, ids)).toEqual(DEFAULT_SETTINGS);
  });

  it('recorta a los rangos y redondea la capacidad', () => {
    const s = sanitizeSettings({ maxSpeed: 99, capacity: 3.6, hpInterval: 0, ai: false, playerAuto: 'collect' }, ids);
    expect(s.maxSpeed).toBe(SETTINGS_RANGE.maxSpeed.max);
    expect(s.capacity).toBe(4);
    expect(s.hpInterval).toBe(SETTINGS_RANGE.hpInterval.min);
    expect(s.ai).toBe(false);
    expect(s.playerAuto).toBe('collect');
  });

  it('calidad gráfica: solo valores conocidos', () => {
    expect(sanitizeSettings({ quality: 'low' }, ids).quality).toBe('low');
    expect(sanitizeSettings({ quality: 'ultra' }, ids).quality).toBe('auto');
  });

  it('las rutinas por defecto existen', () => {
    expect(ids).toContain(DEFAULT_SETTINGS.playerAuto);
    for (const r of DEFAULT_SETTINGS.match.robots) expect(ids).toContain(r.auto);
  });
});

describe('registro del match', () => {
  it('trae desglose, RP, Muestras, faltas con su sección y eventos con tiempo', () => {
    const m = new Match(GAME, 2);
    const events: TimedEvent[] = [];
    const run = (dt: number) => {
      for (const e of m.tick(dt)) events.push({ ...e, t: m.t });
    };
    m.start();
    run(1);
    m.crossAutoLine('red', 0);
    m.scoreSample('red', 3);
    run(20); // TELEOP
    m.scoreSample('blue', 1);
    m.foul('OUT_OF_BOUNDS', 'blue', 2);
    run(200);
    m.finish({ red: 1, blue: 0 }, { red: false, blue: true });
    run(0);
    const log = buildMatchLog(m, events, { player: 0 }, new Date('2026-01-01T00:00:00Z'));
    expect(log.format).toBe('labbot-rescue-match');
    expect(log.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(log.alliances.red.breakdown.total).toBe(m.score('red'));
    expect(log.alliances.red.autoLineRobots).toEqual([0]);
    expect(log.alliances.red.samples).toEqual([expect.objectContaining({ level: 3, period: 'AUTO' })]);
    expect(log.alliances.blue.critical).toBe(true);
    expect(log.fouls[0]).toMatchObject({ rule: 'OUT_OF_BOUNDS', section: '§4.6', offender: 'blue' });
    expect(events.some((e) => e.type === 'sample' && e.alliance === 'blue')).toBe(true);
    expect(log.events.at(-1)?.type).toBe('end');
    // Es JSON puro (sin Set ni clases)
    expect(JSON.parse(JSON.stringify(log))).toEqual(log);
  });
});
