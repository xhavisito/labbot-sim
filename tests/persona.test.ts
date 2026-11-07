import { beforeAll, describe, expect, it } from 'vitest';
import { AI_LEVELS, AI_PROFILES } from '../src/ai/difficulty';
import { AI_PERSONAS, applyPersona, isPersona } from '../src/ai/persona';
import { COLLECT_HOME } from '../src/auto/AutoRoutine';
import { sanitizeSettings } from '../src/config/settings';
import { GameSession } from '../src/game/GameSession';
import { emptyInput } from '../src/input/InputManager';
import { initRapier } from '../src/physics/PhysicsWorld';

beforeAll(async () => {
  await initRapier();
});

describe('personalidades de la IA', () => {
  it('equilibrada no cambia el perfil y cada estilo cambia lo que dice', () => {
    for (const l of AI_LEVELS) {
      const b = AI_PROFILES[l];
      expect(applyPersona(b, 'balanced')).toBe(b);
      expect(applyPersona(b)).toBe(b);
      const ag = applyPersona(b, 'aggressive');
      const de = applyPersona(b, 'defensive');
      const fa = applyPersona(b, 'fast');
      expect(ag.steal).toBe(true);
      expect(de.steal).toBe(false);
      expect(de.climbMargin).toBeGreaterThan(ag.climbMargin);
      expect(de.speed).toBeLessThanOrEqual(b.speed);
      expect(fa.batch).toBeLessThanOrEqual(2);
      expect(ag.dockStage).toBeLessThan(de.dockStage);
      expect(ag.dockSpeed).toBeGreaterThan(de.dockSpeed);
      for (const p of [ag, de, fa]) {
        expect(p.speed).toBeGreaterThan(0);
        expect(p.speed).toBeLessThanOrEqual(1);
        expect(p.batch).toBeGreaterThanOrEqual(1);
        expect(p.sloppy).toBeGreaterThanOrEqual(0);
      }
      expect(b).toEqual(AI_PROFILES[l]); // no se modifica el original
    }
  });

  it('los ajustes guardados validan la personalidad', () => {
    expect(isPersona('fast')).toBe(true);
    expect(isPersona('x')).toBe(false);
    const s = sanitizeSettings({ match: { robots: [{ persona: 'aggressive' }, { persona: 'nope' }] }, practice: { persona: 'defensive' } }, []);
    expect(s.match.robots[0].persona).toBe('aggressive');
    expect(s.match.robots[1].persona).toBe('balanced');
    expect(s.practice.persona).toBe('defensive');
  });

  // Un match completo con cada personalidad en la alianza roja (la azul equilibrada): ninguna comete faltas
  // de cancha ni de contacto que la IA se fija en evitar (§4.5, §4.6)
  for (const persona of AI_PERSONAS) {
    it(`${persona}: juega un match completo y anota sin faltas de cancha`, () => {
      const bots = [{ persona }, { persona }, undefined, undefined];
      const g = new GameSession({ player: -1, preload: true, ai: true, autos: [COLLECT_HOME, COLLECT_HOME, COLLECT_HOME, COLLECT_HOME], bots, seed: 7 });
      g.startMatch();
      for (let i = 0; i < 151 * 120 && !g.match!.finished; i++) {
        g.setInput(emptyInput());
        g.step();
      }
      const m = g.match!;
      expect(m.finished).toBe(true);
      const b = m.breakdown('red');
      expect(b.samplesAuto + b.samplesTeleop).toBeGreaterThan(0);
      const redFouls = m.fouls.filter((f) => f.rule === 'OUT_OF_BOUNDS' || f.rule === 'AUTO_CENTER' || f.rule === 'CRITICAL_EARLY');
      expect(redFouls).toEqual([]);
      // Con la Cámara en la mitad rival hay más cruces junto a la Plataforma: se tolera un roce ocasional
      expect(m.fouls.filter((f) => f.rule === 'PLATFORM_EARLY').length).toBeLessThanOrEqual(2);
    }, 120_000);
  }
});
