/**
 * Estado y puntuación del match (lógica pura). La sesión le avisa lo que pasa en la física
 * (Muestra que entra a un nivel, robot que cruza la línea, faltas, evaluación final) y el match
 * calcula puntos y RP según §4.4–§4.6 con los números de `config/game.ts`.
 */
import type { GameConfig } from '../config/game';
import { bounds, phaseAt, type Phase } from './clock';
import { RULES, type CardRecord, type CardType, type FoulRecord, type RuleCode } from './fouls';
import { ALLIANCES, opponent, type Alliance, type Level } from './types';

export type MatchEvent =
  | { type: 'phase'; phase: Phase; prev: Phase }
  | { type: 'sample'; alliance: Alliance; level: Level; points: number }
  | { type: 'autoLine'; alliance: Alliance; robot: number }
  | { type: 'foul'; foul: FoulRecord }
  | { type: 'card'; card: CardRecord }
  | { type: 'end' };

export interface SampleRecord {
  level: Level;
  period: 'AUTO' | 'TELEOP';
  time: number;
}

export interface Breakdown {
  autoLine: number;
  samplesAuto: number;
  samplesTeleop: number;
  platform: number;
  critical: number;
  /** Puntos que recibe por faltas del contrario (§4.5, §4.6). */
  penalties: number;
  /** Suma antes de la Red Card. */
  subtotal: number;
  /** Red Card: pierde todos los puntos del match (§4.3.3; D10: toda la alianza). */
  redCard: boolean;
  total: number;
}

export interface RpBreakdown {
  win: number;
  autoLine: boolean;
  critical: boolean;
  dominance: boolean;
  total: number;
}

interface AllianceState {
  autoLine: Set<number>;
  samples: SampleRecord[];
  platformRobots: number;
  critical: boolean;
}

export class Match {
  t = -1;
  phase: Phase = 'PRE';
  finished = false;
  readonly fouls: FoulRecord[] = [];
  readonly cards: CardRecord[] = [];
  readonly state: Record<Alliance, AllianceState> = {
    red: { autoLine: new Set(), samples: [], platformRobots: 0, critical: false },
    blue: { autoLine: new Set(), samples: [], platformRobots: 0, critical: false },
  };
  /** Puntos en el tiempo (para la gráfica de resultados). */
  readonly history: Array<{ t: number; red: number; blue: number }> = [];
  private yellows = new Map<number, number>();
  private red = new Set<Alliance>();
  private pending: MatchEvent[] = [];

  constructor(
    readonly cfg: GameConfig,
    /** Robots por alianza (para el RP de la línea: "ambos robots", §4.4). */
    readonly robotsPerAlliance = 2,
  ) {}

  get running(): boolean {
    return this.t >= 0 && !this.finished;
  }

  start(): void {
    this.t = 0;
    this.setPhase('AUTO');
  }

  private setPhase(p: Phase): void {
    if (p === this.phase) return;
    const prev = this.phase;
    this.phase = p;
    this.pending.push({ type: 'phase', phase: p, prev });
  }

  /** Avanza el reloj y devuelve los eventos acumulados. */
  tick(dt: number): MatchEvent[] {
    if (this.running) {
      this.t += dt;
      const p = phaseAt(this.t, this.cfg);
      this.setPhase(p);
      const last = this.history[this.history.length - 1];
      if (!last || this.t - last.t >= 1) this.history.push({ t: this.t, red: this.score('red'), blue: this.score('blue') });
    }
    const out = this.pending;
    this.pending = [];
    return out;
  }

  /** Segundos que faltan para el final del TELEOP. */
  get remaining(): number {
    return bounds(this.cfg).teleopEnd - this.t;
  }

  // ------------------------------------------------------------------ Eventos de la física

  /**
   * Una Muestra entró al nivel `level` de la Cámara de `alliance`. Cuenta en todo momento del match
   * con el valor del periodo en que se deposita (§4.4; D4 resuelto). Fuera del match no cuenta
   * (sin gracia, D12). Devuelve los puntos otorgados.
   */
  scoreSample(alliance: Alliance, level: Level): number {
    if (!this.running || this.phase === 'DONE') return 0;
    const auto = this.phase === 'AUTO' || this.phase === 'PAUSE';
    const points = auto ? this.cfg.points.sampleAuto[level] : this.cfg.points.sampleTeleop[level];
    this.state[alliance].samples.push({ level, period: auto ? 'AUTO' : 'TELEOP', time: this.t });
    this.pending.push({ type: 'sample', alliance, level, points });
    return points;
  }

  /** Un robot salió por completo de su Zona de Inicio durante el AUTO (§4.4; D1). */
  crossAutoLine(alliance: Alliance, robot: number): boolean {
    if (this.phase !== 'AUTO') return false;
    const set = this.state[alliance].autoLine;
    if (set.has(robot)) return false;
    set.add(robot);
    this.pending.push({ type: 'autoLine', alliance, robot });
    return true;
  }

  /** El árbitro marca una falta. */
  foul(rule: RuleCode, offender: Alliance, robot: number): FoulRecord {
    const f: FoulRecord = { rule, kind: RULES[rule].kind, offender, robot, time: this.t };
    this.fouls.push(f);
    this.pending.push({ type: 'foul', foul: f });
    return f;
  }

  /** Tarjeta a un equipo (robot). 2 Yellow = Red (§4.3.3). */
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
    if (this.cards.some((c) => c.type === 'RED' && c.alliance === alliance)) this.red.add(alliance);
  }

  /**
   * Evaluación al sonar la bocina (§4.3.1): robots sobre la Plataforma y Muestra Crítica en la
   * Repisa. Termina el match.
   */
  finish(platformRobots: Record<Alliance, number>, critical: Record<Alliance, boolean>): void {
    if (this.finished) return;
    for (const a of ALLIANCES) {
      this.state[a].platformRobots = platformRobots[a];
      this.state[a].critical = critical[a];
    }
    this.finished = true;
    this.setPhase('DONE');
    this.history.push({ t: this.t, red: this.score('red'), blue: this.score('blue') });
    this.pending.push({ type: 'end' });
  }

  // ------------------------------------------------------------------ Puntuación

  breakdown(a: Alliance): Breakdown {
    const s = this.state[a];
    const P = this.cfg.points;
    const autoLine = s.autoLine.size * P.autoLine;
    let samplesAuto = 0;
    let samplesTeleop = 0;
    for (const r of s.samples) {
      if (r.period === 'AUTO') samplesAuto += P.sampleAuto[r.level];
      else samplesTeleop += P.sampleTeleop[r.level];
    }
    // No acumulable: 2 robots = 20 en total, no 10 + 20 (§4.4, nota)
    const platform = s.platformRobots >= 2 ? P.platformTwo : s.platformRobots === 1 ? P.platformOne : 0;
    const critical = s.critical ? P.critical : 0;
    const penalties = this.fouls
      .filter((f) => f.offender === opponent(a))
      .reduce((sum, f) => sum + (f.kind === 'TECH' ? this.cfg.fouls.tech : this.cfg.fouls.foul), 0);
    const subtotal = autoLine + samplesAuto + samplesTeleop + platform + critical + penalties;
    const redCard = this.red.has(a);
    return { autoLine, samplesAuto, samplesTeleop, platform, critical, penalties, subtotal, redCard, total: redCard ? 0 : subtotal };
  }

  score(a: Alliance): number {
    return this.breakdown(a).total;
  }

  /** Muestras anotadas en la Cámara de la alianza (para Dominio de Cámara). */
  samplesIn(a: Alliance): number {
    return this.state[a].samples.length;
  }

  /** Ranking Points (§4.4). Con Red Card: 0 (D10). */
  rankingPoints(a: Alliance): RpBreakdown {
    const R = this.cfg.rp;
    const s = this.state[a];
    const mine = this.score(a);
    const other = this.score(opponent(a));
    const win = mine > other ? R.win : mine === other ? R.tie : 0;
    const autoLine = s.autoLine.size >= this.robotsPerAlliance;
    const critical = s.critical;
    const dominance = this.samplesIn(a) >= R.dominanceSamples;
    const total = this.red.has(a) ? 0 : win + (autoLine ? R.autoLine : 0) + (critical ? R.critical : 0) + (dominance ? R.dominance : 0);
    return { win, autoLine, critical, dominance, total };
  }
}
