/** Comparar dos robots guardados lado a lado (`core/robotCompare.ts`). Lo que falta dice "sin datos". */
import { compareRows, type CompareKey, type RobotSummary } from '../core/robotCompare';
import { backBtn, brandbar } from './chrome';
import { t, type Key } from './i18n';

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const fmt: Record<CompareKey, (v: number) => string> = {
  avgCycle: (v) => `${v.toFixed(1)} s`,
  bestCycle: (v) => `${v.toFixed(1)} s`,
  accuracy: (v) => `${Math.round(v * 100)} %`,
  pointsPerMinute: (v) => v.toFixed(1),
};
const label: Record<CompareKey, Key> = { avgCycle: 'cmp_avgCycle', bestCycle: 'cmp_bestCycle', accuracy: 'cmp_accuracy', pointsPerMinute: 'cmp_ppm' };

export class CompareScreen {
  private ia = 0;
  private ib = 1;

  constructor(
    private root: HTMLElement,
    /** Resumen de cada robot guardado (se arma al abrir, con lo último). */
    private robots: () => RobotSummary[],
    private onBack: () => void,
  ) {}

  show(): void {
    const all = this.robots();
    this.ia = Math.min(this.ia, all.length - 1);
    this.ib = Math.min(this.ib, all.length - 1);
    const a = all[this.ia];
    const b = all[this.ib];
    const opts = (sel: number) => all.map((r, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
    const cell = (v: number | null, k: CompareKey, best: boolean) => (v === null ? `<td class="nodata">${t('cmp_noData')}</td>` : `<td class="${best ? 'best' : ''}">${fmt[k](v)}</td>`);
    const rows = compareRows(a, b)
      .map((r) => `<tr><td>${t(label[r.key])}</td>${cell(r.a, r.key, r.better === 'a')}${cell(r.b, r.key, r.better === 'b')}</tr>`)
      .join('');
    const min = (v: number) => `${v.toFixed(1)} min`;
    this.root.className = 'screen solid';
    this.root.innerHTML = `<div class="inner">
      ${brandbar(t('cmp_title'))}
      <h1>${t('cmp_title')}</h1>
      <p class="sub">${t('cmp_sub')}</p>
      <div class="cmp-pick">
        <label>${t('cmp_robotA')} <select data-cmp="a">${opts(this.ia)}</select></label>
        <label>${t('cmp_robotB')} <select data-cmp="b">${opts(this.ib)}</select></label>
      </div>
      <div class="tablewrap"><table class="breakdown cmp-stats">
        <tr><th></th><th>${esc(a.name)}</th><th>${esc(b.name)}</th></tr>
        ${rows}
        <tr><td>${t('cmp_shots')}</td><td>${a.shots}</td><td>${b.shots}</td></tr>
        <tr><td>${t('cmp_played')}</td><td>${min(a.minutes)}</td><td>${min(b.minutes)}</td></tr>
      </table></div>
      <p class="sub">${t('cmp_note')}</p>
      <div class="actionbar">${backBtn('data-act="back"')}</div>
    </div>`;
    this.root.style.display = '';
    this.root.scrollTop = 0;
    const pick = (k: 'a' | 'b') =>
      this.root.querySelector<HTMLSelectElement>(`[data-cmp="${k}"]`)!.addEventListener('change', (e) => {
        const v = Number((e.target as HTMLSelectElement).value);
        if (k === 'a') this.ia = v;
        else this.ib = v;
        this.show();
      });
    pick('a');
    pick('b');
    this.root.querySelector('[data-act="back"]')!.addEventListener('click', () => this.onBack());
  }
}
