import { describe, expect, it } from 'vitest';
import { GAME } from '../src/config/game';
import { Match } from '../src/core/match';

const none = { red: 0, blue: 0 };
const noCrit = { red: false, blue: false };

function until(m: Match, t: number): void {
  while (m.t < t - 1e-9) m.tick(Math.min(1 / 120, t - m.t));
}

describe('casos límite de reglas (docs/reglas-reto.md)', () => {
  it('§4.2/§4.4: una Muestra exactamente en el segundo 15.0 ya es TELEOP', () => {
    const m = new Match(GAME);
    m.start();
    m.tick(15); // un solo paso: acumular 1/120 deja t en 14.99999… por redondeo de coma flotante
    expect(m.t).toBe(15);
    expect(m.phase).toBe('TELEOP');
    expect(m.scoreSample('red', 2)).toBe(6);
    expect(m.breakdown('red').samplesAuto).toBe(0);
    expect(m.breakdown('red').samplesTeleop).toBe(6);
  });

  it('§4.2/§4.4: a 14.999 s sigue siendo AUTO y la línea de autónomo aún cuenta', () => {
    const m = new Match(GAME);
    m.start();
    until(m, 14.999);
    expect(m.crossAutoLine('red', 0)).toBe(true);
    expect(m.scoreSample('red', 1)).toBe(5);
    until(m, 15);
    expect(m.crossAutoLine('red', 1)).toBe(false);
  });

  it('§4.4: Plataforma 0 robots = 0, 1 = 10, 2 = 20 (no 10 + 20)', () => {
    const m = new Match(GAME);
    m.start();
    until(m, 150);
    m.finish({ red: 0, blue: 2 }, noCrit);
    expect(m.breakdown('red').platform).toBe(0);
    expect(m.breakdown('blue').platform).toBe(20);
    expect(m.breakdown('blue').total).toBe(20);
  });

  it('§4.4: Dominio con exactamente 10 Muestras (mezcla de niveles y periodos) da 1 RP; 9 no', () => {
    const m = new Match(GAME);
    m.start();
    for (let i = 0; i < 4; i++) m.scoreSample('red', 1); // AUTO
    for (let i = 0; i < 4; i++) m.scoreSample('blue', 1);
    until(m, 30);
    for (let i = 0; i < 6; i++) m.scoreSample('red', 3); // TELEOP -> 10 en total
    for (let i = 0; i < 5; i++) m.scoreSample('blue', 2); // 9 en total
    until(m, 150);
    m.finish(none, noCrit);
    expect(m.samplesIn('red')).toBe(10);
    expect(m.rankingPoints('red').dominance).toBe(true);
    expect(m.samplesIn('blue')).toBe(9);
    expect(m.rankingPoints('blue').dominance).toBe(false);
  });

  it('§4.3.3: 2 Yellow = Red; una tercera Yellow no genera otra Red', () => {
    const m = new Match(GAME);
    m.start();
    m.card('YELLOW', 0, 'red', 'a');
    expect(m.cards.filter((c) => c.type === 'RED')).toHaveLength(0);
    m.card('YELLOW', 0, 'red', 'b');
    expect(m.cards.filter((c) => c.type === 'RED')).toHaveLength(1);
    m.card('YELLOW', 0, 'red', 'c');
    expect(m.cards.filter((c) => c.type === 'RED')).toHaveLength(1);
    expect(m.score('red')).toBe(0);
  });

  it('§4.3.3: una Yellow sola no quita puntos; Red directa sí, y el rival conserva los suyos', () => {
    const m = new Match(GAME);
    m.start();
    m.scoreSample('red', 3);
    m.card('YELLOW', 0, 'red', 'a');
    expect(m.score('red')).toBe(18);
    m.card('RED', 1, 'red', 'directa');
    expect(m.score('red')).toBe(0);
    m.scoreSample('blue', 3);
    expect(m.score('blue')).toBe(18);
  });
});
