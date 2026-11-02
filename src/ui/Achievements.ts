/** Pantalla de logros y progreso: medallas por hitos (`core/achievements.ts`). */
import { ACHIEVEMENTS, unlockedCount, type AchProgress } from '../core/achievements';
import { backBtn, brandbar, ic } from './chrome';
import { t, type Key } from './i18n';

export class AchievementsScreen {
  constructor(
    private root: HTMLElement,
    private progress: () => AchProgress,
    private act: { back: () => void; reset: () => void },
  ) {}

  show(): void {
    const p = this.progress();
    const stat = (k: Key, v: string | number) => `<span class="ach-stat"><small>${t(k)}</small><b>${v}</b></span>`;
    const card = (a: (typeof ACHIEVEMENTS)[number]): string => {
      const got = p.unlocked[a.id];
      const { value, goal } = a.progress(p);
      return `<div class="ach-card ${got ? 'got' : ''}" data-id="${a.id}">
        <i class="tn-medal ${got ? 'gold' : 'none'} lg">${got ? ic.medal : ''}</i>
        <div class="ach-info"><b>${t(`ach_${a.id}` as Key)}</b><p>${t(`ach_${a.id}_d` as Key)}</p>
          <small class="tn-meta">${a.section}${got ? ` · ${new Date(got).toLocaleDateString()}` : ''}</small>
          <div class="ach-bar" title="${value}/${goal}"><i style="width:${(value / goal) * 100}%"></i></div></div>
        <small class="ach-val">${got ? '✓' : `${value}/${goal}`}</small></div>`;
    };
    this.root.className = 'screen solid';
    this.root.innerHTML = `<div class="inner">
      ${brandbar(t('ach_title'))}
      <h1>${t('ach_title')}</h1>
      <p class="sub">${t('ach_sub')}</p>
      <div class="ach-stats">
        ${stat('ach_matches', p.matches)}${stat('ach_wins', p.wins)}${stat('ach_samples', p.samples[0] + p.samples[1] + p.samples[2])}${stat('ach_best', p.bestScore)}
        <span class="ach-stat"><small>${t('ach_earned', { n: unlockedCount(p), m: ACHIEVEMENTS.length })}</small><b>${unlockedCount(p)}/${ACHIEVEMENTS.length}</b></span>
      </div>
      <div class="ach-list">${ACHIEVEMENTS.map(card).join('')}</div>
      <div class="actionbar">${backBtn('data-act="back"')}<div class="grow"></div><button class="btn" data-act="reset">${ic.reset}<span>${t('ach_reset')}</span></button></div>
    </div>`;
    this.root.style.display = '';
    this.root.scrollTop = 0;
    this.root.querySelector('[data-act="back"]')!.addEventListener('click', () => this.act.back());
    this.root.querySelector('[data-act="reset"]')!.addEventListener('click', () => {
      if (confirm(t('ach_resetAsk'))) {
        this.act.reset();
        this.show();
      }
    });
  }
}
