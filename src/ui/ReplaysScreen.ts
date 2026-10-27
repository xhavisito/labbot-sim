/**
 * Repeticiones guardadas en este navegador (las últimas `KEEP`; las de estrella no se borran solas):
 * ver, estadísticas, descargar `.lbreplay`, borrar, y abrir un archivo de otro equipo.
 */
import type { Replay } from '../replay/format';
import { deleteReplay, downloadReplay, KEEP, listReplays, loadReplay, readReplayFile, setStarred, type SavedReplay } from '../replay/store';
import { backBtn, brandbar, ic } from './chrome';
import { dateTime, t } from './i18n';
import { stationTag } from './StatsPanel';

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export interface ReplaysActions {
  back: () => void;
  watch: (r: Replay) => void;
  stats: (r: Replay) => void;
}

export class ReplaysScreen {
  private error = '';

  constructor(
    private root: HTMLElement,
    private act: ReplaysActions,
  ) {}

  async show(): Promise<void> {
    const list = await listReplays();
    const card = (s: SavedReplay): string => {
      const h = s.header;
      const me = h.robots.find((r) => r.index === h.player);
      const win = h.final.red === h.final.blue ? '' : h.final.red > h.final.blue ? 'red' : 'blue';
      const kb = Math.max(1, Math.round(s.bytes.length / 1024));
      return `<div class="rp-card" data-id="${esc(s.id)}">
        <div class="rp-score"><b class="red ${win === 'red' ? 'win' : ''}">${h.final.red}</b><span>–</span><b class="blue ${win === 'blue' ? 'win' : ''}">${h.final.blue}</b></div>
        <div class="rp-info"><b>${dateTime(h.createdAt)}</b>
          <small>${me ? `${t('yourRobot')}: ${stationTag(me.alliance, me.station)} · ${esc(me.label)}` : t('rp_aiOnly')} · ${kb} KB</small>
          <small class="rp-robots">${h.robots.map((r) => `<span class="${r.alliance}">${stationTag(r.alliance, r.station)} ${esc(r.label)}</span>`).join('')}</small></div>
        <div class="rp-btns">
          <button class="chipbtn ${s.starred ? 'on' : ''}" data-star title="${t('rp_star')}">★</button>
          <button class="btn primary" data-watch>${ic.play}<span>${t('rp_watch')}</span></button>
          <button class="btn" data-stats>${ic.chart}<span>${t('st_title')}</span></button>
          <button class="btn" data-dl title="${t('rp_download')}">${ic.download}</button>
          <button class="x" data-del title="${t('rp_delete')}" aria-label="${t('rp_delete')}">${ic.x}</button>
        </div></div>`;
    };
    this.root.className = 'screen solid';
    this.root.innerHTML = `<div class="inner">
      ${brandbar(t('rp_list'))}
      <h1>${t('rp_list')}</h1>
      <p class="sub">${t('rp_listNote', { n: KEEP })}</p>
      ${this.error ? `<div class="msg">${esc(this.error)}</div>` : ''}
      <div class="rp-list">${list.length ? list.map(card).join('') : `<div class="msg">${t('rp_none')}</div>`}</div>
      <div class="actionbar">${backBtn('data-act="back"')}<div class="grow"></div>
        <label class="btn">${ic.download}<span>${t('rp_open')}</span><input type="file" accept=".lbreplay,application/octet-stream" hidden></label></div>
      </div>`;
    this.root.style.display = '';
    this.error = '';
    const get = async (el: HTMLElement): Promise<Replay | null> => {
      const id = el.closest<HTMLElement>('[data-id]')!.dataset.id!;
      try {
        return await loadReplay(id);
      } catch (e) {
        this.error = String(e instanceof Error ? e.message : e);
        void this.show();
        return null;
      }
    };
    const on = (sel: string, fn: (el: HTMLElement) => void) => this.root.querySelectorAll<HTMLElement>(sel).forEach((el) => el.addEventListener('click', () => fn(el)));
    on('[data-watch]', async (el) => {
      const r = await get(el);
      if (r) this.act.watch(r);
    });
    on('[data-stats]', async (el) => {
      const r = await get(el);
      if (r) this.act.stats(r);
    });
    on('[data-dl]', async (el) => {
      const r = await get(el);
      if (r) await downloadReplay(r);
    });
    on('[data-del]', async (el) => {
      await deleteReplay(el.closest<HTMLElement>('[data-id]')!.dataset.id!);
      void this.show();
    });
    on('[data-star]', async (el) => {
      await setStarred(el.closest<HTMLElement>('[data-id]')!.dataset.id!, !el.classList.contains('on'));
      void this.show();
    });
    on('[data-act="back"]', () => this.act.back());
    this.root.querySelector<HTMLInputElement>('input[type="file"]')?.addEventListener('change', async (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (!f) return;
      try {
        this.act.watch(await readReplayFile(f));
      } catch (err) {
        this.error = `${t('rp_badFile')} (${err instanceof Error ? err.message : String(err)})`;
        void this.show();
      }
    });
  }
}
