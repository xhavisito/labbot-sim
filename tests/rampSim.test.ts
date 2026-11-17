import { describe, expect, it } from 'vitest';
import { RampSim, ENTRY_S } from '../src/render/rampSim';

const run = (sim: RampSim, secs: number, have: number, ax = 0, lat = 0) => {
  for (let t = 0; t < secs; t += 1 / 60) sim.step(1 / 60, have, ax, lat);
};

describe('RampSim (Muestras guardadas de Phoenix, solo dibujo)', () => {
  it('la Muestra que entra viene de afuera y sube a su lugar junto a la boca', () => {
    const sim = new RampSim(4);
    sim.step(1 / 60, 1, 0, 0);
    expect(sim.bodies[0].s).toBeLessThan(sim.target(0) - 1); // todavía viene de atrás
    run(sim, 2, 1);
    expect(sim.bodies[0].s).toBeCloseTo(3, 1);
    expect(Math.abs(sim.bodies[0].rot)).toBeLessThan(0.02);
  });

  it('varias se forman en fila sin traslaparse', () => {
    const sim = new RampSim(4);
    for (let n = 1; n <= 4; n++) run(sim, 0.3, n);
    run(sim, 2, 4);
    for (let i = 1; i < 4; i++) expect(sim.bodies[i - 1].s - sim.bodies[i].s).toBeGreaterThan(0.97);
    expect(sim.bodies[0].s).toBeLessThanOrEqual(3.05);
  });

  it('al tirar sale la de arriba y las demás suben un lugar', () => {
    const sim = new RampSim(4);
    run(sim, 3, 4);
    run(sim, 0.05, 3);
    expect(sim.bodies[0].s).toBeLessThan(3); // todavía subiendo
    run(sim, 2, 3);
    expect(sim.bodies[0].s).toBeCloseTo(3, 1);
    expect(sim.bodies[2].s).toBeCloseTo(1, 1);
    expect(sim.bodies[3].alive).toBe(false);
  });

  it('con el robot acelerando se recargan hacia el pie y vuelven al parar', () => {
    const sim = new RampSim(4);
    run(sim, 3, 2);
    run(sim, 0.5, 2, 12);
    expect(sim.bodies[1].s).toBeLessThan(2 - 0.02);
    run(sim, 2, 2, 0);
    expect(sim.bodies[1].s).toBeCloseTo(2, 1);
  });

  it('un golpe lateral las cabecea y se calman', () => {
    const sim = new RampSim(4);
    run(sim, 3, 2);
    run(sim, 0.1, 2, 0, 60);
    expect(Math.abs(sim.bodies[0].rot)).toBeGreaterThan(0.005);
    run(sim, 3, 2);
    expect(Math.abs(sim.bodies[0].rot)).toBeLessThan(0.01);
  });

  it('ENTRY_S queda detrás del pie', () => {
    expect(ENTRY_S).toBeLessThan(0);
  });
});

import { Pid } from '../src/render/pid';

describe('Pid (rodillos de la rampa)', () => {
  it('lleva una masa a la meta y la integral vence una fuerza constante', () => {
    const pid = new Pid(110, 12, 13, 220);
    let x = 0, v = 0;
    for (let t = 0; t < 6; t += 1 / 240) {
      v += (pid.update(2 - x, v, 1 / 240) - 8) * (1 / 240); // 8 = carga constante (inercia/gravedad)
      x += v / 240;
    }
    expect(Math.abs(x - 2)).toBeLessThan(0.04); // sin integral quedaría ~0.07 abajo (8/110)
  });

  it('respeta el límite del motor y no acumula integral saturado', () => {
    const pid = new Pid(100, 50, 0, 30);
    for (let i = 0; i < 600; i++) expect(Math.abs(pid.update(5, 0, 1 / 60))).toBeLessThanOrEqual(30);
    // al llegar a la meta la salida se libera pronto (sin windup)
    expect(pid.update(-0.5, 0, 1 / 60)).toBeLessThan(0);
  });
});
