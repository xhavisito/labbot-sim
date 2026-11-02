/**
 * Rendimiento: perfil de FPS (promedio, 1 % peor, ms de simulación y de dibujo) y el gobernador de
 * calidad automática. Lógica pura (sin Three.js ni DOM) para probarla con Vitest.
 */
import { QUALITIES, type Quality } from './Renderer';

/** Ventana del perfil en segundos. */
const WINDOW = 4;

export interface PerfSummary {
  fps: number;
  /** FPS del 1 % de cuadros más lentos. */
  low1: number;
  /** Cuadro más lento (ms). */
  worstMs: number;
  simMs: number;
  renderMs: number;
  frames: number;
}

/** Perfil móvil de los últimos ~4 s de cuadros. */
export class PerfProfile {
  private dts: number[] = [];
  private sims: number[] = [];
  private rends: number[] = [];
  private span = 0;

  /** Un cuadro: `dt` en segundos y lo que tardaron la simulación y el dibujo (ms). */
  push(dt: number, simMs: number, renderMs: number): void {
    this.dts.push(dt);
    this.sims.push(simMs);
    this.rends.push(renderMs);
    this.span += dt;
    while (this.span > WINDOW && this.dts.length > 1) {
      this.span -= this.dts.shift()!;
      this.sims.shift();
      this.rends.shift();
    }
  }

  reset(): void {
    this.dts = [];
    this.sims = [];
    this.rends = [];
    this.span = 0;
  }

  summary(): PerfSummary {
    const n = this.dts.length;
    if (!n || this.span <= 0) return { fps: 0, low1: 0, worstMs: 0, simMs: 0, renderMs: 0, frames: 0 };
    const sorted = [...this.dts].sort((a, b) => b - a);
    const k = Math.max(1, Math.floor(n / 100));
    const lowAvg = sorted.slice(0, k).reduce((a, b) => a + b, 0) / k;
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    return { fps: n / this.span, low1: lowAvg > 0 ? 1 / lowAvg : 0, worstMs: sorted[0] * 1000, simMs: mean(this.sims), renderMs: mean(this.rends), frames: n };
  }
}

/** Escala de resolución dinámica: mínimo y máximo. */
export const DYN_MIN = 0.6;
export const DYN_MAX = 1;
const DYN_STEP = 0.1;

export interface Governor {
  /** Calidad actual (la que pidió "Auto"). */
  quality: Quality;
  /** Escala de resolución (DYN_MIN–DYN_MAX) encima del preset. */
  scale: number;
}

/**
 * Gobernador de "Auto". Cada ventana de 2 s de juego: con menos de 45 FPS baja primero la resolución
 * (rápido, apenas se nota) y, si ya está al mínimo, baja un nivel de calidad y la resolución vuelve a
 * 1. Con más de 57 FPS sostenidos 8 s sube la resolución, pero nunca vuelve a un nivel de calidad del
 * que ya bajó (evita oscilar).
 */
export class QualityGovernor {
  state: Governor;
  /** Nivel más alto permitido (baja al caer; no sube de nuevo). */
  private ceiling: number;
  private good = 0;

  constructor(start: Quality) {
    this.state = { quality: start, scale: DYN_MAX };
    this.ceiling = QUALITIES.indexOf(start);
  }

  /** `fps` promedio de la última ventana de 2 s; devuelve true si cambió algo. */
  step(fps: number, windowSec = 2): boolean {
    const s = this.state;
    if (fps < 45) {
      this.good = 0;
      if (s.scale > DYN_MIN + 1e-6) {
        s.scale = Math.max(DYN_MIN, +(s.scale - DYN_STEP * (fps < 30 ? 2 : 1)).toFixed(2));
        return true;
      }
      const i = QUALITIES.indexOf(s.quality);
      if (i > 0) {
        s.quality = QUALITIES[i - 1];
        this.ceiling = i - 1;
        s.scale = DYN_MAX;
        return true;
      }
      return false;
    }
    if (fps > 57 && s.scale < DYN_MAX - 1e-6) {
      this.good += windowSec;
      if (this.good >= 8) {
        this.good = 0;
        s.scale = Math.min(DYN_MAX, +(s.scale + DYN_STEP).toFixed(2));
        return true;
      }
    } else this.good = 0;
    return false;
  }

  /** Nivel más alto al que aún se puede volver. */
  get maxQuality(): Quality {
    return QUALITIES[this.ceiling];
  }
}
