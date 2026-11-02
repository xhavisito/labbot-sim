/**
 * Práctica 1 contra 1 sobre la física: lleva el cronómetro de ciclos del robot del jugador paso a
 * paso (`GameSession.tap`) y se lo pasa a `core/cycles.ts`, que decide intentos, aciertos y tiempos.
 */
import { GAME } from '../config/game';
import { CycleStats, levelCat, type CycleCat, type Spot } from '../core/cycles';
import type { Shot } from '../core/scoreMap';
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
  /** Dónde soltó el rival cada Muestra que anotó (para el mapa de tiro; solo aciertos). */
  readonly rivalShots: Shot[] = [];
  /** Pieza → dónde estaba el robot que la soltó (cualquier robot). */
  private drops = new Map<number, { robot: number; spot: Spot }>();

  constructor(
    s: GameSession,
    /** Segundos de la práctica; null = libre. */
    readonly limit: number | null,
    /** Robot que se mide (por defecto el del jugador; con 2 personas, el del jugador 2 tiene el suyo). */
    readonly who: number = s.player.index,
  ) {
    // La precarga (§4.1) empieza su ciclo al arrancar
    for (const p of this.robot(s).mech.stored) this.stats.carrying(p.index, 0);
  }

  private robot(s: GameSession) {
    return s.robots.find((r) => r.index === this.who) ?? s.player;
  }

  get time(): number {
    return this.steps / PHYSICS_HZ;
  }

  step(s: GameSession, mech: readonly MechEvent[], scored: readonly ScoredSample[]): void {
    if (this.ended) return;
    this.steps++;
    const t = this.time;
    const me = this.robot(s);
    const st = this.stats;
    const spotOf = (i: number): Spot | null => {
      const r = s.robots.find((x) => x.index === i);
      if (!r) return null;
      const p = r.phys.position();
      return { x: p.x, z: p.z };
    };
    for (const e of mech) {
      if (e.type === 'release') {
        const sp = spotOf(e.robot);
        if (sp) this.drops.set(e.piece, { robot: e.robot, spot: sp });
      }
      if (e.robot !== me.index) continue;
      if (e.type === 'intake' || e.type === 'grabCritical') st.pickup(e.piece, t);
      else if (e.type === 'release') {
        const crit = s.pieces.list[e.piece].kind === 'critical';
        const tgt = me.mech.target;
        // A dónde apuntaba: la Crítica, a la Repisa (posición 4); una Muestra, a N1–N3 (0 = al piso)
        const cat: CycleCat | null = crit ? (tgt === 4 ? 'critical' : null) : tgt >= 1 && tgt <= 3 ? levelCat(tgt as 1 | 2 | 3) : null;
        st.release(e.piece, cat, t, spotOf(me.index));
      }
    }
    for (const x of scored) {
      const p = s.pieces.list[x.piece];
      const drop = this.drops.get(x.piece);
      this.drops.delete(x.piece);
      if (p.lastRobot !== me.index) {
        if (x.alliance !== me.alliance) {
          this.rivalScored++;
          const sp = drop && drop.robot === p.lastRobot ? drop.spot : p.lastRobot !== undefined ? spotOf(p.lastRobot) : null;
          if (sp) this.rivalShots.push({ x: sp.x, z: sp.z, cat: levelCat(x.level), ok: true, t });
        }
        continue;
      }
      // D14: en la Cámara rival cuenta para el rival → para ti es un intento fallado
      if (x.alliance === me.alliance) st.scored(x.piece, levelCat(x.level), t, spotOf(me.index));
      else st.missed(x.piece, t);
    }
    // Muestra Crítica en tu Repisa (§3.2.5): cuenta si se queda `CRITICAL_HOLD` s; el ciclo acaba al llegar
    const crit = s.pieces.critical(me.alliance);
    if (st.isPending(crit.index) && s.sensors.criticalOnRepisa(me.alliance)) {
      if (this.critOn === 0) this.critAt = t;
      this.critOn++;
      if (this.critOn >= Math.round(CRITICAL_HOLD * PHYSICS_HZ)) {
        st.scored(crit.index, 'critical', this.critAt, spotOf(me.index));
        this.critOn = 0;
      }
    } else this.critOn = 0;
    st.advance(t);
    if (this.limit !== null && t >= this.limit - 1e-9) this.ended = true;
  }
}
