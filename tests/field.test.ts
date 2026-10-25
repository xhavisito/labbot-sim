import { describe, expect, it } from 'vitest';
import * as F from '../src/config/field';
import { fieldSolids } from '../src/config/fieldLayout';

describe('cancha (§3)', () => {
  it('mide 9 × 7 m (§3.1)', () => {
    expect(F.FIELD_LENGTH).toBe(9);
    expect(F.FIELD_WIDTH).toBe(7);
  });

  it('rampa: 1035.28 mm a 15° = 1000 mm horizontales; + 800 mm = 1800 mm (§3.2.5)', () => {
    expect(F.RAMP_RUN).toBeCloseTo(1.0, 4);
    expect(F.RAMP_RUN + F.PLATFORM_TOP_LENGTH).toBeCloseTo(F.RAMP_TOTAL_RUN, 4);
    expect(F.PLATFORM_HEIGHT).toBeCloseTo(0.268, 3);
    expect(F.REPISA_TOP - F.PLATFORM_HEIGHT).toBeCloseTo(0.3, 6);
  });

  it('Cámara de Seguridad: 2150 mm de largo, niveles 789/689/639 mm, aperturas 200/500/800 mm (§3.2.3)', () => {
    const w = F.camaraWells();
    expect(w[1].x1 - w[1].x0).toBeCloseTo(0.789, 6);
    expect(w[2].x1 - w[2].x0).toBeCloseTo(0.689, 6);
    expect(w[3].x1 - w[3].x0).toBeCloseTo(0.639, 6);
    expect([w[1].rim, w[2].rim, w[3].rim]).toEqual([0.2, 0.5, 0.8]);
    // De pared exterior a pared exterior = 2150 mm
    expect(w[1].x1 + F.CAMARA_WALL - (w[3].x0 - F.CAMARA_WALL)).toBeCloseTo(F.CAMARA_LENGTH, 6);
    // Nivel 1 junto a la Driver Station, Nivel 3 hacia el centro; toda en la mitad roja y dentro de la cancha
    expect(w[1].x0).toBeGreaterThan(w[2].x0);
    expect(w[3].x0 - F.CAMARA_WALL).toBeGreaterThan(0);
    expect(F.CAMARA_Z_RED[1]).toBeLessThanOrEqual(F.HALF_W);
  });

  it('Laboratorio: 16 Muestras, 8 por mitad, simétricas por rotación de 180° (§3.2.2)', () => {
    const s = F.labSpots();
    expect(s).toHaveLength(F.LAB_SAMPLES);
    expect(s.filter((p) => p.x > 0)).toHaveLength(8);
    for (const p of s) expect(s.some((q) => Math.abs(q.x + p.x) < 1e-9 && Math.abs(q.z + p.z) < 1e-9)).toBe(true);
  });

  it('cada Zona de Inicio admite un robot de 65 × 65 cm (§3.2.1, §7.2)', () => {
    for (const r of F.START_ZONES_RED) {
      expect(r.x1 - r.x0).toBeGreaterThanOrEqual(0.65);
      expect(r.z1 - r.z0).toBeGreaterThanOrEqual(0.65);
    }
  });

  it('las estructuras son simétricas entre alianzas y no salen de la cancha (salvo la Campana, que va por fuera)', () => {
    const solids = fieldSolids();
    const red = solids.filter((s) => s.alliance === 'red');
    const blue = solids.filter((s) => s.alliance === 'blue');
    expect(red.length).toBe(blue.length);
    red.forEach((r, i) => {
      r.points.forEach(([x, y, z], k) => expect(blue[i].points[k]).toEqual([-x, y, -z]));
    });
    for (const s of solids) {
      if (s.part === 'boundary') continue;
      for (const [x, , z] of s.points) {
        expect(Math.abs(x)).toBeLessThanOrEqual(F.HALF_L + 1e-9);
        const limit = s.part === 'campana' ? F.HALF_W + F.CAMPANA_DEPTH + 0.05 : F.HALF_W + 0.05;
        expect(Math.abs(z)).toBeLessThanOrEqual(limit);
      }
    }
  });

  it('la Campana mide 2000 × 610 mm y su ranura 1850.80 mm a 200 mm (§3.2.4)', () => {
    expect(F.CAMPANA_X_RED[1] - F.CAMPANA_X_RED[0]).toBeCloseTo(2.0, 6);
    expect(F.CAMPANA_HEIGHT).toBeCloseTo(0.61, 6);
    expect(F.CAMPANA_SLOT_WIDTH).toBeLessThan(F.CAMPANA_LENGTH);
    expect(F.CAMPANA_SLOT_Y).toBeCloseTo(0.2, 6);
  });
});
