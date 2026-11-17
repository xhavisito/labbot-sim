/**
 * Auditoría continua contra el manual del reto. Ver `tests/manual/clauses.ts` (cláusulas con su cita
 * y su revisión) y `tests/manual/reference.ts` (marcador de referencia escrito directo del manual).
 *
 * Con el texto del manual (`npm run audit:manual -- "game manual copy 2026.pdf"`, o la variable
 * LABBOT_MANUAL_TXT) también revisa que cada cita siga en el manual; sin él esa parte se salta.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GAME } from '../src/config/game';
import { RULES, type RuleCode } from '../src/core/fouls';
import { Match } from '../src/core/match';
import { rng } from '../src/core/rng';
import { ALLIANCES, type Alliance, type Level } from '../src/core/types';
import { CLAUSES, until } from './manual/clauses';
import { referenceScore, type RefEvent } from './manual/reference';

/** Junta espacios y quita los caracteres invisibles que deja pdftotext. */
export const normalize = (s: string): string =>
  s
    .replace(/[​‌‍﻿]/g, '')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const manualPath = process.env.LABBOT_MANUAL_TXT ?? 'docs/manual.txt';
const manual = existsSync(manualPath) ? normalize(readFileSync(manualPath, 'utf8')) : null;
const reglas = readFileSync('docs/reglas-reto.md', 'utf8');
/** Los D que existen en docs/reglas-reto.md (filas de la tabla de dudas o resueltos en el texto). */
const knownD = new Set([...reglas.matchAll(/\bD(\d+)\b/g)].map((m) => `D${m[1]}`));

describe('cláusulas del manual', () => {
  for (const c of CLAUSES) it(`${c.section} · ${c.id}`, c.verify);

  it('los ids no se repiten y cada una trae sección y cita', () => {
    expect(new Set(CLAUSES.map((c) => c.id)).size).toBe(CLAUSES.length);
    for (const c of CLAUSES) {
      expect(c.section).toMatch(/^§\d/);
      expect([c.quote].flat().every((q) => q.length > 5)).toBe(true);
    }
  });

  it('cada SUPUESTO citado existe en docs/reglas-reto.md', () => {
    const cited = new Set([...CLAUSES.flatMap((c) => c.supuestos ?? []), ...Object.values(RULES).flatMap((r) => r.supuesto?.match(/D\d+/g) ?? [])]);
    for (const d of cited) expect(knownD.has(d), `${d} no está en docs/reglas-reto.md`).toBe(true);
  });

  it('todo número de config/game.ts tiene una cita del manual', () => {
    const leaves: string[] = [];
    const walk = (o: object, path: string) => {
      for (const [k, v] of Object.entries(o)) typeof v === 'object' ? walk(v, `${path}${k}.`) : leaves.push(path + k);
    };
    walk(GAME, '');
    const covered = new Set(CLAUSES.flatMap((c) => c.covers ?? []));
    expect(leaves.filter((l) => !covered.has(l))).toEqual([]);
  });

  it.skipIf(!manual)('cada cita sigue en el manual (si falla, el manual cambió: revisar la regla)', () => {
    const missing = CLAUSES.flatMap((c) => [c.quote].flat().filter((q) => !manual!.includes(normalize(q))).map((q) => `${c.section} ${c.id}: "${q}"`));
    expect(missing).toEqual([]);
  });
});

describe('catálogo de faltas (§4.5, §4.6)', () => {
  it('Foul = §4.5 y Tech Foul = §4.6; lo que el manual no clasifica lleva SUPUESTO', () => {
    for (const [code, r] of Object.entries(RULES)) {
      const want = r.kind === 'FOUL' ? '§4.5' : '§4.6';
      if (!r.section.includes(want)) expect(r.supuesto, `${code}: ${r.section} sin SUPUESTO`).toMatch(/D\d+/);
    }
  });
});

describe('marcador del sim = marcador del manual (matches al azar)', () => {
  const codes = Object.keys(RULES) as RuleCode[];
  const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

  function randomMatch(seed: number) {
    const r = rng(seed);
    const events: RefEvent[] = [];
    const robots: Record<Alliance, number[]> = { red: [0, 1], blue: [2, 3] };
    const n = Math.floor(r() * 40);
    for (let i = 0; i < n; i++) {
      // Algunos eventos justo en los bordes de AUTO / ENDGAME / bocina
      const t = r() < 0.15 ? pick(r, [0, 14.99, 15, 119.99, 120, 149.99]) : r() * 150;
      const alliance = pick(r, ALLIANCES);
      const k = r();
      if (k < 0.15) events.push({ t: Math.min(t, 16), type: 'autoLine', alliance, robot: pick(r, robots[alliance]) });
      else if (k < 0.8) events.push({ t, type: 'sample', alliance, level: pick(r, [1, 2, 3] as Level[]) });
      else if (k < 0.97) events.push({ t, type: 'foul', offender: alliance, tech: false });
      else events.push({ t, type: 'yellow', alliance, robot: pick(r, robots[alliance]) });
    }
    // Faltas: un código al azar del tipo pedido (Foul o Tech Foul)
    const foulCodes = events.map((e) => {
      if (e.type !== 'foul') return undefined;
      const code = pick(r, codes);
      e.tech = RULES[code].kind === 'TECH';
      return code;
    });
    const end = {
      platform: { red: Math.floor(r() * 3), blue: Math.floor(r() * 3) },
      critical: { red: r() < 0.4, blue: r() < 0.4 },
    };
    return { events, foulCodes, end };
  }

  it('300 matches: mismos puntos y RP por alianza', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const { events, foulCodes, end } = randomMatch(seed);
      const order = events.map((_, i) => i).sort((a, b) => events[a].t - events[b].t);
      const m = new Match(GAME);
      m.start();
      for (const i of order) {
        const e = events[i];
        until(m, e.t);
        if (e.type === 'autoLine') m.crossAutoLine(e.alliance, e.robot);
        else if (e.type === 'sample') m.scoreSample(e.alliance, e.level);
        else if (e.type === 'foul') m.foul(foulCodes[i]!, e.offender, 0);
        else m.card('YELLOW', e.robot, e.alliance, 'prueba');
      }
      until(m, 150);
      m.finish(end.platform, end.critical);
      const ref = referenceScore(
        order.map((i) => events[i]),
        end,
      );
      for (const a of ALLIANCES) {
        expect(m.score(a), `semilla ${seed}, ${a}: puntos`).toBe(ref.score[a]);
        expect(m.rankingPoints(a).total, `semilla ${seed}, ${a}: RP`).toBe(ref.rp[a]);
      }
    }
  });
});
