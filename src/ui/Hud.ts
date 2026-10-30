/**
 * HUD en DOM con el estilo de rebuilt-sim: marcador (rojo · timer, fase y avance · azul) con el
 * medidor de Dominio de Cámara, panel del robot propio (Muestra en la garra, Crítica,
 * brazo), botones de cámara / reacomodar / pausa, ayuda de teclas y avisos del match.
 * En práctica libre el marcador se cambia por una píldora con las Muestras anotadas.
 */
import { GAME } from '../config/game';
import { bounds, formatTimer, timerSeconds } from '../core/clock';
import type { FaultKind } from '../core/damage';
import { RULES } from '../core/fouls';
import type { MatchEvent } from '../core/match';
import { ALLIANCES } from '../core/types';
import type { GameSession } from '../game/GameSession';
import { keyLabel, type Bindings } from '../input/bindings';
import type { CameraMode } from '../render/CameraRig';
import { ic } from './chrome';
import { keyboardHelp } from './controlsHelp';
import { t, type Key } from './i18n';

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
  private toasts: HTMLElement;
  private camLabel: HTMLElement;
  private resetBtn: HTMLElement;
  private keys: HTMLElement;
  private lastKey = '';
  private lastScore = { red: -1, blue: -1 };

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
    this.toasts = el('div', 'toasts', this.root);

    const tr = el('div', 'hud-tr', this.root);
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
  }

  /** Ayuda de teclas con la asignación actual. */
  setHelp(b: Bindings): void {
    this.keys.innerHTML = keyboardHelp(b)
      .map((h) => `<span>${h.keys.map((k) => (k === '–' ? k : `<kbd>${k}</kbd>`)).join('')} ${h.what}</span>`)
      .join('');
    this.camLabel.querySelector('kbd')!.textContent = b.keys.camera[0] ? keyLabel(b.keys.camera[0]) : '';
    this.lastKey = '';
  }

  show(v: boolean): void {
    this.root.style.display = v ? '' : 'none';
    this.lastKey = '';
    this.lastScore = { red: -1, blue: -1 };
  }

  toast(text: string, cls = ''): void {
    const d = el('div', `toast ${cls}`, this.toasts);
    d.textContent = text;
    setTimeout(() => d.classList.add('out'), 2600);
    setTimeout(() => d.remove(), 3200);
    while (this.toasts.children.length > 4) this.toasts.firstElementChild?.remove();
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
      else if (e.type === 'foul') {
        const r = RULES[e.foul.rule];
        this.toast(t('foulMsg', { kind: e.foul.kind === 'TECH' ? 'Tech Foul' : 'Foul', alliance: t(e.foul.offender), robot: (e.foul.robot % 2) + 1, rule: `${r.es} (${r.section})` }), 'foul');
      } else if (e.type === 'card')
        this.toast(`${e.card.type} CARD · ${t(e.card.alliance)} ${(e.card.robot % 2) + 1}: ${e.card.reason}`, e.card.type === 'RED' ? 'card-red' : 'card-yellow');
    }
  }

  private lastMiss = -Infinity;

  /** Avisos de golpes y fallas del robot propio (y de los demás, solo sus fallas). */
  damage(s: GameSession): void {
    const me = s.opts.player;
    for (const e of s.damageEvents) {
      if (e.type === 'fault') {
        const fault = t(`fault_${e.kind}` as Key);
        if (e.robot === me) {
          const speed = s.damage.impact(me).toFixed(1);
          this.toast(e.cause === 'impact' ? t('faultHit', { speed, fault }) : t('faultRandom', { fault }), 'fault big');
        } else {
          const r = s.robots.find((x) => x.index === e.robot);
          if (r) this.toast(t('faultOther', { robot: `${t(r.alliance)} ${r.station + 1}`, fault }), 'fault');
        }
      } else if (e.robot !== me) continue;
      else if (e.type === 'repaired') this.toast(t('faultFixed', { fault: t(`fault_${e.kind}` as Key) }), 'ok');
      else if (e.type === 'dropped') this.toast(t('faultDropped'), 'fault');
    }
    // Agarre con compliants o preciso: avisa (cada tanto) que la Muestra se resbaló
    for (const e of s.events)
      if (e.type === 'grabMiss' && e.robot === me && s.time - this.lastMiss > 4) {
        this.lastMiss = s.time;
        this.toast(t('grabMiss'));
      }
  }

  update(s: GameSession, cam: CameraMode): void {
    // Viendo un match del torneo (sin robot propio): sin tarjeta de "tu robot" ni teclas
    this.root.classList.toggle('watch', s.opts.player < 0);
    const m = s.match;
    const me = s.player;
    const mech = me.mech;
    const kind = me.spec.mechanism;
    const elev = mech.stowed ? t('stowed') : t('elevatorNames').split('|')[mech.target];
    const time = m ? formatTimer(timerSeconds(m.t, s.game)) : '';
    const score = { red: m ? m.score('red') : s.practiceCount.red, blue: m ? m.score('blue') : s.practiceCount.blue };
    const faults = [...s.damage.faults(me.index)];
    const faultKey = faults.map(([k, left]) => `${k}${left === Infinity ? '' : Math.ceil(left)}`).join(',');
    const key = `${score.red}|${score.blue}|${time}|${m?.phase}|${me.index}|${mech.capacity}|${mech.stored.length}|${!!mech.critical}|${elev}|${mech.intakeOn}|${mech.inClaw}|${cam}|${faultKey}`;
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

    const full = mech.stored.length >= mech.capacity;
    this.player.className = `player ${me.alliance} ${full ? 'full' : ''}`;
    this.player.innerHTML = `
      <div class="p-head"><span class="p-num">${t(me.alliance).slice(0, 1)}${me.station + 1}</span><span class="p-name">${t(`type_${kind}` as Key)}</span><span class="p-tag">${t('you')}</span></div>
      <div class="p-hopper"><div class="p-fuel"><b>${mech.stored.length}</b><small>/${mech.capacity}</small><span>${t('stored')}</span></div>
        <div class="hbar">${Array.from({ length: mech.capacity }, (_, i) => `<i class="${i < mech.stored.length ? 'on' : ''}"></i>`).join('')}</div></div>
      <div class="chips"><span class="${mech.intakeOn ? 'on' : 'off'}">${t('intake')} ${mech.intakeOn ? t('on') : t('off')}</span>
        <span class="${mech.critical ? 'on' : 'off'}">${t('critical')} ${mech.critical ? '■' : '–'}</span>
        <span class="${mech.inClaw ? 'on' : 'off'}">${t('claw')} ${mech.inClaw ? '■' : '–'}</span>
        <span>${t('arm')}: ${elev}</span></div>${faults.length ? `<div class="faults">${faults.map(([k, left]) => faultChip(k, left)).join('')}</div>` : ''}`;
    this.player.classList.toggle('damaged', faults.length > 0);
    this.camLabel.querySelector('span')!.textContent = t(`cam_${cam}` as Key);
  }
}
