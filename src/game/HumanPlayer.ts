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

/** Lo mínimo que el Human Player ve de un robot en la cancha. */
export interface HpWatched {
  alliance: Alliance;
  phys: { position(): { x: number; z: number }; localToWorld(lx: number, ly: number, lz: number): { x: number; z: number } };
  mech: { tipX(): number; height: number };
}

/** Rapidez (m/s) a la que el HP desliza la Muestra Crítica por la rendija (SUPUESTO, D39). */
const CRIT_SLIDE_SPEED = 1.5;
/** Distancia (m) de la garra de su robot a la Crítica a partir de la cual el HP se la acomoda. */
const CRIT_SLIDE_REACH = 1.2;

/** Un rival más cerca que esto de la ranura puede robar lo que se meta (SUPUESTO: el manual no prohíbe tomar Muestras sueltas). */
const THREAT_DIST = 1.8;
/** Con un compañero esperando en la ranura se mete más rápido. */
const FEED_FAST = 1.2;
/** Muestras sueltas junto a la ranura con las que ya no mete más si nadie viene (se amontonan y se las pueden robar). */
const PILE_MAX = 1;
/**
 * Muestra atorada en la ranura (sobre la repisa interior o a medio salir): si casi no se mueve en este
 * tiempo (s), el HP la empuja hacia la cancha a `UNSTICK_SPEED` m/s. §3.2.4: el HP "puede tomar los cubos
 * insertados en la campana siempre y cuando un referee se lo indique"; SUPUESTO (Xhavi, 13-nov: "que los
 * human puedan empujar eso para que no se atoren"): el árbitro siempre se lo permite con una atorada.
 */
const UNSTICK_AFTER = 0.6;
const UNSTICK_SPEED = 0.9;
/** Lo más que la empuja seguida (s) si algo la detiene (un robot enfrente). */
const UNSTICK_MAX = 1.5;

export class HumanPlayer {
  enabled = true;
  interval = 3;
  /**
   * Human Player que piensa: no suelta Muestras con un rival cerca de la ranura (podría robarlas, §3.2.4
   * no lo prohíbe: SUPUESTO), las mete rápido cuando su robot espera enfrente y no amontona. Apagado =
   * ritmo fijo de siempre (`interval`).
   */
  smart = true;
  /** Robots en cancha (para decidir cuándo meter); sin ellos el HP es de ritmo fijo. */
  robots: readonly HpWatched[] = [];
  /** Veces que se guardó la Muestra por tener un rival cerca. */
  held = 0;
  /** Muestras que metió este HP en el match (para saber si las anota el rival: robadas). */
  readonly fed = new Set<number>();
  private timer = 0;
  /** Segundos que lleva quieta cada Muestra en la ranura (índice de pieza). */
  private stuck = new Map<number, number>();
  /** Muestras que está empujando ahora (segundos que lleva). */
  private pushing = new Map<number, number>();
  /** Veces que empujó una Muestra atorada en la ranura. */
  unstuck = 0;
  /** Muestras introducidas en el match. */
  introduced = 0;

  constructor(
    readonly alliance: Alliance,
    private pieces: Pieces,
  ) {}

  reset(): void {
    this.timer = 0;
    this.introduced = 0;
    this.held = 0;
    this.unstuck = 0;
    this.stuck.clear();
    this.pushing.clear();
    this.fed.clear();
  }

  /** Distancia del robot más cercano de esa alianza a la ranura (∞ si no hay). */
  private nearest(alliance: Alliance): number {
    const s = this.slot();
    let d = Infinity;
    for (const r of this.robots) {
      if (r.alliance !== alliance) continue;
      const p = r.phys.position();
      d = Math.min(d, Math.hypot(p.x - s.x, p.z - s.z));
    }
    return d;
  }

  /** Segundos que faltan para que intente meter la siguiente Muestra (la IA espera en la Campana). */
  get nextIn(): number {
    return Math.max(0, this.interval - this.timer);
  }

  /** Punto (dentro de la cancha) por donde sale la Muestra y su dirección. */
  slot(): { x: number; z: number; dz: number } {
    const p = F.forAlliance(this.alliance, { x: (F.CAMPANA_X_RED[0] + F.CAMPANA_X_RED[1]) / 2, z: -F.HALF_W + F.SAMPLE_SIZE / 2 + 0.01 });
    return { ...p, dz: this.alliance === 'red' ? 1 : -1 };
  }

  /**
   * La Muestra Crítica está en la rendija deslizable (§3.2.4): cuando un robot de su alianza acerca la
   * garra, el HP la desliza hasta quedar justo frente a ella (D39). Así el robot no tiene que
   * alinearse de lado al centímetro.
   */
  private centerCritical(dt: number): void {
    const crit = this.pieces.critical(this.alliance);
    if (crit.state.at !== 'field') return;
    const t = crit.body.translation();
    const h = F.forAlliance(this.alliance, F.CRITICAL_HOLDER_RED);
    // Solo mientras sigue en la rendija (no si ya se cayó o la tiene un robot)
    if (t.y < F.CRITICAL_HOLDER_RED.y || Math.abs(t.z - h.z) > 0.12) return;
    let best = Infinity;
    let goal = t.x;
    for (const r of this.robots) {
      // Con la garra a la altura de la rendija (va por la Crítica), no la que pasa con el brazo abajo
      if (r.alliance !== this.alliance || Math.abs(r.mech.height - F.CRITICAL_HOLDER_RED.y) > 0.12) continue;
      const tip = r.phys.localToWorld(r.mech.tipX(), 0, 0);
      const d = Math.hypot(tip.x - t.x, tip.z - t.z);
      if (d < CRIT_SLIDE_REACH && d < best) {
        best = d;
        goal = tip.x;
      }
    }
    const a = F.forAlliance(this.alliance, { x: F.CRITICAL_SLIDE_RED[0], z: 0 }).x;
    const b = F.forAlliance(this.alliance, { x: F.CRITICAL_SLIDE_RED[1], z: 0 }).x;
    goal = Math.max(Math.min(a, b), Math.min(Math.max(a, b), goal));
    const dx = goal - t.x;
    if (Math.abs(dx) < 0.003) return;
    const step = Math.sign(dx) * Math.min(Math.abs(dx), CRIT_SLIDE_SPEED * dt);
    crit.body.setTranslation({ x: t.x + step, y: t.y, z: t.z }, true);
    crit.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }

  /** ¿La Muestra está en la ranura de esta Campana (sobre la repisa o a medio salir por ella)? */
  inSlot(x: number, y: number, z: number): boolean {
    const c = F.forAlliance(this.alliance, { x: (F.CAMPANA_X_RED[0] + F.CAMPANA_X_RED[1]) / 2, z: -F.HALF_W });
    // Hacia la cancha (+) desde la cara de la pared
    const out = (z - c.z) * (this.alliance === 'red' ? 1 : -1);
    return (
      Math.abs(x - c.x) < F.CAMPANA_SLOT_WIDTH / 2 &&
      out < F.SAMPLE_SIZE / 2 + 0.01 &&
      out > -F.CAMPANA_DEPTH &&
      y > F.CAMPANA_SLOT_Y - F.SAMPLE_SIZE / 2 + 0.045 &&
      y < F.CAMPANA_SLOT_Y + F.CAMPANA_SLOT_HEIGHT + F.SAMPLE_SIZE / 2
    );
  }

  /**
   * Empuja hacia la cancha las Muestras que se quedaron atoradas en la ranura: la desliza con la mano
   * (como la Crítica, D39) hasta que sale de la ranura y ahí la suelta a esa velocidad.
   */
  private unstick(dt: number): void {
    const dz = this.alliance === 'red' ? 1 : -1;
    for (const p of this.pieces.list) {
      const pushing = this.pushing.get(p.index);
      if (p.kind !== 'sample' || p.state.at !== 'field') {
        this.stuck.delete(p.index);
        this.pushing.delete(p.index);
        continue;
      }
      const t = p.body.translation();
      const inside = this.inSlot(t.x, t.y, t.z);
      if (pushing !== undefined) {
        // Ya salió (o tardó demasiado): la suelta
        if (!inside || pushing > UNSTICK_MAX) {
          this.pushing.delete(p.index);
          continue;
        }
        this.pushing.set(p.index, pushing + dt);
        const y = Math.max(t.y, F.CAMPANA_SLOT_Y + F.SAMPLE_SIZE / 2 + 0.003);
        p.body.setTranslation({ x: t.x, y, z: t.z + dz * UNSTICK_SPEED * dt }, true);
        p.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
        p.body.setLinvel({ x: 0, y: 0, z: dz * UNSTICK_SPEED }, true);
        p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        continue;
      }
      const v = p.body.linvel();
      if (!inside || Math.hypot(v.x, v.y, v.z) > 0.08) {
        this.stuck.delete(p.index);
        continue;
      }
      const s = (this.stuck.get(p.index) ?? 0) + dt;
      if (s < UNSTICK_AFTER) {
        this.stuck.set(p.index, s);
        continue;
      }
      this.stuck.delete(p.index);
      this.pushing.set(p.index, 0);
      this.unstuck++;
    }
  }

  /**
   * Avanza (solo se llama en TELEOP). `endgame`: los robots ya pueden tomar la Crítica (§4.3.1) y el HP
   * se la acomoda. Devuelve true si introdujo una Muestra.
   */
  step(dt: number, endgame = false): boolean {
    if (!this.enabled) return false;
    if (endgame && this.robots.length) this.centerCritical(dt);
    this.unstick(dt);
    this.timer += dt;
    const stock = this.pieces.hpStock(this.alliance);
    if (!stock.length) return false;
    const s = this.slot();
    const smart = this.smart && this.robots.length > 0;
    const rivalD = smart ? this.nearest(this.alliance === 'red' ? 'blue' : 'red') : Infinity;
    const friendD = smart ? this.nearest(this.alliance) : Infinity;
    const wait = smart && friendD < 1.4 ? Math.min(this.interval, FEED_FAST) : this.interval;
    if (this.timer < wait) return false;
    if (smart && !(friendD < 1.4 && friendD < rivalD)) {
      // Un rival listo para robar y su robot no está enfrente: se queda con la Muestra en la mano
      if (rivalD < THREAT_DIST) {
        this.held++;
        return false;
      }
      // Nadie viene por ellas y ya hay una esperando junto a la ranura: no amontona
      if (friendD > 3) {
        let loose = 0;
        for (const p of this.pieces.list) {
          if (p.kind !== 'sample' || p.state.at !== 'field') continue;
          const t = p.body.translation();
          if (t.y < 0.3 && Math.hypot(t.x - s.x, t.z - s.z) < 1.6) loose++;
        }
        if (loose >= PILE_MAX) return false;
      }
    }
    const clear = this.pieces.list.every((p) => {
      if (p.state.at !== 'field') return true;
      const t = p.body.translation();
      return Math.hypot(t.x - s.x, t.z - s.z) > 0.4 || t.y > 0.5;
    });
    if (!clear) return false;
    this.timer = 0;
    this.introduced++;
    this.fed.add(stock[0].index);
    this.pieces.place(stock[0], s.x, F.CAMPANA_SLOT_Y + F.SAMPLE_SIZE / 2 + 0.003, s.z, 0, { x: 0, y: 0, z: s.dz * 1.0 });
    return true;
  }
}
