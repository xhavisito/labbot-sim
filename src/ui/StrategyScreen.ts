/**
 * Menú "Estrategias": dibujas sobre la cancha cómo se van a mover y rotar tú y tu compañero de la IA
 * en el match (`core/plan.ts`). Por paso (AUTO, turnos del TELEOP, ENDGAME):
 * - ruta del compañero, tu ruta (tocar la cancha agrega un punto; arrastrar un punto lo mueve) y la
 *   zona de trabajo del compañero (arrastrar un rectángulo);
 * - de dónde junta y a qué nivel anota el compañero, y una nota para ti.
 * Se guardan solas en el navegador (`game/planStore.ts`, sirven sin conexión) y se eligen en
 * "Preparar match" → tu compañero → Estrategia. La cancha se ve con tu alianza a la izquierda.
 */
import { obstructZones } from '../referee/Referee';
import * as F from '../config/field';
import {
  cleanPoint,
  ENDGAME_FROM,
  MAX_NAME,
  MAX_NOTE,
  MAX_POINTS,
  MAX_TURNS,
  newPlan,
  PLAN_AUTOS,
  PLAN_ENDGAMES,
  PLAN_LEVELS,
  PLAN_SOURCES,
  planIssues,
  TURN_TIMES,
  type ActiveStep,
  type PlanPhase,
  type PlanPoint,
  type PlanStep,
  type StrategyPlan,
} from '../core/plan';
import { formatTimer } from '../core/clock';
import { loadPlans, savePlans } from '../game/planStore';
import { backBtn, brandbar, ic } from './chrome';
import { dateTime, t, type Key } from './i18n';

const esc = (v: string): string => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Escala del dibujo: px por metro (la cancha de 9 × 7 m queda de 900 × 700). */
const S = 100;
/** Tu alianza a la izquierda, viendo hacia el centro (giro de la vista del driver, sin espejo). */
const px = (x: number) => (F.HALF_L - x) * S;
const py = (z: number) => (F.HALF_W - z) * S;
const W = F.FIELD_LENGTH * S;
const H = F.FIELD_WIDTH * S;

type Tool = 'mate' | 'me' | 'zone';

/** Nombre del paso: "AUTO", "TELEOP 2 · desde 1:30", "ENDGAME". */
export function stepLabel(key: string, step: PlanStep): string {
  if (key === 'AUTO' || key === 'ENDGAME') return key;
  const i = Number(key.replace('TELEOP', ''));
  return `TELEOP ${i + 1} · ${t('pl_from')} ${formatTimer(step.from)}`;
}

/** Lo que hace el compañero en el paso, en una línea (HUD y lista). */
export function partnerSummary(plan: StrategyPlan, a: Pick<ActiveStep, 'phase' | 'step'>): string {
  const p = a.step.partner;
  const parts: string[] = [];
  if (a.phase === 'AUTO') parts.push(t(`pl_auto_${plan.auto}` as Key));
  parts.push(t(`pl_src_${p.source}` as Key), p.level ? `N${p.level}` : t('pl_lvl_0'));
  if (p.zone) parts.push(t('pl_inZone'));
  if (a.phase === 'ENDGAME') parts.push(t(`pl_end_${plan.endgame}` as Key));
  return parts.join(' · ');
}

export class StrategyScreen {
  private plans: StrategyPlan[] = [];
  private back: () => void = () => undefined;
  private tool: Tool = 'mate';
  /** Paso que se edita: 'AUTO', 'TELEOP0'…, 'ENDGAME'. */
  private key = 'AUTO';

  constructor(private root: HTMLElement) {}

  /** Abre la lista; `back` regresa a donde estaba (el menú o "Preparar match"). `edit` abre esa directo. */
  show(back: () => void, edit?: string): void {
    this.back = back;
    this.plans = loadPlans();
    const p = edit ? this.plans.find((x) => x.id === edit) : undefined;
    if (p) this.edit(p);
    else this.list();
  }

  private save(p?: StrategyPlan): void {
    if (p) p.updated = Date.now();
    savePlans(this.plans);
  }

  private q<T extends HTMLElement>(sel: string): T {
    return this.root.querySelector<T>(sel)!;
  }

  // ------------------------------------------------------------------ lista
  private list(): void {
    const sorted = [...this.plans].sort((a, b) => b.updated - a.updated);
    const card = (p: StrategyPlan) => `<div class="pl-card" data-id="${esc(p.id)}">
        <div class="pl-mini">${fieldSvg(p, 'AUTO', true)}</div>
        <div class="pl-info"><b>${esc(p.name)}</b>
          <small>${t('pl_turns', { n: p.steps.TELEOP.length })} · AUTO: ${t(`pl_auto_${p.auto}` as Key)} · ENDGAME: ${t(`pl_end_${p.endgame}` as Key)}</small>
          <small>${p.updated ? dateTime(new Date(p.updated).toISOString()) : ''}</small></div>
        <div class="pl-btns">
          <button class="btn primary" data-edit>${ic.route}<span>${t('pl_edit')}</span></button>
          <button class="btn" data-dup>${t('pl_dup')}</button>
          <button class="x" data-del title="${t('pl_delete')}" aria-label="${t('pl_delete')}">${ic.x}</button>
        </div></div>`;
    this.root.className = 'screen solid';
    this.root.innerHTML = `<div class="inner">
      ${brandbar(t('pl_title'))}
      <h1>${t('pl_title')}</h1>
      <p class="sub">${t('pl_sub')}</p>
      <div class="pl-list">${sorted.length ? sorted.map(card).join('') : `<div class="msg">${t('pl_none')}</div>`}</div>
      <div class="actionbar">${backBtn('data-act="back"')}<div class="grow"></div>
        <button class="btn primary" data-act="new">${ic.route}<span>${t('pl_new')}</span></button></div>
    </div>`;
    this.root.style.display = '';
    this.root.scrollTop = 0;
    const plan = (el: HTMLElement) => this.plans.find((x) => x.id === el.closest<HTMLElement>('[data-id]')!.dataset.id)!;
    this.root.querySelectorAll<HTMLElement>('[data-edit]').forEach((b) => b.addEventListener('click', () => this.edit(plan(b))));
    this.root.querySelectorAll<HTMLElement>('[data-dup]').forEach((b) =>
      b.addEventListener('click', () => {
        const src = plan(b);
        const copy: StrategyPlan = { ...structuredClone(src), id: newPlan('').id, name: `${src.name} (2)`.slice(0, MAX_NAME) };
        this.plans.push(copy);
        this.save(copy);
        this.list();
      }),
    );
    // Borrar: el primer toque pide confirmar (sin diálogos del navegador)
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
        const p = plan(b);
        this.plans = this.plans.filter((x) => x !== p);
        this.save();
        this.list();
      }),
    );
    this.q('[data-act="back"]').addEventListener('click', () => this.back());
    this.q('[data-act="new"]').addEventListener('click', () => {
      const p = newPlan(t('pl_defaultName', { n: this.plans.length + 1 }));
      this.plans.push(p);
      this.save(p);
      this.key = 'AUTO';
      this.edit(p);
    });
  }

  // ------------------------------------------------------------------ editor
  private stepOf(p: StrategyPlan, key: string): PlanStep {
    if (key === 'AUTO') return p.steps.AUTO;
    if (key === 'ENDGAME') return p.steps.ENDGAME;
    return p.steps.TELEOP[Number(key.replace('TELEOP', ''))] ?? p.steps.TELEOP[0];
  }

  private edit(p: StrategyPlan): void {
    if (this.key.startsWith('TELEOP') && !p.steps.TELEOP[Number(this.key.slice(6))]) this.key = 'TELEOP0';
    const phase: PlanPhase = this.key === 'AUTO' ? 'AUTO' : this.key === 'ENDGAME' ? 'ENDGAME' : 'TELEOP';
    const step = this.stepOf(p, this.key);
    const turn = phase === 'TELEOP' ? Number(this.key.slice(6)) : -1;
    const opt = (v: string | number, label: string, sel: string | number) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${label}</option>`;
    const tabs = [
      ['AUTO', 'AUTO', ''],
      ...p.steps.TELEOP.map((s, i) => [`TELEOP${i}`, `TELEOP ${i + 1}`, formatTimer(s.from)]),
      ['ENDGAME', 'ENDGAME', formatTimer(ENDGAME_FROM)],
    ];
    const issues = planIssues(p, obstructZones('blue')).filter((x) => x.key === this.key);
    const toolBtn = (id: Tool, label: Key, cls: string) => `<button class="chipbtn pl-tool ${cls} ${this.tool === id ? 'on' : ''}" data-tool="${id}"><i></i>${t(label)}</button>`;
    // Turnos del TELEOP: cada uno a una hora distinta, después del anterior y antes del siguiente
    const prev = turn > 0 ? p.steps.TELEOP[turn - 1].from : Infinity;
    const next = turn >= 0 && turn < p.steps.TELEOP.length - 1 ? p.steps.TELEOP[turn + 1].from : -Infinity;
    const fromOpts = TURN_TIMES.filter((v) => v < prev && v > next);
    this.root.className = 'screen solid';
    this.root.innerHTML = `<div class="inner">
      ${brandbar(t('pl_title'))}
      <div class="pl-head"><input class="pl-name" data-name maxlength="${MAX_NAME}" value="${esc(p.name)}" aria-label="${t('pl_name')}"><span class="pl-saved">${ic.check}${t('pl_autosave')}</span></div>
      <div class="pl-tabs" role="tablist">${tabs.map(([k, label, time]) => `<button role="tab" class="pl-tab ${k === this.key ? 'on' : ''}" data-key="${k}"><b>${label}</b>${time ? `<small>${time}</small>` : ''}</button>`).join('')}
        ${p.steps.TELEOP.length < MAX_TURNS ? `<button class="pl-tab add" data-addturn title="${t('pl_addTurnTitle')}">+ ${t('pl_turn')}</button>` : ''}</div>
      <div class="pl-edit">
        <div class="panel pl-field">
          <div class="pl-tools">${toolBtn('mate', 'pl_toolMate', 'mate')}${toolBtn('me', 'pl_toolMe', 'me')}${toolBtn('zone', 'pl_toolZone', 'zone')}
            <div class="grow"></div>
            <button class="chipbtn" data-undo>${ic.back}<span>${t('pl_undo')}</span></button>
            <button class="chipbtn" data-clear>${ic.x}<span>${t('pl_clear')}</span></button></div>
          <div class="pl-map" data-map>${fieldSvg(p, this.key, false)}</div>
          <p class="ms-note">${t(phase === 'AUTO' ? 'pl_hintAuto' : 'pl_hint')}</p>
        </div>
        <div class="panel pl-side">
          <h3>${phase === 'AUTO' ? 'AUTO' : phase === 'ENDGAME' ? 'ENDGAME' : `TELEOP ${turn + 1}`}</h3>
          ${
            turn > 0
              ? `<label class="ms-f"><span>${t('pl_starts')}</span><select data-from>${fromOpts.map((v) => opt(v, `${formatTimer(v)} (${t('pl_teleopClock')})`, step.from)).join('')}</select></label>`
              : turn === 0
                ? `<p class="ms-desc">${t('pl_firstTurn')}</p>`
                : ''
          }
          <h4>${t('pl_mate')}</h4>
          ${phase === 'AUTO' ? `<label class="ms-f"><span>${t('pl_mateAuto')}</span><select data-auto>${PLAN_AUTOS.map((v) => opt(v, t(`pl_auto_${v}` as Key), p.auto)).join('')}</select></label>` : ''}
          <label class="ms-f"><span>${t('pl_source')}</span><select data-src>${PLAN_SOURCES.map((v) => opt(v, t(`pl_src_${v}` as Key), step.partner.source)).join('')}</select></label>
          <label class="ms-f"><span>${t('pl_level')}</span><select data-lvl>${PLAN_LEVELS.map((v) => opt(v, v ? `${t('level')} ${v}` : t('pl_lvl_0'), step.partner.level)).join('')}</select></label>
          ${phase === 'ENDGAME' ? `<label class="ms-f"><span>${t('pl_mateEnd')}</span><select data-end>${PLAN_ENDGAMES.map((v) => opt(v, t(`pl_end_${v}` as Key), p.endgame)).join('')}</select></label>` : ''}
          <p class="ms-desc">${t('pl_routeInfo', { n: step.partner.route.length, zone: step.partner.zone ? t('pl_zoneYes') : t('pl_zoneNo') })}</p>
          <h4>${t('pl_me')}</h4>
          <label class="ms-f"><span>${t('pl_note')}</span><input type="text" data-note maxlength="${MAX_NOTE}" value="${esc(step.me.note)}" placeholder="${t('pl_notePh')}"></label>
          ${issues.map((x) => `<div class="msg warn">⚠ ${t(`pl_issue_${x.code}` as Key)} (${x.section})</div>`).join('')}
          ${turn > 0 ? `<button class="btn" data-delturn>${ic.x}<span>${t('pl_delTurn')}</span></button>` : ''}
          <p class="ms-note">${t('pl_rulesNote')}</p>
        </div>
      </div>
      <div class="actionbar">${backBtn('data-act="list"')}<div class="grow"></div>
        <button class="btn primary" data-act="done">${ic.check}<span>${t('pl_done')}</span></button></div>
    </div>`;
    this.root.style.display = '';
    const redraw = () => {
      this.save(p);
      this.edit(p);
    };
    const name = this.q<HTMLInputElement>('[data-name]');
    name.addEventListener('change', () => {
      p.name = name.value.trim().slice(0, MAX_NAME) || p.name;
      this.save(p);
    });
    this.root.querySelectorAll<HTMLElement>('[data-key]').forEach((b) =>
      b.addEventListener('click', () => {
        this.key = b.dataset.key!;
        this.edit(p);
      }),
    );
    this.root.querySelector('[data-addturn]')?.addEventListener('click', () => {
      // El turno nuevo copia el anterior (para rotar, cambia solo lo que se intercambia) y empieza
      // a la mitad del tiempo que le quedaba al último
      const last = p.steps.TELEOP[p.steps.TELEOP.length - 1];
      const free = TURN_TIMES.filter((v) => v < last.from);
      if (!free.length) return;
      const from = free[Math.floor((free.length - 1) / 2)];
      p.steps.TELEOP.push({ ...structuredClone(last), from });
      this.key = `TELEOP${p.steps.TELEOP.length - 1}`;
      redraw();
    });
    this.root.querySelector('[data-delturn]')?.addEventListener('click', () => {
      p.steps.TELEOP.splice(turn, 1);
      this.key = `TELEOP${turn - 1}`;
      redraw();
    });
    this.root.querySelector<HTMLSelectElement>('[data-from]')?.addEventListener('change', (e) => {
      step.from = Number((e.target as HTMLSelectElement).value);
      redraw();
    });
    const sel = (attr: string, fn: (v: string) => void) =>
      this.root.querySelector<HTMLSelectElement>(`[${attr}]`)?.addEventListener('change', (e) => {
        fn((e.target as HTMLSelectElement).value);
        redraw();
      });
    sel('data-auto', (v) => (p.auto = PLAN_AUTOS.find((x) => x === v) ?? p.auto));
    sel('data-end', (v) => (p.endgame = PLAN_ENDGAMES.find((x) => x === v) ?? p.endgame));
    sel('data-src', (v) => (step.partner.source = PLAN_SOURCES.find((x) => x === v) ?? 'any'));
    sel('data-lvl', (v) => (step.partner.level = PLAN_LEVELS.find((x) => x === Number(v)) ?? 0));
    const note = this.q<HTMLInputElement>('[data-note]');
    note.addEventListener('input', () => {
      step.me.note = note.value.slice(0, MAX_NOTE);
      this.save(p);
    });
    this.root.querySelectorAll<HTMLElement>('[data-tool]').forEach((b) =>
      b.addEventListener('click', () => {
        this.tool = b.dataset.tool as Tool;
        this.root.querySelectorAll('[data-tool]').forEach((x) => x.classList.toggle('on', x === b));
      }),
    );
    const routeOf = () => (this.tool === 'me' ? step.me.route : step.partner.route);
    this.q('[data-undo]').addEventListener('click', () => {
      if (this.tool === 'zone') step.partner.zone = null;
      else routeOf().pop();
      redraw();
    });
    this.q('[data-clear]').addEventListener('click', () => {
      if (this.tool === 'zone') step.partner.zone = null;
      else routeOf().length = 0;
      redraw();
    });
    this.q('[data-act="list"]').addEventListener('click', () => this.list());
    this.q('[data-act="done"]').addEventListener('click', () => this.back());
    this.bindMap(p, step, phase);
  }

  /** Tocar agrega un punto (o lo toma si ya hay uno cerca) y arrastrar lo mueve; con "Zona", arrastrar dibuja el rectángulo. */
  private bindMap(p: StrategyPlan, step: PlanStep, phase: PlanPhase): void {
    const map = this.q<HTMLElement>('[data-map]');
    const toField = (e: PointerEvent): PlanPoint => {
      const svg = map.querySelector('svg')!;
      const r = svg.getBoundingClientRect();
      const vb = svg.viewBox.baseVal;
      const sx = vb.x + ((e.clientX - r.left) / r.width) * vb.width;
      const sy = vb.y + ((e.clientY - r.top) / r.height) * vb.height;
      return { x: F.HALF_L - sx / S, z: F.HALF_W - sy / S };
    };
    let drag: { kind: 'point'; route: PlanPoint[]; i: number } | { kind: 'zone'; a: PlanPoint } | null = null;
    const paint = () => (map.innerHTML = fieldSvg(p, this.key, false));
    map.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      map.setPointerCapture(e.pointerId);
      const at = cleanPoint(toField(e), phase);
      if (this.tool === 'zone') {
        drag = { kind: 'zone', a: at };
        return;
      }
      const route = this.tool === 'me' ? step.me.route : step.partner.route;
      let best = -1;
      let bd = 0.35;
      route.forEach((q, i) => {
        const d = Math.hypot(q.x - at.x, q.z - at.z);
        if (d < bd) [best, bd] = [i, d];
      });
      if (best < 0) {
        if (route.length >= MAX_POINTS) return;
        route.push(at);
        best = route.length - 1;
      }
      drag = { kind: 'point', route, i: best };
      paint();
    });
    map.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const at = cleanPoint(toField(e), phase);
      if (drag.kind === 'point') drag.route[drag.i] = at;
      else step.partner.zone = { x0: Math.min(drag.a.x, at.x), x1: Math.max(drag.a.x, at.x), z0: Math.min(drag.a.z, at.z), z1: Math.max(drag.a.z, at.z) };
      paint();
    });
    const end = () => {
      if (!drag) return;
      const z = step.partner.zone;
      // Una zona más chica que un robot no sirve (fue un toque)
      if (drag.kind === 'zone' && z && (z.x1 - z.x0 < 0.3 || z.z1 - z.z0 < 0.3)) step.partner.zone = null;
      drag = null;
      this.save(p);
      this.edit(p);
    };
    map.addEventListener('pointerup', end);
    map.addEventListener('pointercancel', end);
  }
}

/**
 * La cancha (marco de tu alianza, a la izquierda) con el paso `key` del plan: Zonas de Inicio,
 * Cámaras, Campanas, Plataforma, Laboratorio, línea central, zonas de anotación rivales (§4.6, D17) y
 * las rutas/zona. `mini` = miniatura de la lista (sin textos).
 */
export function fieldSvg(p: StrategyPlan, key: string, mini: boolean): string {
  const rect = (r: F.Rect, cls: string) => {
    const x = Math.min(px(r.x0), px(r.x1));
    const y = Math.min(py(r.z0), py(r.z1));
    return `<rect x="${x}" y="${y}" width="${Math.abs(r.x1 - r.x0) * S}" height="${Math.abs(r.z1 - r.z0) * S}" class="${cls}"/>`;
  };
  const both = (r: F.Rect, cls: string) => rect(r, `${cls} mine`) + rect(F.rectFor('blue', r), `${cls} rival`);
  const label = (x: number, z: number, text: string, cls = '') => (mini ? '' : `<text x="${px(x)}" y="${py(z)}" class="pl-lbl ${cls}">${text}</text>`);
  const camara: F.Rect = { x0: F.CAMARA_X_END_RED - F.CAMARA_LENGTH, x1: F.CAMARA_X_END_RED, z0: F.CAMARA_Z_RED[0], z1: F.CAMARA_Z_RED[1] };
  const campana: F.Rect = { x0: F.CAMPANA_X_RED[0], x1: F.CAMPANA_X_RED[1], z0: -F.HALF_W, z1: -F.HALF_W + F.CAMPANA_DEPTH };
  const platform: F.Rect = { x0: -F.PLATFORM_LENGTH / 2, x1: F.PLATFORM_LENGTH / 2, z0: -F.PLATFORM_WIDTH / 2, z1: F.PLATFORM_WIDTH / 2 };
  const repisa: F.Rect = { x0: -F.REPISA_DEPTH / 2, x1: F.REPISA_DEPTH / 2, z0: -F.PLATFORM_WIDTH / 2, z1: F.PLATFORM_WIDTH / 2 };
  const step = key === 'AUTO' ? p.steps.AUTO : key === 'ENDGAME' ? p.steps.ENDGAME : (p.steps.TELEOP[Number(key.slice(6))] ?? p.steps.TELEOP[0]);
  const path = (route: readonly PlanPoint[], cls: string) => {
    if (!route.length) return '';
    const d = route.map((q, i) => `${i ? 'L' : 'M'}${px(q.x).toFixed(1)} ${py(q.z).toFixed(1)}`).join(' ');
    const dots = route.map((q, i) => `<g class="pl-pt ${cls}"><circle cx="${px(q.x)}" cy="${py(q.z)}" r="${mini ? 14 : 17}"/>${mini ? '' : `<text x="${px(q.x)}" y="${py(q.z) + 6}">${i + 1}</text>`}</g>`).join('');
    return `<path d="${d}" class="pl-path ${cls}"/>${dots}`;
  };
  const z = step.partner.zone;
  return `<svg viewBox="-12 -12 ${W + 24} ${H + 24}" class="pl-svg" role="img" aria-label="${t('pl_title')}">
    <rect x="0" y="0" width="${W}" height="${H}" class="pl-carpet"/>
    ${obstructZones('blue').map((r) => rect(r, 'pl-rivalzone')).join('')}
    ${F.START_ZONES_RED.map((r) => both(r, 'pl-start')).join('')}
    ${both(camara, 'pl-camara')}${both(campana, 'pl-campana')}
    ${rect(platform, 'pl-platform')}${rect(repisa, 'pl-repisa')}
    ${F.labSpots().map((q) => `<rect x="${px(q.x) - 7.5}" y="${py(q.z) - 7.5}" width="15" height="15" class="pl-sample"/>`).join('')}
    <line x1="${px(0)}" y1="0" x2="${px(0)}" y2="${H}" class="pl-center ${key === 'AUTO' ? 'hot' : ''}"/>
    <line x1="${W}" y1="0" x2="${W}" y2="${H}" class="pl-wall rival"/><line x1="0" y1="0" x2="0" y2="${H}" class="pl-wall mine"/>
    ${label(F.CAMARA_X_END_RED - F.CAMARA_LENGTH / 2, F.HALF_W - F.CAMARA_WIDTH / 2 + 0.08, t('pl_myCamara'))}
    ${label(F.CAMPANA_X_RED[0] + 1, -F.HALF_W + 0.28, t('pl_myCampana'))}
    ${label(0, 0.08, t('platform'))}
    ${label(1, 1.9, t('pl_lab'), 'dim')}
    ${label(-F.CAMARA_X_END_RED + F.CAMARA_LENGTH / 2, -F.HALF_W + F.CAMARA_WIDTH / 2 + 0.08, t('pl_rivalCamara'), 'rival')}
    ${label(0, F.HALF_W - 0.12, t('pl_centerLine'), 'dim')}
    ${label(3.4, 1.35, t('pl_you'), 'mine')}
    ${z ? rect(z, 'pl-zone') : ''}
    ${path(step.partner.route, 'mate')}${path(step.me.route, 'me')}
  </svg>`;
}
