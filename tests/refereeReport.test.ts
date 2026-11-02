import { describe, expect, it } from 'vitest';
import { GAME } from '../src/config/game';
import { Match } from '../src/core/match';
import { buildRefereeReport, foulPoints } from '../src/core/refereeReport';

const none = { red: 0, blue: 0 };
const noCrit = { red: false, blue: false };

function until(m: Match, t: number): void {
  while (m.t < t - 1e-9) m.tick(Math.min(1 / 120, t - m.t));
}

function started(): Match {
  const m = new Match(GAME);
  m.start();
  return m;
}

describe('reporte del árbitro virtual', () => {
  it('match limpio: sin faltas, resultado y RP iguales con y sin faltas', () => {
    const m = started();
    m.scoreSample('red', 1);
    until(m, 150);
    m.finish(none, noCrit);
    const r = buildRefereeReport(m);
    expect(r.clean).toBe(true);
    expect(r.fouls).toEqual([]);
    expect(r.outcome.actual).toBe('red');
    expect(r.outcome.decidedByFouls).toBe(false);
    expect(r.alliances.red.rp).toBe(r.alliances.red.rpWithoutFouls);
    expect(r.robots).toEqual([]);
  });

  it('cada falta: regla (§), periodo, timer y puntos al contrario (§4.5 = 4, §4.6 = 8)', () => {
    const m = started();
    until(m, 5);
    m.foul('AUTO_CENTER', 'blue', 2); // AUTO, timer 0:10
    until(m, 30);
    m.foul('CONTACT', 'red', 1); // TELEOP, timer 2:00
    until(m, 125);
    m.foul('PLATFORM_EARLY', 'red', 0); // ENDGAME (no es falta en ENDGAME, pero aquí la marca el test)
    until(m, 150);
    m.finish(none, noCrit);
    const r = buildRefereeReport(m);
    expect(r.fouls.map((f) => [f.n, f.period, f.clock, f.label, f.section, f.points, f.beneficiary, f.slot])).toEqual([
      [1, 'AUTO', '0:10', 'Foul', '§4.2', 4, 'red', 1],
      [2, 'TELEOP', '2:00', 'Foul', '§4.5', 4, 'blue', 2],
      [3, 'ENDGAME', '0:25', 'Tech Foul', '§4.6', 8, 'blue', 1],
    ]);
    expect(foulPoints('FOUL', GAME)).toBe(GAME.fouls.foul);
    expect(foulPoints('TECH', GAME)).toBe(GAME.fouls.tech);
    // Los SUPUESTOS del árbitro quedan señalados
    expect(r.fouls[0].supuesto).toMatch(/^D7/);
    expect(r.fouls[1].supuesto).toBeUndefined();
    expect(r.supuestos).toEqual(['D7']);
  });

  it('resumen por alianza: puntos dados y recibidos cuadran con el desglose', () => {
    const m = started();
    until(m, 20);
    m.foul('CONTACT', 'red', 0);
    m.foul('OBSTRUCT', 'red', 1);
    m.foul('PIN', 'blue', 3);
    until(m, 150);
    m.finish(none, noCrit);
    const r = buildRefereeReport(m);
    expect(r.alliances.red).toMatchObject({ committed: 2, fouls: 1, techs: 1, pointsGiven: 12, pointsReceived: 4 });
    expect(r.alliances.blue).toMatchObject({ committed: 1, fouls: 1, techs: 0, pointsGiven: 4, pointsReceived: 12 });
    expect(r.alliances.blue.pointsReceived).toBe(m.breakdown('blue').penalties);
    expect(r.alliances.red.scoreWithoutFouls).toBe(0);
    expect(r.alliances.blue.scoreWithoutFouls).toBe(0);
    // 12 a 4 para Azul solo por faltas; sin ellas, empate
    expect(r.outcome).toMatchObject({ actual: 'blue', withoutFouls: 'tie', decidedByFouls: true, margin: -8, marginWithoutFouls: 0 });
    expect(r.alliances.blue.rp).toBe(GAME.rp.win);
    expect(r.alliances.blue.rpWithoutFouls).toBe(GAME.rp.tie);
    expect(r.alliances.red.rpWithoutFouls).toBe(GAME.rp.tie);
    // Por robot: el que más regaló va primero, con sus reglas
    expect(r.robots.map((x) => [x.robot, x.pointsGiven])).toEqual([
      [1, 8],
      [0, 4],
      [3, 4],
    ]);
    expect(r.robots[0].rules).toEqual([{ rule: 'OBSTRUCT', count: 1 }]);
  });

  it('falta decisiva: sin ella cambia el ganador y el RP de victoria (§4.4)', () => {
    const m = started();
    m.scoreSample('blue', 1); // Azul 5 en AUTO
    until(m, 20);
    m.scoreSample('red', 1); // Rojo 2 en TELEOP
    m.foul('ZONE_CONTACT', 'blue', 2); // Rojo +8 → 10 a 5
    m.foul('CONTACT', 'blue', 3); // Rojo +4 → 14 a 5
    until(m, 150);
    m.finish(none, noCrit);
    const r = buildRefereeReport(m);
    expect(r.outcome.actual).toBe('red');
    // Sin la Tech Foul: 6 a 5, Rojo sigue ganando; sin la Foul: 10 a 5. Ninguna sola es decisiva
    expect(r.fouls.map((f) => f.decisive)).toEqual([false, false]);
    expect(r.fouls[0].rpSwing).toEqual({ red: 0, blue: 0 });
    // Sin ninguna falta: 2 a 5, gana Azul
    expect(r.outcome.withoutFouls).toBe('blue');
    expect(r.alliances.red.rpWithoutFouls - r.alliances.red.rp).toBe(-GAME.rp.win);
    expect(r.alliances.blue.rpWithoutFouls - r.alliances.blue.rp).toBe(GAME.rp.win);
  });

  it('una sola falta que voltea el match: rpSwing por alianza', () => {
    const m = started();
    m.scoreSample('blue', 1); // 5
    until(m, 20);
    m.foul('OUT_OF_BOUNDS', 'blue', 2); // Rojo 8 a 5
    until(m, 150);
    m.finish(none, noCrit);
    const r = buildRefereeReport(m);
    const f = r.fouls[0];
    expect(f.decisive).toBe(true);
    expect(f.rpSwing).toEqual({ red: -GAME.rp.win, blue: GAME.rp.win });
  });

  it('falta que solo convierte una victoria en empate: +1/−1 RP', () => {
    const m = started();
    until(m, 20);
    m.scoreSample('red', 2); // 6
    m.scoreSample('blue', 1);
    m.scoreSample('blue', 1); // 4
    m.foul('CONTACT', 'blue', 2); // Rojo 10 a 4
    m.foul('PIN', 'red', 0); // Azul 10 a 8? no: Azul 4 + 4 = 8
    until(m, 150);
    m.finish(none, noCrit);
    const r = buildRefereeReport(m);
    expect(r.outcome.actual).toBe('red'); // 10 a 8
    const pin = r.fouls.find((f) => f.rule === 'PIN')!;
    expect(pin.decisive).toBe(false); // sin ella 10 a 4
    const contact = r.fouls.find((f) => f.rule === 'CONTACT')!;
    expect(contact.decisive).toBe(true); // sin ella 6 a 8
    expect(contact.rpSwing).toEqual({ red: -GAME.rp.win, blue: GAME.rp.win });
  });

  it('faltas repetidas del mismo robot se cuentan', () => {
    const m = started();
    until(m, 20);
    m.foul('PIN', 'red', 0);
    until(m, 25);
    m.foul('PIN', 'red', 0);
    m.foul('PIN', 'red', 1);
    until(m, 150);
    m.finish(none, noCrit);
    const r = buildRefereeReport(m);
    expect(r.fouls.map((f) => f.repeat)).toEqual([0, 1, 0]);
    expect(r.robots[0]).toMatchObject({ robot: 0, fouls: 2, rules: [{ rule: 'PIN', count: 2 }] });
  });

  it('Red Card (§4.3.3, D10): puntos y RP perdidos', () => {
    const m = started();
    m.scoreSample('red', 3); // 18
    m.scoreSample('red', 3); // 36
    for (let i = 0; i < 10; i++) m.scoreSample('red', 1); // +50 = 86, Dominio
    m.scoreSample('blue', 1); // 5
    until(m, 30);
    m.card('YELLOW', 1, 'red', 'conducta');
    m.card('YELLOW', 1, 'red', 'conducta');
    until(m, 150);
    m.finish(none, noCrit);
    const r = buildRefereeReport(m);
    expect(r.cards.map((c) => [c.type, c.slot, c.section])).toEqual([
      ['YELLOW', 2, '§4.3.3'],
      ['YELLOW', 2, '§4.3.3'],
      ['RED', 2, '§4.3.3'],
    ]);
    expect(r.clean).toBe(false);
    expect(r.alliances.red).toMatchObject({ redCard: true, score: 0, lostToRedCard: 86, rp: 0, rpWithoutFouls: 0 });
    // Sin la Red Card: victoria (2) + Dominio (1)
    expect(r.alliances.red.rpWithoutRedCard).toBe(GAME.rp.win + GAME.rp.dominance);
    expect(r.alliances.blue).toMatchObject({ redCard: false, lostToRedCard: 0 });
    expect(r.outcome.actual).toBe('blue');
    expect(r.robots.map((x) => x.robot)).toEqual([1]);
  });

  it('faltas registradas en desorden salen ordenadas por tiempo', () => {
    const m = started();
    until(m, 40);
    m.foul('CONTACT', 'red', 0);
    // Simula un registro con tiempo anterior (p. ej. de una repetición)
    m.fouls.unshift({ rule: 'PIN', kind: 'FOUL', offender: 'blue', robot: 2, time: 10 });
    until(m, 150);
    m.finish(none, noCrit);
    const r = buildRefereeReport(m);
    expect(r.fouls.map((f) => [f.n, f.rule])).toEqual([
      [1, 'PIN'],
      [2, 'CONTACT'],
    ]);
  });
});
