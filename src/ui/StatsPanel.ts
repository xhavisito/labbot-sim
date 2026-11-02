/**
 * Estadísticas de un match grabado: mapa de calor de cada robot sobre la cancha, línea de tiempo de
 * sus Muestras anotadas y tabla por robot (Muestras por nivel, puntos, tiempos de ciclo, distancia,
 * velocidad, Plataforma, Muestra Crítica). Se abre desde los resultados o desde Repeticiones.
 */
import * as F from '../config/field';
import { levelCat } from '../core/cycles';
import { GAME } from '../config/game';
import { bounds } from '../core/clock';
import { replayDuration, type Replay } from '../replay/format';
import { HEAT_CELL, HEAT_COLS, HEAT_ROWS, robotStats, totalSamples, type RobotStats } from '../replay/stats';
import { backBtn, brandbar, ic } from './chrome';
import { ALLIANCE_RGB, drawShotMap, fieldBase, fieldLines } from './shotMap';
import { dateTime, t } from './i18n';

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Etiqueta corta de la estación: R1, R2, A1, A2. */
export const stationTag = (alliance: 'red' | 'blue', station: number): string => `${t(alliance === 'red' ? 'red' : 'blue').charAt(0)}${station + 1}`;

/** Dibuja la cancha vista desde arriba (X a la derecha = rojo, Z hacia abajo) y el mapa de calor. */
export function drawHeatmap(cv: HTMLCanvasElement, replay: Replay, stats: RobotStats[], only: number | null): void {
  const g = cv.getContext('2d');
  if (!g) return;
  const k = fieldBase(g, cv.width, cv.height);
  // Calor: una capa por robot, del color de su alianza; la intensidad es la raíz del tiempo en la celda
  for (const s of stats) {
    if (only !== null && s.index !== only) continue;
    const rb = replay.header.robots[s.index];
    const [r, gg, b] = ALLIANCE_RGB[rb.alliance];
    for (let row = 0; row < HEAT_ROWS; row++)
      for (let c = 0; c < HEAT_COLS; c++) {
        const v = s.heat[row * HEAT_COLS + c];
        if (v <= 0) continue;
        g.fillStyle = `rgba(${r},${gg},${b},${Math.min(0.92, 0.12 + 0.8 * Math.sqrt(v / s.heatMax))})`;
        g.fillRect(c * HEAT_CELL * k, row * HEAT_CELL * k, HEAT_CELL * k + 0.5, HEAT_CELL * k + 0.5);
      }
  }
  fieldLines(g, cv.width, cv.height);
}

/** Dónde anotó cada robot del match (al soltar la Muestra): un punto por anotación. */
export function drawScoreSpots(cv: HTMLCanvasElement, replay: Replay, stats: RobotStats[], only: number | null): void {
  drawShotMap(cv, {
    dots: stats
      .filter((s) => only === null || s.index === only)
      .map((s) => ({ rgb: ALLIANCE_RGB[replay.header.robots[s.index].alliance], shots: s.scoreSpots.map((p) => ({ x: p.x, z: p.z, cat: levelCat(p.level), ok: true, t: p.t })) })),
  });
}

const num = (v: number | null, d = 1, unit = ''): string => (v === null ? '–' : `${v.toFixed(d)}${unit}`);

export class StatsPanel {
  private only: number | null = null;
  /** Mapa de calor de dónde anduvo o mapa de tiro de dónde anotó. */
  private view: 'heat' | 'shots' = 'heat';
  private stats: RobotStats[];

  constructor(
    private root: HTMLElement,
    private replay: Replay,
    private onBack: () => void,
    private onWatch: (() => void) | null,
  ) {
    this.stats = robotStats(replay);
    const me = replay.header.robots.findIndex((r) => r.index === replay.header.player);
    this.only = me >= 0 ? me : null;
  }

  show(): void {
    const h = this.replay.header;
    const robots = h.robots;
    const st = this.stats;
    const tag = (i: number) => stationTag(robots[i].alliance, robots[i].station);
    // Azul antes que rojo en tablas y listas (los índices de la repetición no cambian)
    const order = robots.map((_, i) => i).sort((a, b) => Number(robots[a].alliance === 'red') - Number(robots[b].alliance === 'red'));
    const ordered = order.map((i) => [i, robots[i]] as const);
    const head = ordered.map(([i, r]) => `<th class="${r.alliance}">${tag(i)}${r.index === h.player ? ` · ${t('you')}` : ''}<small>${esc(r.label)}</small></th>`).join('');
    const row = (label: string, f: (s: RobotStats) => string, cls = '') => `<tr class="${cls}"><td>${label}</td>${order.map((i) => `<td>${f(st[i])}</td>`).join('')}</tr>`;
    const yes = (b: boolean) => (b ? `<span class="ok">✓</span>` : '–');
    const lv = (s: RobotStats, l: 1 | 2 | 3) => s.samples.AUTO[l] + s.samples.TELEOP[l];
    const dur = replayDuration(this.replay);
    const end = Math.max(dur, bounds(GAME).teleopEnd);
    const auto = bounds(GAME).autoEnd;
    const timeline = ordered
      .map(
        ([i, r]) => `<div class="tl-row"><span class="${r.alliance}">${tag(i)}</span><div class="tl-track"><i class="tl-auto" style="width:${(100 * auto) / end}%"></i>${st[i].scoreTimes
          .map((x) => `<b class="${r.alliance}" style="left:${(100 * x) / end}%"></b>`)
          .join('')}</div><em>${totalSamples(st[i])}</em></div>`,
      )
      .join('');
    const date = dateTime(h.createdAt);
    this.root.className = 'screen solid';
    this.root.innerHTML = `<div class="inner">
      ${brandbar(t('st_title'))}
      <h1>${t('st_title')}</h1>
      <p class="sub">${date} · <b class="blue-t">${h.final.blue}</b> – <b class="red-t">${h.final.red}</b> · ${t('st_note')}</p>
      <div class="panels stats">
        <div class="panel"><h3>${t('st_heat')}</h3>
          <div class="seg" data-only>${ordered.map(([i, r]) => `<button class="${r.alliance} ${this.only === i ? 'on' : ''}" data-i="${i}">${tag(i)}</button>`).join('')}<button class="${this.only === null ? 'on' : ''}" data-i="all">${t('st_all')}</button></div>
          <div class="seg" data-view><button class="${this.view === 'heat' ? 'on' : ''}" data-v="heat">${t('st_viewHeat')}</button><button class="${this.view === 'shots' ? 'on' : ''}" data-v="shots">${t('st_viewShots')}</button></div>
          <canvas class="heat" width="${Math.round(F.FIELD_LENGTH * 80)}" height="${Math.round(F.FIELD_WIDTH * 80)}"></canvas>
          <p class="sub" data-heatnote>${t(this.view === 'heat' ? 'st_heatNote' : 'st_shotsNote')}</p>
        </div>
        <div class="panel"><h3>${t('st_timeline')}</h3>
          <div class="timeline">${timeline}</div>
          <p class="sub">${t('st_timelineNote')}</p>
        </div>
        <div class="panel wide"><h3>${t('st_table')}</h3>
          <div class="tablewrap"><table class="breakdown stats-t">
            <tr><th></th>${head}</tr>
            ${row(t('st_samples'), (s) => `<b>${totalSamples(s)}</b> <small>${lv(s, 1)}/${lv(s, 2)}/${lv(s, 3)}</small>`)}
            ${row(t('autoPoints'), (s) => String(s.autoPoints))}
            ${row(t('st_points'), (s) => String(s.samplePoints), 'tot')}
            ${row(t('st_cycles'), (s) => String(s.cycles.length + (s.scoreTimes.length ? 1 : 0)))}
            ${row(t('st_avgCycle'), (s) => num(s.avgCycle, 1, ' s'))}
            ${row(t('st_bestCycle'), (s) => num(s.bestCycle, 1, ' s'))}
            ${row(t('st_pickups'), (s) => String(s.pickups))}
            ${row(t('st_distance'), (s) => num(s.distance, 0, ' m'))}
            ${row(t('st_speed'), (s) => `${num(s.avgSpeed, 2)} / ${num(s.maxSpeed, 2)}`)}
            ${row(t('st_ownHalf'), (s) => `${Math.round((100 * s.timeOwnHalf) / Math.max(1e-6, s.timeOwnHalf + s.timeRivalHalf))}%`)}
            ${row(t('platform'), (s) => yes(s.onPlatform))}
            ${row(t('criticalSample'), (s) => yes(s.critical))}
          </table></div>
          <p class="sub">${t('st_cycleNote')}</p>
        </div>
      </div>
      <div class="actionbar">${backBtn('data-act="back"')}<div class="grow"></div>
        ${this.onWatch ? `<button class="btn primary" data-act="watch">${ic.play}<span>${t('rp_watch')}</span></button>` : ''}</div>
      </div>`;
    this.root.style.display = '';
    this.root.scrollTop = 0;
    this.draw();
    this.root.querySelectorAll<HTMLElement>('[data-only] button').forEach((b) =>
      b.addEventListener('click', () => {
        this.only = b.dataset.i === 'all' ? null : Number(b.dataset.i);
        b.parentElement!.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        this.draw();
      }),
    );
    this.root.querySelectorAll<HTMLElement>('[data-view] button').forEach((b) =>
      b.addEventListener('click', () => {
        this.view = b.dataset.v === 'shots' ? 'shots' : 'heat';
        b.parentElement!.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        const note = this.root.querySelector('[data-heatnote]');
        if (note) note.textContent = t(this.view === 'heat' ? 'st_heatNote' : 'st_shotsNote');
        this.draw();
      }),
    );
    this.root.querySelector('[data-act="back"]')?.addEventListener('click', () => this.onBack());
    this.root.querySelector('[data-act="watch"]')?.addEventListener('click', () => this.onWatch?.());
  }

  private draw(): void {
    const cv = this.root.querySelector<HTMLCanvasElement>('canvas.heat');
    if (!cv) return;
    if (this.view === 'shots') drawScoreSpots(cv, this.replay, this.stats, this.only);
    else drawHeatmap(cv, this.replay, this.stats, this.only);
  }
}
