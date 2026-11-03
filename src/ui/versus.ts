/**
 * Piezas sin DOM del modo 2 jugadores (se prueban en `tests/versusUi.test.ts`): quién va en cada
 * estación, el resultado contado para las dos personas y la ayuda de controles de cada dispositivo.
 * SUPUESTO del simulador: el manual no habla de controles ni de equipos de dos personas.
 */
import type { Alliance } from '../core/types';
import type { VersusDevice } from '../config/settings';
import { ACTIONS, keyLabel, padLabel, type Action, type Bindings } from '../input/bindings';
import { keyboardHelp, type HelpItem } from './controlsHelp';
import { t, type Key } from './i18n';

export type VsTeam = 'opp' | 'same';
/** Quién maneja cada robot: jugador 1, jugador 2 o la IA. */
export type VsRole = 'p1' | 'p2' | 'ai';

/** Estación del jugador 2 según el equipo: la contraria (+2) o la compañera de la misma alianza. */
export function partnerStation(player: number, team: VsTeam): number {
  return team === 'opp' ? (player + 2) % 4 : player ^ 1;
}

/** Quién va en cada estación (índices 0–1 rojo, 2–3 azul). */
export function lineup(player: number, team: VsTeam): VsRole[] {
  const p2 = partnerStation(player, team);
  return [0, 1, 2, 3].map((i) => (i === player ? 'p1' : i === p2 ? 'p2' : 'ai'));
}

/** Intercambiar lugares: el jugador 1 pasa a la estación del 2 (y el 2 queda donde estaba el 1). */
export const swapStations = (player: number, team: VsTeam): number => partnerStation(player, team);

export const allianceOf = (station: number): Alliance => (station < 2 ? 'red' : 'blue');

/** Dos personas no pueden usar el mismo teclado ni el mismo control; el touch sí (cada quien su mitad). */
export const devicesClash = (a: VersusDevice, b: VersusDevice): boolean => a === b && a !== 'touch';

/**
 * Resultado para las dos personas: contra = gana el jugador 1, el 2 o empate; mismo equipo = ganaron
 * o perdieron juntos (o empate).
 */
export type VsOutcome = 'p1' | 'p2' | 'tie' | 'win' | 'loss';
export function versusOutcome(winner: Alliance | null, player: number, team: VsTeam): VsOutcome {
  if (!winner) return 'tie';
  const a1 = allianceOf(player);
  if (team === 'same') return winner === a1 ? 'win' : 'loss';
  return winner === a1 ? 'p1' : 'p2';
}

/** Nombre corto de una estación: "Azul 1". */
export const stationName = (i: number): string => `${t(allianceOf(i))} ${(i % 2) + 1}`;

/** Ícono y nombre de cada dispositivo para las tarjetas. */
export const DEVICE_LABEL: Record<VersusDevice, { name: Key; hint: Key }> = {
  keys1: { name: 'vs_dev_keys1', hint: 'vs_devh_keys1' },
  keys2: { name: 'vs_dev_keys2', hint: 'vs_devh_keys2' },
  pad1: { name: 'vs_dev_pad1', hint: 'vs_devh_pad' },
  pad2: { name: 'vs_dev_pad2', hint: 'vs_devh_pad' },
  touch: { name: 'vs_dev_touch', hint: 'vs_devh_touch' },
};

/** Tecla con su código (`data-code`): la pantalla de preparación la ilumina al presionarla. */
export interface KeyCap {
  label: string;
  code?: string;
}
export interface DeviceHelpRow {
  keys: KeyCap[];
  what: string;
}

/**
 * Ayuda de controles de un dispositivo: con teclado, sus teclas reales (las de los ajustes para WASD,
 * las fijas de flechas); con control, los botones asignados; con touch, los botones en pantalla.
 */
export function deviceHelp(dev: VersusDevice, keys: Partial<Record<Action, string[]>>, b: Bindings): DeviceHelpRow[] {
  if (dev === 'keys1' || dev === 'keys2') {
    const full = Object.fromEntries(ACTIONS.map((a) => [a, keys[a] ?? []])) as Record<Action, string[]>;
    // Las etiquetas salen de keyboardHelp; los códigos, del mismo orden (primera tecla de cada acción)
    const codeOf = new Map<string, string>();
    for (const a of ACTIONS) for (const c of full[a]) if (!codeOf.has(keyLabel(c))) codeOf.set(keyLabel(c), c);
    return keyboardHelp({ ...b, keys: full }).map((h: HelpItem) => ({
      keys: h.keys.map((l) => (l === '–' ? { label: l } : { label: l, code: codeOf.get(l) })),
      what: h.what,
    }));
  }
  if (dev === 'touch')
    return [
      { keys: [{ label: t('touchStick') }], what: t('help_drive') },
      { keys: [{ label: t('touchIntake') }], what: t('act_intake') },
      { keys: [{ label: '▲' }, { label: '▼' }], what: t('help_elevatorHelp') },
      { keys: [{ label: t('touchDrop') }], what: t('act_releaseSample').toLowerCase() },
    ];
  const pad = (a: Action) => b.pad[a].map((i) => ({ label: padLabel(i) }));
  const rows: DeviceHelpRow[] = [
    { keys: [{ label: b.padDrive === 'split' ? t('vs_padSticks') : t('vs_padStick') }], what: t('help_drive') },
    { keys: pad('intake'), what: t('act_intake') },
    { keys: [...pad('elevatorUp'), ...pad('elevatorDown')], what: t('help_elevatorHelp') },
    { keys: pad('releaseSample'), what: t('act_releaseSample').toLowerCase() },
    { keys: pad('slow'), what: t('act_slow').toLowerCase() },
  ];
  return rows.filter((r) => r.keys.length);
}

/** Todos los códigos de tecla de un dispositivo (para saber que esa persona ya está presionando). */
export const deviceCodes = (keys: Partial<Record<Action, string[]>>): Set<string> => new Set(Object.values(keys).flat());
