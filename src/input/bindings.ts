/**
 * Asignación de teclas y botones del control a acciones, reasignable desde el menú (Controles) y
 * guardada en el navegador. Puro: sin DOM (se prueba en tests/bindings.test.ts).
 */

/** Acciones que se pueden reasignar. Manejo: ejes del stick o las 4 teclas de dirección. */
export const ACTIONS = [
  'forward',
  'back',
  'left',
  'right',
  'slow',
  'intake',
  'releaseSample',
  'elevatorUp',
  'elevatorDown',
  'elevator0',
  'elevator1',
  'elevator2',
  'elevator3',
  'elevator4',
  'camera',
  'pause',
] as const;
export type Action = (typeof ACTIONS)[number];

/** Con qué stick se maneja: todo con el izquierdo, o izquierdo avanza y derecho gira. */
export type PadDrive = 'left' | 'split';

export interface Bindings {
  /** `KeyboardEvent.code` por acción (hasta 2). */
  keys: Record<Action, string[]>;
  /** Índices de botón del gamepad (mapeo "standard") por acción. */
  pad: Record<Action, number[]>;
  padDrive: PadDrive;
  /** Invertir el eje de avance del stick. */
  invertForward: boolean;
  /** Zona muerta de los sticks (0.05–0.5): sube si el stick se mueve solo, baja si cuesta moverlo. */
  padDeadzone: number;
}

/** Botones del mapeo "standard" del navegador. */
export const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;
export const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3', '↑', '↓', '←', '→', 'Home'];

export const DEFAULT_BINDINGS: Bindings = {
  keys: {
    forward: ['KeyW', 'ArrowUp'],
    back: ['KeyS', 'ArrowDown'],
    left: ['KeyJ', 'ArrowLeft'],
    right: ['KeyL', 'ArrowRight'],
    slow: ['ShiftRight'],
    intake: ['ShiftLeft'],
    releaseSample: ['KeyK'],
    elevatorUp: [],
    elevatorDown: [],
    elevator0: ['KeyU', 'Digit0'],
    elevator1: ['KeyI', 'Digit1'],
    elevator2: ['KeyO', 'Digit2'],
    elevator3: ['KeyP', 'Digit3'],
    elevator4: ['Semicolon', 'Digit4'],
    camera: ['KeyC'],
    pause: ['Escape'],
  },
  pad: {
    forward: [],
    back: [],
    left: [],
    right: [],
    slow: [PAD.LT],
    intake: [PAD.A],
    releaseSample: [PAD.B],
    elevatorUp: [PAD.RB, PAD.UP],
    elevatorDown: [PAD.LB, PAD.DOWN],
    elevator0: [],
    elevator1: [],
    elevator2: [],
    elevator3: [],
    elevator4: [],
    camera: [PAD.BACK],
    pause: [PAD.START],
  },
  padDrive: 'left',
  invertForward: false,
  padDeadzone: 0.15,
};

export const DEADZONE_RANGE = { min: 0.05, max: 0.5, step: 0.05 } as const;

/** Máximo de teclas o botones por acción. */
export const MAX_PER_ACTION = 2;

export const cloneBindings = (b: Bindings): Bindings => ({
  keys: Object.fromEntries(ACTIONS.map((a) => [a, [...b.keys[a]]])) as Bindings['keys'],
  pad: Object.fromEntries(ACTIONS.map((a) => [a, [...b.pad[a]]])) as Bindings['pad'],
  padDrive: b.padDrive,
  invertForward: b.invertForward,
  padDeadzone: b.padDeadzone,
});

/**
 * Asigna una tecla o botón a una acción: se lo quita a cualquier otra acción (así una tecla nunca
 * hace dos cosas) y, si la acción ya tenía el máximo, reemplaza el más viejo.
 */
export function assign<D extends 'keys' | 'pad'>(b: Bindings, device: D, action: Action, input: Bindings[D][Action][number]): Bindings {
  const out = cloneBindings(b);
  const table = out[device] as Record<Action, Array<string | number>>;
  for (const a of ACTIONS) table[a] = table[a].filter((x) => x !== input);
  const list = table[action];
  list.push(input);
  while (list.length > MAX_PER_ACTION) list.shift();
  return out;
}

/** Quita todas las teclas o botones de una acción. */
export function clearAction(b: Bindings, device: 'keys' | 'pad', action: Action): Bindings {
  const out = cloneBindings(b);
  out[device][action] = [];
  return out;
}

/** Asignación válida a partir de lo guardado (lo que falta o no sirve toma el valor por defecto). */
export function sanitizeBindings(raw: unknown): Bindings {
  const d = DEFAULT_BINDINGS;
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const keys = (o.keys && typeof o.keys === 'object' ? o.keys : {}) as Record<string, unknown>;
  const pad = (o.pad && typeof o.pad === 'object' ? o.pad : {}) as Record<string, unknown>;
  let out = cloneBindings(d);
  for (const a of ACTIONS) {
    // `intake` antes se llamaba `toggleIntake` (se prendía y apagaba; ahora se mantiene presionado)
    const k = keys[a] ?? (a === 'intake' ? keys.toggleIntake : undefined);
    if (Array.isArray(k) && k.every((x) => typeof x === 'string' && x.length > 0 && x.length < 40)) out.keys[a] = k.slice(0, MAX_PER_ACTION);
    const p = pad[a] ?? (a === 'intake' ? pad.toggleIntake : undefined);
    if (Array.isArray(p) && p.every((x) => Number.isInteger(x) && x >= 0 && x < 32)) out.pad[a] = p.slice(0, MAX_PER_ACTION);
  }
  // Sin repetidos entre acciones: se queda con la primera acción que lo tenga
  for (const dev of ['keys', 'pad'] as const) {
    const seen = new Set<string | number>();
    const table = out[dev] as Record<Action, Array<string | number>>;
    for (const a of ACTIONS) table[a] = table[a].filter((x) => (seen.has(x) ? false : (seen.add(x), true)));
  }
  out = { ...out, padDrive: o.padDrive === 'split' ? 'split' : 'left', invertForward: o.invertForward === true, padDeadzone: clampDeadzone(o.padDeadzone) };
  return out;
}

/** Zona muerta válida (lo guardado puede venir raro). */
export function clampDeadzone(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_BINDINGS.padDeadzone;
  return Math.round(Math.max(DEADZONE_RANGE.min, Math.min(DEADZONE_RANGE.max, v)) * 100) / 100;
}

const STORE = 'labbot.bindings';

export function loadBindings(): Bindings {
  try {
    return sanitizeBindings(JSON.parse(localStorage.getItem(STORE) ?? 'null'));
  } catch {
    return cloneBindings(DEFAULT_BINDINGS);
  }
}

export function saveBindings(b: Bindings): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(b));
  } catch {
    /* sin almacenamiento */
  }
}

/** Nombre corto de una tecla para mostrar ("KeyW" → "W", "ArrowUp" → "↑"). */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'NumpadDecimal') return 'Num .';
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  const named: Record<string, string> = {
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Space: 'Espacio',
    ShiftLeft: 'Shift izq.',
    ShiftRight: 'Shift der.',
    ControlLeft: 'Ctrl izq.',
    ControlRight: 'Ctrl der.',
    AltLeft: 'Alt izq.',
    AltRight: 'Alt der.',
    Escape: 'Esc',
    Enter: 'Enter',
    Tab: 'Tab',
    Backspace: 'Backspace',
    PageUp: 'RePág',
    PageDown: 'AvPág',
    // Signos: el símbolo en lugar del nombre en inglés ("Semicolon" → ";")
    Semicolon: ';',
    Period: '.',
    Comma: ',',
    Slash: '/',
    Quote: "'",
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Backquote: '`',
  };
  return named[code] ?? code;
}

export const padLabel = (i: number): string => PAD_NAMES[i] ?? `B${i}`;
