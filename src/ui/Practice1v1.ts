/**
 * Práctica 1 contra 1: tu robot en la cancha con un rival quieto, uno de la IA o ninguno (se
 * cambia aquí o en Ajustes), sin reloj de match y con Muestras ilimitadas del Human Player. Un
 * cronómetro de ciclos (recoger → anotar) lleva las estadísticas por Muestra: N1/N2/N3 y Crítica,
 * intentos vs. anotadas, tiempo promedio y mejor ciclo. La lógica está en `core/cycles.ts` y la
 * cuenta sobre la física en `game/cycleTracker.ts`.
 *
 * Estados: listo → cuenta de 3 s → practicando → resultado.
 */
import { PRACTICE_LIMITS, RIVALS, type PracticeSettings } from '../config/settings';
import { formatTimer } from '../core/clock';
import { CYCLE_CATS, updateBests, type CycleBests, type CycleCat, type CycleSummary } from '../core/cycles';
import { CycleTracker } from '../game/cycleTracker';
import type { GameSession } from '../game/GameSession';
import { saveCycleBests } from '../game/cycleStore';
import { emptyInput, type PlayerInput } from '../input/InputManager';
import { ic } from './chrome';
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
  robot: { id: string; name: string };
  exit: () => void;
}

export class Practice1v1 {
  readonly root: HTMLElement;
  private phase: Phase = 'brief';
  private clock = 0;
  private tracker: CycleTracker | null = null;
  private summary: CycleSummary | null = null;
  private newBests: CycleCat[] = [];
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
    if (this.s.tap === this.tracker) this.s.tap = null;
    this.tracker = null;
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
    this.clock = COUNTDOWN;
    this.render();
  }

  private begin(): void {
    this.s.resetField();
    this.s.snapViews();
    this.tracker = new CycleTracker(this.s, this.limit);
    this.s.tap = this.tracker;
    this.phase = 'running';
    this.render();
  }

  /** Termina la práctica (se acabó el tiempo o tú); guarda tus mejores ciclos. */
  private finish(): void {
    const tr = this.tracker;
    if (!tr) return;
    this.summary = tr.stats.summary();
    this.newBests = updateBests(this.h.bests, this.h.robot.id, this.summary);
    saveCycleBests(this.h.bests);
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
      const last = s.last === null ? '' : ` · ${t('p1_last')} ${secs(s.last)}`;
      pr.textContent = `${t('p1_chip', { n: s.cycles, p: s.points })}${last}`;
    }
  }

  /** Selectores de rival y duración (en el panel de antes y del resultado). */
  private optionsHtml(): string {
    const p = this.h.settings();
    const seg = (k: string, vals: readonly (string | number)[], cur: string | number, label: (v: never) => string) =>
      `<div class="seg" data-seg="${k}">${vals.map((v) => `<button class="${v === cur ? 'on' : ''}" data-v="${v}">${label(v as never)}</button>`).join('')}</div>`;
    return `<div class="p1-opts">
      <label>${t('p1_rival')}</label>${seg('rival', RIVALS, p.rival, (v: string) => t(`p1_rival_${v}` as Key))}
      <label>${t('p1_limit')}</label>${seg('limit', PRACTICE_LIMITS, p.limit, (v: number) => (v === 0 ? t('p1_free') : secs(v)))}
    </div>`;
  }

  private tableHtml(s: CycleSummary): string {
    const bests = this.h.bests.bests[this.h.robot.id] ?? {};
    const rows = CYCLE_CATS.map((c) => {
      const x = s.byCat[c];
      const rec = bests[c];
      const star = this.newBests.includes(c) ? ` <b class="tn-new" title="${t('p1_newBest')}">★</b>` : '';
      return `<tr class="${x.attempts ? '' : 'dim'}"><th>${catName(c)}</th><td>${x.scored}/${x.attempts}</td><td>${pct(x.accuracy)}</td><td>${secs(x.avg)}</td>
        <td>${secs(x.best)}${star}</td><td>${rec === undefined ? '—' : secs(rec)}</td><td>${x.points}</td></tr>`;
    }).join('');
    const total = `<tr class="total"><th>${t('p1_total')}</th><td>${s.scored}/${s.attempts}</td><td>${pct(s.accuracy)}</td><td>${secs(s.avg)}</td><td>${secs(s.best)}</td><td></td><td>${s.points}</td></tr>`;
    return `<table class="p1-table"><thead><tr><th></th><th>${t('p1_th_scored')}</th><th>${t('p1_th_acc')}</th><th>${t('p1_th_avg')}</th><th>${t('p1_th_best')}</th><th>${t('p1_th_record')}</th><th>${t('p1_th_pts')}</th></tr></thead>
      <tbody>${rows}${total}</tbody></table>`;
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
    const body =
      ph === 'result' && s
        ? `<p class="tn-note">${t('p1_resultNote', { t: secs(s.time), c: s.cycles, m: s.perMinute.toFixed(1) })}</p>${this.tableHtml(s)}
          <p class="ap-note">${t('p1_assume')}</p>`
        : `<p class="tn-goal">${t('p1_goal')}</p><p class="ap-note">${t('p1_assume')}</p>`;
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
