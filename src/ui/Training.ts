/**
 * Entrenamiento por retos: la lista de retos (pantalla del menú, con medalla y récord por robot) y
 * el panel sobre la cancha mientras se juega uno (instrucciones → cuenta de 3 s → reto → resultado).
 * La lógica está en `core/training.ts` (medallas y récords) y `game/drills.ts` (cuenta en la física).
 */
import type { MechanismKind } from '../config/robot';
import { formatTimer } from '../core/clock';
import { bestOf, DRILLS, drillTargets, medalCount, MEDALS, PACE, recordRun, type Drill, type DrillId, type Medal, type RunResult, type TrainingProgress } from '../core/training';
import { DrillTracker, setupDrill } from '../game/drills';
import type { GameSession } from '../game/GameSession';
import { saveTraining } from '../game/trainingStore';
import { emptyInput, type PlayerInput } from '../input/InputManager';
import { backBtn, brandbar, ic } from './chrome';
import { t, type Key } from './i18n';

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const COUNTDOWN = 3;

/** Lo que identifica al robot con el que se entrena (los récords son por robot). */
export interface TrainingRobot {
  id: string;
  name: string;
  mech: MechanismKind;
}

const drillName = (d: Drill): string => t(`tn_${d.id}` as Key);
/** Segundos con un decimal (o m:ss si es un minuto o más). */
const secs = (s: number): string => (s >= 60 ? formatTimer(s) : `${(Math.round(s * 10) / 10).toFixed(1)} s`);
/** Marca o corte de un reto: segundos ('time') o puntos ('points'). */
export function fmtValue(d: Drill, v: number): string {
  return d.kind === 'time' ? `${v.toFixed(2)} s` : `${v} pts`;
}
const fmtCut = (d: Drill, v: number): string => (d.kind === 'time' ? `≤ ${secs(v)}` : `≥ ${v} pts`);
const medalDisc = (m: Medal | null, cls = ''): string => `<i class="tn-medal ${m ?? 'none'} ${cls}" title="${m ? t(`medal_${m}` as Key) : t('tn_noMedal')}">${m ? ic.medal : ''}</i>`;

/** Cortes de oro, plata y bronce (de mejor a peor), marcando el que se alcanzó. */
function cutsHtml(d: Drill, mech: MechanismKind, got: Medal | null = null): string {
  const { medals } = drillTargets(d, mech);
  return `<div class="tn-cuts">${[2, 1, 0]
    .map((i) => {
      const m = MEDALS[i];
      return `<span class="${m} ${got === m ? 'got' : ''}">${medalDisc(m, 'sm')}<b>${t(`medal_${m}` as Key)}</b><small>${fmtCut(d, medals[i])}</small></span>`;
    })
    .join('')}</div>`;
}

// ------------------------------------------------------------------ lista de retos

export class TrainingScreen {
  constructor(
    private root: HTMLElement,
    private progress: TrainingProgress,
    private robot: () => TrainingRobot,
    private act: { back: () => void; play: (d: DrillId) => void },
  ) {}

  show(): void {
    const r = this.robot();
    const count = medalCount(this.progress, r.id);
    const card = (d: Drill): string => {
      const best = bestOf(this.progress, d.id, r.id);
      const { limit } = drillTargets(d, r.mech);
      return `<div class="tn-card" data-id="${d.id}">
        ${medalDisc(best?.medal ?? null, 'lg')}
        <div class="tn-info"><b>${drillName(d)}</b><p>${t(`tn_${d.id}_goal` as Key)}</p>
          <small class="tn-meta">${t('tn_limit', { s: secs(limit) })} · ${d.section}</small>
          ${cutsHtml(d, r.mech)}</div>
        <div class="tn-side">
          <div class="tn-rec">${best ? `<small>${t('tn_record')}</small><b>${fmtValue(d, best.best)}</b><small>${t('tn_runs', { n: best.runs })}</small>` : `<small>${t('tn_noRecord')}</small>`}</div>
          <button class="btn primary" data-play>${ic.play}<span>${t('tn_play')}</span></button>
        </div></div>`;
    };
    this.root.className = 'screen solid';
    this.root.innerHTML = `<div class="inner">
      ${brandbar(t('tn_title'))}
      <h1>${t('tn_title')}</h1>
      <p class="sub">${t('tn_sub')}</p>
      <div class="tn-robot"><span><small>${t('tn_robot')}</small><b>${esc(r.name)}</b></span>
        <span class="tn-count">${MEDALS.slice()
          .reverse()
          .map((m) => `<span>${medalDisc(m, 'sm')}<b>${count[m]}</b></span>`)
          .join('')}</span>
        <small>${t('tn_robotNote')}${PACE[r.mech] !== 1 ? ` · ${t('tn_pace', { k: PACE[r.mech] })}` : ''}</small></div>
      <div class="tn-list">${DRILLS.map(card).join('')}</div>
      <div class="actionbar">${backBtn('data-act="back"')}<div class="grow"></div></div>
    </div>`;
    this.root.style.display = '';
    this.root.scrollTop = 0;
    this.root.querySelector('[data-act="back"]')!.addEventListener('click', () => this.act.back());
    this.root.querySelectorAll<HTMLElement>('[data-play]').forEach((b) =>
      b.addEventListener('click', () => this.act.play(b.closest<HTMLElement>('[data-id]')!.dataset.id as DrillId)),
    );
  }
}

// ------------------------------------------------------------------ reto en curso

type Phase = 'brief' | 'countdown' | 'running' | 'result';

export interface TrainingRunHost {
  session: () => GameSession;
  progress: TrainingProgress;
  robot: TrainingRobot;
  /** Lista de retos. */
  other: () => void;
  exit: () => void;
}

export class TrainingRun {
  readonly root: HTMLElement;
  private phase: Phase = 'brief';
  private clock = 0;
  private tracker: DrillTracker | null = null;
  private last: RunResult | null = null;
  private readonly limit: number;
  private onKey = (e: KeyboardEvent): void => {
    // Solo con el panel a la vista (no en la pausa)
    if (e.code !== 'Enter' || (this.phase !== 'brief' && this.phase !== 'result') || this.root.style.display === 'none') return;
    e.preventDefault();
    this.start();
  };

  constructor(
    host: HTMLElement,
    readonly drill: Drill,
    private h: TrainingRunHost,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'ap-wrap tn-wrap';
    host.appendChild(this.root);
    this.limit = drillTargets(drill, h.robot.mech).limit;
    document.body.classList.add('tn-on');
    window.addEventListener('keydown', this.onKey);
    this.brief();
  }

  private get s(): GameSession {
    return this.h.session();
  }

  /** Lo que llega del jugador: solo cuenta durante el reto (antes, el robot espera quieto). */
  filter(inp: PlayerInput): PlayerInput {
    return this.phase === 'running' ? inp : emptyInput();
  }

  /** Cada cuadro, después de `session.update`. */
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

  /** Backspace / reacomodar: de vuelta a las instrucciones con la cancha acomodada. */
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
    setupDrill(this.s, this.drill);
    this.phase = 'brief';
    this.render();
  }

  private start(): void {
    this.stop();
    setupDrill(this.s, this.drill);
    this.phase = 'countdown';
    this.clock = COUNTDOWN;
    this.render();
  }

  private begin(): void {
    // La cancha se reacomoda justo al arrancar (nada se movió en la cuenta)
    setupDrill(this.s, this.drill);
    this.tracker = new DrillTracker(this.drill, this.limit);
    this.s.tap = this.tracker;
    this.phase = 'running';
    this.render();
  }

  private finish(): void {
    const tr = this.tracker;
    if (!tr) return;
    const r = this.h.robot;
    this.last = recordRun(this.h.progress, this.drill, r.id, r.mech, tr.outcome());
    saveTraining(this.h.progress);
    this.phase = 'result';
    this.render();
  }

  /** Texto del avance en vivo. */
  private progressText(): string {
    const tr = this.tracker;
    const d = this.drill;
    if (!tr) return '';
    const yn = (v: boolean) => (v ? '✓' : '–');
    switch (d.id) {
      case 'line':
        return t('tn_chipLine');
      case 'level3':
        return t('tn_chipSamples', { n: tr.samples[3], goal: d.goal ?? 0 });
      case 'dominance':
        return t('tn_chipTotal', { n: tr.scoredTotal, goal: d.goal ?? 0 });
      case 'critical':
        return t('tn_chipCritical', { v: yn(tr.criticalOn) });
      case 'platform':
        return t('tn_chipPlatform', { v: yn(tr.onPlatform) });
      case 'endgame':
        return t('tn_chipEndgame', { n: tr.points, p: yn(tr.onPlatform), c: yn(tr.criticalOn) });
      case 'cycles':
        return t('tn_chipPoints', { n: tr.points });
    }
  }

  private chip(): void {
    const el = this.root.querySelector<HTMLElement>('[data-clock]');
    const pr = this.root.querySelector<HTMLElement>('[data-prog]');
    if (!el) return;
    if (this.phase === 'countdown') {
      el.textContent = String(Math.ceil(this.clock));
      return;
    }
    const left = Math.max(0, this.limit - (this.tracker?.time ?? 0));
    el.textContent = secs(left);
    el.classList.toggle('low', left <= 5);
    if (pr) pr.textContent = this.progressText();
  }

  private resultHtml(): string {
    const d = this.drill;
    const r = this.last!;
    const tr = this.tracker;
    const mech = this.h.robot.mech;
    const best = bestOf(this.h.progress, d.id, this.h.robot.id);
    const value = r.value === null ? `<b class="fail">—</b>` : `<b>${fmtValue(d, r.value)}</b>`;
    // Siguiente medalla que falta
    const { medals } = drillTargets(d, mech);
    const rank = r.medal ? MEDALS.indexOf(r.medal) : -1;
    const next = rank < 2 ? `${t('tn_next', { medal: t(`medal_${MEDALS[rank + 1]}` as Key).toLowerCase(), cut: fmtCut(d, medals[rank + 1]) })}` : t('tn_allGold');
    const notes: string[] = [];
    if (r.value === null) notes.push(t('tn_failTime', { s: secs(this.limit) }));
    if (r.improved) notes.push(`<b class="tn-new">${t('tn_newRecord')}</b>${r.prev ? ` · ${t('tn_prev', { v: fmtValue(d, r.prev.best) })}` : ''}`);
    else if (best) notes.push(t('tn_best', { v: fmtValue(d, best.best) }));
    if (tr && d.kind === 'time' && r.value !== null) notes.push(t('tn_resultPts', { n: tr.points }));
    return `<div class="tn-res ${r.medal ?? 'none'}">${medalDisc(r.medal, 'xl')}
        <div><small>${r.medal ? t(`medal_${r.medal}` as Key) : t('tn_noMedal')}</small>${value}</div></div>
      ${notes.map((n) => `<p class="tn-note">${n}</p>`).join('')}
      ${cutsHtml(d, mech, r.medal)}
      <p class="tn-note dim">${next}</p>`;
  }

  private render(): void {
    const ph = this.phase;
    const d = this.drill;
    // Los controles touch solo hacen falta durante el reto (si no, el panel los tapa)
    document.body.classList.toggle('ap-open', ph !== 'running');
    if (ph === 'countdown' || ph === 'running') {
      const label = ph === 'countdown' ? t('tn_getReady') : drillName(d);
      this.root.innerHTML = `<div class="ap-chip tn-chip ${ph}">${ic.medal}<span>${label}</span><em data-prog></em><b data-clock></b>
        <button class="hud-btn" data-a="stop" title="${t('tn_stop')}">${ic.x}</button></div>`;
      this.root.querySelector('[data-a="stop"]')!.addEventListener('click', () => this.reset());
      this.chip();
      return;
    }
    const mech = this.h.robot.mech;
    const best = bestOf(this.h.progress, d.id, this.h.robot.id);
    const body =
      ph === 'result'
        ? this.resultHtml()
        : `<p class="tn-goal"><b>${t('tn_goal')}:</b> ${t(`tn_${d.id}_goal` as Key)}</p>
          <p class="ap-note"><b>${t('tn_tips')}:</b> ${t(`tn_${d.id}_tip` as Key)}</p>
          ${cutsHtml(d, mech, best?.medal ?? null)}
          <p class="tn-note dim">${best ? t('tn_best', { v: fmtValue(d, best.best) }) : t('tn_noRecord')} · ${esc(this.h.robot.name)}</p>`;
    this.root.innerHTML = `<div class="ap-panel tn-panel">
      <div class="ap-head">${ic.medal}<b>${drillName(d)}</b>
        <button class="hud-btn" data-a="exit" title="${t('tn_exit')}">${ic.x}</button></div>
      <small class="tn-meta">${t('tn_limit', { s: secs(this.limit) })} · ${d.section}</small>
      <div class="ap-sec">${body}</div>
      <div class="ap-actions tn-actions">
        <button class="btn" data-a="other">${ic.back}<span>${t('tn_other')}</span></button>
        <button class="btn primary" data-a="start">${ph === 'result' ? ic.reset : ic.play}<span>${ph === 'result' ? t('tn_retry') : t('tn_start')}</span><kbd>Enter</kbd></button>
      </div></div>`;
    const on = (a: string, fn: () => void) => this.root.querySelectorAll<HTMLElement>(`[data-a="${a}"]`).forEach((el) => el.addEventListener('click', fn));
    on('exit', () => this.h.exit());
    on('other', () => this.h.other());
    on('start', () => this.start());
  }
}

