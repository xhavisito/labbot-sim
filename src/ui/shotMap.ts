/**
 * Dibujo de la cancha vista desde arriba (X a la derecha = rojo, Z hacia abajo) y del mapa de tiro:
 * celdas coloreadas por acierto (rojo = fallas, verde = aciertos) y un punto por tiro. Lo usan la
 * práctica por ciclos (`Practice1v1.ts`) y las estadísticas de las repeticiones (`StatsPanel.ts`).
 */
import * as F from '../config/field';
import { SHOT_CELL, shotCells, type Shot } from '../core/scoreMap';
import { ALLIANCES } from '../core/types';

export type RGB = readonly [number, number, number];

/** Fondo de la cancha; devuelve los píxeles por metro. */
export function fieldBase(g: CanvasRenderingContext2D, W: number, H: number): number {
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#15191f';
  g.fillRect(0, 0, W, H);
  return W / F.FIELD_LENGTH;
}

/** Líneas de la cancha: línea central, Zonas de Inicio, Cámaras, Campanas, Plataforma y Laboratorio. */
export function fieldLines(g: CanvasRenderingContext2D, W: number, H: number): void {
  const k = W / F.FIELD_LENGTH;
  const X = (x: number) => (x + F.HALF_L) * k;
  const Z = (z: number) => (z + F.HALF_W) * k;
  const rect = (rc: F.Rect, stroke: string, fill = '') => {
    if (fill) {
      g.fillStyle = fill;
      g.fillRect(X(rc.x0), Z(rc.z0), (rc.x1 - rc.x0) * k, (rc.z1 - rc.z0) * k);
    }
    g.strokeStyle = stroke;
    g.strokeRect(X(rc.x0), Z(rc.z0), (rc.x1 - rc.x0) * k, (rc.z1 - rc.z0) * k);
  };
  g.lineWidth = 1.5;
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.strokeRect(1, 1, W - 2, H - 2);
  g.setLineDash([6, 5]);
  g.beginPath();
  g.moveTo(X(0), 0);
  g.lineTo(X(0), H);
  g.stroke();
  g.setLineDash([]);
  for (const a of ALLIANCES) {
    const col = a === 'red' ? 'rgba(255,138,131,0.9)' : 'rgba(143,182,255,0.9)';
    for (const z of F.START_ZONES_RED) rect(F.rectFor(a, z), col);
    rect(F.camaraRect(a), col, 'rgba(255,255,255,0.06)');
    rect(F.rectFor(a, { x0: F.CAMPANA_X_RED[0], x1: F.CAMPANA_X_RED[1], z0: F.HALF_W - 0.08, z1: F.HALF_W }), col, col);
  }
  rect({ x0: -F.PLATFORM_LENGTH / 2, x1: F.PLATFORM_LENGTH / 2, z0: -F.PLATFORM_WIDTH / 2, z1: F.PLATFORM_WIDTH / 2 }, 'rgba(255,199,44,0.8)', 'rgba(255,199,44,0.06)');
  g.fillStyle = 'rgba(217,201,168,0.55)';
  for (const p of F.labSpots()) g.fillRect(X(p.x) - 3, Z(p.z) - 3, 6, 6);
}

/** Color del acierto: rojo (0) → ámbar → verde (1). */
export function accuracyRgb(acc: number): RGB {
  const a = Math.min(1, Math.max(0, acc));
  return a < 0.5 ? [229, Math.round(65 + (190 - 65) * a * 2), 58] : [Math.round(229 - (229 - 46) * (a - 0.5) * 2), Math.round(190 + (204 - 190) * (a - 0.5) * 2), Math.round(58 + (113 - 58) * (a - 0.5) * 2)];
}

export interface ShotMapLayers {
  /** Tiros que se agrupan en celdas coloreadas por acierto (null = sin celdas). */
  cells?: readonly Shot[] | null;
  /** Un punto por tiro: lleno si contó, con × si falló. */
  dots?: readonly { shots: readonly Shot[]; rgb: RGB }[];
}

export function drawShotMap(cv: HTMLCanvasElement, layers: ShotMapLayers): void {
  const g = cv.getContext('2d');
  if (!g) return;
  const W = cv.width;
  const H = cv.height;
  const k = fieldBase(g, W, H);
  const X = (x: number) => (x + F.HALF_L) * k;
  const Z = (z: number) => (z + F.HALF_W) * k;
  if (layers.cells?.length) {
    const cells = shotCells(layers.cells, F.FIELD_LENGTH, F.FIELD_WIDTH);
    const most = cells.reduce((a, c) => Math.max(a, c.tried), 1);
    for (const c of cells) {
      const [r, gg, b] = accuracyRgb(c.made / c.tried);
      g.fillStyle = `rgba(${r},${gg},${b},${Math.min(0.9, 0.3 + 0.6 * Math.sqrt(c.tried / most))})`;
      g.fillRect(c.col * SHOT_CELL * k, c.row * SHOT_CELL * k, SHOT_CELL * k + 0.5, SHOT_CELL * k + 0.5);
    }
  }
  fieldLines(g, W, H);
  const rad = Math.max(3, 0.07 * k);
  for (const layer of layers.dots ?? []) {
    const [r, gg, b] = layer.rgb;
    for (const s of layer.shots) {
      const x = X(s.x);
      const y = Z(s.z);
      g.beginPath();
      g.arc(x, y, rad, 0, Math.PI * 2);
      g.lineWidth = 1.5;
      if (s.ok) {
        g.fillStyle = `rgba(${r},${gg},${b},0.9)`;
        g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.85)';
        g.stroke();
      } else {
        g.strokeStyle = `rgba(${r},${gg},${b},0.95)`;
        g.stroke();
        const d = rad * 0.7;
        g.beginPath();
        g.moveTo(x - d, y - d);
        g.lineTo(x + d, y + d);
        g.moveTo(x + d, y - d);
        g.lineTo(x - d, y + d);
        g.strokeStyle = 'rgba(255,255,255,0.9)';
        g.stroke();
      }
    }
  }
}
