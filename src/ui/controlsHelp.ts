/** Ayuda de controles armada con la asignación actual (cambia al reasignar). Sin DOM: se prueba. */
import { keyLabel, padLabel, type Action, type Bindings } from '../input/bindings';
import { t, type Key } from './i18n';

/** Grupo de teclas y lo que hacen (el HUD los dibuja como `<kbd>`). */
export interface HelpItem {
  keys: string[];
  what: string;
}

/** Una acción: todas sus teclas; varias (p. ej. WASD): la primera de cada una. */
const keys = (b: Bindings, ...acts: Action[]) => acts.flatMap((a) => b.keys[a].slice(0, acts.length > 1 ? 1 : undefined).map(keyLabel));

/** Teclas principales para la barra de ayuda del HUD. */
export function keyboardHelp(b: Bindings): HelpItem[] {
  const elev = keys(b, 'elevator0', 'elevator1', 'elevator2', 'elevator3', 'elevator4');
  const items: HelpItem[] = [
    { keys: keys(b, 'forward', 'back', 'left', 'right'), what: t('help_drive') },
    { keys: keys(b, 'toggleIntake'), what: t('act_toggleIntake') },
    { keys: elev.length > 1 ? [elev[0], '–', elev[elev.length - 1]] : keys(b, 'elevatorUp', 'elevatorDown'), what: t('help_elevatorHelp') },
    { keys: keys(b, 'releaseSample'), what: t('act_releaseSample').toLowerCase() },
    { keys: keys(b, 'slow'), what: t('act_slow').toLowerCase() },
  ];
  return items.filter((i) => i.keys.length);
}

/** Línea de ayuda del control. */
export function padHelp(b: Bindings): string {
  const acts: Action[] = ['slow', 'toggleIntake', 'releaseSample', 'elevatorUp', 'elevatorDown', 'camera', 'pause'];
  const drive = b.padDrive === 'split' ? t('help_padSplit') : t('help_padLeft');
  return `${drive} · ${acts
    .filter((a) => b.pad[a].length)
    .map((a) => `${b.pad[a].map(padLabel).join('/')} ${t(`act_${a}` as Key).toLowerCase()}`)
    .join(' · ')}`;
}
