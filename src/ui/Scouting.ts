/**
 * Pantalla de Scouting y estrategia: equipos del reto, calendario de clasificación (simular, jugar
 * o registrar cada match), captura manual de un match real, tabla por equipo y alianzas sugeridas
 * con su pronóstico. El formato del torneo no está en el manual: es SUPUESTO y se configura aquí.
 */
import { GAME } from '../config/game';
import { MECHANISM_KINDS, type MechanismKind } from '../config/robot';
import type { Match } from '../core/match';
import { bestPartners, entriesFromMatch, entryPoints, summarize, type LevelCounts, type Role, type ScoutEntry, type TeamSummary } from '../core/scouting';
import { makeSchedule, predictPlayoffs, rankTeams, suggestDraft, type DraftAlliance, type QualMatch } from '../core/tournament';
import { emptyScout, sanitizeScout, saveScout, scoutCsv, type ScoutData } from '../game/scoutStore';
import { simulateMatch } from '../sim/quickSim';
import { backBtn, brandbar, ic } from './chrome';
import { t, type Key } from './i18n';

export type ScoutTab = 'teams' | 'schedule' | 'record' | 'table' | 'alliances';
const TABS: ScoutTab[] = ['schedule', 'table', 'alliances', 'record', 'teams'];

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
      alliances: () => this.alliancesHtml(),
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
      alliances: () => this.wireAlliances(),
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
        // Al elegir un match del calendario, el equipo y la alianza salen de ahí
        const q = this.data.schedule.find((x) => x.id === d.match);
        if (q) {
          if (![...q.red, ...q.blue].includes(d.team)) d.team = q.red[0];
          d.alliance = q.red.includes(d.team) ? 'red' : 'blue';
        }
        if (k !== 'notes') this.show();
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
