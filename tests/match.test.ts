import { describe, expect, it } from 'vitest';
import { GAME } from '../src/config/game';
import { formatTimer, phaseAt, timerSeconds } from '../src/core/clock';
import { Match } from '../src/core/match';

const none = { red: 0, blue: 0 };
const noCrit = { red: false, blue: false };

/** Avanza el match hasta el segundo `t` (pasos de 1/120 s). */
function until(m: Match, t: number): void {
  while (m.t < t - 1e-9) m.tick(Math.min(1 / 120, t - m.t));
}

describe('reloj (§2, §4.2, §4.3, §4.3.1)', () => {
  it('AUTO 15 s, TELEOP 135 s, ENDGAME = últimos 30 s; match de 150 s', () => {
    expect(phaseAt(-0.1, GAME)).toBe('PRE');
    expect(phaseAt(0, GAME)).toBe('AUTO');
    expect(phaseAt(14.999, GAME)).toBe('AUTO');
    expect(phaseAt(15, GAME)).toBe('TELEOP');
    expect(phaseAt(119.999, GAME)).toBe('TELEOP');
    expect(phaseAt(120, GAME)).toBe('ENDGAME');
    expect(phaseAt(149.999, GAME)).toBe('ENDGAME');
    expect(phaseAt(150, GAME)).toBe('DONE');
  });

  it('timer: AUTO 0:15→0:00, TELEOP 2:15→0:00', () => {
    expect(formatTimer(timerSeconds(0, GAME))).toBe('0:15');
    expect(formatTimer(timerSeconds(14.2, GAME))).toBe('0:01');
    expect(formatTimer(timerSeconds(15, GAME))).toBe('2:15');
    expect(formatTimer(timerSeconds(120, GAME))).toBe('0:30');
    expect(formatTimer(timerSeconds(150, GAME))).toBe('0:00');
  });
});

describe('puntuación (§4.4)', () => {
  it('Muestras: AUTO 5/10/18; TELEOP y ENDGAME 2/6/15', () => {
    const m = new Match(GAME);
    m.start();
    expect(m.scoreSample('red', 1)).toBe(5);
    expect(m.scoreSample('red', 2)).toBe(10);
    expect(m.scoreSample('red', 3)).toBe(18);
    until(m, 20);
    expect(m.scoreSample('red', 1)).toBe(2);
    expect(m.scoreSample('red', 2)).toBe(6);
    expect(m.scoreSample('red', 3)).toBe(15);
    until(m, 125);
    expect(m.phase).toBe('ENDGAME');
    expect(m.scoreSample('red', 3)).toBe(15);
    const b = m.breakdown('red');
    expect(b.samplesAuto).toBe(33);
    expect(b.samplesTeleop).toBe(2 + 6 + 15 + 15);
    expect(m.score('blue')).toBe(0);
  });

  it('borde: una Muestra al segundo 14.99 vale como AUTO y a los 15.0 como TELEOP', () => {
    const m = new Match(GAME);
    m.start();
    until(m, 14.99);
    expect(m.scoreSample('blue', 3)).toBe(18);
    until(m, 15);
    expect(m.scoreSample('blue', 3)).toBe(15);
  });

  it('borde: antes de empezar y después de la bocina no cuenta nada (sin gracia, D12)', () => {
    const m = new Match(GAME);
    expect(m.scoreSample('red', 3)).toBe(0);
    m.start();
    until(m, 150);
    expect(m.scoreSample('red', 3)).toBe(0);
    m.finish(none, noCrit);
    expect(m.scoreSample('red', 3)).toBe(0);
    expect(m.score('red')).toBe(0);
  });

  it('Línea de Autónomo: 5 por robot, solo en AUTO y una vez por robot; RP solo si cruzan los dos', () => {
    const m = new Match(GAME);
    m.start();
    expect(m.crossAutoLine('red', 0)).toBe(true);
    expect(m.crossAutoLine('red', 0)).toBe(false);
    expect(m.breakdown('red').autoLine).toBe(5);
    until(m, 16);
    expect(m.crossAutoLine('red', 1)).toBe(false); // ya en TELEOP
    m.finish(none, noCrit);
    expect(m.rankingPoints('red').autoLine).toBe(false);

    const m2 = new Match(GAME);
    m2.start();
    m2.crossAutoLine('blue', 2);
    m2.crossAutoLine('blue', 3);
    until(m2, 150);
    m2.finish(none, noCrit);
    expect(m2.breakdown('blue').autoLine).toBe(10);
    expect(m2.rankingPoints('blue').autoLine).toBe(true);
  });

  it('Plataforma no acumulable: 1 robot = 10, 2 robots = 20 (no 30)', () => {
    const m = new Match(GAME);
    m.start();
    until(m, 150);
    m.finish({ red: 1, blue: 2 }, noCrit);
    expect(m.breakdown('red').platform).toBe(10);
    expect(m.breakdown('blue').platform).toBe(20);
  });

  it('Muestra Crítica: 15 puntos + 1 RP', () => {
    const m = new Match(GAME);
    m.start();
    until(m, 150);
    m.finish(none, { red: true, blue: false });
    expect(m.breakdown('red').critical).toBe(15);
    expect(m.rankingPoints('red').critical).toBe(true);
    expect(m.rankingPoints('blue').critical).toBe(false);
  });

  it('Dominio de Cámara: ≥ 10 Muestras (9 no alcanza)', () => {
    const m = new Match(GAME);
    m.start();
    until(m, 20);
    for (let i = 0; i < 9; i++) m.scoreSample('red', 1);
    for (let i = 0; i < 10; i++) m.scoreSample('blue', 1);
    until(m, 150);
    m.finish(none, noCrit);
    expect(m.rankingPoints('red').dominance).toBe(false);
    expect(m.rankingPoints('blue').dominance).toBe(true);
  });
});

describe('faltas y tarjetas (§4.3.2–§4.6)', () => {
  it('Foul = 4 y Tech Foul = 8 puntos para el equipo contrario', () => {
    const m = new Match(GAME);
    m.start();
    m.foul('CONTACT', 'red', 0);
    m.foul('PLATFORM_EARLY', 'red', 1);
    expect(m.breakdown('blue').penalties).toBe(12);
    expect(m.score('blue')).toBe(12);
    expect(m.score('red')).toBe(0);
  });

  it('2 Yellow Cards = Red Card: la alianza pierde todos sus puntos y sus RP (D10)', () => {
    const m = new Match(GAME);
    m.start();
    m.scoreSample('red', 3);
    m.foul('CONTACT', 'blue', 2); // +4 para rojo
    m.card('YELLOW', 0, 'red', 'conducta');
    expect(m.score('red')).toBe(22);
    m.card('YELLOW', 0, 'red', 'conducta');
    expect(m.cards.filter((c) => c.type === 'RED')).toHaveLength(1);
    expect(m.breakdown('red').subtotal).toBe(22);
    expect(m.score('red')).toBe(0);
    until(m, 150);
    m.finish(none, { red: true, blue: false });
    expect(m.rankingPoints('red').total).toBe(0);
  });

  it('Yellow Cards de robots distintos no se suman para la Red Card', () => {
    const m = new Match(GAME);
    m.start();
    m.card('YELLOW', 0, 'red', 'a');
    m.card('YELLOW', 1, 'red', 'b');
    expect(m.cards.some((c) => c.type === 'RED')).toBe(false);
  });
});

describe('Ranking Points (§4.4)', () => {
  it('victoria 2, empate 1 a cada uno; máximo 5', () => {
    const m = new Match(GAME);
    m.start();
    m.crossAutoLine('red', 0);
    m.crossAutoLine('red', 1);
    until(m, 20);
    for (let i = 0; i < 10; i++) m.scoreSample('red', 3);
    until(m, 150);
    m.finish(none, { red: true, blue: false });
    expect(m.rankingPoints('red')).toEqual({ win: 2, autoLine: true, critical: true, dominance: true, total: 5 });
    expect(m.rankingPoints('blue').total).toBe(0);

    const tie = new Match(GAME);
    tie.start();
    until(tie, 150);
    tie.finish(none, noCrit);
    expect(tie.rankingPoints('red').win).toBe(1);
    expect(tie.rankingPoints('blue').win).toBe(1);
  });

  it('las faltas recibidas pueden decidir el match', () => {
    const m = new Match(GAME);
    m.start();
    until(m, 20);
    m.scoreSample('red', 1); // 2
    m.foul('CONTACT', 'red', 0); // +4 azul
    until(m, 150);
    m.finish(none, noCrit);
    expect(m.score('blue')).toBeGreaterThan(m.score('red'));
    expect(m.rankingPoints('blue').win).toBe(2);
  });
});
