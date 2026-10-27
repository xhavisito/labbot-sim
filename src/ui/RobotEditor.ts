/**
 * Editor de robot propio: medidas, tracción (motor, reducción, rueda), mecanismo, motores y
 * materiales con números reales de MDF de 5.5 mm (§7.1). Calcula masa, velocidad y aceleración,
 * revisa las reglas de construcción (§7.1–§7.3) y compara su score contra un robot de referencia
 * en matches de solo IA. Se guarda en este navegador y aparece junto a los presets.
 */
import { allRobotIds, robotSpec, type RobotId } from '../config/robotIds';
import {
  checkCustom,
  CUSTOM_PREFIX,
  customFromSpec,
  customRobots,
  customSpec,
  driveAccel,
  driveSpeed,
  estimateMass,
  estimateMdf,
  MDF_DENSITY,
  MOTOR_KINDS,
  MOTOR_LIMITS,
  MOTORS,
  motorCount,
  newId,
  PLA_LIMIT_G,
  sanitizeCustom,
  saveCustomRobots,
  type CustomRobot,
  type MotorKind,
} from '../config/customRobots';
import { DEFAULT_ROBOT, MECHANISM_KINDS, type MechanismKind } from '../config/robot';
import { botFor, compareAlliance, type CompareResult } from '../sim/compare';
import { backBtn, brandbar, ic, robotSilhouette } from './chrome';
import { t, type Key } from './i18n';

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

type NumKey = 'lengthCm' | 'widthCm' | 'heightCm' | 'driveCount' | 'gearRatio' | 'wheelIn' | 'wheels' | 'capacity' | 'liftSpeed' | 'armPivotXCm' | 'armPivotYCm' | 'armLengthCm' | 'plaG' | 'extraKg';

interface NumField {
  k: NumKey;
  label: Key;
  unit: string;
  step: number;
}

const CHASSIS: NumField[] = [
  { k: 'lengthCm', label: 'ed_length', unit: 'cm', step: 0.5 },
  { k: 'widthCm', label: 'ed_width', unit: 'cm', step: 0.5 },
  { k: 'heightCm', label: 'ed_height', unit: 'cm', step: 1 },
];
const DRIVE: NumField[] = [
  { k: 'driveCount', label: 'ed_driveCount', unit: '', step: 1 },
  { k: 'gearRatio', label: 'ed_gear', unit: ': 1', step: 0.05 },
  { k: 'wheelIn', label: 'ed_wheel', unit: 'in', step: 0.5 },
  { k: 'wheels', label: 'ed_wheels', unit: '', step: 1 },
];
const MECH: NumField[] = [
  { k: 'capacity', label: 'ed_capacity', unit: '', step: 1 },
  { k: 'liftSpeed', label: 'ed_armSpeed', unit: 'rad/s', step: 0.1 },
  { k: 'armPivotXCm', label: 'ed_pivotX', unit: 'cm', step: 1 },
  { k: 'armPivotYCm', label: 'ed_pivotY', unit: 'cm', step: 1 },
  { k: 'armLengthCm', label: 'ed_armLength', unit: 'cm', step: 1 },
];
const MATERIAL: NumField[] = [
  { k: 'plaG', label: 'ed_pla', unit: 'g', step: 5 },
  { k: 'extraKg', label: 'ed_extra', unit: 'kg', step: 0.1 },
];

/** Robots con los que se puede comparar (los presets, no los propios). */
const baselines = (): RobotId[] => [...MECHANISM_KINDS];
const nameOf = (id: RobotId): string => robotSpec(id).label ?? t(`type_${id}` as Key);

export class RobotEditor {
  /** Robot que se edita (copia; se guarda con el botón). */
  private c: CustomRobot | null = null;
  private compare: { base: RobotId; rival: RobotId; n: number; busy: boolean; progress: number; mine?: CompareResult; ref?: CompareResult; cancel: boolean } = {
    base: DEFAULT_ROBOT.mechanism,
    rival: DEFAULT_ROBOT.mechanism,
    n: 3,
    busy: false,
    progress: 0,
    cancel: false,
  };

  constructor(
    private root: HTMLElement,
    private onBack: () => void,
    /** Elegir este robot como el tuyo (lo guarda en los ajustes). */
    private onUse: (id: RobotId) => void,
  ) {}

  show(edit: CustomRobot | null = this.c): void {
    this.c = edit ? { ...edit, mechMotors: { ...edit.mechMotors } } : null;
    this.root.className = 'screen solid';
    this.root.innerHTML = `<div class="inner">
      ${brandbar(t('ed_title'))}
      <h1>${t('ed_title')}</h1>
      <p class="sub">${t('ed_note')}</p>
      ${this.c ? this.formHtml(this.c) : this.listHtml()}
      <div class="actionbar">${backBtn('data-act="back"')}<div class="grow"></div>
        ${
          this.c
            ? `<button class="btn" data-act="save">${ic.check}<span>${t('save')}</span></button>
               <button class="btn primary" data-act="use">${ic.play}<span>${t('ed_saveUse')}</span></button>`
            : ''
        }</div>
      </div>`;
    this.root.style.display = '';
    this.wire();
    if (this.c) this.refresh();
  }

  // ------------------------------------------------------------------ lista
  private listHtml(): string {
    const card = (c: CustomRobot) => {
      const n = checkCustom(c).filter((x) => x.level === 'error').length;
      return `<div class="ed-card" data-id="${c.id}">
        <div class="ed-sil">${robotSilhouette(c.mechanism)}</div>
        <div class="ed-info"><b>${esc(c.name)}</b><small>${t(`type_${c.mechanism}` as Key)} · ${c.lengthCm} × ${c.widthCm} × ${c.heightCm} cm · ${(c.massKg ?? estimateMass(c).total).toFixed(1)} kg · ${driveSpeed(c).toFixed(2)} m/s</small>
          <small class="${n ? 'bad' : 'good'}">${n ? t('ed_nErrors', { n }) : t('ed_legal')}</small></div>
        <div class="rp-btns">
          <button class="btn primary" data-use>${ic.play}<span>${t('ed_use')}</span></button>
          <button class="btn" data-edit>${ic.sliders}<span>${t('ed_edit')}</span></button>
          <button class="btn" data-dup title="${t('ed_duplicate')}">+</button>
          <button class="x" data-del title="${t('rp_delete')}" aria-label="${t('rp_delete')}">${ic.x}</button>
        </div></div>`;
    };
    return `<div class="panels">
      <div class="panel wide-p"><h3>${t('ed_mine')}</h3>
        <div class="rp-list">${customRobots.length ? customRobots.map(card).join('') : `<div class="msg">${t('ed_none')}</div>`}</div>
      </div>
      <div class="panel"><h3>${t('ed_new')}</h3><div class="form">
        <label>${t('ed_from')}</label><select data-from>
          <optgroup label="${t('grp_labbot')}">${MECHANISM_KINDS.map((m) => `<option value="${m}">${nameOf(m)}</option>`).join('')}</optgroup>
        </select>
        <div></div><button class="btn primary" data-act="new">${ic.cube}<span>${t('ed_create')}</span></button>
        <p class="full sub">${t('ed_newNote')}</p>
      </div></div>
    </div>`;
  }

  // ------------------------------------------------------------------ formulario
  private formHtml(c: CustomRobot): string {
    const num = (f: NumField) => `<label>${t(f.label)}</label><div class="numin"><input type="number" inputmode="decimal" step="${f.step}" data-n="${f.k}" value="${c[f.k]}"><span>${f.unit}</span></div>`;
    const motorSel = `<select data-drive>${MOTOR_KINDS.map((k) => `<option value="${k}" ${k === c.driveMotor ? 'selected' : ''}>${MOTORS[k].name}</option>`).join('')}</select>`;
    const mechMotors = MOTOR_KINDS.map(
      (k) => `<label>${MOTORS[k].name}</label><div class="numin"><input type="number" min="0" step="1" data-m="${k}" value="${c.mechMotors[k]}"><span>/ ${MOTOR_LIMITS[k]} (§7.3)</span></div>`,
    ).join('');
    const seg = (k: string, cur: string | number, opts: Array<[string | number, string]>) =>
      `<div class="seg" data-seg="${k}">${opts.map(([v, l]) => `<button class="${v === cur ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>`;
    const levelSeg = `<label>${t('ed_maxLevel')}</label>${seg('maxLevel', c.maxLevel, [[1, 'N1'], [2, 'N2'], [3, 'N3']])}`;
    return `<div class="panels editor">
      <div class="panel"><div class="form">
        <h3>${t('ed_identity')}</h3>
        <label>${t('ed_name')}</label><input type="text" maxlength="40" data-name value="${esc(c.name)}">
        <label>${t('robotType')}</label>${seg('mechanism', c.mechanism, MECHANISM_KINDS.map((m) => [m, t(`type_${m}` as Key)]))}
        <p class="full sub">${t(`type_${c.mechanism}_desc` as Key)}</p>
        <h3>${t('ed_chassis')}</h3>${CHASSIS.map(num).join('')}
        <h3>${t('ed_drive')}</h3><label>${t('ed_driveMotor')}</label>${motorSel}${DRIVE.map(num).join('')}
        <h3>${t('ed_mech')}</h3>${MECH.map(num).join('')}${levelSeg}
        <h3>${t('ed_mechMotors')}</h3>${mechMotors}
        <h3>${t('ed_materials')}</h3>
        <label>${t('ed_mdf')}</label><div class="numin"><input type="number" step="0.05" min="0" data-mdf value="${c.mdfM2 ?? ''}" placeholder="${estimateMdf(c).toFixed(2)}"><span>m²</span></div>
        <p class="full sub">${t('ed_mdfNote', { rho: MDF_DENSITY })}</p>
        ${MATERIAL.map(num).join('')}
        <label>${t('ed_scale')}</label><div class="numin"><input type="number" step="0.1" min="0" data-scale value="${c.massKg ?? ''}" placeholder="${t('ed_estimated')}"><span>kg</span></div>
      </div></div>
      <div class="ed-side">
        <div class="panel"><h3>${t('ed_result')}</h3><div data-derived></div></div>
        <div class="panel"><h3>${t('ed_checks')}</h3><ul class="checks" data-checks></ul></div>
        <div class="panel"><h3>${t('ed_compare')}</h3><div data-compare></div></div>
      </div>
    </div>`;
  }

  /** Recalcula lo que depende de los números (sin rehacer el formulario, para no perder el foco). */
  private refresh(): void {
    const c = this.c;
    if (!c) return;
    const m = estimateMass(c);
    const spec = customSpec(c);
    const row = (l: string, v: string) => `<tr><td>${l}</td><td>${v}</td></tr>`;
    const kg = (x: number) => `${x.toFixed(2)} kg`;
    const n = motorCount(c);
    const d = this.root.querySelector<HTMLElement>('[data-derived]');
    if (d)
      d.innerHTML = `<div class="ed-sil big">${robotSilhouette(c.mechanism)}</div>
        <div class="ed-kpis">
          <div><b>${(c.massKg ?? m.total).toFixed(1)}</b><small>kg${c.massKg === null ? ` · ${t('ed_estimated')}` : ''}</small></div>
          <div><b>${spec.maxSpeed.toFixed(2)}</b><small>m/s</small></div>
          <div><b>${driveAccel(c).toFixed(1)}</b><small>m/s²</small></div>
          <div><b>${spec.capacity}</b><small>${t('statCapacity')}</small></div>
        </div>
        <table class="rules-t">
          ${row(`${t('ed_mMdf')} (${(c.mdfM2 ?? estimateMdf(c)).toFixed(2)} m² × 5.5 mm)`, kg(m.mdf))}
          ${row(`${t('ed_mMotors')} (${MOTOR_KINDS.filter((k) => n[k]).map((k) => `${n[k]} ${MOTORS[k].name}`).join(', ') || '–'})`, kg(m.motors))}
          ${row(t('ed_mBattery'), kg(m.battery))}
          ${row(t('ed_mElectronics'), kg(m.electronics))}
          ${row(t('ed_mDrive'), kg(m.drivetrain))}
          ${row(`PLA (${c.plaG} / ${PLA_LIMIT_G} g, §7.1.1)`, kg(m.pla))}
          ${row(t('ed_extra'), kg(m.extra))}
          ${row(t('ed_mHardware'), kg(m.hardware))}
          <tr class="tot"><td>${t('ed_mTotal')}</td><td>${kg(m.total)}</td></tr>
        </table>
        <p class="sub">${t('ed_derivedNote')}</p>`;
    const ch = this.root.querySelector<HTMLElement>('[data-checks]');
    if (ch) ch.innerHTML = checkCustom(c).map((x) => `<li class="${x.level}"><i></i>${esc(x.text)}</li>`).join('');
    this.renderCompare();
  }

  private renderCompare(): void {
    const el = this.root.querySelector<HTMLElement>('[data-compare]');
    if (!el || !this.c) return;
    const k = this.compare;
    const opts = (sel: RobotId) => baselines().map((id) => `<option value="${id}" ${id === sel ? 'selected' : ''}>${nameOf(id)}</option>`).join('');
    const res = (r: CompareResult | undefined) => (r ? r : null);
    const a = res(k.mine);
    const b = res(k.ref);
    const cell = (v: number | undefined, d = 1) => (v === undefined ? '–' : v.toFixed(d));
    const diff = (x?: number, y?: number) => (x === undefined || y === undefined ? '' : `<em class="${x >= y ? 'up' : 'down'}">${x >= y ? '+' : ''}${(x - y).toFixed(1)}</em>`);
    el.innerHTML = `<div class="form">
        <label>${t('ed_cmpBase')}</label><select data-cmp="base">${opts(k.base)}</select>
        <label>${t('ed_cmpRival')}</label><select data-cmp="rival">${opts(k.rival)}</select>
        <label>${t('ed_cmpN')}</label><div class="seg" data-cmpn>${[1, 3, 5].map((n) => `<button class="${n === k.n ? 'on' : ''}" data-v="${n}">${n}</button>`).join('')}</div>
      </div>
      ${k.busy ? `<div class="cmp-bar"><i style="width:${Math.round(k.progress * 100)}%"></i></div>` : ''}
      ${
        a && b
          ? `<table class="breakdown cmp-t"><tr><th></th><th>${esc(this.c.name)}</th><th>${esc(nameOf(k.base))}</th></tr>
            <tr><td>${t('ed_cmpTotal')}</td><td>${cell(a.total)} ${diff(a.total, b.total)}</td><td>${cell(b.total)}</td></tr>
            <tr><td>${t('ed_cmpOwn')}</td><td>${cell(a.own)} ${diff(a.own, b.own)}</td><td>${cell(b.own)}</td></tr>
            <tr><td>${t('ed_cmpSamples')}</td><td>${cell(a.samples)}</td><td>${cell(b.samples)}</td></tr>
            <tr><td>RP</td><td>${cell(a.rp, 2)}</td><td>${cell(b.rp, 2)}</td></tr>
            <tr><td>${t('ed_cmpWin')}</td><td>${Math.round(a.winRate * 100)}%</td><td>${Math.round(b.winRate * 100)}%</td></tr>
            <tr><td>${t('ed_cmpRivalPts')}</td><td>${cell(a.rival)}</td><td>${cell(b.rival)}</td></tr></table>`
          : ''
      }
      <div class="cmp-act"><button class="btn ${k.busy ? '' : 'primary'}" data-act="compare">${k.busy ? `${ic.x}<span>${t('ed_cmpStop')}</span>` : `${ic.chart}<span>${t('ed_cmpRun')}</span>`}</button></div>
      <p class="sub">${t('ed_cmpNote')}</p>`;
    el.querySelectorAll<HTMLSelectElement>('[data-cmp]').forEach((s) =>
      s.addEventListener('change', () => {
        k[s.dataset.cmp as 'base' | 'rival'] = s.value as RobotId;
        k.mine = k.ref = undefined;
        this.renderCompare();
      }),
    );
    el.querySelectorAll<HTMLElement>('[data-cmpn] button').forEach((b2) =>
      b2.addEventListener('click', () => {
        k.n = Number(b2.dataset.v);
        this.renderCompare();
      }),
    );
    el.querySelector('[data-act="compare"]')?.addEventListener('click', () => (k.busy ? (k.cancel = true) : void this.runCompare()));
  }

  private async runCompare(): Promise<void> {
    const c = this.c;
    if (!c) return;
    const k = this.compare;
    k.busy = true;
    k.cancel = false;
    k.progress = 0;
    k.mine = k.ref = undefined;
    this.renderCompare();
    const mine = customSpec(c);
    const base = robotSpec(k.base);
    const rival = { spec: robotSpec(k.rival), bot: botFor(robotSpec(k.rival)) };
    const bar = () => this.root.querySelector<HTMLElement>('.cmp-bar i');
    const stop = () => k.cancel || !this.root.contains(this.root.querySelector('[data-compare]'));
    const a = await compareAlliance({ spec: mine, bot: botFor(mine) }, rival, k.n, (f) => {
      k.progress = f / 2;
      const b = bar();
      if (b) b.style.width = `${Math.round(k.progress * 100)}%`;
    }, stop);
    const b = stop()
      ? undefined
      : await compareAlliance({ spec: base, bot: botFor(base) }, rival, k.n, (f) => {
          k.progress = 0.5 + f / 2;
          const el = bar();
          if (el) el.style.width = `${Math.round(k.progress * 100)}%`;
        }, stop);
    k.busy = false;
    if (!k.cancel && b) {
      k.mine = a;
      k.ref = b;
    }
    if (this.c) this.renderCompare();
  }

  // ------------------------------------------------------------------ eventos
  private wire(): void {
    const r = this.root;
    const on = (sel: string, fn: (el: HTMLElement) => void) => r.querySelectorAll<HTMLElement>(sel).forEach((el) => el.addEventListener('click', () => fn(el)));
    const id = (el: HTMLElement) => el.closest<HTMLElement>('[data-id]')!.dataset.id!;
    on('[data-act="back"]', () => {
      this.compare.cancel = true;
      if (this.c) this.show(null);
      else this.onBack();
    });
    on('[data-act="new"]', () => {
      const from = r.querySelector<HTMLSelectElement>('[data-from]')!.value as RobotId;
      this.show(customFromSpec(robotSpec(from), `${t('ed_myRobot')} ${customRobots.length + 1}`));
    });
    on('[data-edit]', (el) => this.show(customRobots.find((c) => c.id === id(el)) ?? null));
    on('[data-use]', (el) => this.onUse(`${CUSTOM_PREFIX}${id(el)}`));
    on('[data-dup]', (el) => {
      const c = customRobots.find((x) => x.id === id(el));
      if (!c) return;
      customRobots.push({ ...c, id: newId(), name: `${c.name} (2)`, mechMotors: { ...c.mechMotors } });
      saveCustomRobots(customRobots);
      this.show(null);
    });
    on('[data-del]', (el) => {
      const i = customRobots.findIndex((x) => x.id === id(el));
      if (i >= 0) customRobots.splice(i, 1);
      saveCustomRobots(customRobots);
      this.show(null);
    });
    on('[data-act="save"]', () => {
      this.save();
      this.show(null);
    });
    on('[data-act="use"]', () => {
      const c = this.save();
      if (c) this.onUse(`${CUSTOM_PREFIX}${c.id}`);
    });
    const c = this.c;
    if (!c) return;
    r.querySelectorAll<HTMLInputElement>('[data-n]').forEach((inp) =>
      inp.addEventListener('input', () => {
        const v = Number(inp.value);
        if (inp.value === '' || !Number.isFinite(v)) return;
        c[inp.dataset.n as NumKey] = v;
        this.changed();
      }),
    );
    r.querySelectorAll<HTMLInputElement>('[data-m]').forEach((inp) =>
      inp.addEventListener('input', () => {
        c.mechMotors[inp.dataset.m as MotorKind] = Math.max(0, Math.round(Number(inp.value) || 0));
        this.changed();
      }),
    );
    r.querySelector<HTMLSelectElement>('[data-drive]')?.addEventListener('change', (e) => {
      c.driveMotor = (e.target as HTMLSelectElement).value as MotorKind;
      this.changed();
    });
    r.querySelector<HTMLInputElement>('[data-name]')?.addEventListener('input', (e) => {
      c.name = (e.target as HTMLInputElement).value;
    });
    const optNum = (sel: string, set: (v: number | null) => void) =>
      r.querySelector<HTMLInputElement>(sel)?.addEventListener('input', (e) => {
        const s = (e.target as HTMLInputElement).value;
        set(s === '' || !Number.isFinite(Number(s)) ? null : Number(s));
        this.changed();
      });
    optNum('[data-mdf]', (v) => (c.mdfM2 = v));
    optNum('[data-scale]', (v) => (c.massKg = v));
    r.querySelectorAll<HTMLElement>('[data-seg] button').forEach((b) =>
      b.addEventListener('click', () => {
        const k = b.parentElement!.dataset.seg!;
        if (k === 'mechanism') {
          // Otro tipo: toma las medidas del mecanismo de ese preset y conserva chasis, tracción y materiales
          const keep = { ...c };
          const fresh = customFromSpec(robotSpec(b.dataset.v as MechanismKind), c.name, c.id);
          this.show({ ...fresh, lengthCm: keep.lengthCm, widthCm: keep.widthCm, driveMotor: keep.driveMotor, driveCount: keep.driveCount, gearRatio: keep.gearRatio, wheelIn: keep.wheelIn, wheels: keep.wheels, mdfM2: keep.mdfM2, plaG: keep.plaG, extraKg: keep.extraKg, massKg: keep.massKg });
          return;
        }
        if (k === 'maxLevel') c.maxLevel = Number(b.dataset.v) as 1 | 2 | 3;
        b.parentElement!.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        this.changed();
      }),
    );
  }

  private changed(): void {
    const c = this.c;
    if (!c) return;
    const mdf = this.root.querySelector<HTMLInputElement>('[data-mdf]');
    if (mdf) mdf.placeholder = estimateMdf(c).toFixed(2);
    this.compare.mine = this.compare.ref = undefined;
    this.refresh();
  }

  /** Guarda el robot editado (limpio por `sanitizeCustom`) y lo devuelve. */
  private save(): CustomRobot | null {
    const c = sanitizeCustom(this.c);
    if (!c) return null;
    const i = customRobots.findIndex((x) => x.id === c.id);
    if (i >= 0) customRobots[i] = c;
    else customRobots.push(c);
    saveCustomRobots(customRobots);
    this.c = c;
    return c;
  }

  /** ¿Sigue existiendo el robot elegido en los ajustes? */
  static exists(id: RobotId): boolean {
    return allRobotIds().includes(id);
  }
}
