import { describe, expect, it } from 'vitest';
import { PerfProfile, QualityGovernor, DYN_MIN } from '../src/render/perf';

describe('PerfProfile', () => {
  it('promedia FPS y detecta el peor cuadro', () => {
    const p = new PerfProfile();
    for (let i = 0; i < 99; i++) p.push(1 / 60, 2, 5);
    p.push(0.25, 2, 5);
    const s = p.summary();
    expect(s.fps).toBeGreaterThan(50);
    expect(s.fps).toBeLessThan(60);
    expect(s.worstMs).toBeCloseTo(250, 0);
    expect(s.low1).toBeCloseTo(4, 0);
    expect(s.simMs).toBe(2);
    expect(s.renderMs).toBe(5);
  });
  it('solo guarda unos 4 s', () => {
    const p = new PerfProfile();
    for (let i = 0; i < 1000; i++) p.push(0.1, 1, 1);
    expect(p.summary().frames).toBeLessThan(45);
  });
  it('vacío no truena', () => {
    expect(new PerfProfile().summary().fps).toBe(0);
  });
});

describe('QualityGovernor', () => {
  it('con FPS bajos baja primero la resolución y luego la calidad', () => {
    const g = new QualityGovernor('high');
    let guard = 0;
    while (g.state.scale > DYN_MIN && guard++ < 20) expect(g.step(35)).toBe(true);
    expect(g.state.quality).toBe('high');
    expect(g.step(35)).toBe(true);
    expect(g.state.quality).toBe('medium');
    expect(g.state.scale).toBe(1);
  });
  it('en baja ya no hay más que bajar', () => {
    const g = new QualityGovernor('low');
    for (let i = 0; i < 10; i++) g.step(20);
    expect(g.state.quality).toBe('low');
    expect(g.state.scale).toBe(DYN_MIN);
    expect(g.step(20)).toBe(false);
  });
  it('recupera resolución con FPS altos sostenidos, no el nivel de calidad', () => {
    const g = new QualityGovernor('high');
    for (let i = 0; i < 3; i++) g.step(40);
    const q = g.state.quality;
    const sc = g.state.scale;
    for (let i = 0; i < 3; i++) expect(g.step(60)).toBe(false);
    expect(g.step(60)).toBe(true);
    expect(g.state.scale).toBeGreaterThan(sc);
    expect(g.state.quality).toBe(q);
    expect(g.maxQuality).toBe(q);
  });
  it('FPS buenos no cambian nada', () => {
    const g = new QualityGovernor('medium');
    expect(g.step(60)).toBe(false);
    expect(g.state.scale).toBe(1);
  });
});
