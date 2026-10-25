/**
 * HUD en DOM: marcador (rojo · timer y fase · azul), estado del robot propio, avisos del match
 * (Muestras, línea, faltas, cambios de fase) y ayuda de controles.
 */
import { formatTimer, timerSeconds } from '../core/clock';
import { RULES } from '../core/fouls';
import type { MatchEvent } from '../core/match';
import type { GameSession } from '../game/GameSession';
import type { CameraMode } from '../render/CameraRig';
import { t, type Key } from './i18n';

const el = (tag: string, cls: string, parent?: HTMLElement): HTMLElement => {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.appendChild(e);
  return e;
};

export class Hud {
  readonly root: HTMLElement;
  private red: HTMLElement;
  private blue: HTMLElement;
  private timer: HTMLElement;
  private phase: HTMLElement;
  private robot: HTMLElement;
  private toasts: HTMLElement;
  private cam: HTMLElement;
  private help: HTMLElement;
  private lastKey = '';

  constructor(host: HTMLElement) {
    this.root = el('div', 'hud', host);
    const board = el('div', 'board', this.root);
    this.red = el('div', 'score red', board);
    const mid = el('div', 'mid', board);
    this.timer = el('div', 'timer', mid);
    this.phase = el('div', 'phase', mid);
    this.blue = el('div', 'score blue', board);
    this.robot = el('div', 'robot-status', this.root);
    this.toasts = el('div', 'toasts', this.root);
    this.cam = el('div', 'cam-label', this.root);
    this.help = el('div', 'help', this.root);
  }

  /** Ayuda de controles con la asignación actual. */
  setHelp(keyboard: string, pad: string): void {
    this.help.innerHTML = `${keyboard}<br>${pad}`;
  }

  show(v: boolean): void {
    this.root.style.display = v ? '' : 'none';
  }

  toast(text: string, cls = ''): void {
    const d = el('div', `toast ${cls}`, this.toasts);
    d.textContent = text;
    setTimeout(() => d.classList.add('out'), 2600);
    setTimeout(() => d.remove(), 3200);
    while (this.toasts.children.length > 5) this.toasts.firstElementChild?.remove();
  }

  /** Avisos de los eventos del match del cuadro. */
  events(evs: readonly MatchEvent[]): void {
    for (const e of evs) {
      if (e.type === 'phase') {
        if (e.phase === 'AUTO') this.toast(t('autoStart'), 'big');
        else if (e.phase === 'TELEOP') this.toast(t('teleopStart'), 'big');
        else if (e.phase === 'ENDGAME') this.toast(t('endgameStart'), 'big warn');
      } else if (e.type === 'sample') this.toast(t('sampleScored', { level: e.level, alliance: t(e.alliance), points: e.points }), e.alliance);
      else if (e.type === 'autoLine') this.toast(t('autoLineMsg', { robot: e.robot + 1 }), e.alliance);
      else if (e.type === 'foul') {
        const r = RULES[e.foul.rule];
        this.toast(t('foulMsg', { kind: e.foul.kind === 'TECH' ? 'Tech Foul' : 'Foul', alliance: t(e.foul.offender), robot: e.foul.robot + 1, rule: `${r.es} (${r.section})` }), 'foul');
      } else if (e.type === 'card') this.toast(`${e.card.type} CARD · ${t(e.card.alliance)} (robot ${e.card.robot + 1}): ${e.card.reason}`, 'foul');
    }
  }

  update(s: GameSession, cam: CameraMode): void {
    const m = s.match;
    const redScore = m ? m.score('red') : s.practiceCount.red;
    const blueScore = m ? m.score('blue') : s.practiceCount.blue;
    const time = m ? formatTimer(timerSeconds(m.t, s.game)) : '–:––';
    const phase = m ? t(`phase_${m.phase}` as Key) : t('practiceMode');
    const me = s.player;
    const mech = me.mech;
    const kind = me.spec.mechanism;
    const elevLabel = t(kind === 'pivot' ? 'arm' : kind === 'tower' ? 'scoop' : 'elevator');
    const elev = mech.stowed ? t('stowed') : t('elevatorNames').split('|')[mech.target];
    const key = `${redScore}|${blueScore}|${time}|${phase}|${me.index}|${mech.capacity}|${mech.stored.length}|${!!mech.critical}|${elev}|${mech.intakeOn}|${cam}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.red.textContent = String(redScore);
    this.blue.textContent = String(blueScore);
    this.timer.textContent = time;
    this.phase.textContent = m ? phase : `${phase} · ${t('sampleCount', { red: redScore, blue: blueScore })}`;
    this.timer.classList.toggle('endgame', m?.phase === 'ENDGAME');
    this.robot.className = `robot-status ${me.alliance}`;
    this.robot.innerHTML =
      `<b>${t('yourRobot')}: ${t(me.alliance)} ${me.station + 1}</b>` +
      `<span>${t('stored')}: ${mech.stored.length}/${mech.capacity}</span>` +
      `<span>${t('critical')}: ${mech.critical ? '■' : '–'}</span>` +
      `<span>${elevLabel}: ${elev}</span>` +
      `<span>${t('intake')}: ${mech.intakeOn ? t('on') : t('off')}</span>`;
    this.cam.textContent = `${t('camera')}: ${t(`cam_${cam}` as Key)} (C)`;
  }
}
