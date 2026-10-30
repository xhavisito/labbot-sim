import { beforeAll, describe, expect, it } from 'vitest';
import { DO_NOTHING } from '../src/auto/AutoRoutine';
import * as F from '../src/config/field';
import { armAngle, armTip, DEFAULT_ROBOT } from '../src/config/robot';
import { GameSession } from '../src/game/GameSession';
import { emptyInput, type PlayerInput } from '../src/input/InputManager';
import { initRapier } from '../src/physics/PhysicsWorld';

beforeAll(async () => {
  await initRapier();
});

const still = [DO_NOTHING, DO_NOTHING, DO_NOTHING, DO_NOTHING];
const session = (autos = still, player = 0) => new GameSession({ player, preload: true, autos });
const steps = (g: GameSession, s: number, inp: Partial<PlayerInput> = {}) => {
  for (let i = 0; i < s * 120; i++) {
    g.setInput({ ...emptyInput(), ...(i === 0 ? inp : { forward: inp.forward ?? 0, turn: inp.turn ?? 0 }) });
    g.step();
  }
};
/** Salta el reloj del match a `t` sin simular lo de en medio. */
const skipTo = (g: GameSession, t: number) => {
  g.match!.t = t;
  g.match!.tick(0);
};

describe('match completo en la física', () => {
  it('AUTO por defecto: los 4 robots salen de su zona → 5 c/u y RP de la línea (§4.4)', () => {
    const g = new GameSession({ player: 0, preload: true });
    g.startMatch();
    steps(g, 15.2);
    expect(g.match!.phase).toBe('TELEOP');
    for (const a of ['red', 'blue'] as const) expect(g.match!.breakdown(a).autoLine).toBe(10);
    // Nadie cruzó la línea central ni hizo faltas
    expect(g.match!.fouls).toEqual([]);
    skipTo(g, 149.9);
    steps(g, 0.2);
    expect(g.match!.finished).toBe(true);
    expect(g.match!.rankingPoints('red').autoLine).toBe(true);
  });

  it('en AUTO el jugador no controla su robot; en TELEOP sí', () => {
    const g = session();
    g.startMatch();
    const x0 = g.player.phys.position().x;
    steps(g, 1, { forward: 1 });
    expect(Math.abs(g.player.phys.position().x - x0)).toBeLessThan(0.02);
    skipTo(g, 16);
    steps(g, 0.5, { forward: 1 });
    expect(Math.abs(g.player.phys.position().x - x0)).toBeGreaterThan(0.3);
  });

  it('una Muestra que cae al Nivel 3 rojo vale 18 en AUTO y 15 en TELEOP (§4.4)', () => {
    const g = session();
    g.startMatch();
    const w = F.camaraWells()[3];
    const drop = () => {
      const p = g.pieces.hpStock('blue')[0];
      g.pieces.place(p, (w.x0 + w.x1) / 2, w.rim + 0.2, (w.z0 + w.z1) / 2);
      steps(g, 1.5);
    };
    drop();
    expect(g.match!.breakdown('red').samplesAuto).toBe(18);
    skipTo(g, 30);
    drop();
    expect(g.match!.breakdown('red').samplesTeleop).toBe(15);
    expect(g.match!.samplesIn('red')).toBe(2);
    expect(g.match!.score('blue')).toBe(0);
  });

  it('el robot que sube a la Plataforma antes del endgame recibe Tech Foul (8 al contrario, §4.6)', () => {
    const g = session();
    g.startMatch();
    skipTo(g, 30);
    g.player.phys.teleport(0.6, 0, Math.PI, F.PLATFORM_HEIGHT + 0.01);
    steps(g, 1);
    expect(g.match!.fouls.map((f) => f.rule)).toEqual(['PLATFORM_EARLY']);
    expect(g.match!.breakdown('blue').penalties).toBe(8);
  });

  it('al sonar la bocina: robot rojo en la Plataforma (10) y Muestra Crítica roja en la Repisa (15 + 1 RP)', () => {
    const g = session();
    g.startMatch();
    skipTo(g, 140);
    g.player.phys.teleport(0.6, 0, Math.PI, F.PLATFORM_HEIGHT + 0.01);
    const c = g.pieces.critical('red');
    g.pieces.place(c, 0, F.REPISA_TOP + F.CRITICAL_SIZE / 2 + 0.01, 0);
    steps(g, 10.2);
    const m = g.match!;
    expect(m.finished).toBe(true);
    expect(m.breakdown('red').platform).toBe(10);
    expect(m.breakdown('red').critical).toBe(15);
    expect(m.rankingPoints('red').critical).toBe(true);
    expect(m.breakdown('blue').platform).toBe(0);
    // En el endgame subir a la Plataforma no es falta
    expect(m.fouls).toEqual([]);
  });

  it('tomar la Muestra Crítica antes del endgame es Tech Foul (§4.6); en el endgame no', () => {
    const run = (t: number) => {
      const g = session();
      g.startMatch();
      skipTo(g, t);
      // Suelta la precarga (con algo en la garra no toma la Crítica)
      steps(g, 0.5, { releaseSample: true });
      const c = F.CRITICAL_HOLDER_RED;
      const a = DEFAULT_ROBOT.arm;
      g.player.phys.teleport(c.x, c.z + armTip(a, armAngle(a, DEFAULT_ROBOT.elevatorHeights[4])).x - 0.05, Math.PI / 2);
      steps(g, 1.5, { elevator: 4 });
      steps(g, 0.1, { toggleIntake: true });
      expect(g.player.mech.critical).not.toBeNull();
      return g.match!.fouls.map((f) => f.rule);
    };
    expect(run(60)).toEqual(['CRITICAL_EARLY']);
    expect(run(125)).toEqual([]);
  });

  it('un robot rival que tira la Muestra Crítica de la Repisa comete Tech Foul (§4.6, D21); el propio no', () => {
    const run = (player: number) => {
      const g = session(still, player);
      g.startMatch();
      skipTo(g, 130);
      // La Crítica roja sobresale de la Repisa hacia la plataforma roja
      const c = g.pieces.critical('red');
      g.pieces.place(c, 0.19, F.REPISA_TOP + F.CRITICAL_SIZE / 2 + 0.002, 0.1);
      steps(g, 0.5);
      expect(g.sensors.criticalOnRepisa('red')).toBe(true);
      // Un robot en la plataforma roja, pegado a la Repisa, la toca y la pieza sale volando hacia +Z
      g.player.phys.teleport(0.2 + DEFAULT_ROBOT.width / 2 + 0.005, 0.1, -Math.PI / 2, F.PLATFORM_HEIGHT + 0.01);
      steps(g, 0.3);
      c.body.setLinvel({ x: 0, y: 0.5, z: 3 }, true);
      steps(g, 1.5);
      expect(g.sensors.criticalOnRepisa('red')).toBe(false);
      return g.match!.fouls.filter((f) => f.rule === 'CRITICAL_KNOCK');
    };
    expect(run(2)).toEqual([expect.objectContaining({ offender: 'blue', robot: 2, kind: 'TECH' })]);
    expect(run(1)).toEqual([]);
  });

  it('el Human Player solo introduce Muestras en TELEOP y a lo más 10 (§3.2.4, §4.1.1)', () => {
    const g = session();
    g.startMatch();
    steps(g, 14);
    expect(g.hps.red.introduced).toBe(0);
    skipTo(g, 16);
    g.hps.red.interval = 0.2;
    // Barre lo que va saliendo para que la ranura quede libre
    for (let i = 0; i < 12 * 120; i++) {
      g.step();
      for (const p of g.pieces.list) {
        const t = p.body.translation();
        if (p.kind === 'sample' && p.state.at === 'field' && t.x > 2.4 && t.z < -2.5) g.pieces.place(p, 1.0, 0.08, -2.0 + (p.index % 5) * 0.2);
      }
    }
    expect(g.hps.red.introduced).toBe(F.HP_SAMPLES_PER_ALLIANCE);
    expect(g.pieces.hpStock('red')).toHaveLength(0);
  });

  it('chocar contra un robot rival es Foul para el que inicia el contacto (§4.5)', () => {
    const g = session();
    g.startMatch();
    skipTo(g, 20);
    // Robot rojo 0 en (0.5, −2.0) viendo hacia −X; robot azul 2 quieto en (−0.5, −2.0)
    g.player.phys.teleport(0.6, -1.9, Math.PI);
    g.robots[2].phys.teleport(-0.6, -1.9, 0);
    steps(g, 1.0, { forward: 0.5 });
    const fouls = g.match!.fouls;
    expect(fouls.length).toBeGreaterThanOrEqual(1);
    expect(fouls[0].rule).toBe('CONTACT');
    expect(fouls[0].offender).toBe('red');
    expect(fouls[0].robot).toBe(0);
  });

  it('empujar a un rival contra la Cámara más de 3 s es pinning (§4.5)', () => {
    const g = session();
    g.startMatch();
    skipTo(g, 20);
    // Azul 2 pegado a la Cámara roja; rojo 0 empujándolo hacia +Z
    const w = F.camaraWells()[2];
    const x = (w.x0 + w.x1) / 2;
    g.robots[2].phys.teleport(x, F.CAMARA_Z_RED[0] - 0.34, Math.PI / 2);
    g.player.phys.teleport(x, F.CAMARA_Z_RED[0] - 0.34 - 0.7, -Math.PI / 2);
    steps(g, 3.6, { forward: 0.6 });
    expect(g.match!.fouls.some((f) => f.rule === 'PIN' && f.offender === 'red')).toBe(true);
  });

  it('salir de los límites de la cancha es Tech Foul, una vez por salida y solo completamente fuera (§4.6, D33)', () => {
    const g = session();
    g.startMatch();
    skipTo(g, 20);
    g.player.phys.teleport(1.5, -3.0, Math.PI / 2); // viendo hacia −Z, cerca del límite
    steps(g, 1.5, { forward: 0.4 });
    // La pared perimetral lo detiene: no sale y no hay falta
    expect(g.match!.fouls.filter((f) => f.rule === 'OUT_OF_BOUNDS')).toEqual([]);
    // Del otro lado de la pared (completamente fuera): una falta, aunque siga ahí
    g.player.phys.teleport(1.5, -F.HALF_W - 1.2, Math.PI / 2);
    steps(g, 1.5);
    expect(g.match!.fouls.filter((f) => f.rule === 'OUT_OF_BOUNDS')).toHaveLength(1);
  });

  it('D5: con estar arriba de la rampa (sin tocar la alfombra) ya cuenta; con medio robot en la alfombra no', () => {
    const g = session();
    g.startMatch();
    skipTo(g, 149.5);
    g.robots[0].phys.teleport(1.5, 0.37, Math.PI, 0.16); // a media rampa roja
    g.robots[1].phys.teleport(2.2, -0.37, Math.PI, 0.05); // ruedas delanteras en la rampa, traseras en la alfombra
    steps(g, 0.7);
    expect(g.match!.finished).toBe(true);
    expect(g.match!.state.red.platformRobots).toBe(1);
    expect(g.match!.breakdown('red').platform).toBe(10);
  });
});

describe('práctica libre en solitario', () => {
  it('solo existe el robot del jugador y se maneja sin reloj', () => {
    const g = new GameSession({ player: 2, preload: true, solo: true });
    expect(g.robots.map((r) => r.index)).toEqual([2]);
    expect(g.player.index).toBe(2);
    expect(g.player.alliance).toBe('blue');
    expect(g.match).toBeNull();
    expect(g.playerEnabled()).toBe(true);
    const x0 = g.player.phys.position().x;
    steps(g, 1, { forward: 1 });
    // El azul empieza en −X y avanza hacia +X
    expect(g.player.phys.position().x).toBeGreaterThan(x0 + 0.5);
    g.resetField();
    expect(g.player.mech.stored.length).toBe(1);
  });

  it('una sesión solo no puede empezar un match', () => {
    const g = new GameSession({ player: 0, preload: true, solo: true });
    expect(() => g.startMatch()).toThrow();
  });
});

describe('práctica libre: Muestras sin límite y Cámaras con vacío', () => {
  const dropInWell = (g: GameSession, level: 1 | 2 | 3) => {
    const w = F.rectFor(g.player.alliance, F.camaraWells()[level]);
    const p = g.pieces.list.find((x) => x.kind === 'sample' && x.state.at === 'hp')!;
    g.pieces.place(p, (w.x0 + w.x1) / 2, F.SAMPLE_SIZE / 2 + 0.02, (w.z0 + w.z1) / 2);
    return p;
  };

  it('la Muestra anotada cuenta y el vacío la regresa a la reserva del HP', () => {
    const g = new GameSession({ player: 0, preload: true, solo: true, hp: { enabled: false, interval: 3 } });
    const stock0 = g.pieces.hpStock('red').length;
    const p = dropInWell(g, 1);
    steps(g, 0.3);
    expect(g.practiceCount.red).toBe(1);
    expect(p.state.at).toBe('field');
    steps(g, GameSession.SINK_DELAY);
    expect(p.state).toEqual({ at: 'hp', alliance: 'red' });
    expect(g.pieces.hpStock('red').length).toBe(stock0);
    // La misma pieza puede volver a anotarse
    dropInWell(g, 2);
    steps(g, 0.3);
    expect(g.practiceCount.red).toBe(2);
  });

  it('toda la reserva es del HP del jugador y nunca se acaba', () => {
    const g = new GameSession({ player: 2, preload: true, solo: true, hp: { enabled: true, interval: 1 } });
    expect(g.pieces.hpStock('red').length).toBe(0);
    const total = g.pieces.hpStock('blue').length;
    expect(total).toBeGreaterThan(F.HP_SAMPLES_PER_ALLIANCE);
    // Más Muestras que la reserva: cada una que entra a la Cámara regresa a la reserva
    for (let i = 0; i < total + 5; i++) {
      dropInWell(g, 3);
      steps(g, GameSession.SINK_DELAY + 0.3);
    }
    expect(g.practiceCount.blue).toBe(total + 5);
    expect(g.pieces.hpStock('blue').length).toBeGreaterThan(0);
  });

  it('en práctica el Human Player mete Muestras sin reloj', () => {
    const g = new GameSession({ player: 0, preload: true, solo: true, hp: { enabled: true, interval: 1 } });
    steps(g, 1.2);
    expect(g.hps.red.introduced).toBe(1);
  });
});
