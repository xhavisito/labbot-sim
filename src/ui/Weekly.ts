/**
 * Desafío semanal: la pantalla del menú con el reto de la semana, su meta de puntos y el marcador
 * local de mejores marcas (en este navegador). Se juega con el panel de `ui/Training.ts`.
 * La lógica está en `core/weekly.ts`.
 */
import { entriesOf, weeklyChallenge, weeksCleared, type WeeklyBoard } from '../core/weekly';
import { backBtn, brandbar, ic } from './chrome';
import { dateTime, t, type Key } from './i18n';

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** "3 d 4 h" / "5 h 20 min" que faltan para el siguiente lunes. */
export function timeLeft(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return d > 0 ? `${d} d ${h} h` : `${h} h ${m % 60} min`;
}

export class WeeklyScreen {
  constructor(
    private root: HTMLElement,
    private board: WeeklyBoard,
    private robotName: () => string,
    private act: { back: () => void; play: () => void },
  ) {}

  show(): void {
    const ch = weeklyChallenge();
    const rows = entriesOf(this.board, ch.week);
    const best = rows[0]?.points ?? null;
    const met = best !== null && best >= ch.goal;
    const board = rows.length
      ? `<ol class="wk-board">${rows
          .map((e, i) => `<li class="${e.points >= ch.goal ? 'met' : ''}"><i>${i + 1}</i><b>${e.points} pts</b><span>${esc(e.robot)}</span><small>${e.at ? dateTime(e.at) : ''}</small></li>`)
          .join('')}</ol>`
      : `<p class="tn-note dim">${t('wk_empty')}</p>`;
    this.root.className = 'screen solid';
    this.root.innerHTML = `<div class="inner">
      ${brandbar(t('wk_title'))}
      <h1>${t('wk_title')}</h1>
      <p class="sub">${t('wk_sub')}</p>
      <div class="tn-card wk-card">
        <i class="tn-medal ${met ? 'gold' : 'none'} lg">${met ? ic.medal : ''}</i>
        <div class="tn-info"><b>${t(`wk_${ch.def.id}` as Key)}</b>
          <p>${t('wk_goal', { n: ch.goal, s: ch.def.limit })}</p>
          <small class="tn-meta">${ch.week} · ${t('wk_ends', { t: timeLeft(ch.end.getTime() - Date.now()) })} · §4.4</small>
          <small class="tn-meta">${t('wk_assume')}</small></div>
        <div class="tn-side">
          <div class="tn-rec">${best !== null ? `<small>${t('tn_record')}</small><b>${best} pts</b><small>${met ? t('wk_met') : t('wk_notMet', { n: ch.goal - best })}</small>` : `<small>${t('tn_noRecord')}</small>`}</div>
          <button class="btn primary" data-play>${ic.play}<span>${t('tn_play')}</span></button>
        </div></div>
      <h2 class="wk-h">${t('wk_boardTitle')}</h2>
      <p class="tn-note dim">${t('wk_robot', { r: esc(this.robotName()) })} · ${t('wk_cleared', { n: weeksCleared(this.board) })}</p>
      ${board}
      <div class="actionbar">${backBtn('data-act="back"')}<div class="grow"></div></div>
    </div>`;
    this.root.style.display = '';
    this.root.scrollTop = 0;
    this.root.querySelector('[data-act="back"]')!.addEventListener('click', () => this.act.back());
    this.root.querySelector('[data-play]')!.addEventListener('click', () => this.act.play());
  }
}
