/**
 * Controles de la repetición: marcador arriba y barra abajo con play/pausa, saltos entre jugadas
 * clave, cuadro a cuadro, línea de tiempo (Muestras y faltas marcadas), velocidad, Resumen, robot que
 * sigue la cámara, cámara, estadísticas y salir. A la derecha, la lista de jugadas clave
 * (`replay/moments.ts`) con filtro Todas / Puntos / Faltas: tocar una salta a unos segundos antes.
 * Teclado: espacio = play/pausa, ←/→ = 5 s, [ / ] = jugada anterior / siguiente, , / . = cuadro,
 * H = Resumen, M = lista de jugadas, C = cámara.
 */
import { RULES, type RuleCode } from '../core/fouls';
import { MOMENT_FILTERS, momentTotals, type Moment } from '../replay/moments';
import { REPLAY_SPEEDS, type ReplayPlayer } from '../replay/ReplayPlayer';
import { ic } from './chrome';
import { t, type Key } from './i18n';
import { stationTag } from './StatsPanel';

export interface ReplayBarActions {
  camera: () => void;
  stats: () => void;
  exit: () => void;
}

const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Texto corto de una jugada (sin el robot ni los puntos). */
export function momentLabel(m: Moment): string {
  switch (m.kind) {
    case 'score':
      return `${t('rp_m_score', { level: m.level ?? '' })}${m.period === 'AUTO' ? ' · AUTO' : ''}`;
    case 'autoLine':
      return t('rp_m_autoLine');
    case 'critical':
      return t(m.points ? 'rp_m_critical' : 'rp_m_criticalMiss');
    case 'platform':
      return t('rp_m_platform', { n: m.robots ?? 0 });
    case 'phase':
      return t(`rp_m_phase_${m.phase}` as Key);
    case 'card':
      return t(`rp_m_card_${m.card}` as Key);
    case 'foul': {
      const r = m.rule ? RULES[m.rule as RuleCode] : undefined;
      return `${m.foulKind === 'TECH' ? 'Tech Foul' : 'Foul'}${r ? ` · ${r.es}` : ''}`;
    }
  }
}

const KIND_ICON: Record<Moment['kind'], string> = { score: '●', autoLine: '↗', critical: '◆', platform: '▲', phase: '⏱', foul: '!', card: '■' };

export class ReplayBar {
  readonly root: HTMLElement;
  private p: ReplayPlayer | null = null;
  private dragging = false;
  /** Lista de jugadas abierta (en celular empieza cerrada para no tapar la cancha). */
  private listOpen = typeof window !== 'undefined' && window.innerWidth > 760;
  private shownMoment: Moment | null | undefined = undefined;

  constructor(host: HTMLElement, private act: ReplayBarActions) {
    this.root = document.createElement('div');
    this.root.className = 'replaybar-wrap';
    this.root.style.display = 'none';
    host.appendChild(this.root);
    window.addEventListener('keydown', (e) => {
      const p = this.p;
      if (!p || this.root.style.display === 'none') return;
      if (e.code === 'Space') this.togglePlay();
      else if (e.code === 'ArrowLeft') p.seek(p.t - 5);
      else if (e.code === 'ArrowRight') p.seek(p.t + 5);
      else if (e.code === 'BracketLeft') p.prevMoment();
      else if (e.code === 'BracketRight') p.nextMoment();
      else if (e.code === 'Comma') p.stepFrame(-1);
      else if (e.code === 'Period') p.stepFrame(1);
      else if (e.code === 'KeyH') this.setHighlights(!p.highlights);
      else if (e.code === 'KeyM') this.toggleList();
      else return;
      e.preventDefault();
    });
  }

  private togglePlay(): void {
    const p = this.p;
    if (!p) return;
    if (!p.playing && p.t >= p.duration - 0.01) p.seek(0);
    p.playing = !p.playing;
  }

  private setHighlights(on: boolean): void {
    const p = this.p;
    if (!p) return;
    p.highlights = on;
    this.root.querySelector('[data-a="hl"]')?.classList.toggle('on', p.highlights);
  }

  private toggleList(): void {
    this.listOpen = !this.listOpen;
    this.root.querySelector('.rb-moments')?.classList.toggle('open', this.listOpen);
    this.root.querySelector('[data-a="list"]')?.classList.toggle('on', this.listOpen);
  }

  /** Robot de una jugada como en el resto de la UI (A1, R2…), o vacío. */
  private robotTag(m: Moment): string {
    const r = this.p?.replay.header.robots.find((x) => x.index === m.robot);
    return r ? stationTag(r.alliance, r.station) : '';
  }

  private pointsTag(m: Moment): string {
    if (!m.points || !m.pointsTo) return '';
    const rival = m.alliance && m.pointsTo !== m.alliance;
    return `<b class="${m.pointsTo}">+${m.points}${rival ? ` <small>${t('rp_m_toRival', { a: t(m.pointsTo) })}</small>` : ''}</b>`;
  }

  /** Marcas de la línea de tiempo y lista de jugadas según el filtro. */
  private renderMoments(): void {
    const p = this.p;
    if (!p) return;
    const list = p.visibleMoments;
    const pct = (s: number) => (100 * s) / Math.max(1, p.duration);
    this.root.querySelector('.rb-marks')!.innerHTML = list
      .filter((m) => m.kind !== 'phase')
      .map((m) => {
        const cls = m.kind === 'foul' || m.kind === 'card' ? `foul ${m.kind === 'card' ? (m.card === 'RED' ? 'rc' : 'yc') : ''}` : (m.alliance ?? '');
        return `<i class="${cls} k-${m.kind}" style="left:${pct(m.t)}%"></i>`;
      })
      .join('');
    const tot = momentTotals(list);
    const body = this.root.querySelector('.rb-mlist')!;
    body.innerHTML = list.length
      ? list
          .map(
            (m, i) => `<button class="rb-m ${m.alliance ?? 'neutral'} k-${m.kind}" data-m="${i}">
            <span class="rb-mt">${mmss(m.t)}</span><span class="rb-mi">${KIND_ICON[m.kind]}</span>
            <span class="rb-ml"><span>${esc(momentLabel(m))}</span><em>${this.robotTag(m)}${this.robotTag(m) ? ' · ' : ''}${m.section}</em></span>${this.pointsTag(m)}</button>`,
          )
          .join('')
      : `<div class="rb-mnone">${t('rp_noMoments')}</div>`;
    this.root.querySelector('.rb-mtot')!.innerHTML = `<b class="blue">${tot.blue}</b><b class="red">${tot.red}</b>`;
    body.querySelectorAll<HTMLElement>('[data-m]').forEach((b) =>
      b.addEventListener('click', () => {
        p.goTo(list[Number(b.dataset.m)]);
        p.playing = true;
      }),
    );
    this.shownMoment = undefined;
  }

  show(p: ReplayPlayer | null): void {
    this.p = p;
    this.root.style.display = p ? '' : 'none';
    if (!p) return;
    const h = p.replay.header;
    this.root.innerHTML = `
      <div class="rb-score"><b class="blue">0</b><div><span class="rb-timer">0:15</span><small class="rb-phase"></small></div><b class="red">0</b></div>
      <div class="rb-tag">${ic.play}${t('rp_title')}</div>
      <div class="rb-now" hidden></div>
      <aside class="rb-moments ${this.listOpen ? 'open' : ''}">
        <header><b>${t('rp_moments')}</b><span class="rb-mtot"></span></header>
        <div class="seg rb-filter">${MOMENT_FILTERS.map((f) => `<button data-filter="${f}" class="${f === p.filter ? 'on' : ''}">${t(`rp_f_${f}` as Key)}</button>`).join('')}</div>
        <div class="rb-mlist"></div>
      </aside>
      <div class="replaybar">
        <button class="hud-btn" data-a="prev" title="${t('rp_prev')}" aria-label="${t('rp_prev')}">${ic.prevMark}</button>
        <button class="hud-btn" data-a="play" title="${t('rp_playPause')}"></button>
        <button class="hud-btn" data-a="next" title="${t('rp_next')}" aria-label="${t('rp_next')}">${ic.skip}</button>
        <div class="seg rb-step" title="${t('rp_step')}"><button data-step="-1">‹</button><button data-step="1">›</button></div>
        <div class="rb-track"><div class="rb-marks"></div><input type="range" min="0" max="${p.duration.toFixed(2)}" step="0.05" value="0"></div>
        <span class="rb-time"></span>
        <div class="seg rb-speed">${REPLAY_SPEEDS.map((s) => `<button data-speed="${s}" class="${s === p.speed ? 'on' : ''}">${s}×</button>`).join('')}</div>
        <button class="chipbtn rb-hl ${p.highlights ? 'on' : ''}" data-a="hl" title="${t('rp_highlightsTitle')}">${ic.bolt}<span>${t('rp_highlights')}</span></button>
        <button class="hud-btn ${this.listOpen ? 'on' : ''}" data-a="list" title="${t('rp_momentsTitle')}" aria-label="${t('rp_moments')}">${ic.list}</button>
        <div class="seg rb-focus">${h.robots.map((r, i) => `<button class="${r.alliance} ${i === p.focus ? 'on' : ''}" data-focus="${i}" title="${esc(r.label)}">${stationTag(r.alliance, r.station)}</button>`).join('')}</div>
        <button class="hud-btn" data-a="cam" title="${t('camera')}">${ic.camera}</button>
        <button class="hud-btn" data-a="stats" title="${t('st_title')}">${ic.chart}</button>
        <button class="hud-btn" data-a="exit" title="${t('rp_exit')}">${ic.x}</button>
      </div>`;
    const range = this.root.querySelector<HTMLInputElement>('input[type="range"]')!;
    range.addEventListener('input', () => {
      this.dragging = true;
      p.seek(Number(range.value));
    });
    range.addEventListener('change', () => (this.dragging = false));
    const on = (sel: string, fn: (el: HTMLElement) => void) => this.root.querySelectorAll<HTMLElement>(sel).forEach((el) => el.addEventListener('click', () => fn(el)));
    on('[data-a="play"]', () => this.togglePlay());
    on('[data-a="prev"]', () => p.prevMoment());
    on('[data-a="next"]', () => p.nextMoment());
    on('[data-step]', (b) => p.stepFrame(Number(b.dataset.step) as 1 | -1));
    on('[data-a="hl"]', () => this.setHighlights(!p.highlights));
    on('[data-a="list"]', () => this.toggleList());
    const pick = (b: HTMLElement) => b.parentElement!.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    on('[data-speed]', (b) => {
      p.speed = Number(b.dataset.speed);
      pick(b);
    });
    on('[data-focus]', (b) => {
      p.focus = Number(b.dataset.focus);
      pick(b);
    });
    on('[data-filter]', (b) => {
      p.filter = b.dataset.filter as ReplayPlayer['filter'];
      pick(b);
      // El Resumen sigue con el filtro nuevo (o se apaga si no quedan jugadas)
      if (p.highlights) this.setHighlights(true);
      this.renderMoments();
    });
    on('[data-a="cam"]', () => this.act.camera());
    on('[data-a="stats"]', () => this.act.stats());
    on('[data-a="exit"]', () => this.act.exit());
    this.renderMoments();
    this.update();
  }

  /** Cada cuadro: marcador, timer, línea de tiempo, ícono de play/pausa y la jugada que se está viendo. */
  update(): void {
    const p = this.p;
    if (!p) return;
    const sb = p.scoreboard;
    const q = <T extends HTMLElement>(s: string) => this.root.querySelector<T>(s)!;
    q('.rb-score .red').textContent = String(sb.red);
    q('.rb-score .blue').textContent = String(sb.blue);
    q('.rb-timer').textContent = sb.timer;
    q('.rb-phase').textContent = t(`phase_${sb.phase}` as Key);
    q('.rb-time').textContent = `${mmss(p.t)} / ${mmss(p.duration)}`;
    if (!this.dragging) q<HTMLInputElement>('input[type="range"]').value = String(p.t);
    const play = q('[data-a="play"]');
    const want = p.playing ? 'pause' : 'play';
    if (play.dataset.icon !== want) {
      play.dataset.icon = want;
      play.innerHTML = p.playing ? ic.pause : ic.play;
    }
    q('[data-a="hl"]').classList.toggle('on', p.highlights);
    const cur = p.currentMoment;
    if (cur !== this.shownMoment) {
      this.shownMoment = cur;
      const now = q('.rb-now');
      now.hidden = !cur;
      if (cur) {
        const tag = this.robotTag(cur);
        now.className = `rb-now ${cur.alliance ?? 'neutral'} k-${cur.kind}`;
        now.innerHTML = `<span class="rb-mi">${KIND_ICON[cur.kind]}</span><span>${tag ? `<b>${tag}</b> ` : ''}${esc(momentLabel(cur))}</span>${this.pointsTag(cur)}<em>${cur.section}</em>`;
      }
      const idx = cur ? p.visibleMoments.indexOf(cur) : -1;
      this.root.querySelectorAll<HTMLElement>('.rb-m').forEach((b) => b.classList.toggle('cur', Number(b.dataset.m) === idx));
      if (idx >= 0 && this.listOpen) this.root.querySelector<HTMLElement>(`.rb-m[data-m="${idx}"]`)?.scrollIntoView({ block: 'nearest' });
    }
  }
}
