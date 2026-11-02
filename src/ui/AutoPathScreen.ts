/**
 * Menú "Rutinas de AUTO": dibujas sobre la cancha la trayectoria de tu robot en los 15 s del AUTO
 * (§2, §4.2) con puntos —tocar la cancha agrega uno, arrastrar lo mueve— y a cada uno le pones qué
 * hace (velocidad, reversa, girar a un rumbo, brazo, garra, soltar, esperar). Atajos para anotar
 * en N1/N2/N3 y recoger Muestras del Laboratorio. Avisa lo que el manual no deja (línea central,
 * Plataforma, 15 s), la prueba en solitario (puntos de AUTO) y contra la IA (varias semillas), y se
 * guarda sola en el navegador (`game/autoPathStore.ts`) para elegirla como tu AUTO (Ajustes y
 * Preparar match). La cancha se ve con tu alianza a la izquierda, como en Estrategias.
 */
import { runVsAi, summarizeVsAi, type VsAiRun, type VsAiSummary } from '../auto/pathTest';
import { runRoutine } from '../auto/practice';
import * as F from '../config/field';
import { posTip, type ElevatorPos, type RobotSpec } from '../config/robot';
import { clampSpot, spotValid } from '../config/startSpot';
import {
  AUTO_SECONDS,
  backOffPoint,
  cleanXZ,
  estimatePath,
  MAX_PATH_NAME,
  MAX_PATH_POINTS,
  MAX_WAIT,
  newPath,
  newPoint,
  pathIssues,
  pathStart,
  PATH_PREFIX,
  pickupPoints,
  scoringPoint,
  type AutoPath,
  type PathPoint,
} from '../core/autoPath';
import { newPlan } from '../core/plan';
import { loadPaths, pathRoutine, savePaths } from '../game/autoPathStore';
import { backBtn, brandbar, ic } from './chrome';
import { dateTime, t, type Key } from './i18n';
import { fieldSvg } from './StrategyScreen';

const esc = (v: string): string => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const S = 100;
const px = (x: number) => (F.HALF_L - x) * S;
const py = (z: number) => (F.HALF_W - z) * S;
const DEG = Math.PI / 180;
const SEEDS = 6;
const EMPTY_PLAN = newPlan('', 'x');

export interface AutoPathHost {
  back: () => void;
  /** Tu robot (tipo, velocidad y capacidad). */
  spec: () => RobotSpec;
  /** Elige la rutina como tu AUTO (Ajustes). */
  use: (routineId: string) => void;
  currentAuto: () => string;
  /** Empieza un match de 2 contra 2 con la rutina como tu AUTO. */
  play: (routineId: string) => void;
}

export class AutoPathScreen {
  private paths: AutoPath[] = [];
  private cur: AutoPath | null = null;
  private sel = -1;
  private solo: { points: number; line: boolean; center: boolean; samples: string } | null = null;
  private vs: VsAiSummary | null = null;
  private busy = false;
  private cancel = false;
  private msg = '';

  constructor(
    private root: HTMLElement,
    private h: AutoPathHost,
  ) {}

  show(): void {
    this.paths = loadPaths();
    this.cancel = false;
    this.list();
  }

  private save(p?: AutoPath): void {
    if (p) p.updated = Date.now();
    savePaths(this.paths);
  }

  private q<T extends HTMLElement>(sel: string): T {
    return this.root.querySelector<T>(sel)!;
  }

  // ------------------------------------------------------------------ lista
  private list(): void {
    this.cur = null;
    const sorted = [...this.paths].sort((a, b) => b.updated - a.updated);
    const spec = this.h.spec();
    const card = (p: AutoPath) => {
      const e = estimatePath(p, spec);
      return `<div class="pl-card" data-id="${esc(p.id)}">
        <div class="pl-mini">${this.svg(p, -1, true)}</div>
        <div class="pl-info"><b>${esc(p.name)}</b>
          <small>${t('ar_pointsN', { n: p.points.length })} · ~${e.total.toFixed(1)} s · ${t('ar_zone')} ${p.station ? 'B' : 'A'}</small>
          <small>${p.updated ? dateTime(new Date(p.updated).toISOString()) : ''}</small></div>
        <div class="pl-btns">
          <button class="btn primary" data-edit>${ic.route}<span>${t('pl_edit')}</span></button>
          <button class="btn" data-dup>${t('pl_dup')}</button>
          <button class="x" data-del title="${t('pl_delete')}" aria-label="${t('pl_delete')}">${ic.x}</button>
        </div></div>`;
    };
    this.root.className = 'screen solid';
    this.root.innerHTML = `<div class="inner">
      ${brandbar(t('ar_title'))}
      <h1>${t('ar_title')}</h1>
      <p class="sub">${t('ar_sub')}</p>
      <div class="pl-list">${sorted.length ? sorted.map(card).join('') : `<div class="msg">${t('ar_none')}</div>`}</div>
      <div class="actionbar">${backBtn('data-act="back"')}<div class="grow"></div>
        <button class="btn primary" data-act="new">${ic.route}<span>${t('ar_new')}</span></button></div>
    </div>`;
    this.root.style.display = '';
    this.root.scrollTop = 0;
    const of = (el: HTMLElement) => this.paths.find((x) => x.id === el.closest<HTMLElement>('[data-id]')!.dataset.id)!;
    this.root.querySelectorAll<HTMLElement>('[data-edit]').forEach((b) => b.addEventListener('click', () => this.edit(of(b))));
    this.root.querySelectorAll<HTMLElement>('[data-dup]').forEach((b) =>
      b.addEventListener('click', () => {
        const src = of(b);
        const copy: AutoPath = { ...structuredClone(src), id: newPath('').id, name: `${src.name} (2)`.slice(0, MAX_PATH_NAME) };
        this.paths.push(copy);
        this.save(copy);
        this.list();
      }),
    );
    this.root.querySelectorAll<HTMLElement>('[data-del]').forEach((b) =>
      b.addEventListener('click', () => {
        if (!b.classList.contains('armed')) {
          b.classList.add('armed');
          b.innerHTML = `<span>${t('pl_confirmDel')}</span>`;
          setTimeout(() => {
            if (!b.isConnected) return;
            b.classList.remove('armed');
            b.innerHTML = ic.x;
          }, 3000);
          return;
        }
        const p = of(b);
        this.paths = this.paths.filter((x) => x !== p);
        this.save();
        this.list();
      }),
    );
    this.q('[data-act="back"]').addEventListener('click', () => this.h.back());
    this.q('[data-act="new"]').addEventListener('click', () => {
      const p = newPath(t('ar_defaultName', { n: this.paths.length + 1 }));
      this.paths.push(p);
      this.save(p);
      this.edit(p);
    });
  }

  // ------------------------------------------------------------------ editor
  private edit(p: AutoPath): void {
    if (this.cur !== p) {
      this.cur = p;
      this.sel = -1;
      this.solo = null;
      this.vs = null;
      this.msg = '';
    }
    const spec = this.h.spec();
    const est = estimatePath(p, spec);
    const issues = pathIssues(p, spec, spec.length / 2);
    const pt = p.points[this.sel] as PathPoint | undefined;
    const opt = (v: string | number, label: string, sel: string | number) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${label}</option>`;
    const armLabel = (a: ElevatorPos | null) => (a === null ? t('ar_same') : a === 0 ? t('ar_armFloor') : a === 4 ? t('ar_armShelf') : `${t('level')} ${a}`);
    const inUse = this.h.currentAuto() === PATH_PREFIX + p.id;
    const over = est.total > AUTO_SECONDS;
    const bar = Math.min(100, (est.total / AUTO_SECONDS) * 100);
    this.root.className = 'screen solid';
    this.root.innerHTML = `<div class="inner">
      ${brandbar(t('ar_title'))}
      <div class="pl-head"><input class="pl-name" data-name maxlength="${MAX_PATH_NAME}" value="${esc(p.name)}" aria-label="${t('pl_name')}"><span class="pl-saved">${ic.check}${t('pl_autosave')}</span></div>
      <div class="pl-edit">
        <div class="panel pl-field">
          <div class="pl-tools">
            <button class="chipbtn" data-quick="score3">${t('ar_addScore')} N3</button>
            <button class="chipbtn" data-quick="score2">N2</button>
            <button class="chipbtn" data-quick="score1">N1</button>
            <button class="chipbtn" data-quick="pickup">${t('ar_addPickup')}</button>
            <button class="chipbtn" data-quick="back">${t('ar_addBack')}</button>
            <div class="grow"></div>
            <button class="chipbtn" data-undo>${ic.back}<span>${t('pl_undo')}</span></button>
            <button class="chipbtn" data-clear>${ic.x}<span>${t('pl_clear')}</span></button></div>
          <div class="pl-map" data-map>${this.svg(p, this.sel, false)}</div>
          <p class="ms-note">${t('ar_hint')}</p>
          <div class="ar-time ${over ? 'over' : ''}" title="${t('ar_timeTitle')}"><i style="width:${bar}%"></i><span>${t('ar_time', { s: est.total.toFixed(1), max: AUTO_SECONDS })}</span></div>
        </div>
        <div class="panel pl-side">
          <h3>${t('ar_start')}</h3>
          <label class="ms-f"><span>${t('ar_zone')}</span><select data-station>${opt(0, 'A', p.station)}${opt(1, 'B', p.station)}</select></label>
          <div class="ar-grid">
            <label class="ms-f"><span>${t('ar_dx')}</span><input type="number" step="0.05" data-spot="dx" value="${p.start.dx.toFixed(2)}"></label>
            <label class="ms-f"><span>${t('ar_dz')}</span><input type="number" step="0.05" data-spot="dz" value="${p.start.dz.toFixed(2)}"></label>
            <label class="ms-f"><span>${t('ar_turn')}</span><input type="number" step="5" data-spot="turn" value="${Math.round(p.start.turn / DEG)}"></label>
          </div>
          ${pt ? this.pointForm(pt, opt, armLabel) : `<p class="ms-desc">${t('ar_pickPoint')}</p>`}
          ${issues.map((x) => `<div class="msg warn">⚠ ${t(`ar_issue_${x.code}` as Key)}${x.point !== undefined ? ` (#${x.point + 1})` : ''} (${x.section})</div>`).join('')}
          <h4>${t('ar_test')}</h4>
          <div class="ar-tests">
            <button class="btn" data-solo ${this.busy ? 'disabled' : ''}>${t('ar_testSolo')}</button>
            <button class="btn" data-vs ${this.busy ? 'disabled' : ''}>${t('ar_testAi')}</button>
          </div>
          ${this.msg ? `<div class="msg">${esc(this.msg)}</div>` : ''}
          ${this.solo ? this.soloHtml() : ''}${this.vs ? this.vsHtml() : ''}
          <p class="ms-note">${t('ar_rulesNote')}</p>
        </div>
      </div>
      <div class="actionbar">${backBtn('data-act="list"')}<div class="grow"></div>
        <button class="btn" data-act="use" ${inUse ? 'disabled' : ''}>${inUse ? t('ar_inUse') : t('ar_use')}</button>
        <button class="btn primary" data-act="play">${ic.go}<span>${t('ar_play')}</span></button></div>
    </div>`;
    this.root.style.display = '';
    this.bind(p, spec);
  }

  private pointForm(pt: PathPoint, opt: (v: string | number, l: string, s: string | number) => string, armLabel: (a: ElevatorPos | null) => string): string {
    const arms: Array<ElevatorPos | null> = [null, 0, 1, 2, 3, 4];
    const tri = (v: boolean | null) => (v === null ? 'null' : String(v));
    return `<h4>${t('ar_point', { n: this.sel + 1 })}</h4>
      <label class="ms-f"><span>${t('ar_speed')} (${Math.round(pt.speed * 100)} %)</span><input type="range" min="20" max="100" step="5" data-pt="speed" value="${Math.round(pt.speed * 100)}"></label>
      <label class="ms-f"><span>${t('ar_reverse')}</span><select data-pt="reverse">${opt('false', t('ar_forward'), String(pt.reverse))}${opt('true', t('ar_reverseOn'), String(pt.reverse))}</select></label>
      <label class="ms-f"><span>${t('ar_face')}</span><input type="number" step="5" data-pt="face" placeholder="${t('ar_noTurn')}" value="${pt.face === null ? '' : Math.round(pt.face / DEG)}"></label>
      <label class="ms-f"><span>${t('ar_arm')}</span><select data-pt="arm">${arms.map((a) => opt(a === null ? 'null' : a, armLabel(a), pt.arm === null ? 'null' : pt.arm)).join('')}</select></label>
      <label class="ms-f"><span>${t('ar_armWhen')}</span><select data-pt="armEarly">${opt('true', t('ar_onTheWay'), String(pt.armEarly))}${opt('false', t('ar_onArrive'), String(pt.armEarly))}</select></label>
      <label class="ms-f"><span>${t('ar_intake')}</span><select data-pt="intake">${opt('null', t('ar_same'), tri(pt.intake))}${opt('true', t('ar_on'), tri(pt.intake))}${opt('false', t('ar_off'), tri(pt.intake))}</select></label>
      <label class="ms-f"><span>${t('ar_release')}</span><select data-pt="release">${opt('false', t('no_'), String(pt.release))}${opt('true', t('on_'), String(pt.release))}</select></label>
      <label class="ms-f"><span>${t('ar_wait')} (0–${MAX_WAIT} s)</span><input type="number" step="0.1" min="0" max="${MAX_WAIT}" data-pt="wait" value="${pt.wait}"></label>
      <button class="btn" data-delpt>${ic.x}<span>${t('ar_delPoint')}</span></button>`;
  }

  private soloHtml(): string {
    const r = this.solo!;
    return `<div class="msg ok"><b>${t('ar_soloResult', { n: r.points })}</b><br><small>${t(r.line ? 'ar_lineYes' : 'ar_lineNo')} · ${r.samples}${r.center ? ` · ⚠ ${t('ar_issue_center')}` : ''}</small></div>`;
  }

  private vsHtml(): string {
    const r = this.vs!;
    return `<div class="msg ok"><b>${t('ar_vsResult', { a: r.avgMine.toFixed(1), b: r.avgRival.toFixed(1) })}</b><br>
      <small>${t('ar_vsDetail', { w: r.wins, t: r.ties, n: r.runs.length, line: Math.round(r.lineRate * 100), f: r.avgFouls.toFixed(1) })}</small></div>`;
  }

  private bind(p: AutoPath, spec: RobotSpec): void {
    const redraw = () => {
      this.save(p);
      this.solo = null;
      this.vs = null;
      this.edit(p);
    };
    const name = this.q<HTMLInputElement>('[data-name]');
    name.addEventListener('change', () => {
      p.name = name.value.trim().slice(0, MAX_PATH_NAME) || p.name;
      this.save(p);
    });
    this.q('[data-act="list"]').addEventListener('click', () => {
      this.cancel = true;
      this.list();
    });
    this.q('[data-act="use"]').addEventListener('click', () => {
      this.h.use(PATH_PREFIX + p.id);
      this.edit(p);
    });
    this.q('[data-act="play"]').addEventListener('click', () => {
      this.h.use(PATH_PREFIX + p.id);
      this.h.play(PATH_PREFIX + p.id);
    });
    this.q('[data-undo]').addEventListener('click', () => {
      p.points.pop();
      this.sel = -1;
      redraw();
    });
    this.q('[data-clear]').addEventListener('click', () => {
      p.points.length = 0;
      this.sel = -1;
      redraw();
    });
    this.q<HTMLSelectElement>('[data-station]').addEventListener('change', (e) => {
      p.station = (e.target as HTMLSelectElement).value === '1' ? 1 : 0;
      p.start = clampSpot(spec.length, spec.width, p.start);
      redraw();
    });
    this.root.querySelectorAll<HTMLInputElement>('[data-spot]').forEach((i) =>
      i.addEventListener('change', () => {
        const k = i.dataset.spot as 'dx' | 'dz' | 'turn';
        const v = Number(i.value);
        if (!Number.isFinite(v)) return;
        const next = { ...p.start, [k]: k === 'turn' ? v * DEG : v };
        // El chasis completo tiene que quedar dentro de la Zona de Inicio (§3.2.1, §4.1)
        p.start = spotValid(spec.length, spec.width, next) ? next : clampSpot(spec.length, spec.width, next);
        redraw();
      }),
    );
    // Atajos: se agregan después del último punto (o desde la Zona de Inicio)
    const last = () => p.points[p.points.length - 1] ?? { ...pathStart(p), z: pathStart(p).z };
    const add = (...pts: PathPoint[]) => {
      if (p.points.length + pts.length > MAX_PATH_POINTS) {
        this.msg = t('ar_full', { n: MAX_PATH_POINTS });
        return this.edit(p);
      }
      this.msg = '';
      p.points.push(...pts);
      this.sel = p.points.length - 1;
      redraw();
    };
    const back = !!spec.arm.pickBack;
    const tip = (l: 0 | 1 | 2 | 3) => Math.abs(posTip(spec, l).x);
    this.root.querySelectorAll<HTMLElement>('[data-quick]').forEach((b) =>
      b.addEventListener('click', () => {
        const k = b.dataset.quick!;
        if (k.startsWith('score')) add(scoringPoint(Number(k.slice(5)) as 1 | 2 | 3, tip(Number(k.slice(5)) as 1 | 2 | 3), spec.length / 2));
        else if (k === 'back') add(backOffPoint(p.points.length ? p.points[p.points.length - 1] : newPoint(pathStart(p).x, pathStart(p).z)));
        else {
          // La Muestra del Laboratorio (de tu lado) más cercana al último punto
          const from = last();
          const spots = F.labSpots().filter((s) => s.x > 0);
          const near = spots.reduce((a, s) => (Math.hypot(s.x - from.x, s.z - from.z) < Math.hypot(a.x - from.x, a.z - from.z) ? s : a));
          add(...pickupPoints(near.x, near.z, from, tip(0), back));
        }
      }),
    );
    const num = (v: string, f: (n: number) => void) => {
      const n = Number(v);
      if (v.trim() !== '' && Number.isFinite(n)) f(n);
    };
    this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-pt]').forEach((el) =>
      el.addEventListener('change', () => {
        const pt = p.points[this.sel];
        if (!pt) return;
        const v = el.value;
        switch (el.dataset.pt) {
          case 'speed': num(v, (n) => (pt.speed = Math.max(0.2, Math.min(1, n / 100))));
            break;
          case 'reverse': pt.reverse = v === 'true';
            break;
          case 'face': if (v.trim() === '') pt.face = null; else num(v, (n) => (pt.face = Math.atan2(Math.sin(n * DEG), Math.cos(n * DEG))));
            break;
          case 'arm': pt.arm = v === 'null' ? null : (Number(v) as ElevatorPos);
            break;
          case 'armEarly': pt.armEarly = v === 'true';
            break;
          case 'intake': pt.intake = v === 'null' ? null : v === 'true';
            break;
          case 'release': pt.release = v === 'true';
            break;
          case 'wait': num(v, (n) => (pt.wait = Math.max(0, Math.min(MAX_WAIT, Math.round(n * 10) / 10))));
            break;
        }
        redraw();
      }),
    );
    this.root.querySelector('[data-delpt]')?.addEventListener('click', () => {
      p.points.splice(this.sel, 1);
      this.sel = -1;
      redraw();
    });
    this.q('[data-solo]').addEventListener('click', () => {
      if (!p.points.length) return;
      const r = runRoutine(p.station, spec, pathRoutine(p));
      this.solo = { points: r.points, line: r.line, center: r.center, samples: `N1 ${r.samples[1]} · N2 ${r.samples[2]} · N3 ${r.samples[3]}` };
      this.edit(p);
    });
    this.q('[data-vs]').addEventListener('click', () => void this.runVs(p, spec));
    this.bindMap(p);
  }

  private async runVs(p: AutoPath, spec: RobotSpec): Promise<void> {
    if (!p.points.length || this.busy) return;
    this.busy = true;
    this.cancel = false;
    const runs: VsAiRun[] = [];
    for (let k = 0; k < SEEDS && !this.cancel; k++) {
      this.msg = t('ar_running', { k: k + 1, n: SEEDS });
      this.edit(p);
      await new Promise((r) => setTimeout(r, 20));
      if (this.cur !== p) break;
      runs.push(runVsAi(p, spec, k + 1));
    }
    this.busy = false;
    this.msg = '';
    if (this.cur === p && runs.length) {
      this.vs = summarizeVsAi(runs);
      this.edit(p);
    }
  }

  /** Tocar agrega un punto (o selecciona el que está cerca); arrastrar mueve el seleccionado. */
  private bindMap(p: AutoPath): void {
    const map = this.q<HTMLElement>('[data-map]');
    const toField = (e: PointerEvent) => {
      const svg = map.querySelector('svg')!;
      const r = svg.getBoundingClientRect();
      const vb = svg.viewBox.baseVal;
      const sx = vb.x + ((e.clientX - r.left) / r.width) * vb.width;
      const sy = vb.y + ((e.clientY - r.top) / r.height) * vb.height;
      return cleanXZ(F.HALF_L - sx / S, F.HALF_W - sy / S);
    };
    let drag = -1;
    let moved = false;
    const paint = () => (map.innerHTML = this.svg(p, this.sel, false));
    map.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      map.setPointerCapture(e.pointerId);
      const at = toField(e);
      let best = -1;
      let bd = 0.35;
      p.points.forEach((q, i) => {
        const d = Math.hypot(q.x - at.x, q.z - at.z);
        if (d < bd) [best, bd] = [i, d];
      });
      if (best < 0) {
        if (p.points.length >= MAX_PATH_POINTS) return;
        p.points.push(newPoint(at.x, at.z));
        best = p.points.length - 1;
        moved = true;
      } else moved = false;
      this.sel = best;
      drag = best;
      paint();
    });
    map.addEventListener('pointermove', (e) => {
      if (drag < 0) return;
      const at = toField(e);
      const q = p.points[drag];
      if (Math.hypot(q.x - at.x, q.z - at.z) > 0.02) moved = true;
      q.x = at.x;
      q.z = at.z;
      paint();
    });
    const end = () => {
      if (drag < 0) return;
      drag = -1;
      if (moved) {
        this.save(p);
        this.solo = null;
        this.vs = null;
      }
      this.edit(p);
    };
    map.addEventListener('pointerup', end);
    map.addEventListener('pointercancel', end);
  }

  /** La cancha con la trayectoria: el robot en su pose inicial, los puntos numerados y su orden. */
  private svg(p: AutoPath, sel: number, mini: boolean): string {
    const base = fieldSvg(EMPTY_PLAN, 'AUTO', mini);
    const st = pathStart(p);
    const spec = this.h.spec();
    const w = spec.length * S;
    const hgt = spec.width * S;
    // Rumbo en pantalla: el eje de la cancha se refleja (px = −x), así que el rumbo gira 180° respecto a la cancha
    const deg = -((st.heading * 180) / Math.PI) + 180;
    const robot = `<g transform="translate(${px(st.x)} ${py(st.z)}) rotate(${deg.toFixed(1)})"><rect x="${-w / 2}" y="${-hgt / 2}" width="${w}" height="${hgt}" class="ar-robot"/><path d="M0 0 L${w / 2} 0" class="ar-heading"/></g>`;
    let prev = { x: st.x, z: st.z };
    const segs = p.points.map((q) => {
      const s = `<line x1="${px(prev.x)}" y1="${py(prev.z)}" x2="${px(q.x)}" y2="${py(q.z)}" class="ar-seg ${q.reverse ? 'rev' : ''}"/>`;
      prev = q;
      return s;
    });
    const dots = p.points
      .map((q, i) => {
        const tag = (q.release ? '▼' : '') + (q.intake ? '◉' : '');
        return `<g class="pl-pt mate ${i === sel ? 'sel' : ''}"><circle cx="${px(q.x)}" cy="${py(q.z)}" r="${mini ? 12 : 17}"/>${mini ? '' : `<text x="${px(q.x)}" y="${py(q.z) + 6}">${i + 1}</text>`}${!mini && tag ? `<text class="ar-tag" x="${px(q.x)}" y="${py(q.z) - 22}">${tag}</text>` : ''}</g>`;
      })
      .join('');
    return base.replace('</svg>', `${robot}${segs.join('')}${dots}</svg>`);
  }
}

