/**
 * Estratega de alianza: coordina a los robots de la IA de una alianza (los dos, o el único si una persona maneja al
 * otro) como lo haría el drive coach de un equipo de Einstein. No es una lista fija de papeles: cada medio segundo
 * mira el reloj, el marcador, lo que rinde cada robot en este match y qué hace el robot de la persona, y reparte:
 * - Muestras: cada robot "aparta" la que va a tomar y su compañero escoge otra; cada uno trabaja su franja.
 * - Human Player: uno atiende la Campana (§3.2.4) si conviene; si la persona ya está ahí, ninguno de la IA va.
 * - Muestra Crítica (35 pts y 1 RP, §4.4): la lleva el robot que más probabilidad tiene de dejarla en la Repisa
 *   (§4.3.1), y solo si vale más que lo que dejaría de anotar en ese tiempo. Si falla, ya no se la asigna.
 * - Plataforma (10 o 20 no acumulable, §4.4): cada robot sube si los 10 puntos que agrega valen más que lo que
 *   anotaría en los segundos que tarda en subir; un robot que cicla muy rápido puede quedarse anotando.
 * - Cámara: un solo robot cabe frente al Nivel 3; el otro espera su turno o usa otro nivel.
 * - Plan del match (`playbook`): al empezar elige al azar (con pesos) entre varias formas de jugar igual de serias,
 *   para que no se repita el mismo patrón en todos los matches.
 * Todo lo que no dice el manual (valores de un RP, márgenes, probabilidades iniciales) es SUPUESTO de diseño.
 */
import { canHoldCritical, canTakeCriticalFromHolder, critSeat, intakeOf, type MechanismKind, type RobotSpec } from '../config/robot';
import * as F from '../config/field';
import { GAME } from '../config/game';
import { rng } from '../core/rng';
import type { Alliance } from '../core/types';
import type { HumanPlayer } from '../game/HumanPlayer';
import type { Robot } from '../game/Robot';
import type { Bot } from './Bot';

/**
 * Preferencia por mecanismo para llevar la Crítica cuando dos tienen la misma probabilidad (el pivote la toma y suelta
 * con la garra vacía). Se mantiene por compatibilidad con los presets de LabBot.
 */
export const CRIT_PREF: Record<MechanismKind, number> = { pivot: 2, pivot180: 1, longarm: 2, elevator: 1, dual: 1 };

/**
 * Probabilidad inicial de dejar la Crítica en la Repisa según cómo la agarra (medido en la arena con los robots del
 * CAD, 22-nov: garra fija con asiento como Psycho ≈ 0.8; pinza como Axiom ≈ 0.45–0.7; garra de compliants como
 * Mentores ≈ 0.05–0.17, la rendija le queda lejos). En el match se corrige con lo que pasa (`critFailed`).
 */
export function critPrior(s: RobotSpec): number {
  if (!canHoldCritical(s) || !canTakeCriticalFromHolder(s)) return 0;
  if (critSeat(s)) return 0.8;
  if (intakeOf(s).kind === 'pinza') return 0.55;
  return s.intake ? 0.15 : 0.6; // los presets de LabBot (sin `intake`) la toman bien
}

/** Lo que vale un RP en puntos para decidir (SUPUESTO: en Qualifications un RP pesa como un ciclo y algo, §8.2). */
export const RP_VALUE = 18;
/** Segundos del ENDGAME que se lleva la Crítica (ir a la Campana, tomarla, subir y soltarla; medido ≈ 15–20 s). */
const CRIT_TIME = 17;

export type Playbook = 'balanced' | 'labFirst' | 'feeder' | 'n3Rush';
/** Formas de jugar y qué tan seguido salen. Todas buscan ganar; cambian el orden y el reparto (SUPUESTO de diseño). */
export const PLAYBOOKS: ReadonlyArray<readonly [Playbook, number]> = [
  ['balanced', 4],
  ['labFirst', 2],
  ['feeder', 2],
  ['n3Rush', 2],
];

export class Team {
  readonly members: Bot[] = [];
  /** Muestra (índice) → robot (índice) que va por ella. */
  readonly claims = new Map<number, number>();
  /** Robot que lleva la Muestra Crítica en el ENDGAME, o null. */
  critBy: number | null = null;
  /** Robot que atiende al Human Player, o null (cualquiera). */
  hpBy: number | null = null;
  /** Robot que va (o espera) por la Crítica a la Campana, o null: los demás dejan libre la Campana. */
  critPending: number | null = null;
  /** Robot frente al Nivel 3 de la Cámara (anotando), o null. */
  n3By: number | null = null;
  /** Marcador y Dominio de la alianza ahora (lo pone la sesión; sin él la IA no mira el marcador). */
  situation?: () => { lead: number; samples: number; need: number };
  /** Todos los robots de la alianza (los de la IA y el de la persona), para ver qué hace la persona. */
  allies: Robot[] = [];
  /** Plan del match (`PLAYBOOKS`). */
  playbook: Playbook = 'balanced';
  /** Robots que ya fallaron la Crítica en este match. */
  private critFails = new Set<number>();
  /** Segundos que lleva el robot de la persona en su Campana (sube al estar ahí, baja al irse). */
  private humanHpT = 0;
  private thinkT = 0;
  private readonly rand: () => number;

  constructor(
    readonly alliance: Alliance,
    readonly hp?: HumanPlayer,
    seed = 0,
  ) {
    this.rand = rng(0x7ea + seed * 31 + (alliance === 'red' ? 1 : 2));
  }

  /** Elige el plan del match al azar con pesos (lo llama la sesión al empezar; `pick` lo fija). */
  choosePlaybook(pick?: Playbook): Playbook {
    if (pick) return (this.playbook = pick);
    const total = PLAYBOOKS.reduce((a, [, w]) => a + w, 0);
    let r = this.rand() * total;
    for (const [p, w] of PLAYBOOKS) if ((r -= w) < 0) return (this.playbook = p);
    return (this.playbook = 'balanced');
  }

  join(b: Bot): void {
    const i = this.members.findIndex((m) => m.robot.index === b.robot.index);
    if (i >= 0) this.members[i] = b;
    else this.members.push(b);
    this.plan();
  }

  /** Robots de la alianza que maneja una persona ahora (no corren la IA). */
  humans(): Robot[] {
    return this.allies.filter((r) => {
      const b = this.members.find((m) => m.robot.index === r.index);
      return !b || !b.opts.teleop;
    });
  }

  /** ¿La persona de esta alianza está trabajando su Campana (lleva un rato ahí)? Entonces la IA no se mete. */
  get humanAtHp(): boolean {
    return this.humanHpT > 1.5;
  }

  /** Robot de la persona cerca de un punto (para cederle la Crítica, el Nivel 3, la Campana). */
  humanNear(p: { x: number; z: number }, d: number): boolean {
    return this.humans().some((r) => {
      const q = r.phys.position();
      return Math.hypot(q.x - p.x, q.z - p.z) < d;
    });
  }

  /** Lo llama cada robot en cada paso; el estratega piensa cada medio segundo. */
  tick(dt: number, by: Bot): void {
    if (by !== this.members[0]) return;
    // La persona en su Campana: entre la barra y la pared, del lado de su Human Player
    const hpArea = F.forAlliance(this.alliance, { x: 3.5, z: -2.9 });
    this.humanHpT = this.humanNear(hpArea, 1.1) ? Math.min(6, this.humanHpT + dt) : Math.max(0, this.humanHpT - dt * 0.5);
    this.thinkT -= dt;
    if (this.thinkT > 0) return;
    this.thinkT = 0.5;
    this.plan();
  }

  /** Probabilidad de que ese robot deje la Crítica en la Repisa en este match. */
  critOdds(b: Bot): number {
    if (this.critFails.has(b.robot.index)) return 0;
    return critPrior(b.robot.spec);
  }

  /** El robot no la pudo tomar o dejar: no se le vuelve a asignar (y si hay otro, la lleva el otro). */
  critFailed(robot: number): void {
    this.critFails.add(robot);
    if (this.critBy === robot) this.critBy = null;
    this.plan();
  }

  /**
   * Cuánto gana la alianza si ese robot lleva la Crítica en vez de seguir anotando: 35 puntos y el RP (§4.4) por la
   * probabilidad de lograrlo, menos lo que anotaría en ese tiempo (su ritmo de este match).
   */
  critGain(b: Bot): number {
    return this.critOdds(b) * (GAME.points.critical + RP_VALUE) - b.pointsPerSecond() * CRIT_TIME;
  }

  /**
   * ¿Ese robot sube a la Plataforma? Lo que agrega (10: con uno son 10 y con dos 20, no acumulable, §4.4) contra lo
   * que anotaría en lo que tarda en subir desde su Cámara. Con poca diferencia sube: es más seguro (SUPUESTO).
   */
  climbWorth(b: Bot, climbSeconds: number): boolean {
    const lost = b.pointsPerSecond() * climbSeconds;
    return GAME.points.platformOne * 1.25 >= lost;
  }

  /** Reparte la Crítica y el Human Player (respeta lo que pida cada `BotOptions`). */
  plan(): void {
    const scorers = this.members.filter((b) => b.opts.role === 'score');
    const canCrit = (b: Bot) => canHoldCritical(b.robot.spec) && canTakeCriticalFromHolder(b.robot.spec);
    const explicitCrit = scorers.find((b) => b.opts.endgame === 'critical' && canCrit(b));
    const critCand = scorers.filter((b) => b.opts.endgame === undefined && b.profile.critical && canCrit(b) && this.critOdds(b) > 0);
    const best = (list: Bot[], score: (b: Bot) => number) => list.reduce<Bot | null>((a, b) => (!a || score(b) > score(a) ? b : a), null);
    // El mejor candidato, si vale la pena (con la Crítica ya en la garra no se cambia de idea)
    const holding = scorers.find((b) => b.robot.mech.critical);
    let crit = holding ?? explicitCrit ?? best(critCand, (b) => this.critGain(b) + CRIT_PREF[b.robot.spec.mechanism] * 0.1 - b.robot.index * 0.01);
    if (crit && !holding && !explicitCrit && this.critGain(crit) < 0) crit = null;
    this.critBy = crit ? crit.robot.index : null;
    // El Human Player: el que más guarda (llena su depósito en la Campana); de preferencia no el de la Crítica.
    // Plan "feeder": el que menos rinde en el Laboratorio se queda en la Campana todo el match; "labFirst": nadie
    // espera en la Campana mientras queden Muestras en el piso (se las gana al rival, el Laboratorio es de todos §3.2.2)
    const explicitHp = scorers.find((b) => b.opts.source === 'hp');
    const team = scorers.filter((b) => b.profile.teamwork && b.opts.source === undefined);
    let hp: Bot | null = explicitHp ?? null;
    if (!hp && team.length >= 2 && !this.humanAtHp) {
      const cap = (b: Bot) => b.robot.mech.capacity * 10 - (b.robot.index === this.critBy ? 5 : 0) - b.robot.index * 0.1;
      hp = best(team, this.playbook === 'feeder' ? (b) => cap(b) - b.pointsPerSecond() * 30 : cap);
    }
    this.hpBy = hp ? hp.robot.index : null;
  }

  /**
   * Franja de la cancha de este robot cuando juntan dos de IA: +1 o −1 (lado de `side·z`); 0 si es
   * el único que junta (o su compañero no recolecta). El de índice menor toma +1.
   */
  lane(b: Bot): number {
    const mates = this.members.filter((m) => m.opts.role === 'score' && m.opts.teleop && m.profile.teamwork);
    if (mates.length < 2 || !mates.includes(b)) return 0;
    return mates.every((m) => m.robot.index >= b.robot.index) ? 1 : -1;
  }

  /** ¿La Muestra la apartó otro robot de la alianza? */
  claimedByOther(piece: number, robot: number): boolean {
    const c = this.claims.get(piece);
    return c !== undefined && c !== robot;
  }

  claim(piece: number, robot: number): void {
    for (const [p, r] of this.claims) if (r === robot) this.claims.delete(p);
    if (piece >= 0) this.claims.set(piece, robot);
  }
}
