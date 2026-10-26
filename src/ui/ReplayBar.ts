/**
 * Controles de la repetición: marcador arriba y barra abajo con play/pausa, línea de tiempo (con las
 * Muestras anotadas marcadas), velocidad, robot que sigue la cámara, cámara, estadísticas y salir.
 * Teclado: espacio = play/pausa, ←/→ = 5 s, C = cámara.
 */
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

export class ReplayBar {
  readonly root: HTMLElement;
  private p: ReplayPlayer | null = null;
  private dragging = false;

  constructor(host: HTMLElement, private act: ReplayBarActions) {
    this.root = document.createElement('div');
    this.root.className = 'replaybar-wrap';
    this.root.style.display = 'none';
    host.appendChild(this.root);
    window.addEventListener('keydown', (e) => {
      const p = this.p;
      if (!p || this.root.style.display === 'none') return;
      if (e.code === 'Space') p.playing = !p.playing;
      else if (e.code === 'ArrowLeft') p.seek(p.t - 5);
      else if (e.code === 'ArrowRight') p.seek(p.t + 5);
      else return;
      e.preventDefault();
    });
  }

  show(p: ReplayPlayer | null): void {
    this.p = p;
    this.root.style.display = p ? '' : 'none';
    if (!p) return;
    const h = p.replay.header;
    const marks = p.replay.events
      .filter((e) => e.type === 'score')
      .map((e) => `<i class="${e.type === 'score' ? e.alliance : ''}" style="left:${(100 * e.t) / Math.max(1, p.duration)}%"></i>`)
      .join('');
    this.root.innerHTML = `
      <div class="rb-score"><b class="red">0</b><div><span class="rb-timer">0:15</span><small class="rb-phase"></small></div><b class="blue">0</b></div>
      <div class="rb-tag">${ic.play}${t('rp_title')}</div>
      <div class="replaybar">
        <button class="hud-btn" data-a="play" title="${t('rp_playPause')}"></button>
        <div class="rb-track"><div class="rb-marks">${marks}</div><input type="range" min="0" max="${p.duration.toFixed(2)}" step="0.05" value="0"></div>
        <span class="rb-time"></span>
        <div class="seg rb-speed">${REPLAY_SPEEDS.map((s) => `<button data-speed="${s}" class="${s === p.speed ? 'on' : ''}">${s}×</button>`).join('')}</div>
        <div class="seg rb-focus">${h.robots.map((r, i) => `<button class="${r.alliance} ${i === p.focus ? 'on' : ''}" data-focus="${i}" title="${r.label}">${stationTag(r.alliance, r.station)}</button>`).join('')}</div>
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
    this.root.querySelector('[data-a="play"]')!.addEventListener('click', () => {
      if (!p.playing && p.t >= p.duration - 0.01) p.seek(0);
      p.playing = !p.playing;
    });
    this.root.querySelectorAll<HTMLElement>('[data-speed]').forEach((b) =>
      b.addEventListener('click', () => {
        p.speed = Number(b.dataset.speed);
        b.parentElement!.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      }),
    );
    this.root.querySelectorAll<HTMLElement>('[data-focus]').forEach((b) =>
      b.addEventListener('click', () => {
        p.focus = Number(b.dataset.focus);
        b.parentElement!.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      }),
    );
    this.root.querySelector('[data-a="cam"]')!.addEventListener('click', () => this.act.camera());
    this.root.querySelector('[data-a="stats"]')!.addEventListener('click', () => this.act.stats());
    this.root.querySelector('[data-a="exit"]')!.addEventListener('click', () => this.act.exit());
    this.update();
  }

  /** Cada cuadro: marcador, timer, posición de la línea de tiempo y el ícono de play/pausa. */
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
  }
}
