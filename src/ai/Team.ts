/**
 * Coordinación de los robots de IA de una alianza (los dos, o el único si el jugador maneja al
 * otro). Reparte papeles para no estorbarse:
 * - Muestras: cada robot "aparta" la que va a tomar y su compañero escoge otra.
 * - Human Player: uno de los dos atiende la Campana (§3.2.4) cuando conviene esperar ahí.
 * - Muestra Crítica: uno la lleva a la Repisa en el ENDGAME (§4.3.1); el otro solo sube.
 * - Cámara: un solo robot cabe frente al Nivel 3; el otro espera su turno a un lado.
 */
import type { MechanismKind } from '../config/robot';
import type { Alliance } from '../core/types';
import type { HumanPlayer } from '../game/HumanPlayer';
import type { Bot } from './Bot';

/**
 * Quién lleva la Muestra Crítica (medido con `npm run batch`): el pivote la toma y suelta con la
 * garra (con hopper, igual: la garra va vacía aunque traiga Muestras); la torre con su pala al frente; el genérico con su depósito; el elevador la saca por
 * atrás (sube la rampa de reversa). El chasis no tiene con qué.
 */
export const CRIT_PREF: Record<MechanismKind, number> = { pivotHopper: 4, pivot: 4, tower: 3, generic: 2, elevator: 1, chassis: 0 };

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

  constructor(
    readonly alliance: Alliance,
    readonly hp?: HumanPlayer,
  ) {}

  join(b: Bot): void {
    const i = this.members.findIndex((m) => m.robot.index === b.robot.index);
    if (i >= 0) this.members[i] = b;
    else this.members.push(b);
    this.plan();
  }

  /** Reparte la Crítica y el Human Player (respeta lo que pida cada `BotOptions`). */
  plan(): void {
    const scorers = this.members.filter((b) => b.opts.role === 'score' && b.robot.spec.mechanism !== 'chassis');
    const explicitCrit = scorers.find((b) => b.opts.endgame === 'critical');
    const critCand = scorers.filter((b) => b.opts.endgame === undefined && b.profile.critical);
    const best = (list: Bot[], score: (b: Bot) => number) => list.reduce<Bot | null>((a, b) => (!a || score(b) > score(a) ? b : a), null);
    const crit = explicitCrit ?? best(critCand, (b) => CRIT_PREF[b.robot.spec.mechanism] * 10 - b.robot.index * 0.1);
    this.critBy = crit ? crit.robot.index : null;
    // El Human Player: el que más guarda (llena su depósito en la Campana); de preferencia no el de la Crítica
    const explicitHp = scorers.find((b) => b.opts.source === 'hp');
    const team = scorers.filter((b) => b.profile.teamwork && b.opts.source === undefined);
    const hp = explicitHp ?? (team.length >= 2 ? best(team, (b) => b.robot.spec.capacity * 10 - (b.robot.index === this.critBy ? 5 : 0) - b.robot.index * 0.1) : null);
    this.hpBy = hp ? hp.robot.index : null;
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
