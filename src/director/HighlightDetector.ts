/**
 * Detector de momentos destacados (puro: recibe datos simples, no toca la física).
 *
 * Reglas (todos los umbrales son SUPUESTOS de diseño del Modo Director, no del manual):
 *  - rapid:    2 o más Muestras de la misma alianza en ≤ 6 s.
 *  - topLevel: Muestra anotada en el nivel 3 (la de más puntos: tiro de precisión).
 *  - maneuver: robot a ≥ 60 % de su velocidad máxima girando ≥ 2 rad/s (drift) cerca de un robot
 *              (< 1.1 m) o de una pared (< 0.5 m), sin tocar a nadie, sostenido 0.25 s.
 *  - endgame:  Muestra anotada en los últimos 10 s del match.
 *  - platform: un robot se sube a la Plataforma durante el ENDGAME.
 *  - critical: la Muestra Crítica queda sobre la Repisa durante el ENDGAME.
 *  - clutch:   anotar ≤ 4 s después de que un robot de la alianza recibió un golpe fuerte.
 */
import type { Alliance, Level } from '../core/types';
import type { HighlightKind } from './clip';

export const RULES = {
  rapidWindow: 6,
  maneuverSpeedFrac: 0.6,
  maneuverOmega: 2,
  maneuverRobotDist: 1.1,
  maneuverWallDist: 0.5,
  maneuverHold: 0.25,
  maneuverCooldown: 8,
  endgameLast: 10,
  /** Caída de velocidad entre dos cuadros (m/s) que cuenta como golpe. */
  impactDrop: 0.8,
  clutchWindow: 4,
  cooldown: 4,
} as const;

export interface DetRobot {
  alliance: Alliance;
  x: number;
  z: number;
  /** Rapidez (m/s) y velocidad angular (rad/s). */
  speed: number;
  omega: number;
  maxSpeed: number;
  onPlatform: boolean;
}

export interface DetFrame {
  /** Tiempo de simulación (s). */
  time: number;
  /** Segundos que faltan del match (Infinity en práctica). */
  remaining: number;
  endgame: boolean;
  robots: DetRobot[];
  /** ¿Están en contacto los robots i y j? */
  touching: (i: number, j: number) => boolean;
  criticalOnRepisa: Record<Alliance, boolean>;
  /** Mitades de la cancha (m) para medir la distancia a las paredes. */
  halfL: number;
  halfW: number;
}

export interface Trigger {
  kind: HighlightKind;
  time: number;
  focus: number;
  alliance: Alliance;
}

export class HighlightDetector {
  private lastScore: Record<Alliance, number> = { red: -Infinity, blue: -Infinity };
  private armedClutch: Record<Alliance, number> = { red: -Infinity, blue: -Infinity };
  private lastKind = new Map<string, number>();
  private maneuverSince: Array<number | null> = [];
  private prevSpeed: number[] = [];
  private prevPlatform: boolean[] = [];
  private prevCritical: Record<Alliance, boolean> = { red: false, blue: false };
  constructor(private emit: (t: Trigger) => void) {}

  reset(): void {
    this.lastScore = { red: -Infinity, blue: -Infinity };
    this.armedClutch = { red: -Infinity, blue: -Infinity };
    this.lastKind.clear();
    this.maneuverSince = [];
    this.prevSpeed = [];
    this.prevPlatform = [];
    this.prevCritical = { red: false, blue: false };
  }

  private fire(kind: HighlightKind, time: number, focus: number, alliance: Alliance, cooldown: number = RULES.cooldown, key = kind as string): void {
    if (time - (this.lastKind.get(key) ?? -Infinity) < cooldown) return;
    this.lastKind.set(key, time);
    this.emit({ kind, time, focus, alliance });
  }

  /**
   * Una Muestra se anotó. `focus` = robot de la alianza más cercano a la Cámara (quien la depositó,
   * casi seguro). `remaining` = segundos que faltan del match.
   */
  onScore(time: number, alliance: Alliance, level: Level, focus: number, remaining: number): void {
    const prev = this.lastScore[alliance];
    this.lastScore[alliance] = time;
    if (remaining <= RULES.endgameLast) this.fire('endgame', time, focus, alliance, RULES.cooldown, `endgame-${alliance}`);
    else if (time - this.armedClutch[alliance] <= RULES.clutchWindow) this.fire('clutch', time, focus, alliance, RULES.cooldown, `clutch-${alliance}`);
    else if (time - prev <= RULES.rapidWindow) this.fire('rapid', time, focus, alliance, RULES.cooldown, `rapid-${alliance}`);
    else if (level === 3) this.fire('topLevel', time, focus, alliance, RULES.cooldown, `top-${alliance}`);
  }

  /** Revisar un cuadro (≈30 Hz). */
  onFrame(f: DetFrame): void {
    const n = f.robots.length;
    for (let i = 0; i < n; i++) {
      const r = f.robots[i];
      // Golpe: caída brusca de rapidez entre cuadros, con otro robot pegado
      const prev = this.prevSpeed[i] ?? r.speed;
      if (prev - r.speed >= RULES.impactDrop) {
        for (let j = 0; j < n; j++) if (j !== i && f.touching(i, j)) this.armedClutch[r.alliance] = f.time;
      }
      this.prevSpeed[i] = r.speed;

      // Maniobra a alta velocidad cerca de obstáculos, sin contacto
      let touching = false;
      let nearRobot = false;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        if (f.touching(i, j)) touching = true;
        else if (Math.hypot(f.robots[j].x - r.x, f.robots[j].z - r.z) < RULES.maneuverRobotDist) nearRobot = true;
      }
      const nearWall = f.halfL - Math.abs(r.x) < RULES.maneuverWallDist || f.halfW - Math.abs(r.z) < RULES.maneuverWallDist;
      const fast = r.speed >= r.maxSpeed * RULES.maneuverSpeedFrac && Math.abs(r.omega) >= RULES.maneuverOmega;
      if (fast && !touching && (nearRobot || nearWall)) {
        const since = this.maneuverSince[i] ?? f.time;
        this.maneuverSince[i] = since;
        if (f.time - since >= RULES.maneuverHold) {
          this.fire('maneuver', f.time, i, r.alliance, RULES.maneuverCooldown, `maneuver-${i}`);
          this.maneuverSince[i] = null;
        }
      } else this.maneuverSince[i] = null;

      // Se sube a la Plataforma en el ENDGAME
      if (f.endgame && r.onPlatform && !this.prevPlatform[i]) this.fire('platform', f.time, i, r.alliance, RULES.cooldown, `platform-${i}`);
      this.prevPlatform[i] = r.onPlatform;
    }
    for (const a of ['red', 'blue'] as const) {
      if (f.endgame && f.criticalOnRepisa[a] && !this.prevCritical[a]) {
        // Quien más cerca esté de la Repisa (centro de la cancha) de la alianza
        let focus = f.robots.findIndex((r) => r.alliance === a);
        let best = Infinity;
        f.robots.forEach((r, i) => {
          const d = Math.hypot(r.x, r.z);
          if (r.alliance === a && d < best) (best = d), (focus = i);
        });
        this.fire('critical', f.time, focus, a, RULES.cooldown, `critical-${a}`);
      }
      this.prevCritical[a] = f.criticalOnRepisa[a];
    }
  }
}
