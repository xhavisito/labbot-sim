/**
 * Árbitro automático: revisa cada paso de física las faltas que se pueden ver en la simulación
 * (catálogo en `core/fouls.ts`). Cada umbral está documentado junto a su regla; los que el manual
 * no fija son SUPUESTOS listados en docs/reglas-reto.md (D7, D8, D11, D17, D21, D33).
 */
import * as F from '../config/field';
import { isTeleop, type Phase } from '../core/clock';
import type { RuleCode } from '../core/fouls';
import type { Match } from '../core/match';
import { ALLIANCES, type Alliance } from '../core/types';
import type { MechEvent } from '../game/Mechanisms';
import type { Robot } from '../game/Robot';
import type { Sensors } from '../game/Sensors';
import type { Pieces } from '../physics/Pieces';
import type { PhysicsWorld } from '../physics/PhysicsWorld';

/** Segundos mínimos entre dos faltas por contacto del mismo par (una por "instancia", D11). */
export const CONTACT_COOLDOWN = 2;
/** Velocidad mínima de acercamiento (m/s) para "entrar en contacto" (iniciarlo). */
export const CONTACT_MIN_SPEED = 0.15;
/** Pinning: más de 3 s; otra falta cada 3 s más (D11). */
export const PIN_SECONDS = 3;
/** Obstruir (D17, SUPUESTO): más de 3 s seguidos en una zona de anotación rival (`obstructZones`); otra falta cada 5 s más. */
export const OBSTRUCT_SECONDS = 3;
export const OBSTRUCT_REPEAT = 5;
/**
 * Tirar la Muestra Crítica rival de la Repisa (§4.6 dice "intencionalmente"; D21, SUPUESTO): Tech
 * Foul si un robot rival la tocaba, o la dejó de tocar hace menos de esto (s), cuando sale de la Repisa.
 */
export const KNOCK_WINDOW = 1;

/** Frente de la Cámara de cada alianza (D17, SUPUESTO): el largo de la Cámara y 1 m hacia la cancha. */
export function camaraFront(a: Alliance): F.Rect {
  return F.rectFor(a, { x0: F.CAMARA_X_END_RED - F.CAMARA_LENGTH, x1: F.CAMARA_X_END_RED, z0: F.CAMARA_Z_RED[0] - 1.0, z1: F.CAMARA_Z_RED[0] });
}

/**
 * Zonas que un rival no puede obstruir (§4.6 "bloquear u obstruir las zonas del equipo contrario";
 * D17, SUPUESTO con el criterio de un mentor del reto, 30-oct: "cualquier zona de anotación que sea
 * obstruida es foul, hasta subirse a la rampa enemiga"): el frente de su Cámara, el frente de su
 * Campana (donde su robot recibe las Muestras del Human Player) y su rampa de la Plataforma (del pie a
 * la Repisa, sin la Repisa compartida).
 */
export function obstructZones(a: Alliance): F.Rect[] {
  const campanaFront: F.Rect = { x0: F.CAMPANA_X_RED[0], x1: F.CAMPANA_X_RED[1], z0: -F.HALF_W, z1: -F.HALF_W + 0.8 };
  const ramp: F.Rect = { x0: F.REPISA_DEPTH / 2, x1: F.PLATFORM_LENGTH / 2, z0: -F.PLATFORM_WIDTH / 2, z1: F.PLATFORM_WIDTH / 2 };
  return [camaraFront(a), F.rectFor(a, campanaFront), F.rectFor(a, ramp)];
}

/** Zonas del color de cada alianza (D8, SUPUESTO): sus 2 Zonas de Inicio y el frente de su Campana. */
export function allianceZones(a: Alliance): F.Rect[] {
  const campanaFront: F.Rect = { x0: F.CAMPANA_X_RED[0], x1: F.CAMPANA_X_RED[1], z0: -F.HALF_W, z1: -F.HALF_W + 0.8 };
  return [...F.START_ZONES_RED, campanaFront].map((r) => F.rectFor(a, r));
}

interface PairState {
  touching: boolean;
  lastFoul: number;
  pinFor: number;
  pinCharged: number;
}

export class Referee {
  private pairs = new Map<string, PairState>();
  /** Contactos activos entre colisionadores de robots distintos: "a-b" → nº de pares de colisionadores. */
  private contacts = new Map<string, number>();
  private flags = new Map<string, boolean>();
  private platformClear = new Map<number, number>();
  private obstruct = new Map<number, { t: number; charged: number }>();
  /** Contactos robot–Muestra Crítica: "pieza-robot" → nº de pares de colisionadores y último cambio (s). */
  private critTouch = new Map<string, { n: number; t: number }>();
  private critOnRepisa = new Map<Alliance, boolean>();

  constructor(
    private pw: PhysicsWorld,
    private robots: Robot[],
    private match: () => Match | null,
    /** Para la Muestra Crítica en la Repisa (§4.6); sin ellos no se revisa. */
    private field?: { pieces: Pieces; sensors: Sensors },
  ) {}

  reset(): void {
    this.pairs.clear();
    this.contacts.clear();
    this.flags.clear();
    this.platformClear.clear();
    this.obstruct.clear();
    this.critTouch.clear();
    this.critOnRepisa.clear();
  }

  /** Lee los eventos de colisión del último paso (llamar después de `world.step`). */
  drainCollisions(): void {
    this.pw.events.drainCollisionEvents((h1, h2, started) => {
      const a = this.pw.tagOf(h1);
      const b = this.pw.tagOf(h2);
      const robot = a?.kind === 'robot' ? a : b?.kind === 'robot' ? b : undefined;
      const piece = a?.kind === 'piece' ? a : b?.kind === 'piece' ? b : undefined;
      if (robot && piece && this.field?.pieces.list[piece.index]?.kind === 'critical') {
        const k = `${piece.index}-${robot.robot}`;
        const c = this.critTouch.get(k) ?? { n: 0, t: 0 };
        this.critTouch.set(k, { n: Math.max(0, c.n + (started ? 1 : -1)), t: this.match()?.t ?? 0 });
        return;
      }
      if (a?.kind !== 'robot' || b?.kind !== 'robot' || a.robot === b.robot) return;
      const key = a.robot < b.robot ? `${a.robot}-${b.robot}` : `${b.robot}-${a.robot}`;
      const n = (this.contacts.get(key) ?? 0) + (started ? 1 : -1);
      if (n <= 0) this.contacts.delete(key);
      else this.contacts.set(key, n);
    });
  }

  private charge(rule: RuleCode, r: Robot): void {
    this.match()?.foul(rule, r.alliance, r.index);
  }

  /** Marca una vez mientras la condición siga; se rearma cuando deja de cumplirse. */
  private once(key: string, cond: boolean, r: Robot, rule: RuleCode): void {
    if (cond && !this.flags.get(key)) this.charge(rule, r);
    this.flags.set(key, cond);
  }

  /** Revisa un paso. `phase` es la fase del match en ese paso. */
  step(dt: number, phase: Phase, mechEvents: readonly MechEvent[]): void {
    const m = this.match();
    if (!m?.running || !(phase === 'AUTO' || isTeleop(phase))) return;
    const t = m.t;

    for (const r of this.robots) {
      const corners = r.phys.footprint();
      // §4.6: el robot sale de los límites de la cancha. Solo cuando TODO el robot (chasis y garra)
      // queda fuera (Xhavi, 29-oct; el manual no aclara si basta una parte: SUPUESTO, D33)
      const out = F.fullyOutOfField(r.phys.outline(r.mech.angle));
      this.once(`oob:${r.index}`, out, r, 'OUT_OF_BOUNDS');
      // §4.6: subir a la Plataforma antes del endgame (una por instancia; se rearma tras 1 s fuera)
      const on = r.phys.wheelsOnPlatform > 0;
      const clear = on ? 0 : (this.platformClear.get(r.index) ?? 1) + dt;
      this.platformClear.set(r.index, clear);
      const key = `plat:${r.index}`;
      if (on && phase !== 'ENDGAME' && !this.flags.get(key)) {
        this.charge('PLATFORM_EARLY', r);
        this.flags.set(key, true);
      }
      if (clear >= 1) this.flags.set(key, false);
      // §4.6 (y §6.1 "no hay defensa"): quedarse en una zona de anotación rival en el TELEOP (D17)
      const p = r.phys.position();
      const zones = obstructZones(r.alliance === 'red' ? 'blue' : 'red');
      const ob = this.obstruct.get(r.index) ?? { t: 0, charged: 0 };
      if (isTeleop(phase) && zones.some((z) => F.inRect(z, p.x, p.z))) ob.t += dt;
      else {
        ob.t = 0;
        ob.charged = 0;
      }
      if (ob.t > OBSTRUCT_SECONDS) {
        const due = 1 + Math.floor((ob.t - OBSTRUCT_SECONDS) / OBSTRUCT_REPEAT);
        if (due > ob.charged) {
          ob.charged = due;
          this.charge('OBSTRUCT', r);
        }
      }
      this.obstruct.set(r.index, ob);
      // §4.2: no cruzar la línea central en AUTO (D7: el manual no da la falta; SUPUESTO Foul)
      if (phase === 'AUTO') {
        const s = r.alliance === 'red' ? 1 : -1;
        this.once(`center:${r.index}`, corners.every((c) => s * c.x < F.CENTER_LINE_X), r, 'AUTO_CENTER');
      }
    }

    // §4.6: tomar la Muestra Crítica antes del endgame
    for (const e of mechEvents) {
      const r = e.type === 'grabCritical' && phase !== 'ENDGAME' ? this.robots.find((x) => x.index === e.robot) : undefined;
      if (r) this.charge('CRITICAL_EARLY', r);
    }

    // §4.6: tirar la Muestra Crítica del equipo contrario de la Repisa (D21)
    if (this.field)
      for (const al of ALLIANCES) {
        const on = this.field.sensors.criticalOnRepisa(al);
        const was = this.critOnRepisa.get(al) ?? false;
        this.critOnRepisa.set(al, on);
        const c = this.field.pieces.critical(al);
        // La tomó un robot (solo puede su dueño): no es tirarla
        if (!was || on || c.state.at !== 'field') continue;
        const rival = this.robots.find((r) => {
          const k = this.critTouch.get(`${c.index}-${r.index}`);
          return r.alliance !== al && !!k && (k.n > 0 || t - k.t <= KNOCK_WINDOW);
        });
        if (rival) this.charge('CRITICAL_KNOCK', rival);
      }

    // §4.5 contacto y pinning; §4.6 contacto en zonas del color contrario
    for (let i = 0; i < this.robots.length; i++)
      for (let j = i + 1; j < this.robots.length; j++) {
        const a = this.robots[i];
        const b = this.robots[j];
        if (a.alliance === b.alliance) continue;
        const key = `${a.index}-${b.index}`;
        const st = this.pairs.get(key) ?? { touching: false, lastFoul: -Infinity, pinFor: 0, pinCharged: 0 };
        this.pairs.set(key, st);
        const touching = this.contacts.has(key);
        if (!touching) {
          st.touching = false;
          st.pinFor = 0;
          st.pinCharged = 0;
          continue;
        }
        const pa = a.phys.position();
        const pb = b.phys.position();
        const dx = pb.x - pa.x;
        const dz = pb.z - pa.z;
        const d = Math.hypot(dx, dz) || 1;
        const va = a.phys.body.linvel();
        const vb = b.phys.body.linvel();
        // Velocidad de cada uno HACIA el otro
        const closeA = (va.x * dx + va.z * dz) / d;
        const closeB = -(vb.x * dx + vb.z * dz) / d;
        const initiator = closeA >= closeB ? a : b;
        const victim = initiator === a ? b : a;
        if (!st.touching && Math.max(closeA, closeB) > CONTACT_MIN_SPEED && t - st.lastFoul >= CONTACT_COOLDOWN) {
          const mid = { x: (pa.x + pb.x) / 2, z: (pa.z + pb.z) / 2 };
          const inVictimZone = allianceZones(victim.alliance).some((z) => F.inRect(z, mid.x, mid.z));
          this.charge(inVictimZone ? 'ZONE_CONTACT' : 'CONTACT', initiator);
          st.lastFoul = t;
        }
        st.touching = true;
        // Pinning: el que empuja manda avanzar hacia el otro y el otro casi no se mueve
        const push = (r: Robot, o: Robot) => {
          const h = r.phys.heading();
          const toward = (Math.cos(h) * (o.phys.position().x - r.phys.position().x) - Math.sin(h) * (o.phys.position().z - r.phys.position().z)) / d;
          return r.phys.lastCmd.forward * toward;
        };
        const pushA = push(a, b);
        const pushB = push(b, a);
        const pusher = pushA >= pushB ? a : b;
        const pinned = pusher === a ? b : a;
        const pinnedSpeed = Math.hypot(pinned.phys.body.linvel().x, pinned.phys.body.linvel().z);
        if (Math.max(pushA, pushB) > 0.2 && pinnedSpeed < 0.3) st.pinFor += dt;
        else st.pinFor = Math.max(0, st.pinFor - dt);
        const due = Math.floor(st.pinFor / PIN_SECONDS);
        if (due > st.pinCharged) {
          st.pinCharged = due;
          this.charge('PIN', pusher);
        }
      }
  }
}

