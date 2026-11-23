/**
 * Sensores de la cancha: traducen el estado físico a hechos de puntuación (§4.4).
 *  - Muestra dentro del pozo de un nivel de la Cámara (abajo de la apertura) → anotada en ese
 *    nivel, una sola vez (D4: cuenta al depositarse; no se puede sacar).
 *  - Pozo lleno (D17, SUPUESTO): la Muestra que entra por la apertura y queda asentada encima de las
 *    que ya estaban (su centro sobre el borde, pero dentro de la apertura) también cuenta, con el
 *    valor de su nivel, y se registra como "no cupo" (`overflow`) solo para mostrarlo.
 *  - Robot que sale por completo de su Zona de Inicio en AUTO → cruzó la línea (D1).
 *  - Al sonar la bocina: robots sobre la Plataforma (D5) y Muestra Crítica en la Repisa.
 */
import * as F from '../config/field';
import { ALLIANCES, LEVELS, type Alliance, type Level } from '../core/types';
import type { Piece, Pieces } from '../physics/Pieces';
import type { Robot } from './Robot';

/** Rapidez máxima (m/s) para contar una Muestra sobre el borde de un pozo lleno: ya asentada, no cayendo ni volando. */
export const OVERFLOW_MAX_SPEED = 0.5;

/** Altura máxima sobre el borde (m) hasta donde una Muestra apilada sobre el pozo lleno todavía cuenta: tres Muestras de pila. */
export const OVERFLOW_PILE = 3 * F.SAMPLE_SIZE;

/** Pasos de física seguidos (a 120 Hz, ≈0.25 s) que debe estar quieta para contarla encima de un pozo lleno. */
export const OVERFLOW_CALM_STEPS = 30;

export class Sensors {
  /** Muestras ya anotadas: índice → alianza dueña de la Cámara y nivel. */
  readonly scored = new Map<number, { alliance: Alliance; level: Level }>();
  private wells = ALLIANCES.flatMap((a) => LEVELS.map((level) => ({ alliance: a, level, rect: F.rectForCamara(a, F.camaraWells()[level]), rim: F.camaraWells()[level].rim })));

  /** Pasos seguidos que lleva quieta cada Muestra sobre un pozo (índice → pasos). */
  private calm = new Map<number, number>();

  constructor(private pieces: Pieces) {}

  reset(): void {
    this.scored.clear();
    this.calm.clear();
  }

  /** Muestras que acaban de entrar a un nivel (desde el último llamado). */
  newSamples(): Array<{ piece: Piece; alliance: Alliance; level: Level; overflow: boolean }> {
    const out: Array<{ piece: Piece; alliance: Alliance; level: Level; overflow: boolean }> = [];
    for (const p of this.pieces.list) {
      if (p.kind !== 'sample' || p.state.at !== 'field' || this.scored.has(p.index)) continue;
      const t = p.body.translation();
      for (const w of this.wells) {
        if (!F.inRect(w.rect, t.x, t.z)) continue;
        // Por debajo del borde: entró normal. Entre el borde y una Muestra más arriba (pozo lleno):
        // cuenta si ya está asentada ahí (no una que cae o vuela por encima).
        const overflow = t.y >= w.rim;
        if (overflow) {
          const v = p.body.linvel();
          if (t.y >= w.rim + OVERFLOW_PILE || Math.hypot(v.x, v.y, v.z) > OVERFLOW_MAX_SPEED) {
            this.calm.delete(p.index);
            continue;
          }
          // Quieta varios pasos seguidos: una soltada en el aire todavía no agarra velocidad
          const n = (this.calm.get(p.index) ?? 0) + 1;
          this.calm.set(p.index, n);
          if (n < OVERFLOW_CALM_STEPS) continue;
          this.calm.delete(p.index);
        }
        this.scored.set(p.index, { alliance: w.alliance, level: w.level });
        out.push({ piece: p, alliance: w.alliance, level: w.level, overflow });
        break;
      }
    }
    return out;
  }

  /** ¿El robot ya salió por completo de su Zona de Inicio? (la cinta es la línea de autónomo, D1) */
  outOfStartZone(r: Robot): boolean {
    const zone = F.rectFor(r.alliance, F.START_ZONES_RED[r.station]);
    // Fuera por completo = ninguna esquina adentro y el centro tampoco
    const p = r.phys.position();
    if (F.inRect(zone, p.x, p.z)) return false;
    return r.phys.footprint().every((c) => !F.inRect(zone, c.x, c.z));
  }

  /** Sobre la Plataforma (D5, resuelto): basta con estar en la rampa, apoyado en la estructura y sin tocar la alfombra. */
  onPlatform(r: Robot): boolean {
    r.phys.senseGround();
    return r.phys.wheelsOnPlatform > 0 && r.phys.wheelsOnCarpet === 0;
  }

  /** Muestra Crítica de la alianza apoyada sobre la Repisa de Seguridad (§3.2.5, §4.3.1). */
  criticalOnRepisa(a: Alliance): boolean {
    const c = this.pieces.critical(a);
    if (c.state.at !== 'field') return false;
    const t = c.body.translation();
    const hx = F.REPISA_DEPTH / 2;
    const hz = F.PLATFORM_WIDTH / 2;
    return Math.abs(t.x) <= hx && Math.abs(t.z) <= hz && t.y >= F.REPISA_TOP + F.CRITICAL_SIZE / 2 - 0.03;
  }
}
