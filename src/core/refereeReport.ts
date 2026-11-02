/**
 * Reporte del árbitro virtual (lógica pura, sin DOM): al terminar el match explica cada falta con su
 * regla (§ del manual), cuántos puntos le dio al contrario y si cambió el resultado y los RP.
 *
 * - Foul = 4 puntos al contrario (§4.5); Tech Foul = 8 (§4.6). El sim siempre los otorga (D30).
 * - RP (§4.4): victoria 2, empate 1, más Línea, Muestra Crítica y Dominio. Las faltas solo mueven el
 *   RP de victoria/empate (los otros tres no dependen de los puntos). Red Card: 0 puntos y 0 RP (D10).
 * - "Sin esta falta" (SUPUESTO D43): el árbitro quita los puntos de esa falta y vuelve a comparar los
 *   marcadores; todo lo demás del match queda igual. Es una cuenta, no una predicción de lo que habría
 *   pasado en la cancha.
 */
import type { GameConfig } from '../config/game';
import { formatTimer, phaseAt, timerSeconds } from './clock';
import { RULES, type CardType, type FoulKind, type RuleCode } from './fouls';
import type { Breakdown, Match, RpBreakdown } from './match';
import { ALLIANCES, opponent, type Alliance } from './types';

export type Outcome = Alliance | 'tie';
export type FoulPeriod = 'AUTO' | 'TELEOP' | 'ENDGAME';

export interface FoulLine {
  /** Número de falta en orden de tiempo (1, 2, …). */
  n: number;
  /** Segundos desde el inicio del match. */
  time: number;
  /** Lo que marcaba el timer de la arena (AUTO 0:15→0:00, TELEOP 2:15→0:00). */
  clock: string;
  period: FoulPeriod;
  offender: Alliance;
  /** Índice global del robot (0–1 rojo, 2–3 azul). */
  robot: number;
  /** Robot dentro de su alianza: 1 o 2. */
  slot: number;
  rule: RuleCode;
  kind: FoulKind;
  label: 'Foul' | 'Tech Foul';
  section: string;
  description: string;
  /** Si el criterio del árbitro sale de un SUPUESTO (docs/reglas-reto.md). */
  supuesto?: string;
  /** Puntos que recibe la alianza contraria. */
  points: number;
  beneficiary: Alliance;
  /** RP que tendría cada alianza sin esta falta, menos los que tiene (0 = no cambió nada). */
  rpSwing: Record<Alliance, number>;
  /** Sin esta falta el resultado (victoria, empate o derrota) habría sido otro. */
  decisive: boolean;
  /** Veces que este robot ya había cometido esta misma regla antes en el match (0 = primera). */
  repeat: number;
}

export interface CardLine {
  type: CardType;
  alliance: Alliance;
  robot: number;
  slot: number;
  time: number;
  clock: string;
  reason: string;
  /** §4.3.3: 2 Yellow = Red; la Red hace perder todos los puntos (D10: a toda la alianza). */
  section: string;
}

export interface AllianceRefSummary {
  /** Faltas que cometió (Foul + Tech Foul). */
  committed: number;
  fouls: number;
  techs: number;
  /** Puntos que le regaló al contrario. */
  pointsGiven: number;
  /** Puntos que recibió por faltas del contrario (`Breakdown.penalties`). */
  pointsReceived: number;
  /** Marcador real. */
  score: number;
  /** Marcador sin los puntos de faltas (ni dados ni recibidos). Con Red Card sigue en 0. */
  scoreWithoutFouls: number;
  rp: number;
  /** RP si nadie hubiera cometido faltas. */
  rpWithoutFouls: number;
  redCard: boolean;
  /** Puntos que borró la Red Card (subtotal antes de quedar en 0). */
  lostToRedCard: number;
  /** RP que habría tenido sin la Red Card (con el marcador del contrario igual). */
  rpWithoutRedCard: number;
}

export interface RobotRefSummary {
  robot: number;
  alliance: Alliance;
  slot: number;
  fouls: number;
  techs: number;
  pointsGiven: number;
  /** Reglas que rompió, con cuántas veces cada una (orden: más veces primero). */
  rules: Array<{ rule: RuleCode; count: number }>;
}

export interface RefereeReport {
  fouls: FoulLine[];
  cards: CardLine[];
  alliances: Record<Alliance, AllianceRefSummary>;
  /** Solo los robots que cometieron alguna falta o tarjeta, en orden de puntos regalados. */
  robots: RobotRefSummary[];
  outcome: {
    actual: Outcome;
    /** Resultado si nadie hubiera cometido faltas (las tarjetas se quedan). */
    withoutFouls: Outcome;
    /** Las faltas cambiaron el resultado. */
    decidedByFouls: boolean;
    /** Diferencia final (rojo − azul) y sin faltas. */
    margin: number;
    marginWithoutFouls: number;
  };
  /** Match sin faltas ni tarjetas. */
  clean: boolean;
  /** Códigos de SUPUESTO que usó el árbitro en este match (D7, D11, …). */
  supuestos: string[];
}

const outcomeOf = (red: number, blue: number): Outcome => (red === blue ? 'tie' : red > blue ? 'red' : 'blue');

/** RP de victoria/empate (§4.4) para `a` con este resultado. */
function winRp(o: Outcome, a: Alliance, cfg: GameConfig): number {
  return o === 'tie' ? cfg.rp.tie : o === a ? cfg.rp.win : 0;
}

/** RP de `a` con otro resultado: cambia solo el de victoria/empate; Red Card = 0 (D10). */
function rpWith(rp: RpBreakdown, o: Outcome, a: Alliance, redCard: boolean, cfg: GameConfig): number {
  if (redCard) return 0;
  return winRp(o, a, cfg) + (rp.autoLine ? cfg.rp.autoLine : 0) + (rp.critical ? cfg.rp.critical : 0) + (rp.dominance ? cfg.rp.dominance : 0);
}

/** Puntos que le da al contrario una falta de este tipo (§4.5, §4.6). */
export function foulPoints(kind: FoulKind, cfg: GameConfig): number {
  return kind === 'TECH' ? cfg.fouls.tech : cfg.fouls.foul;
}

/** Código del SUPUESTO al inicio del texto ("D11: …" → "D11"). */
const supuestoCode = (s: string | undefined): string | undefined => s?.match(/^D\d+/)?.[0];

export function buildRefereeReport(m: Match): RefereeReport {
  const cfg = m.cfg;
  const per = m.robotsPerAlliance;
  const slot = (robot: number) => (robot % per) + 1;
  const clock = (time: number) => formatTimer(timerSeconds(time, cfg));
  const b = { red: m.breakdown('red'), blue: m.breakdown('blue') } as Record<Alliance, Breakdown>;
  const rp = { red: m.rankingPoints('red'), blue: m.rankingPoints('blue') } as Record<Alliance, RpBreakdown>;
  const actual = outcomeOf(b.red.total, b.blue.total);
  /** Marcador quitándole `minus` puntos a cada alianza (Red Card: sigue en 0). */
  const scoreMinus = (a: Alliance, minus: number) => (b[a].redCard ? 0 : b[a].subtotal - minus);

  const seen = new Map<string, number>();
  const sorted = m.fouls.map((f, i) => ({ f, i })).sort((x, y) => x.f.time - y.f.time || x.i - y.i);
  const fouls: FoulLine[] = sorted.map(({ f }, k) => {
    const rule = RULES[f.rule];
    const points = foulPoints(f.kind, cfg);
    const beneficiary = opponent(f.offender);
    const minus: Record<Alliance, number> = { red: 0, blue: 0 };
    minus[beneficiary] = points;
    const o = outcomeOf(scoreMinus('red', minus.red), scoreMinus('blue', minus.blue));
    const rpSwing = {} as Record<Alliance, number>;
    for (const a of ALLIANCES) rpSwing[a] = rpWith(rp[a], o, a, b[a].redCard, cfg) - rp[a].total;
    const key = `${f.robot}:${f.rule}`;
    const repeat = seen.get(key) ?? 0;
    seen.set(key, repeat + 1);
    const p = phaseAt(f.time, cfg);
    const period: FoulPeriod = p === 'AUTO' || p === 'PAUSE' || p === 'PRE' ? 'AUTO' : p === 'ENDGAME' || p === 'DONE' ? 'ENDGAME' : 'TELEOP';
    return {
      n: k + 1,
      time: f.time,
      clock: clock(f.time),
      period,
      offender: f.offender,
      robot: f.robot,
      slot: slot(f.robot),
      rule: f.rule,
      kind: f.kind,
      label: f.kind === 'TECH' ? 'Tech Foul' : 'Foul',
      section: rule.section,
      description: rule.es,
      ...(rule.supuesto ? { supuesto: rule.supuesto } : {}),
      points,
      beneficiary,
      rpSwing,
      decisive: o !== actual,
      repeat,
    };
  });

  const cards: CardLine[] = [...m.cards]
    .sort((x, y) => x.time - y.time)
    .map((c) => ({ type: c.type, alliance: c.alliance, robot: c.robot, slot: slot(c.robot), time: c.time, clock: clock(c.time), reason: c.reason, section: '§4.3.3' }));

  const noFouls = { red: scoreMinus('red', b.red.penalties), blue: scoreMinus('blue', b.blue.penalties) };
  const withoutFouls = outcomeOf(noFouls.red, noFouls.blue);
  const alliances = {} as Record<Alliance, AllianceRefSummary>;
  for (const a of ALLIANCES) {
    const mine = fouls.filter((f) => f.offender === a);
    const o = opponent(a);
    // Sin la Red Card: su subtotal contra el marcador real del contrario
    const sub = b[a].subtotal;
    const noRed = a === 'red' ? outcomeOf(sub, b[o].total) : outcomeOf(b[o].total, sub);
    alliances[a] = {
      committed: mine.length,
      fouls: mine.filter((f) => f.kind === 'FOUL').length,
      techs: mine.filter((f) => f.kind === 'TECH').length,
      pointsGiven: mine.reduce((s, f) => s + f.points, 0),
      pointsReceived: b[a].penalties,
      score: b[a].total,
      scoreWithoutFouls: noFouls[a],
      rp: rp[a].total,
      rpWithoutFouls: rpWith(rp[a], withoutFouls, a, b[a].redCard, cfg),
      redCard: b[a].redCard,
      lostToRedCard: b[a].redCard ? b[a].subtotal : 0,
      rpWithoutRedCard: b[a].redCard ? rpWith(rp[a], noRed, a, false, cfg) : rp[a].total,
    };
  }

  const byRobot = new Map<number, RobotRefSummary>();
  const robotOf = (robot: number, alliance: Alliance) => {
    let r = byRobot.get(robot);
    if (!r) byRobot.set(robot, (r = { robot, alliance, slot: slot(robot), fouls: 0, techs: 0, pointsGiven: 0, rules: [] }));
    return r;
  };
  for (const f of fouls) {
    const r = robotOf(f.robot, f.offender);
    if (f.kind === 'TECH') r.techs++;
    else r.fouls++;
    r.pointsGiven += f.points;
    const e = r.rules.find((x) => x.rule === f.rule);
    if (e) e.count++;
    else r.rules.push({ rule: f.rule, count: 1 });
  }
  for (const c of cards) robotOf(c.robot, c.alliance);
  const robots = [...byRobot.values()].sort((x, y) => y.pointsGiven - x.pointsGiven || x.robot - y.robot);
  for (const r of robots) r.rules.sort((x, y) => y.count - x.count);

  const supuestos = [...new Set(fouls.map((f) => supuestoCode(f.supuesto)).filter((s): s is string => !!s))].sort(
    (x, y) => Number(x.slice(1)) - Number(y.slice(1)),
  );

  return {
    fouls,
    cards,
    alliances,
    robots,
    outcome: {
      actual,
      withoutFouls,
      decidedByFouls: actual !== withoutFouls,
      margin: b.red.total - b.blue.total,
      marginWithoutFouls: noFouls.red - noFouls.blue,
    },
    clean: fouls.length === 0 && cards.length === 0,
    supuestos,
  };
}
