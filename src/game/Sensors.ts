/**
 * Sensores de la cancha: traducen el estado físico a hechos de puntuación (§4.4).
 *  - Muestra dentro del pozo de un nivel de la Cámara (abajo de la apertura) → anotada en ese
 *    nivel, una sola vez (D4: cuenta al depositarse; no se puede sacar).
 *  - Robot que sale por completo de su Zona de Inicio en AUTO → cruzó la línea (D1).
 *  - Al sonar la bocina: robots sobre la Plataforma (D5) y Muestra Crítica en la Repisa.
 */
import * as F from '../config/field';
import { ALLIANCES, LEVELS, type Alliance, type Level } from '../core/types';
import type { Piece, Pieces } from '../physics/Pieces';
import type { Robot } from './Robot';

export class Sensors {
  /** Muestras ya anotadas: índice → alianza dueña de la Cámara y nivel. */
  readonly scored = new Map<number, { alliance: Alliance; level: Level }>();
  private wells = ALLIANCES.flatMap((a) => LEVELS.map((level) => ({ alliance: a, level, rect: F.rectFor(a, F.camaraWells()[level]), rim: F.camaraWells()[level].rim })));

  constructor(private pieces: Pieces) {}

  reset(): void {
    this.scored.clear();
  }

  /** Muestras que acaban de entrar a un nivel (desde el último llamado). */
  newSamples(): Array<{ piece: Piece; alliance: Alliance; level: Level }> {
    const out: Array<{ piece: Piece; alliance: Alliance; level: Level }> = [];
    for (const p of this.pieces.list) {
      if (p.kind !== 'sample' || p.state.at !== 'field' || this.scored.has(p.index)) continue;
      const t = p.body.translation();
      for (const w of this.wells) {
        if (t.y < w.rim && F.inRect(w.rect, t.x, t.z)) {
          this.scored.set(p.index, { alliance: w.alliance, level: w.level });
          out.push({ piece: p, alliance: w.alliance, level: w.level });
          break;
        }
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

  /** Sobre la Plataforma (D5, SUPUESTO): apoyado en la estructura y sin tocar la alfombra. */
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
