/** Textos de ayuda de controles armados con la asignación actual (cambian al reasignar). */
import { keyLabel, padLabel, type Action, type Bindings } from '../input/bindings';
import { t, type Key } from './i18n';

const keys = (b: Bindings, a: Action) => b.keys[a].map(keyLabel).join('/') || '–';
const pads = (b: Bindings, a: Action) => b.pad[a].map(padLabel).join('/') || '–';

/** Línea de ayuda del teclado. */
export function keyboardHelp(b: Bindings): string {
  const elev = (['elevator0', 'elevator1', 'elevator2', 'elevator3', 'elevator4'] as const).map((a) => keys(b, a)).join(' ');
  const parts: Array<[string, Action[] | string]> = [
    [`${keys(b, 'forward')} ${keys(b, 'back')}`, 'drive'],
    [`${keys(b, 'left')} ${keys(b, 'right')}`, 'turnHelp'],
    [keys(b, 'slow'), ['slow']],
    [keys(b, 'toggleIntake'), ['toggleIntake']],
    [elev, 'elevatorHelp'],
    [keys(b, 'releaseSample'), ['releaseSample']],
    [keys(b, 'grabCritical'), ['grabCritical']],
    [keys(b, 'releaseCritical'), ['releaseCritical']],
    [keys(b, 'camera'), ['camera']],
    [keys(b, 'pause'), ['pause']],
  ];
  return parts.map(([k, what]) => `${k} ${typeof what === 'string' ? t(`help_${what}` as Key) : t(`act_${what[0]}` as Key).toLowerCase()}`).join(' · ');
}

/** Línea de ayuda del control. */
export function padHelp(b: Bindings): string {
  const acts: Action[] = ['slow', 'toggleIntake', 'releaseSample', 'grabCritical', 'releaseCritical', 'elevatorUp', 'elevatorDown', 'camera', 'pause'];
  const drive = b.padDrive === 'split' ? t('help_padSplit') : t('help_padLeft');
  return `${t('gamepad')}: ${drive} · ${acts.filter((a) => b.pad[a].length).map((a) => `${pads(b, a)} ${t(`act_${a}` as Key).toLowerCase()}`).join(' · ')}`;
}
