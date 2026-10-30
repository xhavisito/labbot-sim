import { beforeAll, describe, expect, it } from 'vitest';
import * as F from '../src/config/field';
import { PIVOT_ROBOT } from '../src/config/robot';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/config/settings';
import { CENTER_SPOT, clampSpot, sanitizeSpot, spotPose, spotRoom, spotValid } from '../src/config/startSpot';
import { GameSession } from '../src/game/GameSession';
import { initRapier } from '../src/physics/PhysicsWorld';

const { length: L, width: W } = PIVOT_ROBOT;

describe('posición de inicio elegible (§3.2.1, §4.1)', () => {
  it('derecho, el centro se mueve lo que sobra de la zona; girado 45° casi no cabe', () => {
    const r = spotRoom(L, W, 0);
    const z = F.START_ZONES_RED[0];
    expect(r.x).toBeCloseTo((z.x1 - z.x0 - L) / 2, 9);
    expect(r.z).toBeCloseTo((z.z1 - z.z0 - W) / 2, 9);
    expect(spotValid(L, W, CENTER_SPOT)).toBe(true);
    expect(spotValid(L, W, { dx: r.x, dz: -r.z, turn: 0 })).toBe(true);
    expect(spotValid(L, W, { dx: r.x + 0.01, dz: 0, turn: 0 })).toBe(false);
    // De reversa o de lado cabe igual (el chasis es casi cuadrado)
    expect(spotValid(L, W, { dx: 0, dz: 0, turn: Math.PI })).toBe(true);
    expect(spotValid(L, W, { dx: 0, dz: 0, turn: Math.PI / 2 })).toBe(true);
    const r45 = spotRoom(L, W, Math.PI / 4);
    expect(r45.x).toBeLessThan(r.x);
  });

  it('clampSpot deja el chasis dentro y endereza al que no cabe girado', () => {
    for (const turn of [0, 0.3, -1.2, Math.PI / 4, 2.5, Math.PI]) {
      const s = clampSpot(L, W, { dx: 5, dz: -5, turn });
      expect(spotValid(L, W, s)).toBe(true);
    }
    // El más grande que permite §7.2 (65 × 65 cm) cabe girado 45° en la zona de ~1 m, pero sin moverse
    const max = clampSpot(0.65, 0.65, { dx: 0.3, dz: 0, turn: Math.PI / 4 });
    expect(max.turn).toBeCloseTo(Math.PI / 4, 9);
    expect(max.dx).toBeLessThan(0.05);
    // Uno que no cabe girado queda derecho
    const big = clampSpot(0.8, 0.8, { dx: 0, dz: 0, turn: Math.PI / 4 });
    expect(big.turn).toBe(0);
    expect(spotValid(0.8, 0.8, big)).toBe(true);
    expect(clampSpot(L, W, { dx: NaN, dz: Infinity, turn: NaN })).toEqual({ dx: 0, dz: 0, turn: 0 });
  });

  it('el mismo lugar vale para rojo y azul (giro de 180°) y para las dos estaciones', () => {
    const s = { dx: 0.1, dz: -0.15, turn: 0.4 };
    for (const st of [0, 1] as const) {
      const red = spotPose('red', st, s);
      const blue = spotPose('blue', st, s);
      expect(blue.x).toBeCloseTo(-red.x, 9);
      expect(blue.z).toBeCloseTo(-red.z, 9);
      expect(Math.cos(blue.heading)).toBeCloseTo(-Math.cos(red.heading), 9);
    }
    // Al centro, viendo al centro de la cancha
    const c = spotPose('red', 0);
    expect(c.heading).toBeCloseTo(Math.PI, 9);
    const z = F.START_ZONES_RED[0];
    expect(c.x).toBeCloseTo((z.x0 + z.x1) / 2, 9);
  });

  it('lo guardado se limpia y los ajustes viejos de la IA pasan a cada robot', () => {
    expect(sanitizeSpot({ dx: 'a', dz: 9, turn: 7 })).toEqual({ dx: 0, dz: 1, turn: Math.atan2(Math.sin(7), Math.cos(7)) });
    const ids = ['leave', 'preload', 'collect', 'none'];
    const s = sanitizeSettings({ aiLevel: 'easy', botAuto: 'leave', match: { robots: [{ kind: 'pivot180', strategy: 'park', ai: 'normal' }, { kind: 'tower', strategy: 'volar' }] } }, ids);
    expect(s.match.robots[0]).toEqual({ kind: 'pivot180', strategy: 'park', ai: 'normal', auto: 'leave', plan: '' });
    // Tipo quitado o estrategia desconocida: al azar / automática, con la dificultad de antes
    expect(s.match.robots[1]).toEqual({ kind: 'random', strategy: 'auto', ai: 'easy', auto: 'leave', plan: '' });
    expect(s.match.start).toEqual(CENTER_SPOT);
    expect(sanitizeSettings({}, ids).match).toEqual(DEFAULT_SETTINGS.match);
  });
});

describe('posición de inicio en la física', () => {
  beforeAll(async () => {
    await initRapier();
  });

  it('el robot arranca girado y en la esquina elegida, todo dentro de su zona', () => {
    const spot = clampSpot(L, W, { dx: -1, dz: 1, turn: 0.5 });
    for (const player of [0, 3]) {
      const starts = [];
      starts[player] = spot;
      const g = new GameSession({ player, preload: true, starts });
      const r = g.player;
      const zone = F.rectFor(r.alliance, F.START_ZONES_RED[r.station]);
      for (const c of r.phys.footprint()) expect(F.inRect(zone, c.x, c.z), `${player} ${JSON.stringify(c)} ${JSON.stringify(zone)}`).toBe(true);
      const want = spotPose(r.alliance, r.station, spot);
      expect(r.phys.position().x).toBeCloseTo(want.x, 2);
      expect(Math.cos(r.phys.heading() - want.heading)).toBeGreaterThan(0.999);
      // Los demás, al centro de su zona
      const other = g.robots.find((o) => o !== r)!;
      expect(other.phys.position().x).toBeCloseTo(spotPose(other.alliance, other.station).x, 2);
    }
  });
});
