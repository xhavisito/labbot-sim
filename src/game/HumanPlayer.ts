/**
 * Human Player automático de cada alianza (§3.2.4): desliza Muestras de su reserva (10 por
 * match, §4.1.1) por la ranura inferior de la Campana "durante todo el TeleOp". La Muestra Crítica
 * ya la colocó en la rendija antes del AUTO (§4.1).
 *
 * SUPUESTOS: introduce una Muestra cada `interval` s si el frente de la ranura está libre, por el
 * centro de la ranura y a ~1 m/s hacia la cancha.
 */
import * as F from '../config/field';
import type { Alliance } from '../core/types';
import type { Pieces } from '../physics/Pieces';

export class HumanPlayer {
  enabled = true;
  interval = 3;
  private timer = 0;
  /** Muestras introducidas en el match. */
  introduced = 0;

  constructor(
    readonly alliance: Alliance,
    private pieces: Pieces,
  ) {}

  reset(): void {
    this.timer = 0;
    this.introduced = 0;
  }

  /** Punto (dentro de la cancha) por donde sale la Muestra y su dirección. */
  slot(): { x: number; z: number; dz: number } {
    const p = F.forAlliance(this.alliance, { x: (F.CAMPANA_X_RED[0] + F.CAMPANA_X_RED[1]) / 2, z: -F.HALF_W + F.SAMPLE_SIZE / 2 + 0.01 });
    return { ...p, dz: this.alliance === 'red' ? 1 : -1 };
  }

  /** Avanza (solo se llama en TELEOP). Devuelve true si introdujo una Muestra. */
  step(dt: number): boolean {
    if (!this.enabled) return false;
    this.timer += dt;
    if (this.timer < this.interval) return false;
    const stock = this.pieces.hpStock(this.alliance);
    if (!stock.length) return false;
    const s = this.slot();
    const clear = this.pieces.list.every((p) => {
      if (p.state.at !== 'field') return true;
      const t = p.body.translation();
      return Math.hypot(t.x - s.x, t.z - s.z) > 0.4 || t.y > 0.5;
    });
    if (!clear) return false;
    this.timer = 0;
    this.introduced++;
    this.pieces.place(stock[0], s.x, F.CAMPANA_SLOT_Y + F.SAMPLE_SIZE / 2 + 0.003, s.z, 0, { x: 0, y: 0, z: s.dz * 1.0 });
    return true;
  }
}
