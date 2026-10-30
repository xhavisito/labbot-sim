/**
 * Entrada del jugador: teclado, gamepad (mapeo estándar) y controles touch → acciones abstractas.
 * Las teclas y botones se reasignan (`bindings.ts`). Manejo tipo "arcade": un eje adelante/atrás y
 * un eje de giro (tanque, §7.2).
 */
import type { ElevatorPos } from '../config/robot';
import { ACTIONS, loadBindings, type Action, type Bindings } from './bindings';

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
  /** Suelta lo que trae en la garra (Muestra o Crítica). */
  releaseSample: boolean;
}

export const emptyInput = (): PlayerInput => ({
  forward: 0,
  turn: 0,
  slow: false,
  toggleIntake: false,
  elevator: null,
  releaseSample: false,
});

/** Estado de los controles touch (lo escribe `ui/TouchControls`). */
export interface TouchState {
  forward: number;
  turn: number;
  /** Acciones tocadas desde el último cuadro. */
  pressed: Set<Action>;
}

const DEADZONE = 0.15;
const dz = (v: number): number => (Math.abs(v) < DEADZONE ? 0 : (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE));
const ELEVATOR_ACTIONS: Array<[Action, ElevatorPos]> = [
  ['elevator0', 0],
  ['elevator1', 1],
  ['elevator2', 2],
  ['elevator3', 3],
  ['elevator4', 4],
];

/** Lo que se capturó al reasignar: una tecla o un botón del control. */
export type Captured = { device: 'keys'; code: string } | { device: 'pad'; button: number } | null;

export class InputManager {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private padPrev: boolean[] = [];
  /** Cámara y pausa en este cuadro (teclado, control o touch). */
  camera = false;
  pause = false;
  /** Posición del elevador elegida con subir/bajar (paso a paso). */
  private elevatorPos = 0;
  readonly touch: TouchState = { forward: 0, turn: 0, pressed: new Set() };
  /** Esperando una tecla o botón para reasignar (lo maneja el menú de Controles). */
  private capture: ((c: Captured) => void) | null = null;

  constructor(
    public bindings: Bindings = loadBindings(),
    target: Window = window,
  ) {
    target.addEventListener('keydown', (e) => {
      if (this.capture) {
        e.preventDefault();
        const cb = this.capture;
        this.capture = null;
        // Esc cancela la captura (Esc no se puede asignar desde aquí; es la pausa por defecto)
        cb(e.code === 'Escape' ? null : { device: 'keys', code: e.code });
        return;
      }
      if (e.repeat) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT') return;
      this.down.add(e.code);
      this.pressed.add(e.code);
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.down.clear());
  }

  /** Espera la siguiente tecla o botón del control (para reasignar). `null` = cancelado. */
  captureNext(cb: (c: Captured) => void): void {
    this.capture = cb;
    this.padPrev = this.padButtons();
  }

  cancelCapture(): void {
    this.capture = null;
  }

  get capturing(): boolean {
    return this.capture !== null;
  }

  private held(a: Action): boolean {
    return this.bindings.keys[a].some((c) => this.down.has(c));
  }

  private hit(a: Action): boolean {
    return this.bindings.keys[a].some((c) => this.pressed.has(c));
  }

  private padButtons(): boolean[] {
    const pad = this.pad();
    return pad ? pad.buttons.map((b) => b.pressed) : [];
  }

  private pad(): Gamepad | null {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    return [...pads].find((p): p is Gamepad => !!p && p.connected) ?? null;
  }

  /** Lee el estado del cuadro y limpia las acciones de un disparo. */
  poll(): PlayerInput {
    const inp = emptyInput();
    const hit = new Set<Action>();
    if (this.capture) {
      this.pollCapture();
      this.pressed.clear();
      this.touch.pressed.clear();
      this.camera = this.pause = false;
      return inp;
    }
    inp.forward = (this.held('forward') ? 1 : 0) - (this.held('back') ? 1 : 0);
    inp.turn = (this.held('left') ? 1 : 0) - (this.held('right') ? 1 : 0);
    inp.slow = this.held('slow');
    for (const a of ACTIONS) if (this.hit(a)) hit.add(a);
    this.pressed.clear();
    this.pollPad(inp, hit);
    // Touch
    if (Math.abs(this.touch.forward) > Math.abs(inp.forward)) inp.forward = this.touch.forward;
    if (Math.abs(this.touch.turn) > Math.abs(inp.turn)) inp.turn = this.touch.turn;
    for (const a of this.touch.pressed) hit.add(a);
    this.touch.pressed.clear();

    inp.toggleIntake = hit.has('toggleIntake');
    inp.releaseSample = hit.has('releaseSample');
    for (const [a, pos] of ELEVATOR_ACTIONS) if (hit.has(a)) inp.elevator = this.elevatorPos = pos;
    if (hit.has('elevatorUp')) inp.elevator = this.elevatorPos = Math.min(4, this.elevatorPos + 1) as ElevatorPos;
    if (hit.has('elevatorDown')) inp.elevator = this.elevatorPos = Math.max(0, this.elevatorPos - 1) as ElevatorPos;
    this.camera = hit.has('camera');
    this.pause = hit.has('pause');
    return inp;
  }

  /** El primer botón que se acaba de presionar en el control termina la captura. */
  private pollCapture(): void {
    const now = this.padButtons();
    const i = now.findIndex((b, k) => b && !this.padPrev[k]);
    this.padPrev = now;
    if (i < 0 || !this.capture) return;
    const cb = this.capture;
    this.capture = null;
    cb({ device: 'pad', button: i });
  }

  /** Suma el primer gamepad conectado: ejes según `padDrive` y botones según la asignación. */
  private pollPad(inp: PlayerInput, hit: Set<Action>): void {
    const pad = this.pad();
    if (!pad) return;
    const b = this.bindings;
    const ax = pad.axes;
    const fwd = -dz(ax[1] ?? 0) * (b.invertForward ? -1 : 1);
    const turn = -dz(b.padDrive === 'split' ? (ax[2] ?? 0) : (ax[0] ?? 0));
    if (Math.abs(fwd) > Math.abs(inp.forward)) inp.forward = fwd;
    if (Math.abs(turn) > Math.abs(inp.turn)) inp.turn = turn;
    const now = pad.buttons.map((x) => x.pressed);
    const btn = (a: Action) => b.pad[a].some((i) => !!now[i] && !this.padPrev[i]);
    const hold = (a: Action) => b.pad[a].some((i) => !!now[i]);
    // Botones asignados a manejar (por ejemplo la cruceta) suman como las teclas
    const dpadF = (hold('forward') ? 1 : 0) - (hold('back') ? 1 : 0);
    const dpadT = (hold('left') ? 1 : 0) - (hold('right') ? 1 : 0);
    if (dpadF && !inp.forward) inp.forward = dpadF;
    if (dpadT && !inp.turn) inp.turn = dpadT;
    if (hold('slow')) inp.slow = true;
    for (const a of ACTIONS) if (btn(a)) hit.add(a);
    this.padPrev = now;
  }
}
