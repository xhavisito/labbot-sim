import { beforeAll, describe, expect, it } from 'vitest';
import { segmentHitsRect } from '../src/ai/Bot';
import { COLLECT_HOME, LEAVE_ZONE, SCORE_PRELOAD } from '../src/auto/AutoRoutine';
import { GameSession } from '../src/game/GameSession';
import { emptyInput } from '../src/input/InputManager';
import { initRapier } from '../src/physics/PhysicsWorld';

beforeAll(async () => {
  await initRapier();
});

describe('segmentHitsRect (rodear la Plataforma)', () => {
  it('detecta cruces, toques y segmentos que no tocan', () => {
    expect(segmentHitsRect(-3, 0, 3, 0, 2, 1)).toBe(true); // atraviesa a lo largo
    expect(segmentHitsRect(0, -3, 0, 3, 2, 1)).toBe(true); // atraviesa a lo ancho
    expect(segmentHitsRect(-3, 2, 3, 2, 2, 1)).toBe(false); // pasa por un lado
    expect(segmentHitsRect(3, 3, 2.5, 0, 2, 1)).toBe(false); // se queda en el extremo
    expect(segmentHitsRect(-3, 1, 3, 1, 2, 1)).toBe(true); // roza el borde
    expect(segmentHitsRect(0.5, 0.2, 0.6, 0.3, 2, 1)).toBe(true); // completamente adentro
    expect(segmentHitsRect(3, 0, 3, 0, 2, 1)).toBe(false); // punto afuera
  });
});

/** Match completo de solo IA: el jugador no toca nada y su robot corre la rutina de AUTO. */
function aiMatch(player: number, autos = [SCORE_PRELOAD, SCORE_PRELOAD, SCORE_PRELOAD, SCORE_PRELOAD]) {
  const g = new GameSession({ player, preload: true, ai: true, autos });
  g.startMatch();
  for (let i = 0; i < 151 * 120 && !g.match!.finished; i++) {
    g.setInput(emptyInput());
    g.step();
  }
  return g;
}

describe('IA en un match completo', () => {
  it('anota en AUTO y TELEOP, sube a la Plataforma en el ENDGAME y no comete faltas de cancha', () => {
    const g = aiMatch(1);
    const m = g.match!;
    expect(m.finished).toBe(true);
    for (const a of ['red', 'blue'] as const) {
      const b = m.breakdown(a);
      expect(b.autoLine).toBe(10); // los 2 robots salen de la zona (D1)
      expect(b.samplesAuto).toBeGreaterThanOrEqual(18); // al menos una precarga al Nivel 3 (§4.4)
      expect(b.samplesTeleop).toBeGreaterThan(0);
    }
    // Azul tiene 2 robots de IA: los dos suben (20, no acumulable §4.4); rojo solo el de IA
    expect(m.breakdown('blue').platform).toBe(20);
    expect(m.breakdown('red').platform).toBe(10);
    const field = m.fouls.filter((f) => f.rule === 'PLATFORM_EARLY' || f.rule === 'OUT_OF_BOUNDS' || f.rule === 'AUTO_CENTER');
    expect(field).toEqual([]);
    // El registro tiene los cambios de fase y termina con 'end'
    expect(g.log.filter((e) => e.type === 'phase').map((e) => (e.type === 'phase' ? e.phase : ''))).toEqual(['AUTO', 'TELEOP', 'ENDGAME', 'DONE']);
    expect(g.log[g.log.length - 1].type).toBe('end');
  }, 120_000);

  it('otras rutinas de AUTO tampoco pisan la Plataforma ni salen de la cancha', () => {
    const m = aiMatch(2, [SCORE_PRELOAD, COLLECT_HOME, LEAVE_ZONE, COLLECT_HOME]).match!;
    const field = m.fouls.filter((f) => f.rule === 'PLATFORM_EARLY' || f.rule === 'OUT_OF_BOUNDS' || f.rule === 'AUTO_CENTER');
    expect(field).toEqual([]);
    expect(m.breakdown('red').samplesAuto).toBeGreaterThan(18);
  }, 120_000);
});
