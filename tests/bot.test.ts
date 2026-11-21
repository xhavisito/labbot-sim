import { beforeAll, describe, expect, it } from 'vitest';
import { segmentHitsRect, type Bot } from '../src/ai/Bot';
import { Team } from '../src/ai/Team';
import * as F from '../src/config/field';
import { ROBOT_PRESETS } from '../src/config/robot';
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
    expect(m.breakdown('blue').platform).toBeGreaterThanOrEqual(10); // (la Cámara está lejos de su rampa: no siempre suben los 2)
    expect(m.breakdown('red').platform).toBe(10);
    const field = m.fouls.filter((f) => f.rule === 'PLATFORM_EARLY' || f.rule === 'OUT_OF_BOUNDS' || f.rule === 'AUTO_CENTER');
    expect(field).toEqual([]);
    // El registro tiene los cambios de fase y termina con 'end'
    expect(g.log.filter((e) => e.type === 'phase').map((e) => (e.type === 'phase' ? e.phase : ''))).toEqual(['AUTO', 'TELEOP', 'ENDGAME', 'DONE']);
    expect(g.log[g.log.length - 1].type).toBe('end');
  }, 120_000);

  it('otras rutinas de AUTO tampoco pisan la Plataforma ni salen de la cancha', () => {
    const m = aiMatch(2, [SCORE_PRELOAD, COLLECT_HOME, LEAVE_ZONE, COLLECT_HOME]).match!;
    // El robot 2 es el del jugador: sale de la zona y se queda parado junto a la rampa todo el match,
    // así que un robot que pasa por el pasillo de atrás puede arrimarlo; aquí cuentan los de la IA
    const field = m.fouls.filter((f) => f.robot !== 2 && (f.rule === 'PLATFORM_EARLY' || f.rule === 'OUT_OF_BOUNDS' || f.rule === 'AUTO_CENTER'));
    expect(field).toEqual([]);
    expect(m.breakdown('red').samplesAuto).toBeGreaterThanOrEqual(18); // la Cámara está en la mitad rival: en 15 s alcanza para la precarga
  }, 120_000);
});

/** Bot mínimo para probar el reparto de papeles del Team (solo lo que lee `plan`). */
const stubBot = (index: number, kind: keyof typeof ROBOT_PRESETS): Bot =>
  ({ robot: { index, spec: ROBOT_PRESETS[kind] }, opts: { role: 'score' }, profile: { critical: true, teamwork: true } }) as unknown as Bot;

describe('Team: quién lleva la Muestra Crítica', () => {
  it('con pivote y elevador, la lleva el pivote (el elevador fallaba más al soltarla)', () => {
    const t = new Team('red');
    t.join(stubBot(0, 'elevator'));
    t.join(stubBot(1, 'pivot'));
    expect(t.critBy).toBe(1);
  });
  it('si solo hay un robot capaz, ese la lleva', () => {
    const t = new Team('red');
    t.join(stubBot(0, 'elevator'));
    expect(t.critBy).toBe(0);
  });
});

describe('IA en alianza y manejo humano', () => {
  it('Team.lane reparte franjas opuestas a dos robots que juntan, y ninguna a uno solo', () => {
    const mk = (index: number, teamwork = true) =>
      ({ robot: { index, spec: ROBOT_PRESETS.pivot }, opts: { role: 'score', teleop: true }, profile: { critical: true, teamwork } }) as unknown as Bot;
    const t = new Team('red');
    const a = mk(0);
    const b = mk(1);
    t.join(a);
    expect(t.lane(a)).toBe(0);
    t.join(b);
    expect(t.lane(a)).toBe(1);
    expect(t.lane(b)).toBe(-1);
  });

  it('el mando sube con rampa y frena más rápido (no pega el stick de golpe)', () => {
    const g = new GameSession({ player: 0, preload: true, ai: true });
    g.startMatch();
    const bot = g.bots.find((b) => b) as unknown as { humanize(o: object, dt: number): void; profile: { ramp: number } };
    const dt = 1 / 120;
    const out = { forward: 1, turn: 0, intake: false, elevator: 0, release: false };
    const run = (n: number, want: number) => {
      for (let i = 0; i < n; i++) {
        out.forward = want;
        bot.humanize(out, dt);
      }
      return out.forward;
    };
    // Tras la mitad de la rampa va a medias; tras la rampa completa, al tope
    const half = run(Math.round((bot.profile.ramp / 2) * 120), 1);
    expect(half).toBeGreaterThan(0.3);
    expect(half).toBeLessThan(0.7);
    expect(run(Math.round(bot.profile.ramp * 120), 1)).toBeCloseTo(1, 1);
    // Frenar es ~3 veces más rápido que acelerar
    const brake = run(Math.round((bot.profile.ramp / 3) * 120) + 1, 0);
    expect(brake).toBeLessThan(0.05);
  });
});

describe('IA: sin vueltas a lo tonto en TELEOP', () => {
  it('ningún robot de IA se queda girando en su lugar más de 4 s seguidos mientras trabaja', () => {
    const g = new GameSession({ player: 3, preload: true, ai: true, autos: [SCORE_PRELOAD, COLLECT_HOME, SCORE_PRELOAD, COLLECT_HOME] });
    g.startMatch();
    const run = g.robots.map(() => 0);
    const longest = g.robots.map(() => 0);
    for (let i = 0; i < 151 * 120 && !g.match!.finished; i++) {
      g.setInput(emptyInput());
      g.step();
      const t = i / 120;
      if (t < 20 || t > 118) continue;
      g.robots.forEach((r, k) => {
        if (k === 3) return;
        const v = r.phys.body.linvel();
        const spinning = Math.hypot(v.x, v.z) < 0.05 && Math.abs(r.phys.body.angvel().y) > 1;
        run[k] = spinning ? run[k] + 1 : 0;
        longest[k] = Math.max(longest[k], run[k]);
      });
    }
    for (const l of longest) expect(l / 120).toBeLessThan(4);
    // Y el equipo sigue anotando con la Crítica y la Plataforma (§4.4)
    expect(g.match!.breakdown('red').critical).toBe(35);
  }, 240_000);
});

describe('IA: cambia de nivel cuando el preferido está tapado', () => {
  type Probe = { chooseLevel(): number | null; scoringPose(l: number): { x: number; z: number }; level: number };
  const setup = () => {
    const g = new GameSession({ player: 3, preload: true, ai: true });
    g.startMatch();
    g.setInput(emptyInput());
    for (let k = 0; k < 5; k++) g.step(); // para que el Bot conozca el reloj del match
    const i = g.robots.findIndex((r, k) => k !== 3 && r.alliance === 'red');
    const bot = g.bots[i] as unknown as Probe;
    return { g, bot, robot: g.robots[i] };
  };

  it('con el Nivel 3 lleno (Muestras a la altura de la apertura) elige otro nivel en vez de esperar', () => {
    const { g, bot, robot } = setup();
    robot.phys.teleport(0.5, 1.5, 0);
    expect(bot.chooseLevel()).toBe(bot.level);
    const w = F.camaraWells()[3];
    const rect = F.rectForCamara('red', w);
    const free = g.pieces.list.filter((p) => p.kind === 'sample' && p.state.at === 'field').slice(0, 3);
    free.forEach((p, k) => g.pieces.place(p, rect.x0 + 0.15 + k * 0.17, w.rim - 0.03, (rect.z0 + rect.z1) / 2));
    const l = bot.chooseLevel();
    expect(l).not.toBeNull();
    expect(l).not.toBe(3);
  });

  it('si se atora al arrimarse a un nivel (una Muestra en el piso), lo deja un rato y usa otro', () => {
    const { bot, robot } = setup();
    robot.phys.teleport(0.5, 1.5, 0);
    const first = bot.chooseLevel();
    (bot as unknown as { lastLevel: number; dockFails: number }).lastLevel = first as number;
    const probe = bot as unknown as { dockFails: number; robot: { mech: { stored: unknown[] } } };
    probe.robot.mech.stored.push({}); // trae una Muestra: los fallos cuentan
    probe.dockFails = 1;
    expect(bot.chooseLevel()).toBe(first); // un fallo no basta
    probe.dockFails = 1;
    const next = bot.chooseLevel();
    expect(next).not.toBeNull();
    expect(next).not.toBe(first);
  });
});
