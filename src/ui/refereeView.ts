/**
 * Árbitro virtual en los resultados: resumen del impacto de las faltas y cada falta con su regla (§),
 * puntos al contrario y efecto en el RP. Usa `core/refereeReport.ts`; sin lógica de reglas aquí.
 */
import type { RefereeReport } from '../core/refereeReport';
import { t } from './i18n';

const ALLS = ['blue', 'red'] as const;
const sign = (n: number) => (n > 0 ? `+${n}` : String(n));

export function refereeHtml(r: RefereeReport): string {
  if (r.clean) return `<ul class="fouls"><li class="none">${t('noFouls')}</li></ul>`;
  const who = (a: 'red' | 'blue', slot: number) => `<span class="tag ${a}">${t(a).toUpperCase()} ${slot}</span>`;
  const o = r.outcome;
  const name = (x: 'red' | 'blue' | 'tie') => (x === 'tie' ? t('tie') : `${t('winner')} ${t(x)}`);
  const verdict = o.decidedByFouls
    ? `<div class="ref-verdict decisive">${t('ref_decided', { a: name(o.actual), b: name(o.withoutFouls) })}</div>`
    : `<div class="ref-verdict">${t('ref_notDecided')}</div>`;
  const cols = ALLS.map((a) => {
    const s = r.alliances[a];
    return `<div class="ref-col ${a}"><b>${t(a)}</b>
      <span>${t('ref_committed', { n: s.committed, f: s.fouls, tf: s.techs })}</span>
      <span>${t('ref_given', { n: s.pointsGiven })}</span>
      <span>${t('ref_received', { n: s.pointsReceived })}</span>
      <span>${t('ref_withoutFouls', { s: s.scoreWithoutFouls, rp: s.rpWithoutFouls })} (${t('ref_now', { s: s.score, rp: s.rp })})</span>
      ${s.redCard ? `<span class="ref-red">✕ ${t('redCard')}: −${s.lostToRedCard} ${t('ref_pts')} · ${t('ref_rpWithout', { rp: s.rpWithoutRedCard })}</span>` : ''}
    </div>`;
  }).join('');
  const foulRows = r.fouls
    .map((f) => {
      const swing = (['blue', 'red'] as const).filter((a) => f.rpSwing[a] !== 0).map((a) => `${t(a)} ${sign(f.rpSwing[a])} RP`);
      return `<li>${who(f.offender, f.slot)}<b>${f.label}</b> · ${f.description}
        <em>${f.section} · ${f.clock} (${f.period})</em>
        <div class="ref-impact">${t('ref_impact', { n: f.points, a: t(f.beneficiary) })}${swing.length ? ` · ${swing.join(' · ')}` : ''}${f.decisive ? ` · <strong>${t('ref_decisive')}</strong>` : ''}${f.repeat > 0 ? ` · ${t('ref_repeat', { n: f.repeat + 1 })}` : ''}${f.supuesto ? ` · <i>${t('ref_assumed')} ${f.supuesto.split(':')[0]}</i>` : ''}</div></li>`;
    })
    .join('');
  const cardRows = r.cards
    .map((c) => `<li>${who(c.alliance, c.slot)}<b>${c.type} CARD</b> · ${c.reason}<em>${c.section} · ${c.clock}</em></li>`)
    .join('');
  return `<div class="ref-summary">${verdict}<div class="ref-cols">${cols}</div></div>
    <ul class="fouls ref-list">${foulRows}${cardRows}</ul>
    ${r.supuestos.length ? `<p class="ms-note">${t('ref_note', { ids: r.supuestos.join(', ') })}</p>` : ''}`;
}
