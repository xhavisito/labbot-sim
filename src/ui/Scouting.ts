/**
 * Pantalla de Scouting y estrategia: equipos del reto, calendario de clasificación (simular, jugar
 * o registrar cada match), captura manual de un match real, tabla por equipo y alianzas sugeridas
 * con su pronóstico. El formato del torneo no está en el manual: es SUPUESTO y se configura aquí.
 */
import { GAME } from '../config/game';
import { MECHANISM_KINDS, type MechanismKind } from '../config/robot';
import type { Match } from '../core/match';
import { bestPartners, entriesFromMatch, entryPoints, summarize, type LevelCounts, type Role, type ScoutEntry, type TeamSummary } from '../core/scouting';
import { addEvent, byRobotKind, careers, eventFromScouting, sanitizeHistory, seasons, teamEventRows, type HistoryData, type HistoryEvent } from '../core/history';
import { computeOpr, oprError, oprMatchesFromEntries, type OprMatch, type OprRow } from '../core/opr';
import { makeSchedule, predictPlayoffs, rankTeams, suggestDraft, type DraftAlliance, type QualMatch } from '../core/tournament';
import { loadHistory, saveHistory } from '../game/historyStore';
import { emptyScout, sanitizeScout, saveScout, scoutCsv, type ScoutData } from '../game/scoutStore';
import { simulateMatch } from '../sim/quickSim';
import { backBtn, brandbar, ic } from './chrome';
import { t, type Key } from './i18n';

export type ScoutTab = 'teams' | 'schedule' | 'record' | 'table' | 'opr' | 'robots' | 'alliances' | 'history';
const TABS: ScoutTab[] = ['schedule', 'table', 'opr', 'robots', 'alliances', 'history', 'record', 'teams'];

/** Partido del calendario que se juega en el simulador (lo usa App para el registro al terminar). */
export interface ScoutPlay {
  match: string;
  teams: string[];
  kinds: MechanismKind[];
  /** Robot que manejas (0–3); −1 = solo ver (la IA maneja los 4). */
  player: number;
  /** Match del modo torneo (`ui/TournamentScreen.ts`): el resultado va al torneo, no al Scouting. */
  tour?: boolean;
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const pct = (x: number): string => `${Math.round(100 * x)}%`;
const f1 = (x: number): string => x.toFixed(1);
const fN = (x: number | null | undefined, d = 1): string => (x === null || x === undefined ? '–' : x.toFixed(d));

/** Mini gráfica de línea (SVG) para tendencias: puntos por match, OPR por evento. */
export function sparkline(vals: readonly number[], w = 96, h = 26): string {
  if (vals.length < 2) return vals.length ? `<span class="spark-one">${f1(vals[0])}</span>` : '–';
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const y = (v: number) => (hi > lo ? h - 3 - ((v - lo) / (hi - lo)) * (h - 6) : h / 2);
  const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * (w - 4) + 2).toFixed(1)},${y(v).toFixed(1)}`);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts.join(' ')}"/><circle cx="${pts[pts.length - 1].split(',')[0]}" cy="${pts[pts.length - 1].split(',')[1]}" r="2.2"/></svg>`;
}

/**
 * Guarda los registros de un match del simulador. Si ese match ya tenía registros del mismo equipo
 * (se volvió a simular o jugar), los reemplaza.
 */
export function saveMatchEntries(data: ScoutData, m: Match, teams: readonly string[], match: string): ScoutEntry[] {
  const es = entriesFromMatch(m, teams, match);
  data.entries = data.entries.filter((e) => !(e.match === match && teams.includes(e.team))).concat(es);
  saveScout(data);
  return es;
}

export class ScoutingScreen {
  tab: ScoutTab = 'schedule';
  /** Equipo del que se ven los mejores compañeros. */
  private focus = '';
  /** Simulando matches (App deja de dibujar la cancha mientras tanto para no robarle tiempo). */
  busy = false;
  /** Formulario de captura (se conserva al cambiar de pestaña). */
  private draft: ScoutEntry | null = null;
  /** Equipo del perfil en la pestaña Robots. */
  private robotFocus = '';
  /** Historial: temporada filtrada ('' = todas) y evento abierto. */
  private season = '';
  private eventOpen = '';

  constructor(
    private root: HTMLElement,
    private data: ScoutData,
    private onBack: () => void,
    private onPlay: (p: ScoutPlay) => void,
  ) {}

  private save(): void {
    saveScout(this.data);
  }

  private name(id: string): string {
    return this.data.teams.find((x) => x.id === id)?.name ?? id;
  }

  private kind(id: string): MechanismKind {
    return this.data.teams.find((x) => x.id === id)?.robot ?? 'tower';
  }

  private chip(id: string, cls = ''): string {
    return `<span class="tchip ${cls}"><b>${esc(this.name(id))}</b><small>${t(`type_${this.kind(id)}` as Key)}</small></span>`;
  }

  private on(sel: string, fn: (el: HTMLElement) => void, ev = 'click'): void {
    this.root.querySelectorAll<HTMLElement>(sel).forEach((el) => el.addEventListener(ev, () => fn(el)));
  }

  show(tab: ScoutTab = this.tab): void {
    this.tab = tab;
    const body: Record<ScoutTab, () => string> = {
      teams: () => this.teamsHtml(),
      schedule: () => this.scheduleHtml(),
      record: () => this.recordHtml(),
      table: () => this.tableHtml(),
      opr: () => this.oprHtml(),
      robots: () => this.robotsHtml(),
      alliances: () => this.alliancesHtml(),
      history: () => this.historyHtml(),
    };
    const y = this.root.scrollTop;
    this.root.className = 'screen solid';
    this.root.innerHTML = `<div class="inner scout">
      ${brandbar(t('scouting'))}
      <h1>${t('scouting')}</h1>
      <p class="sub">${t('scoutNote', { n: this.data.entries.length })}</p>
      <div class="seg tabs">${TABS.map((k) => `<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${t(`sc_tab_${k}` as Key)}</button>`).join('')}</div>
      ${body[tab]()}
      <div class="actionbar">${backBtn('data-act="back"')}<div class="grow"></div>
        <button class="btn" data-act="export">${ic.download}<span>JSON</span></button>
        <button class="btn" data-act="csv">${ic.download}<span>CSV</span></button>
        <button class="btn" data-act="import">${ic.go}<span>${t('sc_import')}</span></button>
      </div></div>`;
    this.root.style.display = '';
    this.root.scrollTop = y;
    this.on('[data-tab]', (el) => {
      this.root.scrollTop = 0;
      this.show(el.dataset.tab as ScoutTab);
    });
    this.on('[data-act="back"]', () => this.onBack());
    this.on('[data-act="export"]', () => download(`labbot-scouting.json`, JSON.stringify(this.data, null, 1), 'application/json'));
    this.on('[data-act="csv"]', () => download(`labbot-scouting.csv`, scoutCsv(this.data, GAME), 'text/csv'));
    this.on('[data-act="import"]', () => this.importFile());
    const wire: Record<ScoutTab, () => void> = {
      teams: () => this.wireTeams(),
      schedule: () => this.wireSchedule(),
      record: () => this.wireRecord(),
      table: () => undefined,
      opr: () => undefined,
      robots: () => this.wireRobots(),
      alliances: () => this.wireAlliances(),
      history: () => this.wireHistory(),
    };
    wire[tab]();
  }

  private importFile(): void {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/json,.json';
    inp.addEventListener('change', async () => {
      const file = inp.files?.[0];
      if (!file) return;
      try {
        const d = sanitizeScout(JSON.parse(await file.text()));
        Object.assign(this.data, d);
        this.save();
      } catch {
        /* archivo inválido: no cambia nada */
      }
      this.show();
    });
    inp.click();
  }

  // ------------------------------------------------------------------ equipos
  private teamsHtml(): string {
    const opts = (sel: MechanismKind) => MECHANISM_KINDS.map((k) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${t(`type_${k}` as Key)}</option>`).join('');
    return `<div class="panels"><div class="panel">
      <h3>${t('sc_teams')}</h3>
      <p class="sub">${t('sc_teamsNote')}</p>
      <table class="stable teams">
        <tr><th>ID</th><th>${t('sc_name')}</th><th>${t('robotType')}</th><th></th></tr>
        ${this.data.teams
          .map(
            (tm, i) => `<tr><td class="mono">${esc(tm.id)}</td>
          <td><input class="tin" data-name="${i}" value="${esc(tm.name)}" maxlength="40"></td>
          <td><select data-robot="${i}">${opts(tm.robot)}</select></td>
          <td><button class="x" data-del="${i}" title="${t('clear')}" aria-label="${t('clear')}">${ic.x}</button></td></tr>`,
          )
          .join('')}
      </table>
      <div class="row-actions"><button class="btn" data-act="addTeam">+ ${t('sc_addTeam')}</button>
        <button class="btn ghost" data-act="wipe">${ic.reset}<span>${t('sc_wipe')}</span></button></div>
    </div></div>`;
  }

  private wireTeams(): void {
    this.on(
      '[data-name]',
      (el) => {
        this.data.teams[Number(el.dataset.name)].name = (el as HTMLInputElement).value.trim().slice(0, 40) || this.data.teams[Number(el.dataset.name)].id;
        this.save();
      },
      'change',
    );
    this.on(
      '[data-robot]',
      (el) => {
        this.data.teams[Number(el.dataset.robot)].robot = (el as HTMLSelectElement).value as MechanismKind;
        this.save();
      },
      'change',
    );
    this.on('[data-del]', (el) => {
      const tm = this.data.teams[Number(el.dataset.del)];
      if (this.data.teams.length <= 4) return; // un match necesita 4 equipos
      this.data.teams = this.data.teams.filter((x) => x !== tm);
      this.data.entries = this.data.entries.filter((e) => e.team !== tm.id);
      this.data.schedule = this.data.schedule.filter((q) => ![...q.red, ...q.blue].includes(tm.id));
      this.save();
      this.show();
    });
    this.on('[data-act="addTeam"]', () => {
      let n = this.data.teams.length + 1;
      while (this.data.teams.some((x) => x.id === `E${n}`)) n++;
      this.data.teams.push({ id: `E${n}`, name: `Equipo ${n}`, robot: 'tower' });
      this.save();
      this.show();
    });
    this.on('[data-act="wipe"]', () => {
      if (!this.root.querySelector('[data-act="wipe"]')!.classList.toggle('armed')) {
        Object.assign(this.data, emptyScout());
        this.save();
        this.show();
      } else (this.root.querySelector('[data-act="wipe"] span') as HTMLElement).textContent = t('sc_wipeConfirm');
    });
  }

  // ------------------------------------------------------------------ calendario
  private scheduleHtml(): string {
    const f = this.data.tournament;
    const seg = (k: string, cur: string | number, opts: Array<[string | number, string]>) =>
      `<div class="seg" data-fmt="${k}">${opts.map(([v, l]) => `<button class="${v === cur ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>`;
    const done = new Set(this.data.entries.map((e) => e.match));
    const sched = this.data.schedule;
    const rows = sched
      .map((q) => {
        const has = done.has(q.id);
        const res = has ? this.matchScore(q) : null;
        return `<tr class="${has ? 'done' : ''}"><td class="mono">${q.id}</td>
          <td class="al red">${q.red.map((x) => this.chip(x)).join('')}</td>
          <td class="sc">${res ? `<b class="r">${res.red}</b>–<b class="b">${res.blue}</b>` : '–'}</td>
          <td class="al blue">${q.blue.map((x) => this.chip(x)).join('')}</td>
          <td class="acts"><button class="chipbtn" data-sim="${q.id}">${t('sc_sim')}</button>
            <button class="chipbtn" data-play="${q.id}">${t('sc_play')}</button>
            <button class="chipbtn" data-rec="${q.id}">${t('sc_record')}</button></td></tr>`;
      })
      .join('');
    return `<div class="panels"><div class="panel"><div class="form">
        <h3>${t('sc_format')}</h3>
        <p class="full msg">${t('sc_formatNote')}</p>
        <label>${t('sc_qualsPerTeam')}</label>${seg('qualsPerTeam', f.qualsPerTeam, [3, 4, 5, 6, 8].map((n) => [n, String(n)]))}
        <label>${t('sc_alliances')}</label>${seg('alliances', f.alliances, [2, 3, 4].map((n) => [n, String(n)]))}
        <label>${t('sc_allianceSize')}</label>${seg('allianceSize', f.allianceSize, [[2, '2'], [3, t('sc_size3')]])}
        <label>${t('sc_draft')}</label>${seg('draft', f.draft, [['serpentine', t('sc_serpentine')], ['straight', t('sc_straight')]])}
        <label>${t('sc_rankBy')}</label>${seg('rankBy', f.rankBy, [['rp', 'RP'], ['points', t('sc_points')]])}
        <div class="full row-actions"><button class="btn primary" data-act="gen">${ic.reset}<span>${t('sc_generate')}</span></button>
          ${sched.length ? `<button class="btn" data-act="simAll">${ic.play}<span>${t('sc_simAll')}</span></button>` : ''}</div>
        <div class="full simprog" data-prog hidden><i></i><span></span></div>
      </div></div></div>
      ${
        sched.length
          ? `<div class="panel wide"><h3>${t('sc_schedule')} · ${t('sc_nMatches', { n: sched.length })}</h3>
            <div class="scroll"><table class="stable sched">${rows}</table></div>
            <p class="sub">${t('sc_scheduleNote')}</p></div>`
          : `<p class="msg">${t('sc_noSchedule')}</p>`
      }`;
  }

  /** Marcador de un match del calendario según sus registros (el de la alianza que los trae). */
  private matchScore(q: QualMatch): { red: number | string; blue: number | string } {
    const es = this.data.entries.filter((e) => e.match === q.id);
    const red = es.find((e) => e.alliance === 'red' && e.allianceScore !== undefined)?.allianceScore;
    const blue = es.find((e) => e.alliance === 'blue' && e.allianceScore !== undefined)?.allianceScore;
    return { red: red ?? '?', blue: blue ?? '?' };
  }

  private wireSchedule(): void {
    this.on('[data-fmt] button', (el) => {
      const k = (el.parentElement as HTMLElement).dataset.fmt!;
      const v = el.dataset.v!;
      const f = this.data.tournament as unknown as Record<string, unknown>;
      f[k] = /^\d+$/.test(v) ? Number(v) : v;
      this.save();
      this.show();
    });
    this.on('[data-act="gen"]', () => {
      this.data.schedule = makeSchedule(
        this.data.teams.map((x) => x.id),
        this.data.tournament.qualsPerTeam,
        (Date.now() % 100000) + 1,
      );
      this.save();
      this.show();
    });
    const find = (id: string) => this.data.schedule.find((q) => q.id === id)!;
    this.on('[data-sim]', (el) => void this.simulate([find(el.dataset.sim!)]));
    this.on('[data-act="simAll"]', () => {
      const done = new Set(this.data.entries.map((e) => e.match));
      const todo = this.data.schedule.filter((q) => !done.has(q.id));
      void this.simulate(todo.length ? todo : this.data.schedule);
    });
    this.on('[data-play]', (el) => this.pickSlot(find(el.dataset.play!)));
    this.on('[data-rec]', (el) => {
      const q = find(el.dataset.rec!);
      this.draft = this.blankEntry(q.id, q.red[0], 'red');
      this.show('record');
    });
  }

  /** Simula los matches sin dibujarlos (uno tras otro) y guarda sus registros. */
  private async simulate(list: QualMatch[]): Promise<void> {
    if (this.busy || !list.length) return;
    this.busy = true;
    const prog = this.root.querySelector<HTMLElement>('[data-prog]');
    const bar = prog?.querySelector('i') as HTMLElement | undefined;
    const txt = prog?.querySelector('span') as HTMLElement | undefined;
    this.root.querySelectorAll<HTMLButtonElement>('[data-sim],[data-play],[data-act="simAll"],[data-act="gen"]').forEach((b) => (b.disabled = true));
    if (prog) prog.hidden = false;
    try {
      for (let i = 0; i < list.length; i++) {
        const q = list[i];
        const teams = [...q.red, ...q.blue];
        const m = await simulateMatch(
          teams.map((x) => this.kind(x)),
          Number(q.id.replace(/\D/g, '')) * 7919 + Date.now() % 997,
          (f) => {
            if (bar) bar.style.width = `${(100 * (i + f)) / list.length}%`;
            if (txt) txt.textContent = `${q.id} · ${i + 1}/${list.length}`;
          },
        );
        saveMatchEntries(this.data, m, teams, q.id);
      }
    } finally {
      this.busy = false;
      this.show();
    }
  }

  /** Elegir con qué robot del match juegas tú. */
  private pickSlot(q: QualMatch): void {
    const teams = [...q.red, ...q.blue];
    const dlg = document.createElement('div');
    dlg.className = 'overlay';
    dlg.innerHTML = `<div class="dialog pick">
      <div class="kicker"><span></span>${q.id}</div>
      <h2>${t('sc_pickRobot')}</h2>
      <div class="pickgrid">${teams.map((x, i) => `<button class="${i < 2 ? 'red' : 'blue'}" data-slot="${i}">${this.chip(x)}</button>`).join('')}</div>
      <div class="actions"><button class="btn" data-x>${t('back')}</button></div></div>`;
    this.root.appendChild(dlg);
    dlg.querySelector('[data-x]')!.addEventListener('click', () => dlg.remove());
    dlg.querySelectorAll<HTMLElement>('[data-slot]').forEach((b) =>
      b.addEventListener('click', () => {
        dlg.remove();
        this.onPlay({ match: q.id, teams, kinds: teams.map((x) => this.kind(x)), player: Number(b.dataset.slot) });
      }),
    );
  }

  // ------------------------------------------------------------------ captura manual
  private blankEntry(match: string, team: string, alliance: 'red' | 'blue'): ScoutEntry {
    return {
      id: '',
      match,
      team,
      alliance,
      source: 'manual',
      autoLine: false,
      samplesAuto: [0, 0, 0],
      samplesTeleop: [0, 0, 0],
      platform: false,
      critical: false,
      fouls: 0,
      techFouls: 0,
      yellow: 0,
      red: false,
      createdAt: '',
    };
  }

  private recordHtml(): string {
    const d = (this.draft ??= this.blankEntry(this.data.schedule[0]?.id ?? 'Q1', this.data.teams[0].id, 'red'));
    const q = this.data.schedule.find((x) => x.id === d.match);
    const teamList = q ? [...q.red, ...q.blue] : this.data.teams.map((x) => x.id);
    const stepper = (key: string, v: number) => `<div class="stepper" data-step="${key}"><button data-d="-1">−</button><b>${v}</b><button data-d="1">+</button></div>`;
    const tog = (k: 'autoLine' | 'platform' | 'critical' | 'red', label: string) => `<button class="toggle ${d[k] ? 'on' : ''}" data-tg="${k}"><i></i>${label}</button>`;
    const pts = entryPoints(d, GAME);
    const recent = [...this.data.entries].reverse().slice(0, 12);
    return `<div class="panels">
      <div class="panel"><div class="form">
        <h3>${t('sc_recMatch')}</h3>
        <label>${t('sc_match')}</label><input class="tin" data-f="match" value="${esc(d.match)}" maxlength="20" list="sc-matches">
        <datalist id="sc-matches">${this.data.schedule.map((x) => `<option value="${x.id}">`).join('')}</datalist>
        <label>${t('sc_team')}</label><select data-f="team">${teamList.map((x) => `<option value="${x}" ${x === d.team ? 'selected' : ''}>${esc(this.name(x))}</option>`).join('')}</select>
        <label>${t('sc_alliance')}</label><div class="seg" data-al><button class="red ${d.alliance === 'red' ? 'on' : ''}" data-v="red">${t('red')}</button><button class="blue ${d.alliance === 'blue' ? 'on' : ''}" data-v="blue">${t('blue')}</button></div>
        <h3>AUTO</h3>
        <label>${t('autoLine')}</label>${tog('autoLine', t('sc_crossed'))}
        ${[1, 2, 3].map((l) => `<label>${t('level')} ${l}</label>${stepper(`a${l}`, d.samplesAuto[l - 1])}`).join('')}
        <h3>TELEOP</h3>
        ${[1, 2, 3].map((l) => `<label>${t('level')} ${l}</label>${stepper(`t${l}`, d.samplesTeleop[l - 1])}`).join('')}
        <label>${t('st_cycles')}</label>${stepper('cycles', d.cycles ?? 0)}
        <label>${t('rb_cycleS')}</label><input class="tin" type="number" min="0" max="150" step="0.5" data-f="cycleAvg" value="${d.cycleAvg ?? ''}" placeholder="${t('rb_optional')}">
        <h3>ENDGAME</h3>
        <label>${t('platform')}</label>${tog('platform', t('sc_onPlatform'))}
        <label>${t('criticalSample')}</label>${tog('critical', t('sc_onRepisa'))}
      </div></div>
      <div class="panel"><div class="form">
        <h3>${t('fouls')}</h3>
        <label>Foul (${GAME.fouls.foul})</label>${stepper('fouls', d.fouls)}
        <label>Tech Foul (${GAME.fouls.tech})</label>${stepper('techFouls', d.techFouls)}
        <label>Yellow Card</label>${stepper('yellow', d.yellow)}
        <label>Red Card</label>${tog('red', t('on_'))}
        <h3>${t('sc_notes')}</h3>
        <textarea class="tin full" data-f="notes" rows="2" maxlength="300">${esc(d.notes ?? '')}</textarea>
        <div class="full recsum"><span>AUTO <b>${pts.auto}</b></span><span>TELEOP <b>${pts.teleop}</b></span><span>ENDGAME <b>${pts.endgame}</b></span><span>${t('total')} <b>${pts.total}</b></span><span class="neg">${t('fouls')} −<b>${pts.foulPts}</b></span></div>
        <div class="full row-actions"><button class="btn primary" data-act="saveRec">${ic.check}<span>${t('save')}</span></button>
          <button class="btn ghost" data-act="clearRec">${ic.reset}<span>${t('sc_clearForm')}</span></button></div>
        <h3>${t('sc_recent')}</h3>
        <div class="full scroll"><table class="stable recent">${
          recent.length
            ? recent
                .map(
                  (e) =>
                    `<tr><td class="mono">${esc(e.match)}</td><td>${esc(this.name(e.team))}</td><td class="mono">${e.source === 'sim' ? 'SIM' : t('sc_manual')}</td><td class="num">${entryPoints(e, GAME).total}</td><td><button class="x" data-delrec="${esc(e.id)}" aria-label="${t('clear')}">${ic.x}</button></td></tr>`,
                )
                .join('')
            : `<tr><td class="none">${t('sc_noEntries')}</td></tr>`
        }</table></div>
      </div></div>
    </div>`;
  }

  private wireRecord(): void {
    const d = this.draft!;
    this.on(
      '[data-f]',
      (el) => {
        const k = el.dataset.f!;
        const v = (el as HTMLInputElement).value;
        if (k === 'match') d.match = v.trim().slice(0, 20) || d.match;
        else if (k === 'team') d.team = v;
        else if (k === 'notes') d.notes = v.slice(0, 300);
        else if (k === 'cycleAvg') {
          const x = Number(v);
          if (v.trim() && Number.isFinite(x) && x > 0) d.cycleAvg = Math.min(150, Math.round(x * 10) / 10);
          else delete d.cycleAvg;
        }
        // Al elegir un match del calendario, el equipo y la alianza salen de ahí
        const q = this.data.schedule.find((x) => x.id === d.match);
        if (q) {
          if (![...q.red, ...q.blue].includes(d.team)) d.team = q.red[0];
          d.alliance = q.red.includes(d.team) ? 'red' : 'blue';
        }
        if (k !== 'notes' && k !== 'cycleAvg') this.show();
      },
      'change',
    );
    this.on('[data-al] button', (el) => {
      d.alliance = el.dataset.v === 'blue' ? 'blue' : 'red';
      this.show();
    });
    this.on('[data-tg]', (el) => {
      const k = el.dataset.tg as 'autoLine' | 'platform' | 'critical' | 'red';
      d[k] = !d[k];
      this.show();
    });
    this.on('[data-step] button', (el) => {
      const key = (el.parentElement as HTMLElement).dataset.step!;
      const delta = Number(el.dataset.d);
      if (key[0] === 'a' || key[0] === 't') {
        const arr = (key[0] === 'a' ? d.samplesAuto : d.samplesTeleop) as LevelCounts;
        const i = Number(key[1]) - 1;
        arr[i] = Math.max(0, Math.min(99, arr[i] + delta));
      } else if (key === 'cycles') {
        d.cycles = Math.max(0, Math.min(99, (d.cycles ?? 0) + delta));
      } else {
        const k = key as 'fouls' | 'techFouls' | 'yellow';
        d[k] = Math.max(0, Math.min(k === 'yellow' ? 2 : 99, d[k] + delta));
        if (k === 'yellow' && d.yellow >= GAME.fouls.yellowsForRed) d.red = true; // 2 Yellow = Red (§4.3.3)
      }
      this.show();
    });
    this.on('[data-act="saveRec"]', () => {
      const now = new Date();
      const e: ScoutEntry = { ...d, samplesAuto: [...d.samplesAuto], samplesTeleop: [...d.samplesTeleop], id: `${d.match}-${d.team}-${now.getTime()}`, createdAt: now.toISOString() };
      // Un registro por equipo y match: el nuevo reemplaza al anterior
      this.data.entries = this.data.entries.filter((x) => !(x.match === e.match && x.team === e.team)).concat(e);
      this.save();
      // Siguiente equipo del mismo match (si viene del calendario), formulario limpio
      const q = this.data.schedule.find((x) => x.id === d.match);
      const order = q ? [...q.red, ...q.blue] : [];
      const next = order[order.indexOf(d.team) + 1];
      this.draft = next ? this.blankEntry(d.match, next, q!.red.includes(next) ? 'red' : 'blue') : this.blankEntry(d.match, d.team, d.alliance);
      this.show();
    });
    this.on('[data-act="clearRec"]', () => {
      this.draft = this.blankEntry(d.match, d.team, d.alliance);
      this.show();
    });
    this.on('[data-delrec]', (el) => {
      this.data.entries = this.data.entries.filter((e) => e.id !== el.dataset.delrec);
      this.save();
      this.show();
    });
  }

  // ------------------------------------------------------------------ tabla
  private summaries(): TeamSummary[] {
    return rankTeams(summarize(this.data.entries, GAME), this.data.tournament);
  }

  private tableHtml(): string {
    const sum = this.summaries();
    if (!sum.length) return `<p class="msg">${t('sc_noData')}</p>`;
    const max = Math.max(...sum.map((s) => s.points), 1);
    const head = ['#', t('sc_team'), 'M', t('sc_points'), 'AUTO', 'TELEOP', 'END', t('stored'), 'N3', t('sc_line'), t('sc_plat'), t('sc_crit'), t('fouls'), t('sc_net'), 'RP', '±'];
    return `<div class="panel wide"><h3>${t('sc_tableTitle')}</h3>
      <div class="scroll"><table class="stable summary">
        <tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>
        ${sum
          .map(
            (s, i) => `<tr><td class="mono">${i + 1}</td><td>${this.chip(s.team)}</td><td class="num">${s.matches}</td>
          <td class="num bar"><i style="width:${(100 * s.points) / max}%"></i><b>${f1(s.points)}</b></td>
          <td class="num">${f1(s.auto)}</td><td class="num">${f1(s.teleop)}</td><td class="num">${f1(s.endgame)}</td>
          <td class="num">${f1(s.samples)}</td><td class="num">${f1(s.n3)}</td>
          <td class="num">${pct(s.autoLinePct)}</td><td class="num">${pct(s.platformPct)}</td><td class="num">${pct(s.criticalPct)}</td>
          <td class="num ${s.foulPts > 4 ? 'neg' : ''}">${f1(s.foulPts)}${s.cards ? ` <span class="card">▮${s.cards}</span>` : ''}</td>
          <td class="num strong">${f1(s.net)}</td><td class="num">${s.rp === null ? '–' : s.rp.toFixed(2)}</td><td class="num dim">${f1(s.sd)}</td></tr>`,
          )
          .join('')}
      </table></div>
      <p class="sub">${t('sc_tableNote')}</p></div>`;
  }

  // ------------------------------------------------------------------ OPR
  private oprMatches(): OprMatch[] {
    return oprMatchesFromEntries(this.data.entries, GAME);
  }

  /** Tabla de OPR / DPR / CCWM y OPR por componente (`core/opr.ts`). */
  oprTable(matches: readonly OprMatch[], rows: readonly OprRow[], chip: (id: string) => string): string {
    const max = Math.max(...rows.map((r) => r.opr), 1);
    const head = ['#', t('sc_team'), 'M', 'OPR', 'DPR', 'CCWM', 'AUTO', 'TELEOP', 'END', t('op_noFoul'), t('stored')];
    return `<div class="scroll"><table class="stable summary opr">
        <tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>
        ${rows
          .map(
            (r, i) => `<tr><td class="mono">${i + 1}</td><td>${chip(r.team)}</td><td class="num">${r.matches}</td>
          <td class="num bar"><i style="width:${(100 * Math.max(0, r.opr)) / max}%"></i><b>${f1(r.opr)}</b></td>
          <td class="num">${f1(r.dpr)}</td><td class="num strong ${r.ccwm < 0 ? 'neg' : ''}">${r.ccwm > 0 ? '+' : ''}${f1(r.ccwm)}</td>
          <td class="num">${f1(r.auto)}</td><td class="num">${f1(r.teleop)}</td><td class="num">${f1(r.endgame)}</td><td class="num">${f1(r.noFoul)}</td><td class="num">${f1(r.samples)}</td></tr>`,
          )
          .join('')}
      </table></div>
      <p class="sub">${t('op_fit', { m: matches.length, e: f1(oprError(matches, rows)) })}${matches.length * 2 < rows.length ? ` <span class="neg">${t('op_few')}</span>` : ''}</p>`;
  }

  private oprHtml(): string {
    const ms = this.oprMatches();
    if (!ms.length) return `<p class="msg">${t('op_none')}</p>`;
    return `<div class="panel wide"><h3>${t('op_title')}</h3>
      <p class="sub">${t('op_note')}</p>
      ${this.oprTable(ms, computeOpr(ms), (id) => this.chip(id))}</div>`;
  }

  // ------------------------------------------------------------------ desempeño por robot
  private robotsHtml(): string {
    const sum = this.summaries();
    if (!sum.length) return `<p class="msg">${t('sc_noData')}</p>`;
    if (!sum.some((s) => s.team === this.robotFocus)) this.robotFocus = sum[0].team;
    const s = sum.find((x) => x.team === this.robotFocus)!;
    const opr = computeOpr(this.oprMatches()).find((r) => r.team === s.team);
    const es = this.data.entries.filter((e) => e.team === s.team);
    const lvMax = Math.max(1, ...s.levels);
    const kpi = (label: string, v: string, sub = '') => `<div class="kpi"><small>${label}</small><b>${v}</b>${sub ? `<span>${sub}</span>` : ''}</div>`;
    const lvl = [0, 1, 2]
      .map(
        (i) => `<div class="lvrow"><span>N${i + 1}</span><div class="lvbar"><i class="a" style="width:${(100 * s.levelsAuto[i]) / lvMax}%"></i><i class="t" style="width:${(100 * (s.levels[i] - s.levelsAuto[i])) / lvMax}%"></i></div><b>${f1(s.levels[i])}</b></div>`,
      )
      .join('');
    const matchRows = es
      .map((e) => {
        const p = entryPoints(e, GAME);
        const lv = [0, 1, 2].map((i) => e.samplesAuto[i] + e.samplesTeleop[i]).join('/');
        return `<tr><td class="mono">${esc(e.match)}</td><td class="num strong">${p.total}</td><td class="num">${p.auto}</td><td class="num">${lv}</td><td class="num">${e.cycles ?? '–'}</td><td class="num">${fN(e.cycleAvg)}</td>
          <td>${e.autoLine ? '✓' : '·'}</td><td>${e.platform ? '✓' : '·'}</td><td>${e.critical ? '✓' : '·'}</td><td class="num ${p.foulPts ? 'neg' : ''}">${p.foulPts || ''}</td></tr>`;
      })
      .join('');
    const cmp = sum
      .map(
        (x) => `<tr class="${x.team === s.team ? 'me' : ''}"><td>${this.chip(x.team)}</td><td class="num">${x.matches}</td><td class="num strong">${f1(x.points)}</td>
        <td class="num">${f1(x.levels[0])}</td><td class="num">${f1(x.levels[1])}</td><td class="num">${f1(x.levels[2])}</td><td class="num">${x.topLevel ? `N${x.topLevel}` : '–'}</td>
        <td class="num">${fN(x.cycles)}</td><td class="num">${fN(x.cycle)}</td><td class="num">${fN(x.bestCycle)}</td>
        <td class="num">${pct(x.platformPct)}</td><td class="num">${pct(x.criticalPct)}</td><td>${sparkline(x.trend)}</td></tr>`,
      )
      .join('');
    const kinds = byRobotKind(sum, (id) => this.kind(id))
      .map(
        (k) => `<tr><td>${t(`type_${k.robot}` as Key)}</td><td class="num">${k.teams}</td><td class="num">${k.matches}</td><td class="num strong">${f1(k.points)}</td><td class="num">${f1(k.samples)}</td><td class="num">${f1(k.n3)}</td>
        <td class="num">${fN(k.cycle)}</td><td class="num">${pct(k.platformPct)}</td><td class="num">${pct(k.criticalPct)}</td><td class="num">${f1(k.foulPts)}</td></tr>`,
      )
      .join('');
    return `<div class="panels">
      <div class="panel"><h3>${t('rb_profile')}</h3>
        <div class="form"><label>${t('sc_team')}</label><select data-rfocus>${sum.map((x) => `<option value="${x.team}" ${x.team === s.team ? 'selected' : ''}>${esc(this.name(x.team))}</option>`).join('')}</select></div>
        <div class="kpis">
          ${kpi(t('sc_points'), f1(s.points), `± ${f1(s.sd)} · ${t('rb_best')} ${s.best}`)}
          ${kpi('OPR', opr ? f1(opr.opr) : '–', opr ? `CCWM ${opr.ccwm > 0 ? '+' : ''}${f1(opr.ccwm)}` : '')}
          ${kpi(t('stored'), f1(s.samples), s.topLevel ? t('rb_mostly', { n: s.topLevel }) : '')}
          ${kpi(t('rb_cycle'), s.cycle === null ? '–' : `${f1(s.cycle)} s`, s.cycles === null ? t('rb_noCycle') : t('rb_cyclesPer', { n: f1(s.cycles), b: fN(s.bestCycle) }))}
          ${kpi(t('sc_crit'), pct(s.criticalPct))}
          ${kpi(t('sc_plat'), pct(s.platformPct), `${t('sc_line')} ${pct(s.autoLinePct)}`)}
        </div>
        <h3 class="mt">${t('rb_levels')}</h3>
        <div class="lvbars">${lvl}<p class="sub"><i class="sw a"></i> AUTO <i class="sw t"></i> TELEOP</p></div>
        <h3 class="mt">${t('rb_trend')}</h3>${sparkline(s.trend, 260, 48)}
      </div>
      <div class="panel"><h3>${t('rb_matches')} · ${esc(this.name(s.team))}</h3>
        <div class="scroll"><table class="stable">
          <tr><th>${t('sc_match')}</th><th>${t('sc_points')}</th><th>AUTO</th><th>N1/N2/N3</th><th>${t('st_cycles')}</th><th>${t('rb_cycleS')}</th><th>${t('sc_line')}</th><th>${t('sc_plat')}</th><th>${t('sc_crit')}</th><th>${t('fouls')}</th></tr>
          ${matchRows}</table></div>
      </div></div>
      <div class="panel wide"><h3>${t('rb_compare')}</h3>
        <div class="scroll"><table class="stable summary">
          <tr><th>${t('sc_team')}</th><th>M</th><th>${t('sc_points')}</th><th>N1</th><th>N2</th><th>N3</th><th>${t('rb_level')}</th><th>${t('rb_cyclesM')}</th><th>${t('rb_cycleS')}</th><th>${t('rb_best')}</th><th>${t('sc_plat')}</th><th>${t('sc_crit')}</th><th>${t('rb_trend')}</th></tr>
          ${cmp}</table></div>
        <p class="sub">${t('rb_note')}</p></div>
      <div class="panel wide"><h3>${t('rb_byKind')}</h3>
        <div class="scroll"><table class="stable summary">
          <tr><th>${t('robotType')}</th><th>${t('hi_teams')}</th><th>M</th><th>${t('sc_points')}</th><th>${t('stored')}</th><th>N3</th><th>${t('rb_cycleS')}</th><th>${t('sc_plat')}</th><th>${t('sc_crit')}</th><th>${t('fouls')}</th></tr>
          ${kinds}</table></div></div>`;
  }

  private wireRobots(): void {
    this.on(
      '[data-rfocus]',
      (el) => {
        this.robotFocus = (el as HTMLSelectElement).value;
        this.show();
      },
      'change',
    );
  }

  // ------------------------------------------------------------------ historial
  private historyHtml(): string {
    const h = loadHistory();
    const ss = seasons(h);
    if (this.season && !ss.includes(this.season)) this.season = '';
    const evs = h.events.filter((e) => !this.season || e.season === this.season);
    const car = careers(h, GAME, this.season || undefined);
    const save = `<div class="panel"><div class="form">
        <h3>${t('hi_saveTitle')}</h3>
        <p class="full msg">${t('hi_saveNote')}</p>
        <label>${t('hi_name')}</label><input class="tin" data-hname value="${esc(t('hi_defaultName', { n: h.events.length + 1 }))}" maxlength="60">
        <div class="full row-actions"><button class="btn primary" data-act="hsave" ${this.data.entries.length ? '' : 'disabled'}>${ic.check}<span>${t('hi_save')}</span></button>
          <button class="btn" data-act="hexport" ${h.events.length ? '' : 'disabled'}>${ic.download}<span>${t('hi_export')}</span></button>
          <button class="btn" data-act="himport">${ic.go}<span>${t('hi_import')}</span></button></div>
      </div></div>`;
    if (!h.events.length) return `<div class="panels">${save}</div><p class="msg">${t('hi_none')}</p>`;
    const seg = `<div class="seg" data-season><button class="${this.season ? '' : 'on'}" data-v="">${t('hi_allSeasons')}</button>${ss.map((x) => `<button class="${x === this.season ? 'on' : ''}" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div>`;
    const careerRows = car
      .map(
        (c) => `<tr><td><b>${esc(c.name)}</b> <span class="dim">${t(`type_${c.robot}` as Key)}</span></td><td class="num">${c.events}</td><td class="num strong">${c.titles ? `${ic.trophy}${c.titles}` : '0'}</td><td class="num">${c.finals}</td>
        <td class="num">${c.bestRank}</td><td class="num">${f1(c.rank)}</td><td class="num strong">${fN(c.opr)}</td><td class="num">${fN(c.points)}</td><td>${sparkline(c.oprTrend)}</td></tr>`,
      )
      .join('');
    const champ = (e: HistoryEvent) => {
      const ids = Object.entries(e.place).filter(([, p]) => p === 1).map(([id]) => id);
      const nm = (id: string) => esc(e.teams.find((x) => x.id === id)?.name ?? id);
      return ids.length ? ids.map(nm).join(' + ') : e.ranking[0] ? `${t('hi_top')}: ${nm(e.ranking[0])}` : '–';
    };
    const evRows = [...evs]
      .reverse()
      .map(
        (e) => `<tr class="${e.id === this.eventOpen ? 'me' : ''}"><td><b>${esc(e.name)}</b><br><span class="dim">${e.date.slice(0, 10)} · ${t(e.source === 'tournament' ? 'tournament' : 'scouting')}</span></td>
        <td><input class="tin season" data-hseason="${esc(e.id)}" value="${esc(e.season)}" maxlength="20" aria-label="${t('hi_season')}"></td>
        <td>${champ(e)}</td><td class="num">${e.teams.length}</td><td class="num">${e.matches.length}</td>
        <td class="acts"><button class="chipbtn" data-hopen="${esc(e.id)}">${t(e.id === this.eventOpen ? 'hi_close' : 'hi_open')}</button><button class="x" data-hdel="${esc(e.id)}" title="${t('clear')}" aria-label="${t('clear')}">${ic.x}</button></td></tr>`,
      )
      .join('');
    const open = h.events.find((e) => e.id === this.eventOpen);
    return `<div class="panels">${save}
      <div class="panel"><h3>${t('hi_events')}</h3>${seg}
        <div class="scroll"><table class="stable events"><tr><th>${t('hi_event')}</th><th>${t('hi_season')}</th><th>${t('hi_champion')}</th><th>${t('hi_teams')}</th><th>M</th><th></th></tr>${evRows}</table></div></div></div>
      ${open ? this.eventDetail(open) : ''}
      <div class="panel wide"><h3>${t('hi_careers')} · ${this.season ? esc(this.season) : t('hi_allSeasons')}</h3>
        <div class="scroll"><table class="stable summary"><tr><th>${t('sc_team')}</th><th>${t('hi_events')}</th><th>${t('hi_titles')}</th><th>${t('hi_finals')}</th><th>${t('hi_bestRank')}</th><th>${t('hi_avgRank')}</th><th>OPR</th><th>${t('sc_points')}</th><th>${t('hi_oprTrend')}</th></tr>${careerRows}</table></div>
        <p class="sub">${t('hi_note')}</p></div>`;
  }

  /** Detalle de un evento del historial: ranking final con lugar y OPR. */
  private eventDetail(e: HistoryEvent): string {
    const rows = teamEventRows({ format: 'labbot-history', version: 1, events: [e] }, GAME).sort((a, b) => a.rank - b.rank);
    const ms = e.matches;
    const name = (id: string) => `<b>${esc(e.teams.find((x) => x.id === id)?.name ?? id)}</b>`;
    return `<div class="panel wide"><h3>${esc(e.name)} · ${esc(e.season)}</h3>
      <div class="scroll"><table class="stable summary"><tr><th>#</th><th>${t('sc_team')}</th><th>${t('hi_place')}</th><th>M</th><th>${t('sc_points')}</th><th>${t('stored')}</th><th>N3</th><th>${t('rb_cycleS')}</th><th>OPR</th><th>CCWM</th></tr>
      ${rows
        .map(
          (r) => `<tr class="${r.team === e.player ? 'me' : ''}"><td class="mono">${r.rank}</td><td>${name(r.team)} <span class="dim">${t(`type_${r.robot}` as Key)}</span></td><td class="num">${r.place ? (r.place === 1 ? `${ic.trophy}1` : r.place) : '–'}</td>
          <td class="num">${r.summary?.matches ?? 0}</td><td class="num strong">${fN(r.summary?.points)}</td><td class="num">${fN(r.summary?.samples)}</td><td class="num">${fN(r.summary?.n3)}</td><td class="num">${fN(r.summary?.cycle)}</td>
          <td class="num strong">${fN(r.opr)}</td><td class="num">${r.ccwm === undefined ? '–' : `${r.ccwm > 0 ? '+' : ''}${f1(r.ccwm)}`}</td></tr>`,
        )
        .join('')}</table></div>
      ${ms.length ? `<h3 class="mt">${t('op_title')}</h3>${this.oprTable(ms, computeOpr(ms), name)}` : ''}</div>`;
  }

  private wireHistory(): void {
    const update = (f: (h: HistoryData) => HistoryData) => {
      saveHistory(f(loadHistory()));
      this.show();
    };
    this.on('[data-season] button', (el) => {
      this.season = el.dataset.v ?? '';
      this.show();
    });
    this.on('[data-act="hsave"]', () => {
      const name = (this.root.querySelector<HTMLInputElement>('[data-hname]')?.value.trim() || t('scouting')).slice(0, 60);
      const ev = eventFromScouting(this.data.teams, this.data.entries, name, GAME);
      this.eventOpen = ev.id;
      update((h) => addEvent(h, ev));
    });
    this.on('[data-hopen]', (el) => {
      this.eventOpen = this.eventOpen === el.dataset.hopen ? '' : el.dataset.hopen!;
      this.show();
    });
    this.on('[data-hdel]', (el) => {
      // Dos toques: el primero arma el botón
      if (el.classList.toggle('armed')) return;
      update((h) => ({ ...h, events: h.events.filter((e) => e.id !== el.dataset.hdel) }));
    });
    this.on(
      '[data-hseason]',
      (el) => {
        const v = (el as HTMLInputElement).value.trim().slice(0, 20);
        if (v) update((h) => ({ ...h, events: h.events.map((e) => (e.id === el.dataset.hseason ? { ...e, season: v } : e)) }));
      },
      'change',
    );
    this.on('[data-act="hexport"]', () => download('labbot-historial.json', JSON.stringify(loadHistory()), 'application/json'));
    this.on('[data-act="himport"]', () => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'application/json,.json';
      inp.addEventListener('change', async () => {
        const file = inp.files?.[0];
        if (!file) return;
        try {
          // Se suman a los que ya hay (mismo id = se reemplaza)
          const add = sanitizeHistory(JSON.parse(await file.text()));
          update((h) => add.events.reduce(addEvent, h));
        } catch {
          this.show();
        }
      });
      inp.click();
    });
  }

  // ------------------------------------------------------------------ alianzas
  private roleLabel(r: Role): string {
    return t(`sc_role_${r}` as Key);
  }

  private allianceName(a: DraftAlliance): string {
    return [a.captain, ...a.picks].map((x) => esc(this.name(x))).join(' + ');
  }

  private alliancesHtml(): string {
    const sum = this.summaries();
    if (sum.length < 2) return `<p class="msg">${t('sc_noData')}</p>`;
    const f = this.data.tournament;
    const draft = suggestDraft(sum, f, GAME);
    const po = predictPlayoffs(draft);
    if (!sum.some((s) => s.team === this.focus)) this.focus = sum[0].team;
    const partners = bestPartners(this.focus, sum, GAME);
    const rpPill = (p: number, label: string) => `<span class="rpchip ${p >= 0.5 ? 'on' : ''}">${label} ${pct(p)}</span>`;
    return `<div class="panels">
      <div class="panel"><h3>${t('sc_draftTitle')}</h3>
        <p class="sub">${t('sc_draftNote')}</p>
        <div class="alist">${draft
          .map(
            (a) => `<div class="acard"><div class="seed">${a.seed}</div><div class="who">
              ${[a.captain, ...a.picks].map((x) => `${this.chip(x, x === a.captain ? 'cap' : '')}`).join('')}
              <div class="roles">${a.prediction.teams.map((x, i) => `<span><b>${esc(this.name(x))}</b> · ${this.roleLabel(a.prediction.roles[i])}</span>`).join('')}</div></div>
              <div class="pred"><b>${Math.round(a.prediction.points)}</b><small>${t('sc_expected')}</small></div></div>`,
          )
          .join('')}</div>
        <h3 class="mt">${t('sc_playoffs')}</h3>
        <table class="stable po">${po
          .map(
            (m) => `<tr><td class="mono">${m.round === Math.max(...po.map((x) => x.round)) ? t('sc_final') : `${t('sc_round')} ${m.round}`}</td>
            <td class="${m.winner === m.a ? 'strong' : 'dim'}">A${m.a.seed} · ${this.allianceName(m.a)}</td><td class="num">${Math.round(m.scoreA)}–${Math.round(m.scoreB)}</td>
            <td class="${m.winner === m.b ? 'strong' : 'dim'}">A${m.b.seed} · ${this.allianceName(m.b)}</td></tr>`,
          )
          .join('')}</table>
      </div>
      <div class="panel"><h3>${t('sc_partnerTitle')}</h3>
        <div class="form"><label>${t('sc_team')}</label><select data-focus>${sum.map((s) => `<option value="${s.team}" ${s.team === this.focus ? 'selected' : ''}>${esc(this.name(s.team))}</option>`).join('')}</select></div>
        <div class="scroll"><table class="stable partners">
          <tr><th>${t('sc_partner')}</th><th>${t('sc_expected')}</th><th>${t('sc_roles')}</th><th>RP extra</th></tr>
          ${partners
            .map(
              (p) => `<tr><td>${this.chip(p.teams[1])}</td><td class="num strong">${Math.round(p.points)}${p.foulPts ? ` <small class="neg">−${Math.round(p.foulPts)}</small>` : ''}</td>
            <td class="roles">${p.teams.map((x, i) => `<span><b>${esc(this.name(x))}</b> · ${this.roleLabel(p.roles[i])}</span>`).join('')}</td>
            <td class="rprow">${rpPill(p.pAutoLineRp, t('sc_line'))}${rpPill(p.pCriticalRp, t('sc_crit'))}${rpPill(p.pDominanceRp, t('dominance'))}</td></tr>`,
            )
            .join('')}
        </table></div>
        <p class="sub">${t('sc_predictNote')}</p>
      </div></div>`;
  }

  private wireAlliances(): void {
    this.on(
      '[data-focus]',
      (el) => {
        this.focus = (el as HTMLSelectElement).value;
        this.show();
      },
      'change',
    );
  }
}

function download(name: string, text: string, type: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
