/**
 * Práctica 1 contra 1 sobre la física: lleva el cronómetro de ciclos del robot del jugador paso a
 * paso (`GameSession.tap`) y se lo pasa a `core/cycles.ts`, que decide intentos, aciertos y tiempos.
 */
import { GAME } from '../config/game';
import { CycleStats, levelCat, type CycleCat } from '../core/cycles';
import { PHYSICS_HZ, type GameSession, type ScoredSample, type SessionTap } from './GameSession';
import type { MechEvent } from './Mechanisms';

/** Segundos que la Crítica tiene que quedarse en tu Repisa para contar (que no se caiga). SUPUESTO, como en los retos. */
export const CRITICAL_HOLD = 0.5;

export class CycleTracker implements SessionTap {
  readonly stats = new CycleStats(GAME);
  steps = 0;
  /** Al llegar al límite de tiempo (si la práctica tiene). */
  ended = false;
  private critOn = 0;
  private critAt = -1;
  /** Muestras anotadas por el rival de la IA (solo para mostrar). */
  rivalScored = 0;

  constructor(
    s: GameSession,
    /** Segundos de la práctica; null = libre. */
    readonly limit: number | null,
  ) {
    // La precarga (§4.1) empieza su ciclo al arrancar
    for (const p of s.player.mech.stored) this.stats.carrying(p.index, 0);
  }

  get time(): number {
    return this.steps / PHYSICS_HZ;
  }

  step(s: GameSession, mech: readonly MechEvent[], scored: readonly ScoredSample[]): void {
    if (this.ended) return;
    this.steps++;
    const t = this.time;
    const me = s.player;
    const st = this.stats;
    for (const e of mech) {
      if (e.robot !== me.index) continue;
      if (e.type === 'intake' || e.type === 'grabCritical') st.pickup(e.piece, t);
      else if (e.type === 'release') {
        const crit = s.pieces.list[e.piece].kind === 'critical';
        const tgt = me.mech.target;
        // A dónde apuntaba: la Crítica, a la Repisa (posición 4); una Muestra, a N1–N3 (0 = al piso)
        const cat: CycleCat | null = crit ? (tgt === 4 ? 'critical' : null) : tgt >= 1 && tgt <= 3 ? levelCat(tgt as 1 | 2 | 3) : null;
        st.release(e.piece, cat, t);
      }
    }
    for (const x of scored) {
      const p = s.pieces.list[x.piece];
      if (p.lastRobot !== me.index) {
        if (x.alliance !== me.alliance) this.rivalScored++;
        continue;
      }
      // D14: en la Cámara rival cuenta para el rival → para ti es un intento fallado
      if (x.alliance === me.alliance) st.scored(x.piece, levelCat(x.level), t);
      else st.missed(x.piece, t);
    }
    // Muestra Crítica en tu Repisa (§3.2.5): cuenta si se queda `CRITICAL_HOLD` s; el ciclo acaba al llegar
    const crit = s.pieces.critical(me.alliance);
    if (st.isPending(crit.index) && s.sensors.criticalOnRepisa(me.alliance)) {
      if (this.critOn === 0) this.critAt = t;
      this.critOn++;
      if (this.critOn >= Math.round(CRITICAL_HOLD * PHYSICS_HZ)) {
        st.scored(crit.index, 'critical', this.critAt);
        this.critOn = 0;
      }
    } else this.critOn = 0;
    st.advance(t);
    if (this.limit !== null && t >= this.limit - 1e-9) this.ended = true;
  }
}
