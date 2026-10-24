/**
 * Entrada del jugador: teclado y gamepad (mapeo estándar) → acciones abstractas.
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

/** Botones del gamepad (mapeo "standard" del navegador). */
export const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, BACK: 8, START: 9, UP: 12, DOWN: 13 } as const;
const DEADZONE = 0.15;
const dz = (v: number): number => (Math.abs(v) < DEADZONE ? 0 : (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE));

export class InputManager {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private padPrev: boolean[] = [];
  /** Botones de sistema del gamepad en este cuadro (cámara, pausa). */
  padCamera = false;
  padPause = false;
  /** Elevador elegido con LB/RB (paso a paso). */
  private padElevator = 0;

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
    for (const [code, pos] of Object.entries(KEYS.elevator)) if (this.pressed.has(code)) {
      inp.elevator = pos;
      this.padElevator = pos;
    }
    this.pressed.clear();
    this.pollPad(inp);
    return inp;
  }

  /** Suma el primer gamepad conectado: stick izquierdo Y avanza, stick izquierdo X (o derecho X) gira. */
  private pollPad(inp: PlayerInput): void {
    this.padCamera = false;
    this.padPause = false;
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = [...pads].find((p) => p && p.connected);
    if (!pad) return;
    const ax = pad.axes;
    const fwd = -dz(ax[1] ?? 0);
    const turn = -dz(Math.abs(ax[2] ?? 0) > Math.abs(ax[0] ?? 0) ? (ax[2] ?? 0) : (ax[0] ?? 0));
    if (Math.abs(fwd) > Math.abs(inp.forward)) inp.forward = fwd;
    if (Math.abs(turn) > Math.abs(inp.turn)) inp.turn = turn;
    const now = pad.buttons.map((b) => b.pressed);
    const hit = (i: number) => !!now[i] && !this.padPrev[i];
    if (hit(PAD.A)) inp.toggleIntake = true;
    if (hit(PAD.B)) inp.releaseSample = true;
    if (hit(PAD.X)) inp.grabCritical = true;
    if (hit(PAD.Y)) inp.releaseCritical = true;
    if (hit(PAD.RB) || hit(PAD.UP)) inp.elevator = this.padElevator = Math.min(4, this.padElevator + 1) as ElevatorPos;
    if (hit(PAD.LB) || hit(PAD.DOWN)) inp.elevator = this.padElevator = Math.max(0, this.padElevator - 1) as ElevatorPos;
    this.padCamera = hit(PAD.BACK);
    this.padPause = hit(PAD.START);
    this.padPrev = now;
  }
}
