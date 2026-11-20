/**
 * Árbitro en la práctica 1 contra 1 (lógica pura, sin DOM): cuenta las faltas como en el match.
 * Foul = 4 puntos al contrario (§4.5), Tech Foul = 8 (§4.6), 2 Yellow Cards = Red Card y la Red hace
 * perder todos los puntos (§4.3.3, D10). Cada falta lleva su sección del manual; el aviso en pantalla
 * sale de `core/refCalls.ts` igual que en el match.
 *
 * La práctica no tiene reloj de match ni ENDGAME (SUPUESTO D50): no se cobran las faltas que dependen
 * de la fase (Plataforma o Muestra Crítica antes del ENDGAME, línea central del AUTO).
 * El manual no da una regla automática de Yellow Card (§4.3.2 es de conducta, que el sim no ve);
 * SUPUESTO D50: el 2.º, 4.º… Tech Foul del mismo robot en la práctica (falta repetida) es una Yellow Card.
 */
import type { GameConfig } from '../config/game';
import { RULES, type CardRecord, type CardType, type FoulRecord, type RuleCode } from './fouls';
import type { MatchEvent } from './match';
import { opponent, type Alliance } from './types';

/** Lo mínimo que el árbitro de la simulación necesita para anotar una falta (lo cumplen `Match` y `PracticeFouls`). */
export interface FoulSink {
  readonly running: boolean;
  readonly t: number;
  foul(rule: RuleCode, offender: Alliance, robot: number): FoulRecord;
}

export interface PracticeTally {
  /** Faltas cometidas por cada alianza. */
  fouls: Record<Alliance, number>;
  techs: Record<Alliance, number>;
  /** Puntos que recibe cada alianza por las faltas del contrario. */
  received: Record<Alliance, number>;
  /** Tiene Red Card: pierde todos sus puntos de la práctica (§4.3.3). */
  redCard: Record<Alliance, boolean>;
  yellows: Record<Alliance, number>;
}

export class PracticeFouls implements FoulSink {
  /** Se enciende mientras la práctica corre (no en la cuenta atrás ni en el panel). */
  running = false;
  /** Segundos de práctica corridos. */
  t = 0;
  readonly fouls: FoulRecord[] = [];
  readonly cards: CardRecord[] = [];
  private pending: MatchEvent[] = [];
  private yellows = new Map<number, number>();
  private techs = new Map<number, number>();

  constructor(readonly cfg: GameConfig) {}

  reset(): void {
    this.running = false;
    this.t = 0;
    this.fouls.length = 0;
    this.cards.length = 0;
    this.pending = [];
    this.yellows.clear();
    this.techs.clear();
  }

  tick(dt: number): void {
    if (this.running) this.t += dt;
  }

  foul(rule: RuleCode, offender: Alliance, robot: number): FoulRecord {
    const f: FoulRecord = { rule, kind: RULES[rule].kind, offender, robot, time: this.t };
    this.fouls.push(f);
    this.pending.push({ type: 'foul', foul: f });
    if (f.kind === 'TECH') {
      const n = (this.techs.get(robot) ?? 0) + 1;
      this.techs.set(robot, n);
      if (n % 2 === 0) this.card('YELLOW', robot, offender, `${n} Tech Fouls`);
    }
    return f;
  }

  /** 2 Yellow = Red (§4.3.3). */
  card(type: CardType, robot: number, alliance: Alliance, reason: string): void {
    const add = (c: CardRecord) => {
      this.cards.push(c);
      this.pending.push({ type: 'card', card: c });
    };
    if (type === 'YELLOW') {
      const n = (this.yellows.get(robot) ?? 0) + 1;
      this.yellows.set(robot, n);
      add({ type, robot, alliance, time: this.t, reason });
      if (n === this.cfg.fouls.yellowsForRed) add({ type: 'RED', robot, alliance, time: this.t, reason: `${n} Yellow Cards` });
    } else add({ type, robot, alliance, time: this.t, reason });
  }

  /** Eventos nuevos desde la última vez (faltas y tarjetas), para los avisos. */
  drain(): MatchEvent[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  tally(): PracticeTally {
    const zero = (): Record<Alliance, number> => ({ red: 0, blue: 0 });
    const out: PracticeTally = { fouls: zero(), techs: zero(), received: zero(), redCard: { red: false, blue: false }, yellows: zero() };
    for (const f of this.fouls) {
      if (f.kind === 'TECH') out.techs[f.offender]++;
      else out.fouls[f.offender]++;
      out.received[opponent(f.offender)] += f.kind === 'TECH' ? this.cfg.fouls.tech : this.cfg.fouls.foul;
    }
    for (const c of this.cards) {
      if (c.type === 'YELLOW') out.yellows[c.alliance]++;
      else out.redCard[c.alliance] = true;
    }
    return out;
  }

  /** Puntos de práctica de `a`: `own` (sus ciclos) más lo que le dan las faltas del rival; 0 con Red Card (§4.3.3). */
  score(a: Alliance, own: number): number {
    const t = this.tally();
    return t.redCard[a] ? 0 : own + t.received[a];
  }
}

