/**
 * Menús con el control (gamepad, mapeo "standard"): la cruceta o el stick izquierdo mueven el foco
 * al botón/control más cercano en esa dirección, A lo activa, B regresa (Volver, Cancelar, Reanudar
 * o cerrar), LB/RB cambian de pestaña y el stick derecho hace scroll. En selects y sliders,
 * izquierda/derecha cambian el valor. Solo actúa sobre la capa de UI que App le pasa (`scope`):
 * jugando no hay capa y el control maneja el robot. `pickNext` no usa DOM: se prueba.
 */

export type Dir = 'up' | 'down' | 'left' | 'right';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Distancia entre dos rangos [a0,a1] y [b0,b1] (0 si se enciman). */
const gap = (a0: number, a1: number, b0: number, b1: number): number => Math.max(0, b0 - a1, a0 - b1);

/**
 * Índice del candidato más cercano a `from` en la dirección `dir` (−1 si no hay). Cuenta la
 * distancia en esa dirección y pesa el triple lo que se desvía de lado, así "abajo" prefiere el
 * botón de la misma columna aunque otro esté un poco más cerca en diagonal.
 */
export function pickNext(from: Box, cands: readonly Box[], dir: Dir): number {
  const fx = from.x + from.w / 2;
  const fy = from.y + from.h / 2;
  let best = -1;
  let bestScore = Infinity;
  cands.forEach((c, i) => {
    const cx = c.x + c.w / 2;
    const cy = c.y + c.h / 2;
    const vertical = dir === 'up' || dir === 'down';
    const sign = dir === 'down' || dir === 'right' ? 1 : -1;
    // El centro tiene que avanzar en esa dirección
    if ((vertical ? cy - fy : cx - fx) * sign <= 2) return;
    const along = vertical
      ? sign > 0 ? Math.max(0, c.y - (from.y + from.h)) : Math.max(0, from.y - (c.y + c.h))
      : sign > 0 ? Math.max(0, c.x - (from.x + from.w)) : Math.max(0, from.x - (c.x + c.w));
    const side = vertical ? gap(from.x, from.x + from.w, c.x, c.x + c.w) : gap(from.y, from.y + from.h, c.y, c.y + c.h);
    const center = vertical ? Math.abs(cx - fx) : Math.abs(cy - fy);
    const score = along + side * 3 + center * 0.05 + Math.abs(vertical ? cy - fy : cx - fx) * 0.01;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

/** Botones del mapeo "standard". */
const BTN = { a: 0, b: 1, lb: 4, rb: 5, up: 12, down: 13, left: 14, right: 15 } as const;
/** Mantener una dirección: primer repetido y luego cada tanto (ms). */
const REPEAT_DELAY = 380;
const REPEAT_EVERY = 120;
const STICK = 0.55;

const FOCUSABLE = 'button, select, input:not([type="hidden"]), textarea, a[href], [tabindex]:not([tabindex="-1"])';
/** Lo que B presiona, en orden: cerrar diálogo, volver, cancelar, reanudar, salir. */
const BACK = ['[data-x]', '[data-act="back"]', '[data-act="cancel"]', '[data-back]', '[data-act="resume"]', '[data-a="exit"]'];

function visible(el: HTMLElement): boolean {
  if ((el as HTMLButtonElement).disabled || el.closest('[hidden], [inert]')) return false;
  if (!el.getClientRects().length) return false;
  const st = getComputedStyle(el);
  return st.visibility !== 'hidden' && st.pointerEvents !== 'none';
}

/** Identifica un control para volver a enfocarlo cuando la pantalla se redibuja. */
function keyOf(el: HTMLElement): string {
  const data = (e: Element) =>
    [...e.attributes]
      .filter((a) => a.name.startsWith('data-'))
      .map((a) => `${a.name}=${a.value}`)
      .join(',');
  const own = data(el) || (el.textContent ?? '').trim().slice(0, 30);
  const parent = el.parentElement?.closest('[data-seg],[data-tabs],[data-id],[data-k]');
  return `${el.tagName}|${own}|${parent ? data(parent) : ''}`;
}

/** Qué pantalla es (para no confundir un redibujo con una pantalla nueva). */
const screenOf = (layer: Element): string => `${layer.className}|${layer.querySelector('h1, h2, .ap-head b')?.textContent ?? ''}`;

const box = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};

export class PadNav {
  private prev: boolean[] = [];
  private held: Dir | null = null;
  private nextRepeat = 0;
  private lastKey = '';
  private lastBox: Box | null = null;
  private lastScreen = '';
  /** Último control enfocado en cada pantalla. */
  private memory = new Map<string, string>();
  private wasCapturing = false;
  private current: HTMLElement | null = null;
  /** El jugador está usando el control en los menús: se ve el foco y se restaura al redibujar. */
  private active = false;

  constructor(target: Window = window) {
    const off = () => this.setActive(false);
    target.addEventListener('pointerdown', off, true);
    target.addEventListener('mousemove', off, true);
    target.addEventListener('keydown', off, true);
  }

  private setActive(on: boolean): void {
    if (this.active === on) return;
    this.active = on;
    document.body.classList.toggle('pad-nav', on);
    if (!on) this.mark(null);
  }

  /** Marca el control enfocado (el anillo de foco morado sale con `body.pad-nav .pad-focus`). */
  private mark(el: HTMLElement | null): void {
    if (this.current !== el) this.current?.classList.remove('pad-focus');
    this.current = el;
    el?.classList.add('pad-focus');
  }

  /**
   * Cada cuadro. `scope` = la capa de UI que se usa ahora (null jugando); `capturing` = Controles
   * espera un botón para reasignar (ese botón no navega).
   */
  update(now: number, pad: Gamepad | null, scope: HTMLElement | null, capturing: boolean): void {
    const btns = pad ? pad.buttons.map((b) => b.pressed) : [];
    const prev = this.prev;
    this.prev = btns;
    if (capturing || this.wasCapturing) {
      // El botón que terminó la captura no cuenta como pulsación aquí
      this.wasCapturing = capturing;
      this.held = null;
      return;
    }
    if (!pad || !scope) {
      this.held = null;
      if (!scope) this.mark(null);
      return;
    }
    const layer = this.layer(scope);
    const edge = (i: number) => !!btns[i] && !prev[i];
    const ax = pad.axes;
    const dir = this.direction(btns, ax[0] ?? 0, ax[1] ?? 0);
    const any = btns.some(Boolean) || Math.abs(ax[0] ?? 0) > STICK || Math.abs(ax[1] ?? 0) > STICK || Math.abs(ax[3] ?? 0) > STICK;
    if (!this.active) {
      if (!any) return;
      // El primer toque solo muestra dónde está el foco
      this.setActive(true);
      const cur = this.focused(layer) ?? this.restore(layer);
      if (cur) this.focus(cur);
      this.held = dir;
      this.nextRepeat = now + REPEAT_DELAY;
      return;
    }

    // La pantalla se redibujó o cambió: el mismo control, o donde estaba al volver a esa pantalla
    if (this.current && !this.current.isConnected) {
      this.current = null;
      const r = this.recall(layer);
      if (r) this.focus(r);
    }
    let cur = this.focused(layer);
    if (!cur) {
      // Sin foco (pantalla nueva o redibujada): este cuadro solo enfoca; nada se mueve ni se activa
      cur = this.restore(layer);
      if (cur) this.focus(cur);
      this.held = dir;
      this.nextRepeat = now + REPEAT_DELAY;
      return;
    }

    // Dirección: al presionar y luego repetido mientras se mantiene
    let step: Dir | null = null;
    if (dir !== this.held) {
      this.held = dir;
      step = dir;
      this.nextRepeat = now + REPEAT_DELAY;
    } else if (dir && now >= this.nextRepeat) {
      step = dir;
      this.nextRepeat = now + REPEAT_EVERY;
    }
    if (step && cur) this.move(layer, cur, step);

    if (edge(BTN.a) && cur) this.activate(cur);
    else if (edge(BTN.b)) this.back(layer);
    if (edge(BTN.lb)) this.tab(layer, -1);
    if (edge(BTN.rb)) this.tab(layer, 1);

    // Stick derecho: scroll de la pantalla
    const sy = ax[3] ?? 0;
    if (Math.abs(sy) > 0.2) {
      const sc = this.scroller(this.current ?? layer);
      if (sc) sc.scrollTop += sy * 18;
    }
  }

  private direction(b: boolean[], x: number, y: number): Dir | null {
    if (b[BTN.up]) return 'up';
    if (b[BTN.down]) return 'down';
    if (b[BTN.left]) return 'left';
    if (b[BTN.right]) return 'right';
    if (Math.max(Math.abs(x), Math.abs(y)) < STICK) return null;
    return Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : y > 0 ? 'down' : 'up';
  }

  /** La capa de arriba: un diálogo abierto encima de la pantalla (p. ej. elegir robot del Scouting). */
  private layer(scope: HTMLElement): HTMLElement {
    const dialogs = [...scope.querySelectorAll<HTMLElement>('.overlay')].filter((d) => d.getClientRects().length);
    return dialogs[dialogs.length - 1] ?? scope;
  }

  private items(layer: HTMLElement): HTMLElement[] {
    return [...layer.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
  }

  private focused(layer: HTMLElement): HTMLElement | null {
    const a = document.activeElement as HTMLElement | null;
    const el = a && a !== document.body && layer.contains(a) && visible(a) ? a : this.current?.isConnected && layer.contains(this.current) && visible(this.current) ? this.current : null;
    if (el && el !== this.current) this.remember(el);
    return el;
  }

  /**
   * Tras redibujar: el mismo control (por sus data-*) o, en la misma pantalla, el más cercano al
   * anterior. Al volver a una pantalla: donde estaba el foco (p. ej. Ajustes al regresar al menú).
   * En una pantalla nueva: el botón principal de un diálogo o el primer control.
   */
  private restore(layer: HTMLElement): HTMLElement | null {
    const items = this.items(layer);
    if (!items.length) return null;
    const r = this.recall(layer, items);
    if (r) return r;
    const lb = this.lastBox;
    if (lb && this.lastScreen === screenOf(layer)) {
      const d = (b: Box) => Math.hypot(b.x + b.w / 2 - lb.x - lb.w / 2, b.y + b.h / 2 - lb.y - lb.h / 2);
      return items.reduce((a, e) => (d(box(e)) < d(box(a)) ? e : a));
    }
    const main = layer.querySelector<HTMLElement>('[data-act="resume"], .mm-hero, .dialog .btn.primary, .ap-panel .btn.primary');
    return main && visible(main) ? main : items[0];
  }

  /** El mismo control tras redibujar o, en una pantalla completa (no en diálogos), el último que tuvo. */
  private recall(layer: HTMLElement, items = this.items(layer)): HTMLElement | null {
    const same = items.find((e) => keyOf(e) === this.lastKey);
    if (same) return same;
    if (layer.classList.contains('overlay')) return null;
    const back = this.memory.get(screenOf(layer));
    return (back && items.find((e) => keyOf(e) === back)) || null;
  }

  private remember(el: HTMLElement): void {
    this.lastKey = keyOf(el);
    this.lastBox = box(el);
    const layer = el.closest<HTMLElement>('.overlay, .screen, .ap-wrap, .replaybar-wrap');
    this.lastScreen = layer ? screenOf(layer) : '';
    this.memory.set(this.lastScreen, this.lastKey);
    this.mark(el);
  }

  private focus(el: HTMLElement): void {
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this.remember(el);
  }

  private move(layer: HTMLElement, cur: HTMLElement, d: Dir): void {
    // Izquierda/derecha en un select o slider cambian el valor
    if (d === 'left' || d === 'right') {
      const k = d === 'right' ? 1 : -1;
      if (cur instanceof HTMLSelectElement) return this.cycle(cur, k);
      if (cur instanceof HTMLInputElement && (cur.type === 'range' || cur.type === 'number')) {
        if (k > 0) cur.stepUp();
        else cur.stepDown();
        return this.changed(cur);
      }
    }
    const items = this.items(layer).filter((e) => e !== cur);
    const i = pickNext(box(cur), items.map(box), d);
    if (i >= 0) this.focus(items[i]);
    else if (d === 'up' || d === 'down') {
      // Nada más en esa dirección: scroll para ver lo que falte
      const sc = this.scroller(cur);
      if (sc) sc.scrollTop += d === 'down' ? 120 : -120;
    }
  }

  private cycle(sel: HTMLSelectElement, k: number): void {
    const opts = [...sel.options];
    for (let i = sel.selectedIndex + k; i >= 0 && i < opts.length; i += k) {
      if (opts[i].disabled) continue;
      sel.selectedIndex = i;
      return this.changed(sel);
    }
  }

  private changed(el: HTMLElement): void {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  private activate(el: HTMLElement): void {
    if (el instanceof HTMLSelectElement) {
      // No se puede abrir la lista nativa: A pasa a la siguiente opción (y vuelve a la primera)
      const before = el.selectedIndex;
      this.cycle(el, 1);
      if (el.selectedIndex === before) {
        el.selectedIndex = [...el.options].findIndex((o) => !o.disabled);
        this.changed(el);
      }
      return;
    }
    if (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'file', 'color'].includes(el.type)) return el.focus();
    el.click();
  }

  private back(layer: HTMLElement): void {
    for (const sel of BACK) {
      const el = layer.querySelector<HTMLElement>(sel);
      if (el && visible(el)) return el.click();
    }
  }

  /** LB/RB: la pestaña anterior/siguiente (Scouting, tablas del torneo). */
  private tab(layer: HTMLElement, k: number): void {
    const group = layer.querySelector<HTMLElement>('.seg.tabs, [data-tabs]');
    if (!group) return;
    const tabs = [...group.querySelectorAll<HTMLElement>('button')];
    const i = tabs.findIndex((b) => b.classList.contains('on'));
    const next = tabs[(i + k + tabs.length) % tabs.length];
    if (!next) return;
    this.lastKey = keyOf(next);
    next.click();
  }

  private scroller(el: HTMLElement): HTMLElement | null {
    for (let e: HTMLElement | null = el; e; e = e.parentElement) {
      const oy = getComputedStyle(e).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && e.scrollHeight > e.clientHeight + 1) return e;
    }
    return null;
  }
}
