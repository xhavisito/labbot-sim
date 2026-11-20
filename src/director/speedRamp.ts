/**
 * Control de velocidad (speed ramping) de un clip. Puro.
 * Cámara lenta alrededor del momento del clip (impacto, tiro o anotación) y luego vuelve a 1× o 1.5×.
 */
export interface SpeedRamp {
  /** Velocidad en el momento (1 = sin cámara lenta). */
  slow: number;
  /** Velocidad después del momento. */
  after: number;
  /** Segundo del clip donde está el momento. */
  at: number;
  /** Segundos de entrada a la cámara lenta antes del momento y de duración después. */
  lead: number;
  hold: number;
}

export const DEFAULT_RAMP = (at: number): SpeedRamp => ({ slow: 1, after: 1, at, lead: 0.4, hold: 1.0 });

const smooth = (x: number): number => {
  const k = Math.min(Math.max(x, 0), 1);
  return k * k * (3 - 2 * k);
};

/** Velocidad de reproducción en el segundo `t` del clip. Las transiciones son suaves (0.25 s). */
export function speedAt(r: SpeedRamp, t: number): number {
  if (r.slow === 1 && r.after === 1) return 1;
  const a = r.at - r.lead;
  const b = r.at + r.hold;
  const ease = 0.25;
  // 1 → slow (alrededor de a), slow → after (alrededor de b)
  const enter = smooth((t - (a - ease / 2)) / ease);
  const leave = smooth((t - (b - ease / 2)) / ease);
  const mid = 1 + (r.slow - 1) * enter;
  return mid + (r.after - mid) * leave;
}

/** Avanza `dtReal` segundos de reloj real desde `t` (subpasos para no saltarse una transición). */
export function advance(r: SpeedRamp, t: number, dtReal: number): number {
  const n = Math.max(1, Math.ceil(dtReal / 0.02));
  const h = dtReal / n;
  for (let i = 0; i < n; i++) t += h * speedAt(r, t);
  return t;
}

/** Duración real (s) de reproducir el tramo [t0, t1] con la rampa. */
export function realDuration(r: SpeedRamp, t0: number, t1: number): number {
  let t = t0;
  let real = 0;
  const h = 0.01;
  while (t < t1) {
    const sp = speedAt(r, t);
    t += h * sp;
    real += h;
  }
  return real;
}
