/**
 * Barra de la pizarra táctica: colores, deshacer, borrar y "Listo". Los trazos se dibujan con el
 * puntero sobre la cancha (`pick` convierte la pantalla a la cancha) mientras el match está en pausa.
 */
import { BOARD_COLORS, BOARD_HEX, type Board, type BoardColor, type BoardPoint } from '../core/board';
import { t, type Key } from './i18n';

export interface BoardBarActions {
  /** Punto de la cancha bajo el puntero (null si no cae en ella). */
  pick: (clientX: number, clientY: number) => BoardPoint | null;
  /** La pizarra cambió (para redibujar). */
  changed: () => void;
  done: () => void;
}

export class BoardBar {
  readonly root: HTMLElement;
  private color: BoardColor = 'yellow';
  private drawing = false;
  private active = false;

  constructor(host: HTMLElement, canvas: HTMLElement, private board: Board, private act: BoardBarActions) {
    this.root = document.createElement('div');
    this.root.className = 'boardbar-wrap';
    this.root.style.display = 'none';
    host.appendChild(this.root);
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      const p = act.pick(e.clientX, e.clientY);
      if (!p) return;
      this.drawing = true;
      canvas.setPointerCapture(e.pointerId);
      board.begin(this.color, p);
      act.changed();
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.drawing) return;
      const p = act.pick(e.clientX, e.clientY);
      if (p) {
        board.extend(p);
        act.changed();
      }
    });
    const end = () => (this.drawing = false);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') this.undo();
      else if (e.code === 'Enter') act.done();
      else return;
      e.preventDefault();
    });
  }

  get isOpen(): boolean {
    return this.active;
  }

  show(on: boolean): void {
    this.active = on;
    this.drawing = false;
    this.root.style.display = on ? '' : 'none';
    if (on) this.render();
  }

  private undo(): void {
    this.board.undo();
    this.act.changed();
    this.render();
  }

  private render(): void {
    const hex = (c: BoardColor) => `#${BOARD_HEX[c].toString(16).padStart(6, '0')}`;
    this.root.innerHTML = `<div class="boardbar">
      <p class="bb-hint">${t('board_hint')}</p>
      <div class="bb-row">
        <div class="bb-colors">${BOARD_COLORS.map((c) => `<button class="bb-dot ${c === this.color ? 'on' : ''}" data-color="${c}" style="--c:${hex(c)}" title="${t(`board_${c}` as Key)}" aria-label="${t(`board_${c}` as Key)}"></button>`).join('')}</div>
        <button class="chipbtn" data-act="undo">${t('board_undo')}</button>
        <button class="chipbtn" data-act="clear">${t('board_clear')}</button>
        <button class="chipbtn on" data-act="done">${t('board_done')}</button>
      </div></div>`;
    this.root.querySelectorAll<HTMLElement>('[data-color]').forEach((el) =>
      el.addEventListener('click', () => {
        this.color = el.dataset.color as BoardColor;
        this.render();
      }),
    );
    this.root.querySelector('[data-act="undo"]')!.addEventListener('click', () => this.undo());
    this.root.querySelector('[data-act="clear"]')!.addEventListener('click', () => {
      this.board.clear();
      this.act.changed();
    });
    this.root.querySelector('[data-act="done"]')!.addEventListener('click', () => this.act.done());
  }
}
