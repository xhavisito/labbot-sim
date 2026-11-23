/**
 * Pantalla del modo torneo (como la de rebuilt-sim). Los equipos salen del Scouting; tu equipo juega
 * sus matches en el simulador y los de los demás se ven (transmisión o desde las gradas) u omiten (se
 * simulan). Muestra rankings (general y por categoría), la selección de alianzas (§8.2.1: si eres
 * capitán invitas tú; cada equipo acepta o rechaza) y los PlayOffs (§8.2.2).
 */
import { allRobotIds, isCadId, robotSpec, type RobotId } from '../config/robotIds';
import { saveSettings, SETTINGS_RANGE } from '../config/settings';
import { GAME } from '../config/game';
import type { Settings } from '../config/settings';
import type { Match } from '../core/match';
import { rng } from '../core/rng';
import { addEvent, eventFromTournament, tournamentEventId } from '../core/history';
import { computeOpr, oprMatchesFromTournament } from '../core/opr';
import { predictAlliance, type TeamSummary } from '../core/scouting';
import {
  advancePlayoffs,
  allianceStates,
  dealRobots,
  ensureTeamRobots,
  aiAccepts,
  aiPick,
  allianceCountFor,
  allianceIndexOf,
  availableTeams,
  beginSelection,
  bracketState,
  createTournament,
  finalists,
  finalsWins,
  finishSelection,
  mustAccept,
  playoffWinner,
  rankings,
  respondInvite,
  resultFromMatch,
  sanitizeTournament,
  selectionTurn,
  seriesState,
  simulateMatch,
  standings,
  tournamentSummaries,
  type BracketSrc,
  type PlayoffFormat,
  type TeamEntry,
  type TMatch,
  type Tournament,
} from '../core/tournament';
import { loadHistory, saveHistory } from '../game/historyStore';
import type { ScoutData } from '../game/scoutStore';
import type { CameraMode } from '../render/CameraRig';
import { backBtn, brandbar, ic } from './chrome';
import { t, type Key } from './i18n';
import type { ScoutPlay } from './scoutPlay';

const KEY = 'labbot.tournament.v1';

/** Robots de los equipos del torneo: los CAD (los mismos que usa la IA en un match normal). */
const tourRobots = (): string[] => allRobotIds().filter(isCadId);

export function loadTournament(): Tournament | null {
  try {
    const tt = sanitizeTournament(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
    // Torneos guardados con robots de LabBot ya quitados: cada equipo recibe uno CAD
    if (tt && ensureTeamRobots(tt, tourRobots(), (id) => robotSpec(id as RobotId).mechanism)) saveTournament(tt);
    return tt;
  } catch {
    return null;
  }
}

export function saveTournament(tt: Tournament | null): void {
  try {
    if (tt) localStorage.setItem(KEY, JSON.stringify(tt));
    else localStorage.removeItem(KEY);
  } catch {
    /* sin almacenamiento */
  }
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const involvesPlayer = (tt: Tournament, m: TMatch) => [...m.red, ...m.blue].some((i) => tt.teams[i].isPlayer);

/** Lo que sigue en el torneo para el jugador. */
type Next =
  | { kind: 'play'; m: TMatch }
  | { kind: 'watch'; m: TMatch }
  | { kind: 'pick'; alliance: number }
  | { kind: 'invite'; alliance: number }
  | null;

/** Pestañas del ranking: general (RS), OPR (`core/opr.ts`) o por categoría (promedios del Scouting). */
type Tab = 'overall' | 'opr' | 'samples' | 'auto' | 'endgame' | 'fouls';
type Cat = Exclude<Tab, 'overall' | 'opr'>;
const CATS: Cat[] = ['samples', 'auto', 'endgame', 'fouls'];
const catValue = (s: TeamSummary, c: Cat): number => (c === 'samples' ? s.samples : c === 'auto' ? s.auto : c === 'endgame' ? s.endgame : s.foulPts);

/** Cámara para ver un match de otros: transmisión (desde arriba) o desde las gradas (libre). */
export type WatchMode = 'broadcast' | 'stands';
export const WATCH_CAMERA: Record<WatchMode, CameraMode> = { broadcast: 'top', stands: 'free' };

const LOGOS: Record<string, string> = { 'cad:axiom': 'logos/axiom.png', 'cad:phoenix': 'logos/phoenix.png', 'cad:psycho': 'logos/psycho.png', 'cad:hazmat-704': 'logos/hazmat-704.png', 'cad:mentores-3478': 'logos/mentores-3478.png' };

export class TournamentScreen {
  private cfg = { player: '', perTeam: 5, format: 'manual' as PlayoffFormat, others: 'ask' as 'ask' | 'skip' };
  private tab: Tab = 'overall';
  /** "Omitir hasta mi match": simula los demás sin preguntar hasta que le toque al jugador. */
  private skipToMine = false;
  private note = '';
  /** Torneo abierto (lo usa App para guardar el resultado del match jugado). */
  current: Tournament | null = null;

  constructor(
    private root: HTMLElement,
    private scout: ScoutData,
    private settings: Settings,
    private cb: { back: () => void; play: (p: ScoutPlay, watch?: WatchMode) => void },
  ) {}

  private on(sel: string, fn: (el: HTMLElement) => void, ev = 'click'): void {
    this.root.querySelectorAll<HTMLElement>(sel).forEach((el) => el.addEventListener(ev, () => fn(el)));
  }

  private show(html: string): void {
    const y = this.root.scrollTop;
    this.root.className = 'screen solid';
    this.root.innerHTML = `<div class="inner scout tour">${html}</div>`;
    this.root.style.display = '';
    this.root.scrollTop = y;
  }

  open(): void {
    const tt = this.current ?? loadTournament();
    if (!tt) this.setup();
    else this.view(tt);
  }

  /** Elegir robot en el lobby: igual que en el menú, la velocidad de los ajustes toma la suya. */
  private pickRobot(id: RobotId): void {
    const sp = robotSpec(id);
    this.settings.robotType = id;
    this.settings.maxSpeed = Math.min(SETTINGS_RANGE.maxSpeed.max, Math.round(sp.maxSpeed * 4) / 4);
    saveSettings(this.settings);
  }

  // ------------------------------------------------------------------ crear
  private setup(): void {
    this.current = null;
    const teams = this.scout.teams;
    const seg = (k: string, cur: string | number, opts: Array<[string | number, string]>) =>
      `<div class="seg" data-cfg="${k}">${opts.map(([v, l]) => `<button class="${v === cur ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>`;
    const robotIds = allRobotIds().filter(isCadId);
    if (robotIds.length && !robotIds.includes(this.settings.robotType)) this.pickRobot(robotIds[0]!);
    const spec = robotSpec(this.settings.robotType);
    const n = teams.length;
    this.show(`
      ${brandbar(t('tournament'))}
      <h1>${t('tournament')}</h1>
      <p class="sub">${t('tr_intro')}</p>
      <div class="panels"><div class="panel"><div class="form">
        <h3>${t('tr_setup')}</h3>
        <label>${t('tr_teams')}</label><div>${teams.map((x) => `<span class="team">${esc(x.name)}</span>`).join('')}</div>
        <label>${t('tr_yourTeam')}</label><div class="dim">${t('tr_randomTeam')}</div>
        <label>${t('yourRobot')}</label><div class="cards tr-robots">${robotIds.map((id) => `<button class="card ${id === this.settings.robotType ? 'sel' : ''}" data-rid="${id}" title="${esc(robotSpec(id).label ?? id)}" aria-label="${esc(robotSpec(id).label ?? id)}">${LOGOS[id] ? `<img class="logo-img" src="${LOGOS[id]}" alt="" width="64" height="64">` : `<span>${esc(robotSpec(id).label ?? id)}</span>`}</button>`).join('')}</div>
        <label>${t('sc_qualsPerTeam')}</label>${seg('perTeam', this.cfg.perTeam, [3, 4, 5, 6, 8].map((v) => [v, String(v)]))}
        <label>${t('tr_playoffs')}</label>${seg('format', this.cfg.format, [['manual', t('tr_fmt_manual')], ['doubleElim', t('tr_fmt_doubleElim')]])}
        <label>${t('tr_others')}</label>${seg('others', this.cfg.others, [['ask', t('tr_others_ask')], ['skip', t('tr_others_skip')]])}
        <p class="full msg">${t(this.cfg.format === 'manual' ? 'tr_fmtNote_manual' : 'tr_fmtNote_doubleElim', { n, a: allianceCountFor(n) })}</p>
      </div></div></div>
      <div class="actionbar">${backBtn('data-act="back"')}<div class="grow"></div>
        <button class="btn primary" data-act="create" ${n < 4 ? 'disabled' : ''}>${ic.trophy}<span>${t('tr_create')}</span></button></div>`);
    this.on('[data-act="back"]', () => this.cb.back());
    this.on('[data-rid]', (el) => {
      this.pickRobot(el.dataset.rid as RobotId);
      this.setup();
    });
    this.on('[data-cfg] button', (el) => {
      const k = (el.parentElement as HTMLElement).dataset.cfg!;
      const v = el.dataset.v!;
      if (k === 'perTeam') this.cfg.perTeam = Number(v);
      if (k === 'format') this.cfg.format = v as PlayoffFormat;
      if (k === 'others') this.cfg.others = v as 'ask' | 'skip';
      this.setup();
    });
    this.on('[data-act="create"]', () => {
      const seed = (Math.random() * 2 ** 32) >>> 0;
      const rand = rng(seed);
      // Equipo del jugador: al azar entre los de la lista
      this.cfg.player = teams[Math.floor(rand() * teams.length)]?.id ?? '';
      // Cada equipo lleva un robot CAD: el tuyo es el elegido aquí; los demás, repartidos al azar
      const robots = dealRobots(teams.length, teams.findIndex((x) => x.id === this.cfg.player), this.settings.robotType, tourRobots(), rand);
      const entries: TeamEntry[] = teams.map((x, i) => {
        const me = x.id === this.cfg.player;
        // Fuerza de la IA (SUPUESTO) para la simulación estadística; tu equipo juega con tu robot
        return { id: x.id, name: x.name, robot: me ? spec.mechanism : robotSpec(robots[i] as RobotId).mechanism, specId: robots[i], strength: me ? 0.6 : Math.round((0.35 + 0.5 * rand()) * 100) / 100, isPlayer: me };
      });
      const tt = createTournament(entries, this.cfg.perTeam, this.cfg.format, seed);
      tt.others = this.cfg.others;
      this.skipToMine = false;
      this.current = tt;
      saveTournament(tt);
      this.root.scrollTop = 0;
      this.view(tt);
    });
  }

  // ------------------------------------------------------------------ avance
  private rand(tt: Tournament): () => number {
    const s = tt.selection;
    return rng(tt.seed + tt.quals.filter((m) => m.result).length * 7919 + tt.playoffs.length * 31 + (s ? s.log.length * 131 : 0));
  }

  private asks(tt: Tournament): boolean {
    return (tt.others ?? 'ask') === 'ask' && !this.skipToMine;
  }

  /**
   * Avanza hasta lo siguiente que necesita al jugador: su match, un match de otros (para verlo u
   * omitirlo), su turno de invitar como capitán o una invitación a una alianza.
   */
  private advance(tt: Tournament): Next {
    const rand = this.rand(tt);
    for (const m of tt.quals) {
      if (m.result) continue;
      if (involvesPlayer(tt, m)) return { kind: 'play', m };
      if (this.asks(tt)) return { kind: 'watch', m };
      m.result = simulateMatch(tt, m, rand);
    }
    if (!tt.alliances) {
      if (!tt.selection) beginSelection(tt);
      for (let guard = 0; guard < 80; guard++) {
        const a = selectionTurn(tt);
        if (a === null) break;
        const captain = tt.selection!.alliances[a][0];
        if (tt.teams[captain].isPlayer) return { kind: 'pick', alliance: a };
        const team = aiPick(tt, a);
        if (tt.teams[team].isPlayer) {
          if (mustAccept(tt, team)) respondInvite(tt, team, a, true);
          else return { kind: 'invite', alliance: a };
          continue;
        }
        respondInvite(tt, team, a, aiAccepts(tt, team, a, rand));
      }
      finishSelection(tt);
    }
    for (let guard = 0; guard < 200 && tt.champion === null; guard++) {
      const pending = tt.playoffs.find((m) => !m.result);
      if (!pending) {
        advancePlayoffs(tt);
        if (!tt.playoffs.some((m) => !m.result)) break;
        continue;
      }
      if (involvesPlayer(tt, pending)) return { kind: 'play', m: pending };
      if (this.asks(tt)) return { kind: 'watch', m: pending };
      pending.result = simulateMatch(tt, pending, rand);
      advancePlayoffs(tt);
    }
    return null;
  }

  /** Match para el simulador: los 4 equipos con su tipo de robot; `player` = -1 para verlo. */
  private playOf(tt: Tournament, m: TMatch, watch: boolean): ScoutPlay {
    const ids = [...m.red, ...m.blue];
    return { match: m.id, teams: ids.map((i) => tt.teams[i].id), robots: ids.map((i) => this.robotOf(tt, i)), player: watch ? -1 : ids.findIndex((i) => tt.teams[i].isPlayer), tour: true, tourSeed: tt.seed };
  }

  /** Robot del equipo (`ensureTeamRobots` ya le dio uno CAD a cada equipo). */
  private robotOf(tt: Tournament, i: number): string {
    return tt.teams[i].specId ?? tourRobots()[i % Math.max(1, tourRobots().length)] ?? tt.teams[i].robot;
  }

  /** Nombre del robot del equipo, para las tablas. */
  private robotName(tt: Tournament, i: number): string {
    const sp = robotSpec(this.robotOf(tt, i) as RobotId);
    return esc(sp.label ?? t(`type_${sp.mechanism}` as Key));
  }

  /** Guarda el resultado del match jugado (o visto) en el simulador. Devuelve el aviso para resultados. */
  record(m: Match, p: ScoutPlay): string {
    const tt = this.current ?? loadTournament();
    // Solo en el torneo de ese match (no en uno nuevo con el mismo id) y con los mismos equipos
    const same = (x: TMatch) => [...x.red, ...x.blue].every((i, k) => tt!.teams[i]?.id === p.teams[k]);
    const tm = tt && (p.tourSeed === undefined || p.tourSeed === tt.seed) ? [...tt.quals, ...tt.playoffs].find((x) => x.id === p.match && !x.result && same(x)) : undefined;
    if (!tt || !tm) return '';
    tm.result = resultFromMatch(m, tt, tm);
    if (tm.kind !== 'qual') advancePlayoffs(tt);
    this.current = tt;
    saveTournament(tt);
    return t('tr_saved', { match: this.matchLabel(tt, tm) });
  }

  // ------------------------------------------------------------------ vista
  private matchLabel(tt: Tournament, m: TMatch): string {
    if (m.kind === 'qual') return m.id;
    if (m.kind === 'final') return `${t('br_final')} ${m.id.slice(1)}`;
    if (tt.playoffFormat === 'doubleElim') {
      const lower = !!bracketState(tt).format.slots.find((s) => s.n === m.slot)?.lower;
      return `${m.id.replace(/-R(\d+)/, ` (${t('br_replay')} $1)`)} · ${t(lower ? 'br_lower' : 'br_upper')}`;
    }
    const s = seriesState(tt).find((x) => x.n === m.slot);
    return s ? t('tr_seriesGame', { a: `A${s.a + 1}`, b: `A${s.b + 1}`, g: m.id.split('-')[1] }) : m.id;
  }

  private name(tt: Tournament, i: number): string {
    return esc(tt.teams[i].name);
  }

  private side(tt: Tournament, ids: number[]): string {
    return ids.map((i) => `<span class="team ${tt.teams[i].isPlayer ? 'me' : ''}">${this.name(tt, i)}</span>`).join('');
  }

  /** Línea de una alianza en una tarjeta de PlayOffs. */
  private brLine(tt: Tournament, a: number | undefined, tbd: string, score: string, won: boolean | null): string {
    const myA = tt.alliances!.findIndex((al) => al.some((i) => tt.teams[i].isPlayer));
    const out = a !== undefined && allianceStates(tt)[a]?.status === 'out';
    return a === undefined
      ? `<div class="br-team tbd"><span>${tbd}</span></div>`
      : `<div class="br-team ${won === true ? 'win' : won === false ? 'lose' : ''} ${a === myA ? 'me' : ''} ${out ? 'out' : ''}"><b>A${a + 1}</b><span class="br-cap">${this.name(tt, tt.alliances![a][0])}</span><span class="br-score">${score}</span></div>`;
  }

  /** Final a 2 de 3 (§8.2.2), en los dos formatos. */
  private finalCard(tt: Tournament, tbd: { red: string; blue: string }): string {
    const { red, blue } = finalists(tt);
    const fw = finalsWins(tt);
    const wins = (a: number | undefined) => (a === undefined ? '' : String(fw.get(a) ?? 0));
    const champ = (a: number | undefined) => (a === undefined || tt.champion === null ? null : tt.champion === a);
    const finals = tt.playoffs.filter((m) => m.kind === 'final');
    return `<div class="br-match br-final ${finals.some((m) => !m.result) ? 'next' : ''}"><div class="br-id">${t('br_final')} · ${t('br_bestOf3')}</div>
      <div class="br-side blue">${this.brLine(tt, blue, tbd.blue, wins(blue), champ(blue))}</div><div class="br-side red">${this.brLine(tt, red, tbd.red, wins(red), champ(red))}</div>
      ${finals.map((m) => { const w = playoffWinner(m); return `<div class="br-fgame">${m.id} <span>${m.result ? `${m.result.blue.score} – ${m.result.red.score}` : '—'}</span>${w ? ` <i class="sw ${w}"></i>` : ''}</div>`; }).join('')}</div>`;
  }

  /** Formato del manual: series del todos contra todos, tabla y final. */
  private roundRobinHtml(tt: Tournament): string {
    const cards = seriesState(tt)
      .map((s) => {
        const ms = tt.playoffs.filter((m) => m.kind === 'playoff' && m.slot === s.n);
        const won = (a: number) => (s.winner === undefined ? null : s.winner === a);
        return `<div class="br-match ${ms.some((m) => !m.result) ? 'next' : ''}"><div class="br-id">${t('tr_series')} ${s.n} · ${t('br_bestOf3')}</div>
          <div class="br-side red">${this.brLine(tt, s.a, '', String(s.winsA), won(s.a))}</div><div class="br-side blue">${this.brLine(tt, s.b, '', String(s.winsB), won(s.b))}</div>
          ${ms.map((m) => { const w = playoffWinner(m); return `<div class="br-fgame">${t('tr_game')} ${m.id.split('-')[1]} <span>${m.result ? `${m.result.blue.score} – ${m.result.red.score}` : '—'}</span>${w ? ` <i class="sw ${w}"></i>` : ''}</div>`; }).join('')}</div>`;
      })
      .join('');
    const st = standings(tt);
    const states = allianceStates(tt);
    const table = `<table class="stable"><tr><th>#</th><th>${t('tr_alliance')}</th><th class="num">${t('tr_seriesWL')}</th><th class="num">${t('tr_matchesWL')}</th><th class="num">${t('sc_points')}</th></tr>
      ${st.map((r, i) => `<tr class="${states[r.alliance]?.status === 'out' ? 'out' : ''}"><td class="mono">${i + 1}</td><td><b>A${r.alliance + 1}</b> ${this.side(tt, tt.alliances![r.alliance])}</td><td class="num">${r.seriesWon}–${r.seriesLost}</td><td class="num">${r.matchWins}–${r.matchLosses}</td><td class="num">${r.points}</td></tr>`).join('')}</table>`;
    return `<div class="panel wide"><h3>PlayOffs</h3><p class="sub">${t('tr_rrNote')}</p>
      <div class="bracket"><div class="br-trees"><div class="br-label">${t('tr_roundRobin')}</div><div class="rr-grid">${cards}</div></div>
      <div class="br-finals">${this.finalCard(tt, { red: t('tr_first'), blue: t('tr_second') })}</div></div>
      <div class="scroll">${table}</div></div>`;
  }

  /** Doble eliminación (rebuilt-sim): llave superior arriba, inferior abajo y la final a la derecha. */
  private bracketHtml(tt: Tournament): string {
    const st = bracketState(tt);
    const srcLabel = (src: BracketSrc) => ('seed' in src ? `A${src.seed}` : 'w' in src ? t('br_winnerOf', { n: src.w }) : t('br_loserOf', { n: src.l }));
    const card = (n: number) => {
      const slot = st.format.slots.find((x) => x.n === n)!;
      const sd = st.sides.get(n)!;
      const ms = tt.playoffs.filter((m) => m.kind === 'playoff' && m.slot === n);
      const last = ms[ms.length - 1];
      const out = st.outcomes.get(n);
      const sc = (c: 'red' | 'blue') => (last?.result ? String(last.result[c].score) : '');
      const redA = last ? allianceIndexOf(tt, last.red) : sd.red;
      const blueA = last ? allianceIndexOf(tt, last.blue) : sd.blue;
      const won = (a: number | undefined) => (out && a !== undefined ? out.w === a : null);
      const next = !out && last && !last.result;
      return `<div class="br-match ${next ? 'next' : ''}"><div class="br-id">M${n}${ms.length > 1 ? ` · ${t('br_replay')}` : ''}</div>
        <div class="br-side blue">${this.brLine(tt, blueA, srcLabel(slot.blue), sc('blue'), won(blueA))}</div><div class="br-side red">${this.brLine(tt, redA, srcLabel(slot.red), sc('red'), won(redA))}</div></div>`;
    };
    const cols = (lower: boolean) =>
      [...new Set(st.format.slots.filter((s) => s.lower === lower).map((s) => s.round))]
        .sort((a, b) => a - b)
        .map((r) => `<div class="br-col"><div class="br-round">${t('br_round', { n: r })}</div><div class="br-col-body">${st.format.slots.filter((s) => s.lower === lower && s.round === r).map((s) => card(s.n)).join('')}</div></div>`)
        .join('');
    return `<div class="panel wide"><h3>PlayOffs</h3><p class="sub">${t('br_double')}</p>
      <div class="bracket"><div class="br-trees"><div class="br-label">${t('br_upper')}</div><div class="br-tree">${cols(false)}</div>
      <div class="br-label">${t('br_lower')}</div><div class="br-tree">${cols(true)}</div></div>
      <div class="br-finals">${this.finalCard(tt, { red: t('br_winnerOf', { n: st.format.finals.red }), blue: t('br_winnerOf', { n: st.format.finals.blue }) })}</div></div></div>`;
  }

  view(tt: Tournament): void {
    this.current = tt;
    const next = this.advance(tt);
    if (next?.kind === 'play') this.skipToMine = false;
    saveTournament(tt);
    const rk = rankings(tt);
    const sum = tournamentSummaries(tt);
    const qsum = tournamentSummaries(tt, GAME, 'quals');
    const played = tt.quals.filter((m) => m.result).length;
    const sel = tt.selection;
    const alliancesNow = tt.alliances ?? sel?.alliances ?? null;
    // Estado de cada alianza: una sola fuente (`allianceStates`) para la lista, el bracket y la tabla
    const states = allianceStates(tt);
    const me = tt.teams.findIndex((x) => x.isPlayer);
    const placeTag = (i: number) => {
      const st = states[i];
      if (!st) return '';
      const p = st.place;
      if (st.status === 'alive' || st.status === 'final') return `<span class="br-place ${st.status === 'final' ? 'live' : ''}">${t(st.status === 'final' ? 'tr_st_final' : 'tr_st_alive')}</span>`;
      if (st.status === 'out') return `<span class="br-place out">${t('tr_st_out', { n: p ?? 0 })}</span>`;
      return `<span class="br-place ${p === 1 ? 'gold' : 'silver'}">${p === 1 ? ic.trophy : ''}${t('tr_placeN', { n: p ?? 0 })}</span>`;
    };
    const allianceList = alliancesNow
      ? alliancesNow.map((a, i) => `<div class="arow ${states[i]?.status === 'out' ? 'out' : ''}"><b>A${i + 1}</b>${this.side(tt, a)}${placeTag(i)}</div>`).join('')
      : `<div class="msg">${t('tr_afterQuals')}</div>`;
    const selLog = sel?.log.length
      ? `<div class="sel-log">${sel.log.map((l) => `<div>A${l.alliance + 1} → ${this.name(tt, l.team)} ${l.accepted ? `<span class="ok">✓ ${t('tr_accepted')}</span>` : `<span class="no">✗ ${t('tr_declined')}</span>`}</div>`).join('')}</div>`
      : '';
    const playoffs = tt.alliances ? (tt.playoffFormat === 'doubleElim' ? this.bracketHtml(tt) : this.roundRobinHtml(tt)) : '';
    const archived = tt.champion !== null && this.archive(tt);
    const champ =
      tt.champion !== null
        ? `<div class="msg ok champ">${ic.trophy}${t('tr_champion')}: A${tt.champion + 1} ${this.side(tt, tt.alliances![tt.champion])}${archived ? ` <span class="dim">· ${t('tr_archived')}</span>` : ''}</div>`
        : '';
    const inPlayoffs = tt.alliances?.some((a) => a.includes(me));
    const myA = tt.alliances?.findIndex((a) => a.includes(me)) ?? -1;
    const myPlace = myA >= 0 ? states[myA]?.place : undefined;
    const f1 = (v: number) => v.toFixed(1);
    const vs = (m: TMatch) => `<span class="sw blue"></span>${this.side(tt, m.blue)} <span class="dim">vs</span> <span class="sw red"></span>${this.side(tt, m.red)}`;
    // ---- Panel de lo que sigue
    let action = '';
    if (next?.kind === 'play') {
      const k = [...next.m.red, ...next.m.blue].indexOf(me);
      action = `<div class="panel next"><div class="nx-row"><div><b>${this.matchLabel(tt, next.m)}</b> ${vs(next.m)} <span class="tag ${k < 2 ? 'red' : 'blue'}">${t('tr_youAre', { s: `${t(k < 2 ? 'red' : 'blue')} ${(k % 2) + 1}` })}</span></div>
        <button class="btn primary" data-play>${ic.play}<span>${t('tr_play')} ${next.m.id}</span></button></div></div>`;
    } else if (next?.kind === 'watch')
      action = `<div class="panel next"><div><b>${this.matchLabel(tt, next.m)}</b> · ${t('tr_otherMatch')} &nbsp;${vs(next.m)}</div>
        <div class="row-actions"><button class="btn primary" data-watch="broadcast">${ic.tv}<span>${t('tr_watchBroadcast')}</span></button><button class="btn" data-watch="stands">${ic.field}<span>${t('tr_watchStands')}</span></button><button class="chipbtn" data-skip>${ic.skip}${t('tr_skip')}</button><button class="chipbtn" data-skipall>${ic.skipAll}${t('tr_skipToMine')}</button></div></div>`;
    else if (next?.kind === 'pick') {
      const pos = (i: number) => rk.findIndex((r) => r.team === i);
      const avail = availableTeams(tt).sort((a, b) => pos(a) - pos(b));
      const mine = qsum.get(me);
      action = `<div class="panel next"><h3>${t('tr_youPick', { a: `A${next.alliance + 1}` })}</h3><p class="sub">${t('tr_pickHelp')}</p>
        <div class="scroll"><table class="stable pick"><tr><th>#</th><th>${t('sc_team')}</th><th class="num">RS</th><th class="num">${t('stored')}</th><th class="num">AUTO</th><th class="num">END</th><th class="num">${t('tr_withYou')}</th><th></th></tr>
        ${avail
          .map((i) => {
            const r = pos(i);
            const s = qsum.get(i);
            const capOf = sel!.alliances.findIndex((al) => al[0] === i);
            const capTag = capOf >= 0 ? ` <span class="br-place gold">${t('tr_captainOf', { a: `A${capOf + 1}` })}</span>` : '';
            const pred = mine && s ? predictAlliance(mine, s, GAME) : null;
            return `<tr><td class="mono">${r + 1}</td><td>${this.name(tt, i)} <span class="dim">${this.robotName(tt, i)}</span>${capTag}</td><td class="num">${rk[r].rs.toFixed(2)}</td>
              <td class="num">${s ? f1(s.samples) : '–'}</td><td class="num">${s ? f1(s.auto) : '–'}</td><td class="num">${s ? f1(s.endgame) : '–'}</td><td class="num strong">${pred ? Math.round(pred.points - pred.foulPts) : '–'}</td>
              <td><button class="chipbtn" data-invite="${i}">${t('tr_invite')}</button></td></tr>`;
          })
          .join('')}</table></div>
        <p class="sub">${t('tr_rank2Note')}</p>${this.note ? `<div class="msg warn">${this.note}</div>` : ''}</div>`;
    } else if (next?.kind === 'invite') {
      const capt = sel!.alliances[next.alliance][0];
      const must = mustAccept(tt, me);
      action = `<div class="panel next"><h3>${t('tr_invitedBy', { team: this.name(tt, capt), a: `A${next.alliance + 1}` })}</h3><div>${this.side(tt, sel!.alliances[next.alliance])}</div>
        <p class="msg">${must ? t('tr_mustAccept') : sel!.alliances.some((al) => al[0] === me) ? t('tr_captainDeclineHelp') : t('tr_declineHelp')}</p>
        <div class="row-actions"><button class="btn primary" data-accept>${ic.check}<span>${t('tr_accept')}</span></button>${must ? '' : `<button class="btn" data-decline>${ic.x}<span>${t('tr_decline')}</span></button>`}</div></div>`;
    } else if (tt.alliances && !inPlayoffs) action = `<div class="msg warn">${t('tr_notPicked')}</div>`;
    else if (myPlace !== undefined && myPlace > 1) action = `<div class="msg warn">${myPlace === 2 ? t('tr_finalist') : t('tr_eliminated', { n: myPlace })}</div>`;
    // ---- Ranking: general o por categoría
    const tabs = `<div class="seg" data-tabs>${(['overall', 'opr', ...CATS] as Tab[]).map((c) => `<button class="${c === this.tab ? 'on' : ''}" data-v="${c}">${t(`tr_cat_${c}` as Key)}</button>`).join('')}</div>`;
    const teamCell = (i: number) => `${this.name(tt, i)} <span class="dim">${this.robotName(tt, i)}</span>`;
    const table =
      this.tab === 'overall'
        ? `<table class="stable rank"><tr><th>#</th><th>${t('sc_team')}</th><th class="num">RS</th><th class="num">${t('tr_avgPts')}</th><th class="num">AUTO</th><th class="num">END</th><th class="num">M</th></tr>
          ${rk.map((r, i) => `<tr class="${tt.teams[r.team].isPlayer ? 'me' : ''}"><td class="mono">${i + 1}</td><td>${teamCell(r.team)}</td><td class="num strong">${r.rs.toFixed(2)}</td><td class="num">${r.avgNoFoul.toFixed(0)}</td><td class="num">${f1(r.avgAuto)}</td><td class="num">${f1(r.avgEndgame)}</td><td class="num">${r.played}</td></tr>`).join('')}</table>`
        : this.tab === 'opr'
          ? (() => {
              const ms = oprMatchesFromTournament(tt, 'quals');
              const by = new Map(computeOpr(ms).map((r) => [r.team, r]));
              const rows = tt.teams.map((x, i) => ({ i, r: by.get(x.id) })).sort((a, b) => (b.r?.opr ?? -Infinity) - (a.r?.opr ?? -Infinity) || a.i - b.i);
              const sg = (v: number) => `${v > 0 ? '+' : ''}${f1(v)}`;
              return `<p class="sub">${t('tr_cat_oprHelp')}</p><table class="stable rank"><tr><th>#</th><th>${t('sc_team')}</th><th class="num">OPR</th><th class="num">DPR</th><th class="num">CCWM</th><th class="num">M</th></tr>
                ${rows.map((x, k) => `<tr class="${tt.teams[x.i].isPlayer ? 'me' : ''}"><td class="mono">${k + 1}</td><td>${teamCell(x.i)}</td><td class="num strong">${x.r ? f1(x.r.opr) : '–'}</td><td class="num">${x.r ? f1(x.r.dpr) : '–'}</td><td class="num">${x.r ? sg(x.r.ccwm) : '–'}</td><td class="num">${x.r?.matches ?? 0}</td></tr>`).join('')}</table>`;
            })()
          : (() => {
            const c = this.tab as Cat;
            const rows = tt.teams.map((_, i) => ({ i, s: sum.get(i) })).sort((a, b) => (c === 'fouls' ? 1 : -1) * ((a.s ? catValue(a.s, c) : 0) - (b.s ? catValue(b.s, c) : 0)) || a.i - b.i);
            return `<p class="sub">${t(`tr_catHelp_${c}` as Key)}</p><table class="stable rank"><tr><th>#</th><th>${t('sc_team')}</th><th class="num">${t(`tr_cat_${c}` as Key)}</th><th class="num">M</th></tr>
              ${rows.map((r, k) => `<tr class="${tt.teams[r.i].isPlayer ? 'me' : ''}"><td class="mono">${k + 1}</td><td>${teamCell(r.i)}</td><td class="num strong">${r.s ? f1(catValue(r.s, c)) : '–'}</td><td class="num">${r.s?.matches ?? 0}</td></tr>`).join('')}</table>`;
          })();
    const quals = tt.quals
      .map((m) => `<tr class="${m.result ? 'done' : ''} ${involvesPlayer(tt, m) ? 'me' : ''}"><td class="mono">${m.id}</td><td class="al blue">${this.side(tt, m.blue)}</td><td class="sc">${m.result ? `<b class="b">${m.result.blue.score}</b>–<b class="r">${m.result.red.score}</b>` : '–'}</td><td class="al red">${this.side(tt, m.red)}</td></tr>`)
      .join('');
    this.show(`
      ${brandbar(`${t('tournament')} · ${t(tt.playoffFormat === 'manual' ? 'tr_fmt_manual' : 'tr_fmt_doubleElim')}`)}
      <h1>${t('tournament')}</h1>
      ${champ}
      ${action}
      ${playoffs}
      <div class="panels">
        <div class="panel"><h3>${t('tr_rankings')} <small class="dim">(${played}/${tt.quals.length} Qualifications)</small></h3>
          ${tabs}<div class="scroll">${table}</div></div>
        <div class="panel"><h3>${t('tr_alliances')}</h3><div class="alist">${allianceList}</div>${selLog}
          <h3 class="mt">Qualifications</h3><div class="scroll"><table class="stable sched">${quals}</table></div></div>
      </div>
      <div class="actionbar">${backBtn('data-act="back"')}<div class="grow"></div>
        <button class="btn" data-act="new">${ic.reset}<span>${t('tr_new')}</span></button></div>`);
    this.note = '';
    this.on('[data-act="back"]', () => this.cb.back());
    this.on('[data-act="new"]', (el) => {
      // Dos toques: el primero arma el botón (se pierde el torneo guardado)
      if (!el.classList.toggle('armed')) {
        saveTournament(null);
        this.root.scrollTop = 0;
        this.setup();
      } else (el.querySelector('span') as HTMLElement).textContent = t('tr_newConfirm');
    });
    this.on('[data-tabs] button', (el) => {
      this.tab = el.dataset.v as Tab;
      this.view(tt);
    });
    const m = next && (next.kind === 'play' || next.kind === 'watch') ? next.m : null;
    this.on('[data-play]', () => m && this.cb.play(this.playOf(tt, m, false)));
    this.on('[data-watch]', (b) => m && this.cb.play(this.playOf(tt, m, true), b.dataset.watch as WatchMode));
    this.on('[data-skip]', () => {
      if (m) m.result = simulateMatch(tt, m, this.rand(tt));
      if (m?.kind !== 'qual') advancePlayoffs(tt);
      this.view(tt);
    });
    this.on('[data-skipall]', () => {
      this.skipToMine = true;
      this.view(tt);
    });
    this.on('[data-invite]', (b) => {
      if (next?.kind !== 'pick') return;
      const team = Number(b.dataset.invite);
      const ok = aiAccepts(tt, team, next.alliance, this.rand(tt));
      respondInvite(tt, team, next.alliance, ok);
      this.note = ok || mustAccept(tt, team) ? '' : t('tr_teamDeclined', { team: this.name(tt, team) });
      this.view(tt);
    });
    const answer = (ok: boolean) => {
      if (next?.kind !== 'invite') return;
      respondInvite(tt, me, next.alliance, ok);
      this.view(tt);
    };
    this.on('[data-accept]', () => answer(true));
    this.on('[data-decline]', () => answer(false));
  }

  /** Guarda el torneo terminado en el historial (una sola vez por torneo). Devuelve si ya está ahí. */
  private archive(tt: Tournament): boolean {
    const h = loadHistory();
    if (h.events.some((e) => e.id === tournamentEventId(tt))) return true;
    const now = new Date();
    const n = h.events.filter((e) => e.source === 'tournament').length + 1;
    const next = addEvent(h, eventFromTournament(tt, t('tr_eventName', { n, date: now.toISOString().slice(0, 10) }), now));
    saveHistory(next);
    return next.events.some((e) => e.id === tournamentEventId(tt));
  }
}
