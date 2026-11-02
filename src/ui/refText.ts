/** Textos de los avisos del árbitro (`core/refCalls.ts`): título, detalle con la sección del manual, y la frase de voz. */
import { RULES } from '../core/fouls';
import type { RefCall } from '../core/refCalls';
import { opponent } from '../core/types';
import { getLang, t } from './i18n';

export interface RefText {
  title: string;
  detail: string;
  section: string;
  voice: string;
  /** Clase del cartel: color de la falta, tarjeta o alianza. */
  cls: string;
}

const robots = (n: number) => (n === 1 ? t('ref_robots1') : t('ref_robotsN', { n }));

export function refText(c: RefCall): RefText {
  const alliance = t(c.alliance);
  switch (c.kind) {
    case 'foul':
    case 'tech': {
      const kind = c.kind === 'tech' ? 'Tech Foul' : 'Foul';
      const robot = (c.robot % 2) + 1;
      const other = t(opponent(c.alliance));
      return {
        title: kind.toUpperCase(),
        detail: t('ref_foulDetail', { alliance, robot, rule: RULES[c.rule].es, points: c.points, other }),
        section: c.section,
        voice: t('refv_foul', { kind, alliance, robot, points: c.points, other }),
        cls: c.kind === 'tech' ? 'ref-tech' : 'ref-foul',
      };
    }
    case 'yellow':
    case 'red': {
      const robot = (c.robot % 2) + 1;
      const type = c.kind === 'red' ? 'Red' : 'Yellow';
      return {
        title: `${type.toUpperCase()} CARD`,
        detail: t(c.kind === 'red' ? 'ref_redDetail' : 'ref_yellowDetail', { alliance, robot, reason: c.reason }),
        section: c.section,
        voice: t('refv_card', { type, alliance, robot }),
        cls: c.kind === 'red' ? 'card-red' : 'card-yellow',
      };
    }
    case 'platform':
    case 'platformLost':
      return {
        title: t('ref_platformTitle'),
        detail: c.count === 0 ? t('ref_platformNone', { alliance }) : t('ref_platformDetail', { alliance, count: robots(c.count), points: c.points }),
        section: c.section,
        voice: c.count === 0 ? t('refv_platformNone', { alliance }) : t('refv_platform', { alliance, count: robots(c.count) }),
        cls: `${c.alliance}${c.kind === 'platformLost' ? ' ref-lost' : ''}`,
      };
    case 'critical':
    case 'criticalLost':
      return {
        title: t('ref_criticalTitle'),
        detail: c.kind === 'critical' ? t('ref_criticalDetail', { alliance, points: c.points }) : t('ref_criticalLost', { alliance }),
        section: c.section,
        voice: t(c.kind === 'critical' ? 'refv_critical' : 'refv_criticalLost', { alliance }),
        cls: `${c.alliance}${c.kind === 'criticalLost' ? ' ref-lost' : ''}`,
      };
  }
}

/** Idioma de la voz del árbitro. */
export const voiceLang = (): string => (getLang() === 'en' ? 'en-US' : 'es-MX');
