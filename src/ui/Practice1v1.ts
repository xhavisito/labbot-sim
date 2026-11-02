/**
 * Práctica 1 contra 1: tu robot en la cancha con un rival quieto, uno de la IA o ninguno (se
 * cambia aquí o en Ajustes), sin reloj de match y con Muestras ilimitadas del Human Player. Un
 * cronómetro de ciclos (recoger → anotar) lleva las estadísticas por Muestra: N1/N2/N3 y Crítica,
 * intentos vs. anotadas, tiempo promedio y mejor ciclo, con cada ciclo partido en buscar y llevar.
 * El mapa de tiro dice desde dónde soltaste cada pieza (y si contó), el del rival y tu mapa
 * acumulado por robot. La lógica está en `core/cycles.ts` y `core/scoreMap.ts`; la cuenta sobre la
 * física en `game/cycleTracker.ts`.
 *
 * Estados: listo → cuenta de 3 s → practicando → resultado.
 */
import { AI_PERSONAS } from '../ai/persona';
import { PRACTICE_LIMITS, RIVALS, type PracticeSettings } from '../config/settings';
import { formatTimer } from '../core/clock';
import { CYCLE_CATS, updateBests, type CycleBests, type CycleCat, type CycleSummary } from '../core/cycles';
import { addShots, asRed, zoneStats, ZONES, type Shot, type ShotLog } from '../core/scoreMap';
import * as F from '../config/field';
import { CycleTracker } from '../game/cycleTracker';
import { saveShotLog } from '../game/shotStore';
import type { GameSession, SessionTap } from '../game/GameSession';
import { saveCycleBests } from '../game/cycleStore';
import { emptyInput, type PlayerInput } from '../input/InputManager';
import { ic } from './chrome';
import { activePalette } from '../config/palette';
import { drawShotMap } from './shotMap';
import { t, type Key } from './i18n';

type Phase = 'brief' | 'countdown' | 'running' | 'result';
const COUNTDOWN = 3;
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Segundos con un decimal (o m:ss si es un minuto o más). */
const secs = (s: number | null): string => (s === null ? '—' : s >= 60 ? formatTimer(s) : `${(Math.round(s * 10) / 10).toFixed(1)} s`);
const pct = (v: number | null): string => (v === null ? '—' : `${Math.round(v * 100)} %`);
const catName = (c: CycleCat): string => t(`p1_cat_${c}` as Key);

export interface Practice1v1Host {
  session: () => GameSession;
  settings: () => PracticeSettings;
  /** Cambia rival o duración: la sesión se arma de nuevo con ellos. */
  change: (p: PracticeSettings) => void;
  bests: CycleBests;
  /** Mapa de tiro acumulado por robot (se guarda al terminar cada práctica). */
  shots: ShotLog;
  robot: { id: string; name: string };
  exit: () => void;
}

export class Practice1v1 {
  readonly root: HTMLElement;
  private phase: Phase = 'brief';
  private clock = 0;
  private tracker: CycleTracker | null = null;
  /** Con otra persona de rival (`rival: 'human'`): sus propios ciclos, en la misma pantalla. */
  private tracker2: CycleTracker | null = null;
  private summary2: CycleSummary | null = null;
  private tap: SessionTap | null = null;
  private summary: CycleSummary | null = null;
  private newBests: CycleCat[] = [];
  private newBests2: CycleCat[] = [];
  private lastShots2: { mine: Shot[]; rival: Shot[] } | null = null;
  private get id2(): string {
    return `${this.h.robot.id}#j2`;
  }
  /** Tiros de la última práctica (tuyos y del rival), en coordenadas de la cancha. */
  private lastShots: { mine: Shot[]; rival: Shot[] } | null = null;
  private mapView: 'session' | 'all' = 'session';
  private onKey = (e: KeyboardEvent): void => {
    if (e.code !== 'Enter' || (this.phase !== 'brief' && this.phase !== 'result') || this.root.style.display === 'none') return;
    e.preventDefault();
    this.start();
  };

  constructor(
    host: HTMLElement,
    private h: Practice1v1Host,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'ap-wrap tn-wrap p1-wrap';
    host.appendChild(this.root);
    document.body.classList.add('tn-on');
    window.addEventListener('keydown', this.onKey);
    this.brief();
  }

  private get s(): GameSession {
    return this.h.session();
  }

  private get limit(): number | null {
    const l = this.h.settings().limit;
    return l > 0 ? l : null;
  }

  /** Antes de la cuenta el robot espera quieto; practicando, el control es tuyo. */
  filter(inp: PlayerInput): PlayerInput {
    return this.phase === 'running' ? inp : emptyInput();
  }

  /** Lo mismo para la segunda persona (rival `human`): su robot espera quieto hasta la cuenta. */
  filter2(inp: PlayerInput): PlayerInput {
    return this.phase === 'running' ? inp : emptyInput();
  }

  private get human(): boolean {
    return this.h.settings().rival === 'human' && this.s.player2 !== null;
  }

  get wantsUi(): boolean {
    return this.phase === 'brief' || this.phase === 'result';
  }

  update(dt: number): void {
    if (this.phase === 'countdown') {
      this.clock -= dt;
      if (this.clock <= 0) this.begin();
      else this.chip();
    } else if (this.phase === 'running') {
      if (this.tracker?.ended) this.finish();
      else this.chip();
    }
  }

  /** Backspace / detener: de vuelta al panel con la cancha acomodada. */
  reset(): void {
    this.stop();
    this.brief();
  }

  dispose(): void {
    this.stop();
    window.removeEventListener('keydown', this.onKey);
    this.root.remove();
    document.body.classList.remove('ap-open', 'tn-on');
  }

  private stop(): void {
    if (this.tap && this.s.tap === this.tap) this.s.tap = null;
    this.tap = null;
    this.tracker = null;
    this.tracker2 = null;
  }

  private brief(): void {
    this.s.resetField();
    this.s.snapViews();
    this.phase = 'brief';
    this.render();
  }

  private start(): void {
    this.stop();
    this.s.resetField();
    this.s.snapViews();
    this.phase = 'countdown';
    this.summary2 = null;
    this.clock = COUNTDOWN;
    this.render();
  }

  private begin(): void {
    this.s.resetField();
    this.s.snapViews();
    this.tracker = new CycleTracker(this.s, this.limit);
    this.tracker2 = this.human ? new CycleTracker(this.s, this.limit, this.s.player2Index) : null;
    const trackers = [this.tracker, this.tracker2].filter((x): x is CycleTracker => x !== null);
    this.tap = { step: (s, mech, scored) => trackers.forEach((tr) => tr.step(s, mech, scored)) };
    this.s.tap = this.tap;
    this.phase = 'running';
    this.render();
  }

  /** Termina la práctica (se acabó el tiempo o tú); guarda tus mejores ciclos. */
  private finish(): void {
    const tr = this.tracker;
    if (!tr) return;
    this.summary = tr.stats.summary();
    // La segunda persona guarda sus ciclos y su mapa como los tuyos, bajo la clave `<robot>#j2` (SUPUESTO:
    // ambos usan el mismo robot, así que se separan para no mezclar sus récords ni sus mapas).
    const tr2 = this.tracker2;
    this.summary2 = tr2?.stats.summary() ?? null;
    this.newBests2 = this.summary2 ? updateBests(this.h.bests, this.id2, this.summary2) : [];
    this.newBests = updateBests(this.h.bests, this.h.robot.id, this.summary);
    saveCycleBests(this.h.bests);
    const a = this.s.player.alliance;
    this.lastShots = { mine: [...tr.stats.shots], rival: [...tr.rivalShots] };
    addShots(this.h.shots, this.h.robot.id, tr.stats.shots.map((x) => asRed(x, a)));
    this.lastShots2 = null;
    if (tr2) {
      const a2 = this.s.player2?.alliance ?? (a === 'red' ? 'blue' : 'red');
      this.lastShots2 = { mine: [...tr2.stats.shots], rival: [...tr2.rivalShots] };
      addShots(this.h.shots, this.id2, tr2.stats.shots.map((x) => asRed(x, a2)));
    }
    saveShotLog(this.h.shots);
    this.mapView = 'session';
    this.stop();
    this.phase = 'result';
    this.render();
  }

  private chip(): void {
    const el = this.root.querySelector<HTMLElement>('[data-clock]');
    const pr = this.root.querySelector<HTMLElement>('[data-prog]');
    if (!el) return;
    if (this.phase === 'countdown') {
      el.textContent = String(Math.ceil(this.clock));
      return;
    }
    const tr = this.tracker;
    if (!tr) return;
    const left = this.limit === null ? null : Math.max(0, this.limit - tr.time);
    el.textContent = left === null ? secs(tr.time) : secs(left);
    el.classList.toggle('low', left !== null && left <= 5);
    if (pr) {
      const s = tr.stats.summary();
      const r = tr.stats.records[tr.stats.records.length - 1];
      const last = r ? ` · ${t('p1_last')} ${secs(r.search + r.time)} (${t('p1_split', { b: secs(r.search), l: secs(r.time) })})` : '';
      const s2 = this.tracker2?.stats.summary();
      const other = s2 ? ` · ${t('p1_p2chip', { n: s2.cycles, p: s2.points })}` : '';
      pr.textContent = `${t('p1_chip', { n: s.cycles, p: s.points })}${other}${last}`;
    }
  }

  /** Selectores de rival y duración (en el panel de antes y del resultado). */
  private optionsHtml(): string {
    const p = this.h.settings();
    const seg = (k: string, vals: readonly (string | number)[], cur: string | number, label: (v: never) => string) =>
      `<div class="seg" data-seg="${k}">${vals.map((v) => `<button class="${v === cur ? 'on' : ''}" data-v="${v}">${label(v as never)}</button>`).join('')}</div>`;
    return `<div class="p1-opts">
      <label>${t('p1_rival')}</label>${seg('rival', RIVALS, p.rival, (v: string) => t(`p1_rival_${v}` as Key))}
      ${p.rival === 'ai' ? `<label>${t('ms_persona')}</label>${seg('persona', AI_PERSONAS, p.persona, (v: string) => t(`persona_${v}` as Key))}` : ''}
      <label>${t('p1_limit')}</label>${seg('limit', PRACTICE_LIMITS, p.limit, (v: number) => (v === 0 ? t('p1_free') : secs(v)))}
    </div>`;
  }

  /** Tabla de ciclos por Muestra. `mine` = la del robot guardado (récords y estrellas); si no, la del jugador 2. */
  private tableHtml(s: CycleSummary, mine = true): string {
    const bests = this.h.bests.bests[mine ? this.h.robot.id : this.id2] ?? {};
    const fresh = mine ? this.newBests : this.newBests2;
    const rows = CYCLE_CATS.map((c) => {
      const x = s.byCat[c];
      const rec = bests[c];
      const star = fresh.includes(c) ? ` <b class="tn-new" title="${t('p1_newBest')}">★</b>` : '';
      return `<tr class="${x.attempts ? '' : 'dim'}"><th>${catName(c)}</th><td>${x.scored}/${x.attempts}</td><td>${pct(x.accuracy)}</td><td>${secs(x.avg)}</td>
        <td>${secs(x.best)}${star}</td><td>${rec === undefined ? '—' : secs(rec)}</td><td>${x.points}</td></tr>`;
    }).join('');
    const total = `<tr class="total"><th>${t('p1_total')}</th><td>${s.scored}/${s.attempts}</td><td>${pct(s.accuracy)}</td><td>${secs(s.avg)}</td><td>${secs(s.best)}</td><td></td><td>${s.points}</td></tr>`;
    return `<table class="p1-table"><thead><tr><th></th><th>${t('p1_th_scored')}</th><th>${t('p1_th_acc')}</th><th>${t('p1_th_avg')}</th><th>${t('p1_th_best')}</th><th>${t('p1_th_record')}</th><th>${t('p1_th_pts')}</th></tr></thead>
      <tbody>${rows}${total}</tbody></table>`;
  }

  /** Tiros del mapa elegido y la Cámara contra la que se miden las zonas. */
  private mapShots(p2 = false): { mine: Shot[]; rival: Shot[]; camara: F.Rect } {
    const all = this.h.shots.robots[p2 ? this.id2 : this.h.robot.id] ?? [];
    const last = p2 ? this.lastShots2 : this.lastShots;
    if (this.mapView === 'all' || !last) return { mine: all, rival: [], camara: F.camaraRect('red') };
    return { ...last, camara: F.camaraRect((p2 ? this.s.player2?.alliance : null) ?? this.s.player.alliance) };
  }

  /** Mapa de tiro con su selector (esta práctica / acumulado) y la tabla de zonas. */
  private mapHtml(p2 = false): string {
    const all = this.h.shots.robots[p2 ? this.id2 : this.h.robot.id] ?? [];
    const last = p2 ? this.lastShots2 : this.lastShots;
    if (!last && !all.length) return '';
    if (!this.lastShots) this.mapView = 'all';
    const { mine, camara } = this.mapShots(p2);
    const z = zoneStats(mine, camara);
    const rows = ZONES.map((k) => {
      const x = z.byZone[k];
      const star = z.best === k ? ` <b class="tn-new" title="${t('p1_bestZone')}">★</b>` : '';
      return `<tr class="${x.tried ? '' : 'dim'}"><th>${t(`p1_zone_${k}` as Key)}${star}</th><td>${x.made}/${x.tried}</td><td>${pct(x.accuracy)}</td></tr>`;
    }).join('');
    const seg = last
      ? `<div class="seg" data-map><button class="${this.mapView === 'session' ? 'on' : ''}" data-v="session">${t('p1_mapSession')}</button><button class="${this.mapView === 'all' ? 'on' : ''}" data-v="all">${t('p1_mapAll', { n: all.length })}</button></div>`
      : `<small class="tn-meta">${t('p1_mapAll', { n: all.length })}</small>`;
    const note = this.mapView === 'all' ? t('p1_mapAllNote') : last?.rival.length ? t('p1_mapRivalNote') : '';
    return `<div class="p1-map"><div class="p1-map-head"><b>${t('p1_mapTitle')}</b>${seg}</div>
      <canvas class="heat p1-shots${p2 ? ' p2' : ''}" width="${Math.round(F.FIELD_LENGTH * 80)}" height="${Math.round(F.FIELD_WIDTH * 80)}"></canvas>
      <p class="p1-legend">${t('p1_mapLegend')}${note ? ` ${note}` : ''}</p>
      <table class="p1-table p1-zones"><thead><tr><th>${t('p1_th_zone')}</th><th>${t('p1_th_scored')}</th><th>${t('p1_th_acc')}</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="ap-note">${t('p1_mapAssume')}</p></div>`;
  }

  private drawMap(p2 = false): void {
    const cv = this.root.querySelector<HTMLCanvasElement>(p2 ? 'canvas.p1-shots.p2' : 'canvas.p1-shots:not(.p2)');
    if (!cv) return;
    const { mine, rival } = this.mapShots(p2);
    const a = this.mapView === 'all' ? 'red' : ((p2 ? this.s.player2?.alliance : null) ?? this.s.player.alliance);
    const other = a === 'red' ? 'blue' : 'red';
    drawShotMap(cv, {
      cells: mine,
      // En el acumulado hay demasiados tiros para un punto por cada uno: solo las celdas
      dots: this.mapView === 'all' ? [] : [{ shots: rival, rgb: activePalette().heat[other] }, { shots: mine, rgb: activePalette().heat[a] }],
    });
  }

  private render(): void {
    const ph = this.phase;
    document.body.classList.toggle('ap-open', ph !== 'running');
    if (ph === 'countdown' || ph === 'running') {
      const label = ph === 'countdown' ? t('tn_getReady') : t('p1_title');
      this.root.innerHTML = `<div class="ap-chip tn-chip ${ph}">${ic.medal}<span>${label}</span><em data-prog></em><b data-clock></b>
        ${ph === 'running' ? `<button class="hud-btn" data-a="done" title="${t('p1_finish')}">${ic.check}</button>` : ''}
        <button class="hud-btn" data-a="stop" title="${t('tn_stop')}">${ic.x}</button></div>`;
      this.root.querySelector('[data-a="stop"]')!.addEventListener('click', () => this.reset());
      this.root.querySelector('[data-a="done"]')?.addEventListener('click', () => this.finish());
      this.chip();
      return;
    }
    const s = this.summary;
    const s2 = this.summary2;
    const assume = this.human ? t('p1_assumeHuman') : t('p1_assume');
    const body =
      ph === 'result' && s
        ? `<p class="tn-note">${t('p1_resultNote', { t: secs(s.time), c: s.cycles, m: s.perMinute.toFixed(1) })}</p>
          <p class="tn-note">${t('p1_splitNote', { b: secs(s.avgSearch), l: secs(s.avg), f: secs(s.avgFull) })}</p>${this.tableHtml(s)}
          ${s2 ? `<h3 class="p1-p2">${t('p1_p2Title')}</h3><p class="tn-note">${t('p1_resultNote', { t: secs(s2.time), c: s2.cycles, m: s2.perMinute.toFixed(1) })}</p>${this.tableHtml(s2, false)}${this.mapHtml(true)}` : ''}
          <p class="ap-note">${assume}</p>${this.mapHtml()}`
        : `<p class="tn-goal">${t('p1_goal')}</p><p class="ap-note">${assume}</p>${this.mapHtml()}`;
    this.root.innerHTML = `<div class="ap-panel tn-panel p1-panel">
      <div class="ap-head">${ic.medal}<b>${t('p1_title')}</b>
        <button class="hud-btn" data-a="exit" title="${t('tn_exit')}">${ic.x}</button></div>
      <small class="tn-meta">${esc(this.h.robot.name)}</small>
      <div class="ap-sec">${body}${this.optionsHtml()}</div>
      <div class="ap-actions tn-actions">
        <button class="btn primary" data-a="start">${ph === 'result' ? ic.reset : ic.play}<span>${ph === 'result' ? t('tn_retry') : t('tn_start')}</span><kbd>Enter</kbd></button>
      </div></div>`;
    const on = (a: string, fn: () => void) => this.root.querySelectorAll<HTMLElement>(`[data-a="${a}"]`).forEach((el) => el.addEventListener('click', fn));
    on('exit', () => this.h.exit());
    on('start', () => this.start());
    this.drawMap();
    if (this.summary2) this.drawMap(true);
    this.root.querySelectorAll<HTMLElement>('[data-map] button').forEach((b) =>
      b.addEventListener('click', () => {
        this.mapView = b.dataset.v === 'all' ? 'all' : 'session';
        this.render();
      }),
    );
    this.root.querySelectorAll<HTMLElement>('[data-seg] button').forEach((b) =>
      b.addEventListener('click', () => {
        const k = b.parentElement!.dataset.seg as keyof PracticeSettings;
        const cur = this.h.settings();
        // Cambiar el rival arma la sesión de nuevo (la App crea una práctica nueva con estos ajustes)
        this.h.change({ ...cur, [k]: k === 'limit' ? Number(b.dataset.v) : b.dataset.v } as PracticeSettings);
      }),
    );
  }
}
