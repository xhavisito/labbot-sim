/**
 * Entrada del jugador: teclado (y gamepad en el Hito 4) → acciones abstractas.
 * Manejo tipo "arcade": un eje adelante/atrás y un eje de giro (tanque, §7.2).
 */
import type { ElevatorPos } from '../config/robot';

export interface PlayerInput {
  /** −1…1 adelante/atrás. */
  forward: number;
  /** −1…1, + = girar a la izquierda (antihorario). */
  turn: number;
  /** Modo fino (mitad de velocidad). */
  slow: boolean;
  // Acciones de un solo disparo (se consumen en el cuadro)
  toggleIntake: boolean;
  elevator: ElevatorPos | null;
  releaseSample: boolean;
  grabCritical: boolean;
  releaseCritical: boolean;
}

export const emptyInput = (): PlayerInput => ({
  forward: 0,
  turn: 0,
  slow: false,
  toggleIntake: false,
  elevator: null,
  releaseSample: false,
  grabCritical: false,
  releaseCritical: false,
});

/** Teclas por defecto. */
export const KEYS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  slow: ['ShiftLeft', 'ShiftRight'],
  toggleIntake: ['Space'],
  releaseSample: ['KeyE'],
  grabCritical: ['KeyF'],
  releaseCritical: ['KeyR'],
  elevator: { Digit0: 0, Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4 } as Record<string, ElevatorPos>,
} as const;

export class InputManager {
  private down = new Set<string>();
  private pressed = new Set<string>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      this.down.add(e.code);
      this.pressed.add(e.code);
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.down.clear());
  }

  private held(codes: readonly string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  private hit(codes: readonly string[]): boolean {
    return codes.some((c) => this.pressed.has(c));
  }

  /** Lee el estado del cuadro y limpia las acciones de un disparo. */
  poll(): PlayerInput {
    const inp = emptyInput();
    inp.forward = (this.held(KEYS.forward) ? 1 : 0) - (this.held(KEYS.back) ? 1 : 0);
    inp.turn = (this.held(KEYS.left) ? 1 : 0) - (this.held(KEYS.right) ? 1 : 0);
    inp.slow = this.held(KEYS.slow);
    inp.toggleIntake = this.hit(KEYS.toggleIntake);
    inp.releaseSample = this.hit(KEYS.releaseSample);
    inp.grabCritical = this.hit(KEYS.grabCritical);
    inp.releaseCritical = this.hit(KEYS.releaseCritical);
    for (const [code, pos] of Object.entries(KEYS.elevator)) if (this.pressed.has(code)) inp.elevator = pos;
    this.pressed.clear();
    return inp;
  }
}
