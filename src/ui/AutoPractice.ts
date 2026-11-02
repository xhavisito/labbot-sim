/**
 * Práctica de AUTO (sobre la sesión de práctica con solo tu robot): grabar 15 s de manejo como ruta,
 * repetirla (también desde una pose inicial desplazada unos cm), probar muchas variaciones al azar
 * sin dibujar y guardar la ruta para usarla como la rutina de AUTO de tu robot en el match.
 *
 * Estados: listo → (cuenta 3 s) → grabando → resultado ⇄ repitiendo.
 */
import { AutoRunner, type AutoTrack } from '../auto/AutoRoutine';
import { applyOffset, AutoScorer, AUTO_STEPS, NO_OFFSET, randomOffsets, testVariations, type AutoResult, type StartOffset, type VariationSummary } from '../auto/practice';
import { deleteRoute, newRouteId, routeRoutine, savedRoutes, storeRoute, TrackRecorder, type SavedRoute } from '../auto/recorded';
import { GAME } from '../config/game';
import type { GameSession } from '../game/GameSession';
import { PHYSICS_HZ } from '../game/GameSession';
import { emptyInput, type PlayerInput } from '../input/InputManager';
import { ic } from './chrome';
import { t } from './i18n';

type Phase = 'ready' | 'countdown' | 'recording' | 'result' | 'playing';

export interface AutoPracticeHost {
  session: () => GameSession;
  /** Nombre del robot (se guarda con la ruta). */
  robotName: string;
  exit: () => void;
  /** Usar la ruta guardada como la rutina de AUTO de tu robot (Ajustes). */
  useRoute: (routineId: string) => void;
  /** Rutina de AUTO que tienes elegida ahora (para marcar "en uso"). */
  currentAuto: () => string;
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const COUNTDOWN = 3;

export class AutoPractice {
  readonly root: HTMLElement;
  private phase: Phase = 'ready';
  private clock = 0;
  private recorder: TrackRecorder | null = null;
  private scorer: AutoScorer | null = null;
  /** Ruta que se repite/prueba (la recién grabada o una guardada). */
  private track: AutoTrack | null = null;
  private routeName = '';
  private savedId: string | null = null;
  private result: AutoResult | null = null;
  private offset: StartOffset = { ...NO_OFFSET };
  private vary = { cm: 3, deg: 2, n: 20 };
  private variations: VariationSummary | null = null;
  private progress = -1;
  private cancel = false;
  private msg = '';

  constructor(
    host: HTMLElement,
    private h: AutoPracticeHost,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'ap-wrap';
    host.appendChild(this.root);
    this.ready();
  }

  private get s(): GameSession {
    return this.h.session();
  }

  /** Lo que llega del jugador: solo cuenta mientras graba (el robot espera quieto en su zona). */
  filter(inp: PlayerInput): PlayerInput {
    return this.phase === 'recording' ? inp : emptyInput();
  }

  /** Con el panel abierto (sin grabar ni reproducir) el control navega sus botones. */
  get wantsUi(): boolean {
    return this.phase === 'ready' || this.phase === 'result';
  }

  /** Cada cuadro, después de `session.update`. */
  update(dt: number): void {
    if (this.phase === 'countdown') {
      this.clock -= dt;
      if (this.clock <= 0) this.beginRecording();
      else this.chip();
    } else if (this.phase === 'recording' || this.phase === 'playing') {
      if (this.scorer?.done) this.finish();
      else this.chip();
    }
  }

  /** Backspace / reacomodar: de vuelta al principio (lo grabado se conserva). */
  reset(): void {
    this.stopRun();
    this.ready();
  }

  dispose(): void {
    this.cancel = true;
    this.stopRun();
    this.root.remove();
    document.body.classList.remove('ap-open');
  }

  // ------------------------------------------------------------------ corridas
  private placeRobot(o: StartOffset): void {
    const s = this.s;
    s.resetField();
    applyOffset(s, o);
    this.scorer = new AutoScorer(s, o);
    s.tap = this.scorer;
  }

  private stopRun(): void {
    const s = this.s;
    s.tap = null;
    s.pilot = null;
    s.inputTap = null;
  }

  private startCountdown(): void {
    this.stopRun();
    this.s.resetField();
    this.s.snapViews();
    this.phase = 'countdown';
    this.clock = COUNTDOWN;
    this.render();
  }

  private beginRecording(): void {
    this.placeRobot(NO_OFFSET);
    this.recorder = new TrackRecorder(PHYSICS_HZ, AUTO_STEPS);
    this.s.inputTap = this.recorder.push;
    this.phase = 'recording';
    this.render();
  }

  private play(): void {
    if (!this.track) return;
    this.stopRun();
    this.placeRobot(this.offset);
    this.s.pilot = new AutoRunner({ id: 'practice', name: this.routeName, steps: [], track: this.track });
    this.phase = 'playing';
    this.render();
  }

  private finish(): void {
    const s = this.s;
    this.result = this.scorer?.result(s) ?? null;
    if (this.phase === 'recording' && this.recorder) {
      this.track = this.recorder.track;
      this.routeName = '';
      this.savedId = null;
      this.variations = null;
    }
    this.stopRun();
    this.phase = 'result';
    this.render();
  }

  private async runVariations(): Promise<void> {
    if (!this.track || this.progress >= 0) return;
    const p = this.s.player;
    this.cancel = false;
    this.progress = 0;
    this.render();
    const offs = randomOffsets(this.vary.n, this.vary.cm, this.vary.deg, Date.now() & 0xffff);
    const routine = { id: 'practice', name: this.routeName, steps: [], track: this.track };
    this.variations = await testVariations(p.index, p.spec, routine, offs, (f) => {
      this.progress = f;
      const bar = this.root.querySelector<HTMLElement>('.ap-prog i');
      if (bar) bar.style.transform = `scaleX(${f})`;
    }, () => this.cancel);
    this.progress = -1;
    if (!this.cancel) this.render();
  }

  private save(name: string): void {
    if (!this.track) return;
    const p = this.s.player;
    const r: SavedRoute = {
      id: this.savedId ?? newRouteId(),
      name: name.trim().slice(0, 40) || t('ap_defaultName', { n: savedRoutes.length + 1 }),
      createdAt: new Date().toISOString(),
      robot: this.h.robotName,
      station: p.station,
      track: this.track,
    };
    storeRoute(r);
    this.savedId = r.id;
    this.routeName = r.name;
    this.msg = t('ap_saved', { name: r.name });
    this.render();
  }

  private load(r: SavedRoute): void {
    this.track = r.track;
    this.routeName = r.name;
    this.savedId = r.id;
    this.result = null;
    this.variations = null;
    this.msg = r.station !== this.s.player.station ? t('ap_otherStation') : '';
    this.play();
  }

  // ------------------------------------------------------------------ vista
  private ready(): void {
    this.phase = 'ready';
    this.render();
  }

  /** Durante la cuenta, la grabación o la repetición: solo una tira chica (para manejar sin estorbo). */
  private chip(): void {
    const el = this.root.querySelector<HTMLElement>('[data-clock]');
    if (!el) return;
    if (this.phase === 'countdown') el.textContent = String(Math.ceil(this.clock));
    else el.textContent = `${((this.scorer?.steps ?? 0) / PHYSICS_HZ).toFixed(1)} / ${GAME.times.auto} s`;
  }

  private resultHtml(r: AutoResult): string {
    const P = GAME.points;
    const lv = ([1, 2, 3] as const).map((l) => `<span>L${l} <b>${r.samples[l]}</b><small>×${P.sampleAuto[l]}</small></span>`).join('');
    const warn: string[] = [];
    if (!r.startOk) warn.push(t('ap_wStart'));
    if (r.center) warn.push(t('ap_wCenter', { n: GAME.fouls.foul }));
    if (r.rivalSamples) warn.push(t('ap_wRival', { n: r.rivalSamples }));
    if (!r.line) warn.push(t('ap_wLine'));
    return `<div class="ap-res">
        <div class="ap-pts"><b>${r.points}</b><small>${t('ap_points')}</small></div>
        <div class="ap-facts">
          <span class="${r.line ? 'ok' : 'bad'}">${r.line ? ic.check : ic.x}${t('ap_line')}${r.lineAt !== null ? ` · ${r.lineAt.toFixed(1)} s` : ''}</span>
          <span class="ap-lv">${lv}</span>
        </div>
      </div>
      ${warn.map((w) => `<div class="ap-warn">${w}</div>`).join('')}`;
  }

  private variationsHtml(v: VariationSummary): string {
    const cm = (m: number) => String(Math.round(m * 100) || 0);
    const rows = v.runs
      .map((r) => {
        const d = Math.hypot(r.final.x - v.base.final.x, r.final.z - v.base.final.z);
        const bad = r.points !== v.base.points || r.center || !r.startOk;
        return `<tr class="${bad ? 'bad' : ''}"><td>${cm(r.offset.forward)}</td><td>${cm(r.offset.right)}</td><td>${(Math.round((r.offset.turn * 1800) / Math.PI) / 10 || 0).toFixed(1)}</td><td><b>${r.points}</b></td><td>${r.line ? '✓' : '✗'}</td><td>${r.center ? '⚠' : ''}${r.startOk ? '' : '⛔'}</td><td>${cm(d)}</td></tr>`;
      })
      .join('');
    return `<div class="ap-vsum">
        <div><b>${Math.round(v.sameRate * 100)}%</b><small>${t('ap_vSame', { p: v.base.points })}</small></div>
        <div><b>${v.minPoints}–${v.maxPoints}</b><small>${t('ap_vRange')}</small></div>
        <div><b>${cm(v.avgDrift)} / ${cm(v.maxDrift)}</b><small>${t('ap_vDrift')}</small></div>
      </div>
      <div class="ap-table"><table><thead><tr><th>${t('ap_fwd')}</th><th>${t('ap_right')}</th><th>°</th><th>${t('ap_pointsShort')}</th><th>${t('ap_lineShort')}</th><th></th><th>${t('ap_drift')}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  private render(): void {
    const ph = this.phase;
    // Los controles touch solo hacen falta mientras grabas (si no, el panel los tapa)
    document.body.classList.toggle('ap-open', ph !== 'recording');
    if (ph === 'countdown' || ph === 'recording' || ph === 'playing') {
      const label = ph === 'countdown' ? t('ap_getReady') : ph === 'recording' ? t('ap_recording') : t('ap_playing');
      this.root.innerHTML = `<div class="ap-chip ${ph}">${ph === 'playing' ? ic.play : ic.rec}<span>${label}</span><b data-clock></b>
        <button class="hud-btn" data-a="stop" title="${t('ap_stop')}">${ic.x}</button></div>`;
      this.root.querySelector('[data-a="stop"]')!.addEventListener('click', () => this.reset());
      this.chip();
      return;
    }
    const tr = this.track;
    const routes = savedRoutes
      .map((r) => {
        const inUse = this.h.currentAuto() === routeRoutine(r).id;
        return `<div class="ap-route" data-id="${esc(r.id)}"><span><b>${esc(r.name)}</b><small>${esc(r.robot)} · ${t('ap_station', { n: r.station + 1 })}${inUse ? ` · ${t('ap_inUse')}` : ''}</small></span>
          <button class="chipbtn" data-a="load" title="${t('ap_play')}">${ic.play}</button><button class="chipbtn" data-a="del" title="${t('rp_delete')}">${ic.x}</button></div>`;
      })
      .join('');
    const num = (k: string, v: number, step: number, unit: string) => `<label><span>${t(k as 'ap_fwd')}</span><input type="number" data-k="${k}" value="${v}" step="${step}"><em>${unit}</em></label>`;
    const o = this.offset;
    const result = ph === 'result' && this.result;
    this.root.innerHTML = `<div class="ap-panel">
      <div class="ap-head">${ic.route}<b>${t('ap_title')}</b><small>${GAME.times.auto} s · §4.2</small>
        <button class="hud-btn" data-a="exit" title="${t('ap_exit')}">${ic.x}</button></div>
      ${this.msg ? `<div class="ap-msg">${esc(this.msg)}</div>` : ''}
      ${result ? `<div class="ap-sec"><h4>${this.routeName ? esc(this.routeName) : t('ap_lastRun')}</h4>${this.resultHtml(this.result!)}</div>` : `<p class="ap-note">${t('ap_intro')}</p>`}
      ${tr ? `<div class="ap-sec"><h4>${t('ap_replayTitle')}</h4>
          <div class="ap-offs">${num('ap_fwd', Math.round(o.forward * 100), 1, 'cm')}${num('ap_right', Math.round(o.right * 100), 1, 'cm')}${num('ap_turn', Math.round((o.turn * 180) / Math.PI), 1, '°')}</div>
          <button class="btn primary" data-a="play">${ic.play}<span>${t('ap_play')}</span></button></div>
        <div class="ap-sec"><h4>${t('ap_varyTitle')}</h4>
          <div class="ap-offs">${num('ap_cm', this.vary.cm, 1, '± cm')}${num('ap_deg', this.vary.deg, 0.5, '± °')}${num('ap_n', this.vary.n, 5, '')}</div>
          ${this.progress >= 0 ? `<div class="ap-prog"><i style="transform:scaleX(${this.progress})"></i></div>` : `<button class="btn" data-a="vary">${ic.chart}<span>${t('ap_vary')}</span></button>`}
          ${this.variations ? this.variationsHtml(this.variations) : ''}</div>
        <div class="ap-sec"><h4>${t('ap_saveTitle')}</h4>
          <div class="ap-save"><input type="text" maxlength="40" data-name placeholder="${t('ap_namePh')}" value="${esc(this.routeName)}">
          <button class="btn" data-a="save">${ic.check}<span>${t('ap_save')}</span></button></div>
          ${this.savedId ? `<button class="btn primary" data-a="use">${ic.go}<span>${t('ap_use')}</span></button>` : ''}
          <p class="ap-note">${t('ap_saveNote')}</p></div>` : ''}
      ${routes ? `<div class="ap-sec"><h4>${t('ap_myRoutes')}</h4>${routes}</div>` : ''}
      <div class="ap-actions"><button class="btn ${tr ? '' : 'primary'}" data-a="rec">${ic.rec}<span>${tr ? t('ap_recordAgain') : t('ap_record')}</span></button></div>
    </div>`;
    const on = (a: string, fn: (el: HTMLElement) => void) => this.root.querySelectorAll<HTMLElement>(`[data-a="${a}"]`).forEach((el) => el.addEventListener('click', () => fn(el)));
    on('exit', () => this.h.exit());
    on('rec', () => {
      this.msg = '';
      this.startCountdown();
    });
    on('play', () => {
      this.msg = '';
      this.play();
    });
    on('vary', () => void this.runVariations());
    on('save', () => this.save(this.root.querySelector<HTMLInputElement>('[data-name]')!.value));
    on('use', () => {
      if (!this.savedId) return;
      this.h.useRoute(routeRoutine({ id: this.savedId } as SavedRoute).id);
      this.msg = t('ap_usedMsg');
      this.render();
    });
    on('load', (el) => {
      const r = savedRoutes.find((x) => x.id === el.closest<HTMLElement>('[data-id]')!.dataset.id);
      if (r) this.load(r);
    });
    on('del', (el) => {
      const id = el.closest<HTMLElement>('[data-id]')!.dataset.id!;
      deleteRoute(id);
      if (this.savedId === id) this.savedId = null;
      this.render();
    });
    this.root.querySelectorAll<HTMLInputElement>('input[data-k]').forEach((inp) =>
      inp.addEventListener('change', () => {
        const v = Number(inp.value);
        if (!Number.isFinite(v)) return;
        const k = inp.dataset.k;
        if (k === 'ap_fwd') this.offset.forward = Math.max(-1, Math.min(1, v / 100));
        else if (k === 'ap_right') this.offset.right = Math.max(-1, Math.min(1, v / 100));
        else if (k === 'ap_turn') this.offset.turn = (Math.max(-45, Math.min(45, v)) * Math.PI) / 180;
        else if (k === 'ap_cm') this.vary.cm = Math.max(0, Math.min(30, v));
        else if (k === 'ap_deg') this.vary.deg = Math.max(0, Math.min(20, v));
        else if (k === 'ap_n') this.vary.n = Math.round(Math.max(1, Math.min(100, v)));
      }),
    );
    // Las teclas de manejo no deben mover nada mientras escribes
    this.root.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => e.stopPropagation()));
  }
}
