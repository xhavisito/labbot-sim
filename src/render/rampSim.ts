/**
 * Dinámica visual de las Muestras guardadas en la rampa del lanzador (Phoenix). Es solo dibujo: el conteo, los puntos y
 * el tiro los sigue decidiendo `Mechanisms`/`shooter.ts`; esto mueve las Muestras que ya trae el robot como cuerpos
 * ligeros (SUPUESTO de diseño: el manual no habla de cómo se acomoda lo que el robot sostiene).
 *
 * Cada Muestra es una partícula sobre la rampa (`s`: 0 = pie, `cap − 1` = boca, en lados de Muestra) con resorte
 * amortiguado hacia su lugar (los rodillos la empujan), gravedad cuesta abajo, inercia del robot (si acelera hacia
 * adelante se recargan hacia el pie), tope en la boca y choques entre vecinas. Además cabecean (`rot`) con los golpes.
 */

export interface RampBody {
  /** Posición sobre la rampa en lados de Muestra (negativa = todavía afuera, detrás del pie, rodando por el piso). */
  s: number;
  v: number;
  /** Cabeceo extra (rad) sobre la inclinación de la rampa y su velocidad. */
  rot: number;
  w: number;
  alive: boolean;
}

export interface RampParams {
  /** Rigidez / amortiguamiento del resorte que la lleva a su lugar (1/s², 1/s). */
  k: number;
  c: number;
  /** Gravedad a lo largo de la rampa, en lados de Muestra/s² (positiva = hacia el pie). */
  gravity: number;
  /** Rebote de los choques (0 = pegajoso, 1 = elástico). */
  restitution: number;
}

export const RAMP_DEFAULTS: RampParams = { k: 110, c: 13, gravity: 14, restitution: 0.25 };

/** Donde entra una Muestra nueva (lados de Muestra detrás del pie) y con qué cabeceo (rad). */
export const ENTRY_S = -0.9;
export const ENTRY_ROT = -0.7;

export class RampSim {
  readonly bodies: RampBody[] = [];
  private prevHave = 0;

  constructor(
    readonly cap: number,
    readonly p: RampParams = RAMP_DEFAULTS,
  ) {
    for (let i = 0; i < cap; i++) this.bodies.push({ s: ENTRY_S, v: 0, rot: 0, w: 0, alive: false });
  }

  /** Lugar de la rampa de la Muestra `i` (0 = la más vieja, junto a la boca). */
  target(i: number): number {
    return this.cap - 1 - i;
  }

  /**
   * Avanza `dt` s con `have` Muestras guardadas. `ax` = aceleración del robot hacia adelante a lo largo de la rampa
   * (lados de Muestra/s²), `lat` = aceleración lateral / giro que las cabecea (rad/s²).
   * Al bajar `have`, salieron las primeras: las demás se recorren y reciben un empujón hacia la boca.
   */
  step(dt: number, have: number, ax = 0, lat = 0): void {
    const { bodies, cap, p } = this;
    if (have < this.prevHave) {
      const gone = this.prevHave - have;
      bodies.splice(0, gone);
      for (let i = 0; i < gone; i++) bodies.push({ s: ENTRY_S, v: 0, rot: 0, w: 0, alive: false });
    }
    this.prevHave = have;
    for (let i = 0; i < cap; i++) {
      const b = bodies[i];
      if (i < have && !b.alive) {
        b.alive = true;
        b.s = ENTRY_S;
        b.v = 0;
        b.rot = ENTRY_ROT;
        b.w = 0;
      } else if (i >= have) b.alive = false;
    }
    const n = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / n;
    for (let it = 0; it < n; it++) {
      for (let i = 0; i < have; i++) {
        const b = bodies[i];
        const t = this.target(i);
        // Resorte a su lugar (los rodillos la empujan), amortiguado, menos la inercia del robot. La gravedad cuesta abajo solo se
        // nota mientras se acomoda: con los rodillos agarrando la Muestra no resbala hacia el pie.
        let a = p.k * (t - b.s) - p.c * b.v - ax;
        if (t - b.s > 0.4) a -= p.gravity;
        b.v += a * h;
        b.s += b.v * h;
        // Cabeceo: vuelve a 0 con su resorte; los golpes (aceleración lateral y choques) lo excitan
        b.w += (-70 * b.rot - 9 * b.w + lat * 0.35) * h;
        b.rot += b.w * h;
      }
      // Tope en la boca y choques con la vecina de adelante (la más vieja va primero)
      for (let i = 0; i < have; i++) {
        const b = bodies[i];
        const lim = i === 0 ? cap - 1 + 0.04 : bodies[i - 1].s - 1;
        if (b.s > lim) {
          const vel = b.v - (i === 0 ? 0 : bodies[i - 1].v);
          b.s = lim;
          if (vel > 0) {
            const j = vel * (1 + p.restitution);
            if (i === 0) b.v -= j;
            else {
              const o = bodies[i - 1];
              b.v -= j / 2;
              o.v += j / 2;
              o.w += j * 1.2;
            }
            b.w -= vel * 1.5;
          }
        }
      }
    }
  }
}
