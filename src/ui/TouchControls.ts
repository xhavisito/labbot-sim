/**
 * Controles touch en pantalla: joystick virtual a la izquierda (avanzar/girar, como el stick del
 * control) y botones redondos a la derecha (estilo rebuilt-sim). Escriben en `InputManager.touch`;
 * el resto del juego no sabe de dónde vino la entrada. Cámara y pausa son los botones del HUD.
 */
import type { Action } from '../input/bindings';
import type { InputManager } from '../input/InputManager';
import { t, type Key } from './i18n';

const BUTTONS: Array<{ action: Action; label: Key | string; cls: string }> = [
  { action: 'toggleIntake', label: 'touchIntake', cls: 'b-intake' },
  { action: 'releaseSample', label: 'touchDrop', cls: 'b-drop' },
  { action: 'elevatorUp', label: '▲', cls: 'b-up' },
  { action: 'elevatorDown', label: '▼', cls: 'b-down' },
];

/** ¿El equipo es táctil? (pantalla de dedo, sin mouse fino) */
export const isTouchDevice = (): boolean =>
  typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window);

export class TouchControls {
  readonly root: HTMLElement;
  private stick: HTMLElement;
  private knob: HTMLElement;
  private stickId: number | null = null;
  private center = { x: 0, y: 0 };
  private radius = 60;

  private intake: HTMLElement;

  constructor(
    host: HTMLElement,
    private input: InputManager,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'touch';
    this.root.innerHTML = `
      <div class="stick"><div class="knob"></div><span>${t('touchStick')}</span></div>
      <div class="pad">${BUTTONS.map((b) => `<button class="tbtn ${b.cls}" data-a="${b.action}">${b.label.length <= 2 ? b.label : t(b.label as Key)}</button>`).join('')}</div>`;
    host.appendChild(this.root);
    this.stick = this.root.querySelector('.stick')!;
    this.knob = this.root.querySelector('.knob')!;
    this.stick.addEventListener('pointerdown', (e) => this.stickDown(e));
    this.stick.addEventListener('pointermove', (e) => this.stickMove(e));
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) this.stick.addEventListener(ev, (e) => this.stickUp(e));
    this.root.querySelectorAll<HTMLButtonElement>('[data-a]').forEach((b) =>
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.input.touch.pressed.add(b.dataset.a as Action);
        b.classList.add('on');
        setTimeout(() => b.classList.remove('on'), 150);
      }),
    );
    this.intake = this.root.querySelector('.b-intake')!;
    this.show(false);
  }

  /** Marca el botón del intake mientras está encendido. */
  setIntake(on: boolean): void {
    this.intake.classList.toggle('active', on);
  }

  show(v: boolean): void {
    this.root.style.display = v ? '' : 'none';
    if (!v) this.release();
  }

  private stickDown(e: PointerEvent): void {
    e.preventDefault();
    this.stickId = e.pointerId;
    this.stick.setPointerCapture(e.pointerId);
    const r = this.stick.getBoundingClientRect();
    this.center = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    this.radius = r.width / 2 - 10;
    this.stickMove(e);
  }

  private stickMove(e: PointerEvent): void {
    if (e.pointerId !== this.stickId) return;
    let dx = e.clientX - this.center.x;
    let dy = e.clientY - this.center.y;
    const d = Math.hypot(dx, dy);
    if (d > this.radius) {
      dx *= this.radius / d;
      dy *= this.radius / d;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const k = (v: number) => (Math.abs(v) < 0.12 ? 0 : v);
    // Arriba avanza; izquierda gira a la izquierda (+turn)
    this.input.touch.forward = k(-dy / this.radius);
    this.input.touch.turn = k(-dx / this.radius);
  }

  private stickUp(e: PointerEvent): void {
    if (e.pointerId !== this.stickId) return;
    this.release();
  }

  private release(): void {
    this.stickId = null;
    this.knob.style.transform = '';
    this.input.touch.forward = 0;
    this.input.touch.turn = 0;
  }
}
