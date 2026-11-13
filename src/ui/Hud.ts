/**
 * HUD en DOM con el estilo de rebuilt-sim: marcador (rojo · timer, fase y avance · azul) con el
 * medidor de Dominio de Cámara, panel del robot propio (Muestra en la garra, Crítica,
 * brazo), botones de cámara / reacomodar / pausa, ayuda de teclas y avisos del match.
 * En práctica libre el marcador se cambia por una píldora con las Muestras anotadas.
 */
import type { Settings } from '../config/settings';
import { GAME } from '../config/game';
import { bounds, formatTimer, timerSeconds } from '../core/clock';
import type { FaultKind } from '../core/damage';
import type { RefText } from './refText';
import type { MatchEvent } from '../core/match';
import { ALLIANCES } from '../core/types';
import type { GameSession } from '../game/GameSession';
import { keyLabel, type Bindings } from '../input/bindings';
import type { CameraMode } from '../render/CameraRig';
import { ic } from './chrome';
import { keyboardHelp } from './controlsHelp';
import { t, type Key } from './i18n';
import { activeStep, nextStep, PREVIEW_S, type StrategyPlan } from '../core/plan';
import type { Phase } from '../core/clock';
import { partnerSummary, stepLabel } from './StrategyScreen';

const el = (tag: string, cls: string, parent?: HTMLElement): HTMLElement => {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.appendChild(e);
  return e;
};

/** Falla activa en la tarjeta del robot: nombre y lo que le queda. */
function faultChip(k: FaultKind, left: number): string {
  const rest = left === Infinity ? t('faultUntilEnd') : `${Math.ceil(left)} s`;
  return `<span class="fault-chip ${k}">⚠ ${t(`fault_${k}` as Key)}<em>${rest}</em></span>`;
}

/** 2 jugadores en pantalla dividida: quién va en cada mitad y cómo se parte (lado a lado o arriba/abajo). */
export interface HudVersus {
  stacked: boolean;
  team: 'opp' | 'same';
  players: { station: number; robot: string; keys: { label: string }[][]; help: string[] }[];
}

export interface HudActions {
  camera: () => void;
  pause: () => void;
  reset: () => void;
}

export class Hud {
  readonly root: HTMLElement;
  private board: HTMLElement;
  private sides: Record<'red' | 'blue', { side: HTMLElement; score: HTMLElement; meter: HTMLElement; txt: HTMLElement; rp: HTMLElement }>;
  private timer: HTMLElement;
  private phase: HTMLElement;
  private prog: HTMLElement;
  private pill: HTMLElement;
  private pillCount: HTMLElement;
  private player: HTMLElement;
  /** Tarjeta del jugador 2 (multijugador local). */
  private player2: HTMLElement;
  private toasts: HTMLElement;
  private camLabel: HTMLElement;
  private resetBtn: HTMLElement;
  private keys: HTMLElement;
  /** Tarjeta de la estrategia de alianza: paso en curso, lo que hace tu compañero y tu nota. */
  private planCard: HTMLElement;
  private plan: StrategyPlan | null = null;
  private planKey = '';
  /** Línea "Sigue … en 0:04" de la tarjeta (solo en los últimos `PREVIEW_S` del paso). */
  private planNext: HTMLElement | null = null;
  private planNextText = '';
  private lastKey = '';
  private flags = { hudToasts: true, hudFouls: true };
  private tr!: HTMLElement;
  private lastScore = { red: -1, blue: -1 };
  /** Mitades de la pantalla dividida (2 jugadores): etiqueta, avisos propios y presentación. */
  private halves: { root: HTMLElement; tag: HTMLElement; toasts: HTMLElement; intro: HTMLElement }[] = [];

  constructor(host: HTMLElement, act: HudActions) {
    this.root = el('div', 'hud', host);
    this.board = el('div', 'scorebug', this.root);
    const side = (a: 'red' | 'blue') => {
      const s = el('div', `sb-side ${a}`, this.board);
      const score = el('div', 'sb-score', s);
      const info = el('div', 'sb-info', s);
      el('div', 'sb-name', info).textContent = t(a);
      const rp = el('div', 'sb-rp', info);
      const meter = el('div', 'meter', rp);
      const txt = el('div', 'sb-rp-txt', rp);
      return { side: s, score, meter: el('i', '', meter), txt, rp };
    };
    // Azul a la izquierda, rojo a la derecha (como en el resto de la UI)
    const blue = side('blue');
    const center = el('div', 'sb-center', this.board);
    this.timer = el('div', 'timer', center);
    this.phase = el('div', 'period', center);
    this.prog = el('i', '', el('div', 'sb-prog', center));
    const red = side('red');
    this.sides = { red, blue };

    this.pill = el('div', 'practice-pill', this.root);
    el('div', 'pp-mode', this.pill).textContent = t('practiceMode');
    this.pillCount = el('div', 'pp-count', this.pill);

    this.player = el('div', 'player', this.root);
    this.player2 = el('div', 'player p2', this.root);
    this.player2.style.display = 'none';
    this.toasts = el('div', 'toasts', this.root);

    const tr = (this.tr = el('div', 'hud-tr', this.root));
    const cam = el('button', 'hud-btn cam', tr);
    cam.innerHTML = `${ic.camera}<span></span><kbd>C</kbd>`;
    cam.title = t('camera');
    cam.addEventListener('click', act.camera);
    this.camLabel = cam;
    this.resetBtn = el('button', 'hud-btn reset', tr);
    this.resetBtn.innerHTML = `${ic.reset}<span>${t('resetShort')}</span>`;
    this.resetBtn.title = t('resetField');
    this.resetBtn.addEventListener('click', act.reset);
    const pause = el('button', 'hud-btn icon', tr);
    pause.innerHTML = ic.pause;
    pause.title = t('paused');
    pause.setAttribute('aria-label', t('paused'));
    pause.addEventListener('click', act.pause);
    this.keys = el('div', 'hud-keys', this.root);
    this.planCard = el('div', 'plan-card', this.root);
    this.planCard.style.display = 'none';
    for (const k of ['p1', 'p2']) {
      const root = el('div', `vs-half ${k}`, this.root);
      this.halves.push({ root, tag: el('div', 'vs-tag', root), toasts: el('div', 'toasts vs-toasts', root), intro: el('div', 'vs-intro', root) });
    }
  }

  /**
   * Pantalla dividida de 2 jugadores (o nada): cada mitad lleva su etiqueta (J1/J2, estación, robot),
   * la tarjeta de su robot, sus avisos (fallas, se resbaló la Muestra) y, al empezar, una presentación
   * con sus controles que se va sola.
   */
  setVersus(v: HudVersus | null): void {
    this.root.classList.toggle('vs-on', !!v);
    this.root.classList.toggle('vs-stacked', !!v?.stacked);
    this.root.classList.remove('vs-intro-on');
    for (const [i, h] of this.halves.entries()) {
      h.toasts.innerHTML = '';
      h.intro.innerHTML = '';
      h.intro.classList.remove('out');
      const p = v?.players[i];
      if (!v || !p) continue;
      const a = p.station < 2 ? 'red' : 'blue';
      const st = `${t(a)} ${(p.station % 2) + 1}`;
      const me = t(i === 0 ? 'vs_p1' : 'vs_p2');
      const other = t(i === 0 ? 'vs_p2' : 'vs_p1');
      h.root.className = `vs-half p${i + 1} ${a}`;
      h.tag.innerHTML = `<b>${t(i === 0 ? 'vs_p1short' : 'vs_p2short')}</b><span>${st}</span>`;
      h.intro.innerHTML = `<div class="vi-card">
        <span class="vi-kick">${t('vs_introGo')}</span>
        <b class="vi-name"><i>${t(i === 0 ? 'vs_p1short' : 'vs_p2short')}</i>${me}</b>
        <span class="vi-sub">${st} · ${p.robot} · ${t(v.team === 'opp' ? 'vs_introOpp' : 'vs_introSame', { other })}</span>
        <div class="vi-keys">${p.keys.map((ks, j) => `<span>${ks.map((k) => (k.label === '–' ? '–' : `<kbd>${k.label}</kbd>`)).join('')}<em>${p.help[j]}</em></span>`).join('')}</div>
      </div>`;
      // La tarjeta del robot de cada quien vive en su mitad
      h.root.appendChild(i === 0 ? this.player : this.player2);
    }
    if (!v) {
      this.root.insertBefore(this.player, this.toasts);
      this.root.insertBefore(this.player2, this.toasts);
      return;
    }
    this.introOut = false;
    this.root.classList.add('vs-intro-on');
  }

  /** La presentación de cada mitad se va a los 4 s de juego (cuenta el tiempo de la sesión: no corre en pausa). */
  private introOut = true;

  /** Cambia cómo se parte la pantalla (al girar el celular). */
  setStacked(stacked: boolean): void {
    this.root.classList.toggle('vs-stacked', stacked);
  }

  setPlan(p: StrategyPlan | null): void {
    this.plan = p;
    this.planKey = '';
    this.planCard.style.display = 'none';
  }

  /** Pizarra apagada en Ajustes (`Settings.planBoard` = 'off'): sin tarjeta. */
  set planCardOn(v: boolean) {
    this.planCard.classList.toggle('off', !v);
  }

  /** Cambia la tarjeta al empezar otro paso de la estrategia y avisa cuánto falta para el siguiente. */
  planStep(phase: Phase, remaining: number): void {
    const a = this.plan ? activeStep(this.plan, phase, remaining) : null;
    const key = a?.key ?? '';
    if (key !== this.planKey) {
      this.planKey = key;
      this.planNextText = '';
      this.planCard.style.display = a ? '' : 'none';
      if (!a || !this.plan) return;
      const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
      this.planCard.innerHTML = `<div class="pc-head"><span>${t('hud_plan')}</span><b>${esc(this.plan.name)}</b></div>
        <div class="pc-step">${stepLabel(a.key, a.step)}</div>
        <div class="pc-row mate"><i></i><span><b>${t('hud_mate')}:</b> ${partnerSummary(this.plan, a)}</span></div>
        ${a.step.me.note || a.step.me.route.length ? `<div class="pc-row me"><i></i><span><b>${t('hud_me')}:</b> ${esc(a.step.me.note || '—')}</span></div>` : ''}
        <div class="pc-next"></div>`;
      this.planNext = this.planCard.querySelector('.pc-next');
      this.planCard.classList.remove('flash');
      void this.planCard.offsetWidth;
      this.planCard.classList.add('flash');
    }
    if (!this.plan || !this.planNext) return;
    const n = nextStep(this.plan, phase, remaining);
    const text = n && n.in <= PREVIEW_S ? t('hud_next', { step: n.phase === 'TELEOP' ? `TELEOP ${n.turn + 1}` : n.key, s: formatTimer(n.in) }) : '';
    if (text === this.planNextText) return;
    this.planNextText = text;
    this.planNext.textContent = text;
  }

  /** Ayuda de teclas con la asignación actual. */
  setHelp(b: Bindings): void {
    this.keys.innerHTML = keyboardHelp(b)
      .map((h) => `<span>${h.keys.map((k) => (k === '–' ? k : `<kbd>${k}</kbd>`)).join('')} ${h.what}</span>`)
      .join('');
    this.camLabel.querySelector('kbd')!.textContent = b.keys.camera[0] ? keyLabel(b.keys.camera[0]) : '';
    this.lastKey = '';
  }

  /** Muestra u oculta cada parte del HUD según Ajustes (solo visual). */
  applySettings(s: Settings): void {
    this.flags = { hudToasts: s.hudToasts, hudFouls: s.hudFouls };
    const hide = (e: HTMLElement | null, on: boolean) => e && (e.style.display = on ? '' : 'none');
    hide(this.board, s.hudScore);
    hide(this.pill, s.hudScore);
    hide(this.player, s.hudRobot);
    hide(this.tr, s.hudButtons);
    hide(this.keys, s.hudHelp);
    hide(this.toasts, s.hudToasts || s.hudFouls);
  }

  show(v: boolean): void {
    this.player2.style.display = 'none';
    if (!v) this.setVersus(null);
    this.lastMiss = {};
    this.root.style.display = v ? '' : 'none';
    this.lastKey = '';
    this.lastScore = { red: -1, blue: -1 };
  }

  /** Aviso del match; con `half` (0 = jugador 1, 1 = jugador 2) va solo en su mitad de la pantalla. */
  toast(text: string, cls = '', half?: number): void {
    if (!this.flags.hudToasts) return;
    const box = half !== undefined && this.root.classList.contains('vs-on') ? this.halves[half].toasts : this.toasts;
    const d = el('div', `toast ${cls}`, box);
    d.textContent = text;
    setTimeout(() => d.classList.add('out'), 2600);
    setTimeout(() => d.remove(), 3200);
    while (box.children.length > 4) box.firstElementChild?.remove();
  }

  /** Avisos de los eventos del match del cuadro. */
  events(evs: readonly MatchEvent[]): void {
    for (const e of evs) {
      if (e.type === 'phase') {
        if (e.phase === 'AUTO') this.toast(t('autoStart'), 'big');
        else if (e.phase === 'TELEOP') this.toast(t('teleopStart'), 'big');
        else if (e.phase === 'ENDGAME') this.toast(t('endgameStart'), 'big warn');
      } else if (e.type === 'sample') this.toast(t('sampleScored', { level: e.level, alliance: t(e.alliance), points: e.points }), e.alliance);
      else if (e.type === 'autoLine') this.toast(t('autoLineMsg', { alliance: t(e.alliance), robot: (e.robot % 2) + 1 }), e.alliance);
      // Las faltas y tarjetas las anuncia el árbitro (`referee`, con su sección del manual)
    }
  }

  /** Carteles del árbitro: faltas, tarjetas, Plataforma y Muestra Crítica, con la sección del manual. */
  referee(calls: readonly RefText[]): void {
    if (!this.flags.hudFouls) return;
    for (const c of calls) {
      const d = el('div', `toast refcall ${c.cls}`, this.toasts);
      el('b', 'rc-title', d).textContent = c.title;
      el('span', 'rc-detail', d).textContent = c.detail;
      el('span', 'rc-sec', d).textContent = c.section;
      setTimeout(() => d.classList.add('out'), 3400);
      setTimeout(() => d.remove(), 4000);
      while (this.toasts.children.length > 4) this.toasts.firstElementChild?.remove();
    }
  }

  private lastMiss: Record<number, number> = {};

  /**
   * Avisos de golpes y fallas de los robots manejados por personas (y de los demás, solo sus fallas).
   * En 2 jugadores, los de cada quien salen en su mitad de la pantalla.
   */
  damage(s: GameSession): void {
    const humans = [s.opts.player, ...(s.player2 ? [s.player2.index] : [])];
    const half = (robot: number) => (humans.length > 1 ? humans.indexOf(robot) : undefined);
    for (const e of s.damageEvents) {
      const mine = humans.includes(e.robot);
      if (e.type === 'fault') {
        const fault = t(`fault_${e.kind}` as Key);
        if (mine) {
          const speed = s.damage.impact(e.robot).toFixed(1);
          this.toast(e.cause === 'impact' ? t('faultHit', { speed, fault }) : t('faultRandom', { fault }), 'fault big', half(e.robot));
        } else {
          const r = s.robots.find((x) => x.index === e.robot);
          if (r) this.toast(t('faultOther', { robot: `${t(r.alliance)} ${r.station + 1}`, fault }), 'fault');
        }
      } else if (!mine) continue;
      else if (e.type === 'repaired') this.toast(t('faultFixed', { fault: t(`fault_${e.kind}` as Key) }), 'ok', half(e.robot));
      else if (e.type === 'dropped') this.toast(t('faultDropped'), 'fault', half(e.robot));
    }
    // Agarre con compliants o preciso: avisa (cada tanto) que la Muestra se resbaló
    for (const e of s.events)
      if (e.type === 'grabMiss' && humans.includes(e.robot) && s.time - (this.lastMiss[e.robot] ?? -Infinity) > 4) {
        this.lastMiss[e.robot] = s.time;
        this.toast(t('grabMiss'), '', half(e.robot));
      }
  }

  update(s: GameSession, cam: CameraMode): void {
    if (!this.introOut && s.time > 4) {
      this.introOut = true;
      this.root.classList.remove('vs-intro-on');
      this.halves.forEach((h) => h.intro.classList.add('out'));
    }
    // Viendo un match del torneo (sin robot propio): sin tarjeta de "tu robot" ni teclas
    this.root.classList.toggle('watch', s.opts.player < 0);
    const m = s.match;
    const me = s.player;
    const mech = me.mech;
    const elev = mech.stowed ? t('stowed') : t('elevatorNames').split('|')[mech.target];
    const time = m ? formatTimer(timerSeconds(m.t, s.game)) : '';
    const score = { red: m ? m.score('red') : s.practiceCount.red, blue: m ? m.score('blue') : s.practiceCount.blue };
    const faults = [...s.damage.faults(me.index)];
    const faultKey = faults.map(([k, left]) => `${k}${left === Infinity ? '' : Math.ceil(left)}`).join(',');
    const p2 = s.player2;
    this.root.classList.toggle('versus', !!p2);
    const key = `${p2 ? p2.mech.stored.length + '/' + !!p2.mech.critical + '/' + p2.mech.intakeOn + '/' + p2.mech.target + '/' + [...s.damage.faults(p2.index).keys()] : ''}|${score.red}|${score.blue}|${time}|${m?.phase}|${me.index}|${mech.capacity}|${mech.stored.length}|${!!mech.critical}|${elev}|${mech.intakeOn}|${mech.inClaw}|${cam}|${faultKey}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.root.classList.toggle('practice', !m);
    this.board.style.display = m ? '' : 'none';
    this.pill.style.display = m ? 'none' : '';
    this.resetBtn.style.display = m ? 'none' : '';

    if (m) {
      const need = GAME.rp.dominanceSamples;
      for (const a of ALLIANCES) {
        const v = this.sides[a];
        v.score.textContent = String(score[a]);
        if (this.lastScore[a] >= 0 && score[a] !== this.lastScore[a]) {
          v.score.classList.remove('bump');
          void v.score.offsetWidth;
          v.score.classList.add('bump');
        }
        this.lastScore[a] = score[a];
        v.side.classList.toggle('mine', a === me.alliance);
        const n = m.samplesIn(a);
        v.meter.style.transform = `scaleX(${Math.min(1, n / need)})`;
        v.rp.classList.toggle('full', n >= need);
        v.txt.innerHTML = `<span>${t('samplesShort')} ${n}</span><em>${t('dominance')} ≥${need}</em>`;
      }
      const sec = timerSeconds(m.t, s.game);
      this.timer.textContent = time;
      this.timer.classList.toggle('endgame', m.phase === 'ENDGAME');
      this.timer.classList.toggle('low', m.running && (m.phase === 'ENDGAME' || m.phase === 'AUTO') && sec <= 10);
      this.phase.textContent = t(`phase_${m.phase}` as Key);
      this.prog.style.transform = `scaleX(${Math.min(1, Math.max(0, m.t / bounds(s.game).teleopEnd))})`;
    } else
      this.pillCount.innerHTML = `<b>${score[me.alliance]}</b><span>${t('practiceScored')}</span>${s.hps[me.alliance].enabled ? `<span class="pp-hp">HP ∞</span>` : ''}`;

    this.card(this.player, s, me, p2 ? t('vs_p1') : t('you'));
    this.player2.style.display = p2 ? '' : 'none';
    if (p2) this.card(this.player2, s, p2, t('vs_p2'));
    this.camLabel.querySelector('span')!.textContent = t(`cam_${cam}` as Key);
  }

  /** Tarjeta de un robot manejado por una persona: Muestras, garra, brazo y fallas. */
  private card(box: HTMLElement, s: GameSession, me: GameSession['player'], tag: string): void {
    const mech = me.mech;
    const elev = mech.stowed ? t('stowed') : t('elevatorNames').split('|')[mech.target];
    const faults = [...s.damage.faults(me.index)];
    const full = mech.stored.length >= mech.capacity;
    box.className = `player ${box.classList.contains('p2') ? 'p2 ' : ''}${me.alliance} ${full ? 'full' : ''}`;
    box.innerHTML = `
      <div class="p-head"><span class="p-num">${t(me.alliance).slice(0, 1)}${me.station + 1}</span><span class="p-name">${me.spec.label ?? t(`type_${me.spec.mechanism}` as Key)}</span><span class="p-tag">${tag}</span></div>
      <div class="p-hopper"><div class="p-fuel"><b>${mech.stored.length}</b><small>/${mech.capacity}</small><span>${t('stored')}</span></div>
        <div class="hbar">${Array.from({ length: mech.capacity }, (_, i) => `<i class="${i < mech.stored.length ? 'on' : ''}"></i>`).join('')}</div></div>
      <div class="chips"><span class="${mech.intakeOn ? 'on' : 'off'}">${t('intake')} ${mech.intakeOn ? t('on') : t('off')}</span>
        <span class="${mech.critical ? 'on' : 'off'}">${t('critical')} ${mech.critical ? '■' : '–'}</span>
        <span class="${mech.inClaw ? 'on' : 'off'}">${t('claw')} ${mech.inClaw ? '■' : '–'}</span>
        <span>${t('arm')}: ${elev}</span></div>${faults.length ? `<div class="faults">${faults.map(([k, left]) => faultChip(k, left)).join('')}</div>` : ''}`;
    box.classList.toggle('damaged', faults.length > 0);
  }
}
