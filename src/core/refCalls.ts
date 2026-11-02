/**
 * Avisos del árbitro (lógica pura): qué se anuncia en pantalla y con sonido cuando el árbitro marca
 * una falta o una tarjeta, y cuando en el ENDGAME un robot sube a la Plataforma o la Muestra Crítica
 * queda en la Repisa. Cada aviso lleva la sección del manual de donde sale.
 *
 * El manual no habla de anuncios del árbitro ni de sus sonidos: todo el formato (silbato, voz,
 * cartel) es SUPUESTO (D43 en docs/reglas-reto.md). Los puntos que dice el aviso sí son los de §4.4–§4.6.
 */
import type { GameConfig } from '../config/game';
import type { Phase } from './clock';
import { RULES, type RuleCode } from './fouls';
import type { MatchEvent } from './match';
import { ALLIANCES, opponent, type Alliance } from './types';

/** Sonido del aviso (`audio/FieldAudio.ts`, sintetizados). */
export type RefSound = 'whistle' | 'whistle2' | 'card' | 'chime' | 'chimeDown';

export type RefCall =
  | { kind: 'foul' | 'tech'; alliance: Alliance; robot: number; rule: RuleCode; points: number; section: string; sound: RefSound }
  | { kind: 'yellow' | 'red'; alliance: Alliance; robot: number; reason: string; section: string; sound: RefSound }
  /** `count` robots de `alliance` sobre la Plataforma ahora; `points` si siguen así al sonar la bocina. */
  | { kind: 'platform' | 'platformLost'; alliance: Alliance; count: number; points: number; section: string; sound: RefSound }
  /** Muestra Crítica de `alliance` en la Repisa (o fuera de ella otra vez). */
  | { kind: 'critical' | 'criticalLost'; alliance: Alliance; points: number; section: string; sound: RefSound };

/** Sección de cada tarjeta: Yellow §4.3.2, Red §4.3.3 (2 Yellow = Red). */
export const CARD_SECTION = { YELLOW: '§4.3.2', RED: '§4.3.3' } as const;
/** Plataforma y Muestra Crítica: valores de §4.4, evaluados al sonar la bocina (§4.3.1). */
export const ENDGAME_SECTION = '§4.4, §4.3.1';

/** Aviso de una falta o tarjeta del match (los demás eventos no son del árbitro). */
export function callForEvent(e: MatchEvent, cfg: GameConfig): RefCall | null {
  if (e.type === 'foul') {
    const tech = e.foul.kind === 'TECH';
    return {
      kind: tech ? 'tech' : 'foul',
      alliance: e.foul.offender,
      robot: e.foul.robot,
      rule: e.foul.rule,
      points: tech ? cfg.fouls.tech : cfg.fouls.foul,
      section: RULES[e.foul.rule].section,
      sound: tech ? 'whistle2' : 'whistle',
    };
  }
  if (e.type === 'card') {
    const red = e.card.type === 'RED';
    return { kind: red ? 'red' : 'yellow', alliance: e.card.alliance, robot: e.card.robot, reason: e.card.reason, section: CARD_SECTION[e.card.type], sound: 'card' };
  }
  return null;
}

/** Puntos de la Plataforma con `n` robots (no acumulable, §4.4). */
export function platformPoints(n: number, cfg: GameConfig): number {
  return n >= 2 ? cfg.points.platformTwo : n === 1 ? cfg.points.platformOne : 0;
}

/**
 * Segundos que un cambio debe sostenerse para anunciarse (SUPUESTO, D43): un robot que rebota al pie
 * de la rampa o una Muestra Crítica que se tambalea en la orilla no llenan la pantalla de avisos.
 */
export const ENDGAME_HOLD = 0.5;

/**
 * Vigila en el ENDGAME los robots sobre la Plataforma y la Muestra Crítica en la Repisa y avisa cada
 * cambio que dura `ENDGAME_HOLD` s. Solo informa: los puntos se dan al sonar la bocina (§4.3.1).
 */
export class EndgameWatcher {
  private said = { platform: { red: 0, blue: 0 }, critical: { red: false, blue: false } };
  private seen = { platform: { red: 0, blue: 0 }, critical: { red: false, blue: false } };
  private since = { platform: { red: 0, blue: 0 }, critical: { red: 0, blue: 0 } };

  constructor(public cfg: GameConfig) {}

  reset(): void {
    for (const a of ALLIANCES) {
      this.said.platform[a] = this.seen.platform[a] = 0;
      this.said.critical[a] = this.seen.critical[a] = false;
      this.since.platform[a] = this.since.critical[a] = 0;
    }
  }

  /** `platform`: robots de cada alianza sobre la Plataforma; `critical`: su Muestra Crítica en la Repisa. */
  update(dt: number, phase: Phase, platform: Record<Alliance, number>, critical: Record<Alliance, boolean>): RefCall[] {
    if (phase !== 'ENDGAME') {
      // Antes del ENDGAME no se anuncia (subir antes es Tech Foul, §4.6, y ya lo avisa la falta)
      if (phase !== 'DONE') this.reset();
      return [];
    }
    const out: RefCall[] = [];
    for (const a of ALLIANCES) {
      const n = platform[a];
      if (n !== this.seen.platform[a]) {
        this.seen.platform[a] = n;
        this.since.platform[a] = 0;
      } else this.since.platform[a] += dt;
      if (n !== this.said.platform[a] && this.since.platform[a] >= ENDGAME_HOLD) {
        const up = n > this.said.platform[a];
        this.said.platform[a] = n;
        out.push({ kind: up ? 'platform' : 'platformLost', alliance: a, count: n, points: platformPoints(n, this.cfg), section: ENDGAME_SECTION, sound: up ? 'chime' : 'chimeDown' });
      }
      const c = critical[a];
      if (c !== this.seen.critical[a]) {
        this.seen.critical[a] = c;
        this.since.critical[a] = 0;
      } else this.since.critical[a] += dt;
      if (c !== this.said.critical[a] && this.since.critical[a] >= ENDGAME_HOLD) {
        this.said.critical[a] = c;
        out.push({ kind: c ? 'critical' : 'criticalLost', alliance: a, points: c ? this.cfg.points.critical : 0, section: ENDGAME_SECTION, sound: c ? 'chime' : 'chimeDown' });
      }
    }
    return out;
  }
}

/** Alianza que recibe los puntos de una falta (la contraria a la que la comete, §4.5–§4.6). */
export const beneficiary = (c: RefCall): Alliance => (c.kind === 'foul' || c.kind === 'tech' ? opponent(c.alliance) : c.alliance);
