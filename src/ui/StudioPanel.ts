/**
 * Interfaz del Reveal Studio: HUD de editor de video oscuro con acentos morado/rosa neón, abajo y a
 * los lados para no tapar la vista 3D. Lista de clips, línea de tiempo con recorte, cámaras,
 * velocidad, efectos y exportación.
 */
import { CAM_PRESETS, type CamPreset } from '../director/RevealCamera';
import { downloadBlob, extensionFor, pickMime, type VideoFormat } from '../director/exportClip';
import type { Studio } from '../director/Studio';
import type { Clip } from '../director/clip';
import { keyLabel } from '../input/bindings';
import { t, type Key } from './i18n';
import { stationTag } from './StatsPanel';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
};

const fmt = (s: number): string => `${s.toFixed(1)}s`;

export class StudioPanel {
  readonly root: HTMLElement;
  private clipList!: HTMLElement;
  private track!: HTMLElement;
  private playhead!: HTMLElement;
  private trimBox!: HTMLElement;
  private marker!: HTMLElement;
  private rampBox!: HTMLElement;
  private timeText!: HTMLElement;
  private playBtn!: HTMLButtonElement;
  private freeHelp!: HTMLElement;
  private status!: HTMLElement;
  private exportBtn!: HTMLButtonElement;
  private keyHeld = new Set<string>();
  private dragging: 'play' | 'in' | 'out' | null = null;
  private lastClipCount = -1;
  private lastClip: Clip | null = null;
  private lastKeys = -1;
  private onKey = (e: KeyboardEvent) => this.key(e, true);
  private onKeyUp = (e: KeyboardEvent) => this.key(e, false);
  private onPtrUp = () => (this.dragging = null);

  constructor(
    host: HTMLElement,
    private studio: Studio,
    private clips: () => readonly Clip[],
    private highlightKey: () => string,
    private onExit: () => void,
    private onClean: (on: boolean) => void,
  ) {
    this.root = el('div', 'dir', host);
    this.build();
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('pointerup', this.onPtrUp);
    this.bindFreeLook();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('pointerup', this.onPtrUp);
    this.root.remove();
  }

  private btn(parent: HTMLElement, label: string, click: () => void, cls = ''): HTMLButtonElement {
    const b = el('button', cls, parent, label);
    b.addEventListener('click', () => {
      click();
      b.blur();
    });
    return b;
  }

  private chip(parent: HTMLElement, label: string, on: () => boolean, set: (v: boolean) => void): HTMLButtonElement {
    const b = el('button', 'chip', parent, label);
    const paint = () => b.classList.toggle('on', on());
    b.addEventListener('click', () => {
      set(!on());
      paint();
      b.blur();
    });
    paint();
    return b;
  }

  private build(): void {
    const s = this.studio;
    // --- Barra superior
    const top = el('div', 'dir-top', this.root);
    el('div', 'dir-title', top, `● ${t('dirTitle')}`);
    this.btn(top, t('dirClean'), () => this.setClean(true), 'ghost');
    this.btn(top, `${t('dirExit')} (Esc)`, this.onExit, 'ghost');

    // --- Lista de clips (izquierda)
    const side = el('div', 'dir-side', this.root);
    el('div', 'dir-h', side, t('dirClips'));
    this.clipList = el('div', 'dir-clips', side);

    // --- Panel inferior
    const bot = el('div', 'dir-bottom', this.root);
    const tl = el('div', 'dir-timeline', bot);
    const transport = el('div', 'dir-transport', tl);
    this.playBtn = this.btn(transport, '▶', () => this.togglePlay(), 'play');
    this.timeText = el('span', 'dir-time', transport, '0.0s');
    this.btn(transport, `[ ${t('dirSetIn')}`, () => this.setTrim('in'), 'small');
    this.btn(transport, `${t('dirSetOut')} ]`, () => this.setTrim('out'), 'small');
    this.track = el('div', 'dir-track', tl);
    this.rampBox = el('div', 'dir-ramp', this.track);
    this.trimBox = el('div', 'dir-trim', this.track);
    const hin = el('div', 'dir-handle in', this.trimBox);
    const hout = el('div', 'dir-handle out', this.trimBox);
    this.marker = el('div', 'dir-marker', this.track);
    this.playhead = el('div', 'dir-playhead', this.track);
    this.track.addEventListener('pointerdown', (e) => {
      this.dragging = 'play';
      this.dragTo(e);
    });
    hin.addEventListener('pointerdown', (e) => (e.stopPropagation(), (this.dragging = 'in')));
    hout.addEventListener('pointerdown', (e) => (e.stopPropagation(), (this.dragging = 'out')));
    window.addEventListener('pointermove', (e) => this.dragging && this.dragTo(e));

    const row = el('div', 'dir-row', bot);
    // Cámaras
    const camBox = el('div', 'dir-group', row);
    el('div', 'dir-h', camBox, t('dirCamera'));
    const camBtns = el('div', 'dir-btns', camBox);
    const camEls = new Map<CamPreset, HTMLButtonElement>();
    for (const p of CAM_PRESETS) {
      camEls.set(
        p,
        this.btn(camBtns, t(`dc_${p}` as Key), () => {
          s.cam.setPreset(p);
          for (const [k, b] of camEls) b.classList.toggle('on', k === p);
          this.freeHelp.style.display = p === 'free' ? '' : 'none';
        }),
      );
    }
    camEls.get(s.cam.preset)!.classList.add('on');
    const robots = el('div', 'dir-btns', camBox);
    el('span', 'dir-lbl', robots, t('dirRobot'));
    const robotEls: HTMLButtonElement[] = [];
    (s.clip?.replay.header.robots ?? []).forEach((r, i) => {
      const b = this.btn(robots, stationTag(r.alliance, r.station), () => {
        s.setFocus(i);
        robotEls.forEach((x, k) => x.classList.toggle('on', k === i));
      }, `rb ${r.alliance}`);
      b.title = r.label;
      robotEls.push(b);
    });
    this.robotEls = robotEls;
    this.freeHelp = el('div', 'dir-help', camBox, t('dirFreeHelp'));
    this.freeHelp.style.display = 'none';
    const keys = el('div', 'dir-btns', camBox);
    this.btn(keys, t('dirKeyframe'), () => s.cam.addKeyframe(), 'small');
    this.btn(keys, t('dirClearKeys'), () => s.cam.clearKeyframes(), 'small');
    this.chip(keys, t('dirTravel'), () => s.cam.useTravel, (v) => (s.cam.useTravel = v));

    // Velocidad
    const spd = el('div', 'dir-group', row);
    el('div', 'dir-h', spd, t('dirSpeed'));
    const at = el('div', 'dir-btns', spd);
    el('span', 'dir-lbl', at, t('dirSlowAt'));
    this.radio(at, [1, 0.5, 0.25], (v) => (s.ramp.slow = v), () => s.ramp.slow, (v) => `${v}×`);
    const af = el('div', 'dir-btns', spd);
    el('span', 'dir-lbl', af, t('dirAfter'));
    this.radio(af, [1, 1.5], (v) => (s.ramp.after = v), () => s.ramp.after, (v) => `${v}×`);

    // Efectos
    const fx = el('div', 'dir-group', row);
    el('div', 'dir-h', fx, t('dirFx'));
    const fxb = el('div', 'dir-btns', fx);
    const setFx = (k: 'motionBlur' | 'bloom' | 'vignette') => (v: boolean) => s.setFx({ ...s.fx, [k]: v });
    this.chip(fxb, t('fxBlur'), () => s.fx.motionBlur, setFx('motionBlur'));
    this.chip(fxb, t('fxBloom'), () => s.fx.bloom, setFx('bloom'));
    this.chip(fxb, t('fxVignette'), () => s.fx.vignette, setFx('vignette'));

    // Exportar
    const ex = el('div', 'dir-group', row);
    el('div', 'dir-h', ex, t('dirExport'));
    const exb = el('div', 'dir-btns', ex);
    const fmtSel = el('select', '', exb);
    for (const [v, l] of [['auto', 'Auto'], ['webm', 'WebM'], ['mp4', 'MP4']] as const) fmtSel.add(new Option(l, v));
    const resSel = el('select', '', exb);
    resSel.add(new Option(t('dirResScreen'), '0'));
    resSel.add(new Option('1080p', '1080'));
    resSel.add(new Option('1440p', '1440'));
    resSel.add(new Option('4K', '2160'));
    this.exportBtn = this.btn(exb, `⬤ ${t('dirExport')}`, () => this.doExport(fmtSel.value as VideoFormat, Number(resSel.value)), 'rec');
    this.status = el('div', 'dir-help', ex, t('dirExportNote'));
  }

  private robotEls: HTMLButtonElement[] = [];

  private radio(parent: HTMLElement, values: number[], set: (v: number) => void, get: () => number, label: (v: number) => string): void {
    const bs = values.map((v) =>
      this.btn(parent, label(v), () => {
        set(v);
        bs.forEach((b, i) => b.classList.toggle('on', values[i] === get()));
      }),
    );
    bs.forEach((b, i) => b.classList.toggle('on', values[i] === get()));
  }

  private setClean(on: boolean): void {
    this.root.classList.toggle('clean', on);
    this.onClean(on);
  }

  private togglePlay(): void {
    this.studio.playing = !this.studio.playing;
  }

  private setTrim(which: 'in' | 'out'): void {
    const s = this.studio;
    if (!s.clip) return;
    if (which === 'in') s.trimIn = Math.min(s.t, s.trimOut - 0.5);
    else s.trimOut = Math.max(s.t, s.trimIn + 0.5);
  }

  private dragTo(e: PointerEvent): void {
    const c = this.studio.clip;
    if (!c) return;
    const r = this.track.getBoundingClientRect();
    const x = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1) * c.duration;
    const s = this.studio;
    if (this.dragging === 'in') s.trimIn = Math.min(x, s.trimOut - 0.5);
    else if (this.dragging === 'out') s.trimOut = Math.max(x, s.trimIn + 0.5);
    else s.seek(x);
  }

  private async doExport(format: VideoFormat, height: number): Promise<void> {
    const s = this.studio;
    if (!s.clip) return;
    if (!pickMime(format)) {
      this.status.textContent = t('dirNoRec');
      return;
    }
    this.exportBtn.disabled = true;
    this.root.classList.add('exporting');
    try {
      const { blob, mime } = await s.export({ format, height, onProgress: (p) => (this.status.textContent = t('dirExporting', { pct: p })) });
      const name = `labbot-reveal-${s.clip.id}-${Date.now()}.${extensionFor(mime)}`;
      downloadBlob(blob, name);
      this.status.textContent = t('dirSaved', { name });
    } catch (e) {
      this.status.textContent = String(e instanceof Error ? e.message : e);
    } finally {
      this.exportBtn.disabled = false;
      this.root.classList.remove('exporting');
    }
  }

  /** Teclas del estudio: espacio, flechas, cámara libre (WASD/QE), keyframe (K), Clean Feed (U). */
  private key(e: KeyboardEvent, down: boolean): void {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT') return;
    if (down) {
      if (e.code === 'Space') (e.preventDefault(), this.togglePlay());
      else if (e.code === 'KeyU') this.setClean(!this.root.classList.contains('clean'));
      else if (e.code === 'KeyK' && this.studio.cam.preset === 'free') this.studio.cam.addKeyframe();
      else if (e.code === 'ArrowLeft') this.studio.seek(this.studio.t - 0.2);
      else if (e.code === 'ArrowRight') this.studio.seek(this.studio.t + 0.2);
      this.keyHeld.add(e.code);
    } else this.keyHeld.delete(e.code);
    const h = (c: string) => (this.keyHeld.has(c) ? 1 : 0);
    const m = this.studio.move;
    m.f = h('KeyW') - h('KeyS');
    m.r = h('KeyD') - h('KeyA');
    m.u = h('KeyE') - h('KeyQ');
  }

  private bindFreeLook(): void {
    const cv = document.querySelector('canvas');
    let last: { x: number; y: number } | null = null;
    cv?.addEventListener('pointerdown', (e) => (last = { x: e.clientX, y: e.clientY }));
    window.addEventListener('pointerup', () => (last = null));
    window.addEventListener('pointermove', (e) => {
      if (!last || this.studio.cam.preset !== 'free') return;
      this.studio.cam.look(e.clientX - last.x, e.clientY - last.y);
      last = { x: e.clientX, y: e.clientY };
    });
    cv?.addEventListener('dblclick', () => this.root.classList.contains('clean') && this.setClean(false));
  }

  /** Refresca la lista de clips y la línea de tiempo (llamar cada cuadro; solo toca el DOM si cambió algo). */
  update(): void {
    const s = this.studio;
    const list = this.clips();
    if (list.length !== this.lastClipCount || s.clip !== this.lastClip) {
      this.lastClipCount = list.length;
      this.lastClip = s.clip;
      this.clipList.textContent = '';
      if (!list.length) el('div', 'dir-help', this.clipList, t('dirNoClips', { key: keyLabel(this.highlightKey()) }));
      for (const c of [...list].reverse()) {
        const b = el('button', `dir-clip${c === s.clip ? ' on' : ''}`, this.clipList);
        const when = Number.isNaN(c.matchStart) ? '' : `${Math.max(0, Math.floor(c.matchStart))}s · `;
        el('b', '', b, `${c.kind === 'manual' ? '⚑' : '★'} ${t(`hl_${c.kind}` as Key)}`);
        el('span', '', b, `${when}${fmt(c.duration)}${c.tags.length ? ` · +${c.tags.length}` : ''}`);
        b.addEventListener('click', () => {
          s.open(c);
          this.robotEls.forEach((x, k) => x.classList.toggle('on', k === s.focus));
          b.blur();
        });
      }
    }
    const c = s.clip;
    this.playBtn.textContent = s.playing ? '❚❚' : '▶';
    if (!c) return;
    const pct = (x: number) => `${(x / c.duration) * 100}%`;
    this.playhead.style.left = pct(s.t);
    this.marker.style.left = pct(c.trigger);
    this.trimBox.style.left = pct(s.trimIn);
    this.trimBox.style.width = `${((s.trimOut - s.trimIn) / c.duration) * 100}%`;
    const r = s.ramp;
    const on = r.slow !== 1 || r.after !== 1;
    this.rampBox.style.display = on ? '' : 'none';
    this.rampBox.style.left = pct(Math.max(0, r.at - r.lead));
    this.rampBox.style.width = `${((r.lead + r.hold) / c.duration) * 100}%`;
    this.timeText.textContent = `${fmt(s.t)} / ${fmt(c.duration)} · ${t('dirTrim')} ${fmt(s.trimOut - s.trimIn)}`;
    if (s.cam.keys.length !== this.lastKeys) this.lastKeys = s.cam.keys.length;
  }
}
