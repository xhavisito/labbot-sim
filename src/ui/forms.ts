/** Helpers de formularios para las pantallas (HTML + enlace de eventos). */

export interface Opt {
  value: string;
  label: string;
  cls?: string;
}

export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Botones segmentados (como radio). */
export function seg(name: string, opts: Opt[], current: string): string {
  return `<div class="seg" data-seg="${name}">${opts
    .map((o) => `<button type="button" data-v="${esc(o.value)}" class="${o.cls ?? ''} ${o.value === current ? 'on' : ''}">${esc(o.label)}</button>`)
    .join('')}</div>`;
}

export function select(name: string, opts: Opt[], current: string): string {
  return `<select data-sel="${name}">${opts
    .map((o) => `<option value="${esc(o.value)}" ${o.value === current ? 'selected' : ''}>${esc(o.label)}</option>`)
    .join('')}</select>`;
}

/** Enlaza los controles de un contenedor; `on(name, value)` recibe el valor como string/number. */
export function bind(root: HTMLElement, on: (name: string, value: string | number) => void): void {
  root.querySelectorAll<HTMLElement>('[data-seg]').forEach((g) => {
    g.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
      b.addEventListener('click', () => {
        g.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        on(g.dataset.seg!, b.dataset.v!);
      }),
    );
  });
  root.querySelectorAll<HTMLSelectElement>('[data-sel]').forEach((s) => s.addEventListener('change', () => on(s.dataset.sel!, s.value)));
}
