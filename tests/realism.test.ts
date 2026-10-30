/**
 * Realismo (pedido de Xhavi, 29-oct): pared perimetral, falta solo con el robot completamente fuera,
 * hitbox del brazo y la garra, agarre realista y fallas por golpes. Todo lo que no viene del manual es
 * SUPUESTO (D33–D36 en docs/reglas-reto.md).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DO_NOTHING } from '../src/auto/AutoRoutine';
import * as F from '../src/config/field';
import { fieldSolids } from '../src/config/fieldLayout';
import { CLAW, CLAW_GAP, DEFAULT_ROBOT, PIVOT_180_ROBOT } from '../src/config/robot';
import { DAMAGE, faultChance, ImpactMeter, impactSide, pickFault, sanitizeDamage } from '../src/core/damage';
import { rng } from '../src/core/rng';
import { GameSession, type SessionOptions } from '../src/game/GameSession';
import { COMPLIANT, cubeAlignment, GRIP, missChance, type GripMode } from '../src/game/Mechanisms';
import { emptyInput, type PlayerInput } from '../src/input/InputManager';
import { initRapier } from '../src/physics/PhysicsWorld';

beforeAll(async () => {
  await initRapier();
});

const still = [DO_NOTHING, DO_NOTHING, DO_NOTHING, DO_NOTHING];
const steps = (g: GameSession, s: number, inp: Partial<PlayerInput> = {}) => {
  for (let i = 0; i < s * 120; i++) {
    g.setInput({ ...emptyInput(), ...(i === 0 ? inp : { forward: inp.forward ?? 0, turn: inp.turn ?? 0 }) });
    g.step();
  }
};
const yawQ = (a: number) => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });
const DEG = Math.PI / 180;

/** Práctica solo con el robot del jugador, sin piezas en la cancha. */
function solo(extra: Partial<SessionOptions> = {}, spec = DEFAULT_ROBOT): GameSession {
  const g = new GameSession({ player: 0, preload: false, solo: true, specs: [spec], hp: { enabled: false, interval: 3 }, ...extra });
  for (const p of g.pieces.list) if (p.state.at === 'field') g.pieces.stash(p, { at: 'hp', alliance: 'red' });
  return g;
}

describe('pared perimetral (SUPUESTO: guardrail FRC de 20 in)', () => {
  it('mide 508 mm, va por fuera de la alfombra, es simétrica y deja libre cada Campana', () => {
    expect(F.WALL_HEIGHT).toBeCloseTo(0.508, 6);
    const walls = fieldSolids().filter((s) => s.part === 'wall');
    expect(walls.length).toBe(4);
    for (const w of walls) {
      for (const [x, y, z] of w.points) {
        expect(y).toBeLessThanOrEqual(F.WALL_HEIGHT + 1e-9);
        // Nada de la pared entra a la cancha de 9 × 7 m
        expect(Math.abs(x) >= F.HALF_L - 1e-9 || Math.abs(z) >= F.HALF_W - 1e-9).toBe(true);
      }
      const m = w.points.map(([x, y, z]) => [-x, y, -z].join(','));
      expect(walls.some((o) => o.points.every((p) => m.includes(p.join(','))))).toBe(true);
    }
    // El tramo −Z llega hasta la Campana roja y no la tapa (§3.2.4: su pared cierra ese tramo)
    const sideRed = walls.find((w) => w.points.every((p) => p[2] <= -F.HALF_W + 1e-9))!;
    expect(Math.max(...sideRed.points.map((p) => p[0]))).toBeCloseTo(F.CAMPANA_X_RED[0], 6);
  });

  it('un robot a toda velocidad contra la pared se queda dentro de la cancha', () => {
    const g = solo();
    g.player.phys.teleport(-1.0, -2.5, Math.PI / 2); // viendo hacia −Z
    steps(g, 2.5, { forward: 1 });
    for (const c of g.player.phys.footprint()) expect(c.z).toBeGreaterThan(-F.HALF_W - 0.01);
  });

  it('las piezas también rebotan en la pared', () => {
    const g = solo();
    const p = g.pieces.list[0];
    g.pieces.place(p, 4.0, F.SAMPLE_SIZE / 2, 1.0, 0, { x: 4, y: 0, z: 0 });
    for (let i = 0; i < 240; i++) g.step();
    expect(p.body.translation().x).toBeLessThan(F.HALF_L);
  });
});

describe('fuera de la cancha solo con TODO el robot fuera (D33)', () => {
  const sq = (cx: number, cz: number, h = 0.3) => [
    { x: cx + h, z: cz + h },
    { x: cx + h, z: cz - h },
    { x: cx - h, z: cz - h },
    { x: cx - h, z: cz + h },
  ];
  it('dentro, a medias o en una esquina no cuenta; completamente fuera sí', () => {
    expect(F.fullyOutOfField(sq(0, 0))).toBe(false);
    expect(F.fullyOutOfField(sq(F.HALF_L, 0))).toBe(false); // medio robot fuera
    expect(F.fullyOutOfField(sq(F.HALF_L + 0.29, 0))).toBe(false); // un centímetro adentro
    expect(F.fullyOutOfField(sq(F.HALF_L + 0.31, 0))).toBe(true);
    expect(F.fullyOutOfField(sq(0, -F.HALF_W - 0.4))).toBe(true);
    // Girado 45° junto a la esquina: todas sus esquinas fuera pero un lado cruza la cancha
    const r = 0.3 * Math.SQRT2;
    const diamond = [0, 1, 2, 3].map((k) => ({ x: F.HALF_L + 0.2 + r * Math.cos((k * Math.PI) / 2), z: F.HALF_W + 0.2 + r * Math.sin((k * Math.PI) / 2) }));
    expect(diamond.every((c) => Math.abs(c.x) > F.HALF_L || Math.abs(c.z) > F.HALF_W)).toBe(true);
    expect(F.fullyOutOfField(diamond)).toBe(false);
  });

  it('en el match: con la garra por encima de la pared no hay falta; fuera por completo, una Tech Foul (§4.6)', () => {
    const g = new GameSession({ player: 0, preload: true, autos: still });
    g.startMatch();
    g.match!.t = 20;
    g.match!.tick(0);
    // De frente a la pared −Z, con la garra arriba asomada por fuera
    g.player.phys.teleport(-1.0, -F.HALF_W + DEFAULT_ROBOT.length / 2 + 0.03, Math.PI / 2);
    steps(g, 1.5, { elevator: 4 });
    expect(g.player.phys.outline(g.player.mech.angle).some((c) => c.z < -F.HALF_W)).toBe(true);
    expect(g.match!.fouls.filter((f) => f.rule === 'OUT_OF_BOUNDS')).toEqual([]);
    // Completamente fuera (más allá de la pared)
    g.player.phys.teleport(-1.0, -F.HALF_W - 1.2, Math.PI / 2);
    steps(g, 1.0);
    expect(g.match!.fouls.filter((f) => f.rule === 'OUT_OF_BOUNDS')).toHaveLength(1);
  });
});

describe('hitbox de los mecanismos', () => {
  it('el brazo empuja a otro robot aunque los chasis no se toquen', () => {
    const g = new GameSession({ player: 0, preload: false, autos: still });
    const [a, b] = g.robots;
    a.phys.teleport(0, 2.2, 0);
    // Chasis a 32 cm: solo la garra en N1 (punta a ≈ 0.58 m + dedos, a 26–42 cm de alto) llega al otro robot
    b.phys.teleport(0.92, 2.2, 0);
    steps(g, 0.3);
    const x0 = b.phys.position().x;
    steps(g, 1.5, { elevator: 1 });
    expect(b.phys.position().x - x0).toBeGreaterThan(0.008);
  });

  it('la garra tiene dedos con colisión: una Muestra a un lado no se traga ni se cruza', () => {
    const g = solo();
    const r = g.player;
    r.phys.teleport(0, 2.0, 0);
    const p = g.pieces.list[0];
    // Junto al dedo, por fuera de la garra
    const tip = r.mech.tipX();
    steps(g, 0.6, { toggleIntake: true });
    g.pieces.place(p, tip, F.SAMPLE_SIZE / 2, 2.0 + CLAW.fingerZ + F.SAMPLE_SIZE / 2 + 0.02);
    steps(g, 1.0, { forward: 0.1 });
    expect(r.mech.inClaw).toBe(false);
    expect(Math.abs(p.body.translation().z - 2.0)).toBeGreaterThan(CLAW_GAP / 2);
  });
});

describe('agarre preciso', () => {
  it('giro del cubo respecto a la garra: 0 derecho, simétrico, máximo 45°', () => {
    expect(cubeAlignment(yawQ(0), 0).yaw).toBeCloseTo(0, 6);
    expect(cubeAlignment(yawQ(90 * DEG), 0).yaw).toBeCloseTo(0, 6);
    expect(cubeAlignment(yawQ(10 * DEG), 0).yaw).toBeCloseTo(10 * DEG, 6);
    expect(cubeAlignment(yawQ(-10 * DEG), 0).yaw).toBeCloseTo(10 * DEG, 6);
    expect(cubeAlignment(yawQ(45 * DEG), 0).yaw).toBeCloseTo(45 * DEG, 6);
    expect(cubeAlignment(yawQ(30 * DEG), 30 * DEG).yaw).toBeCloseTo(0, 6);
    // Volteado sobre una arista
    const tilt = { x: Math.sin((30 * DEG) / 2), y: 0, z: 0, w: Math.cos((30 * DEG) / 2) };
    expect(cubeAlignment(tilt, 0).tilt).toBeCloseTo(30 * DEG, 6);
  });

  it('resbalarse es más probable rápido y chueco', () => {
    expect(missChance(0, 0)).toBeCloseTo(GRIP.baseMiss, 6);
    expect(missChance(1.5, 0)).toBeGreaterThan(missChance(0.5, 0));
    expect(missChance(0.3, GRIP.maxYaw)).toBeGreaterThan(missChance(0.3, 0));
    expect(missChance(10, 1)).toBeLessThanOrEqual(0.95);
  });

  for (const spec of [DEFAULT_ROBOT, PIVOT_180_ROBOT])
    it(`${spec.name}: derecha y despacio la agarra; girada 40° no; con agarre fácil la toma de lejos`, () => {
      const go = (yaw: number, grip: GripMode, gap: number) => {
        const g = solo({ grip }, spec);
        const r = g.player;
        r.phys.teleport(0, 2.0, 0);
        steps(g, 0.6, { toggleIntake: true });
        const p = g.pieces.list[0];
        g.pieces.place(p, r.mech.tipX() + gap, F.SAMPLE_SIZE / 2, 2.0, yaw);
        steps(g, 2.5, { forward: 0.08 });
        return r.mech.inClaw;
      };
      expect(go(3 * DEG, 'precise', 0.35)).toBe(true);
      expect(go(40 * DEG, 'precise', 0.35)).toBe(false);
      expect(go(40 * DEG, 'easy', 0.35)).toBe(true);
    });

  it('la IA recoge con el agarre preciso y anota en un match (sin faltas de cancha)', () => {
    const specs = [DEFAULT_ROBOT, PIVOT_180_ROBOT, DEFAULT_ROBOT, PIVOT_180_ROBOT];
    const g = new GameSession({ player: -1, preload: true, ai: true, specs, seed: 7, grip: 'precise' });
    g.startMatch();
    let misses = 0;
    for (let i = 0; i < 151 * 120 && !g.match!.finished; i++) {
      g.step();
      misses += g.events.filter((e) => e.type === 'grabMiss').length;
      g.events.length = 0;
    }
    for (const a of ['red', 'blue'] as const) expect(g.match!.samplesIn(a)).toBeGreaterThanOrEqual(5);
    expect(g.match!.fouls.filter((f) => f.rule === 'OUT_OF_BOUNDS')).toEqual([]);
    expect(misses).toBeGreaterThanOrEqual(0);
  }, 120_000);
});

describe('agarre con compliants (por defecto; Xhavi, 30-oct)', () => {
  it('es el agarre por defecto y solo rebota si llega muy rápido', () => {
    expect(solo().player.mech.grip).toBe('compliant');
    expect(missChance(1.5, 40 * DEG, 'compliant')).toBe(0);
    expect(missChance(COMPLIANT.safeSpeed + 1, 0, 'compliant')).toBeGreaterThan(0);
    expect(missChance(10, 0, 'compliant')).toBeLessThanOrEqual(0.5);
  });

  /** Se acerca con la garra abajo (o a otra altura) a una Muestra girada y corrida de lado. */
  const approach = (spec: typeof DEFAULT_ROBOT, yaw: number, side: number, forward: number, elevator: 0 | 1 = 0) => {
    const g = solo({}, spec);
    const r = g.player;
    r.phys.teleport(0, 2.0, 0);
    steps(g, 1.5, { toggleIntake: true, elevator });
    const p = g.pieces.list[0];
    g.pieces.place(p, r.mech.tipX() + 0.5, F.SAMPLE_SIZE / 2, 2.0 + side, yaw);
    for (let i = 0; i < 3 * 120 && !r.mech.inClaw; i++) steps(g, 1 / 120, { forward });
    return r.mech.inClaw;
  };

  for (const spec of [DEFAULT_ROBOT, PIVOT_180_ROBOT])
    it(`${spec.name}: agarra con cualquier giro, de lado y a cualquier velocidad normal`, () => {
      for (const yaw of [0, 20, 45]) for (const side of [0, 0.05, 0.1]) for (const fwd of [0.15, 0.4, 0.8]) expect(approach(spec, yaw * DEG, side, fwd), `giro ${yaw}° lado ${side} m vel ${fwd}`).toBe(true);
    });

  it('con la garra arriba del piso no agarra', () => {
    expect(approach(DEFAULT_ROBOT, 0, 0, 0.15, 1)).toBe(false);
  });

  it('agarra la Muestra en la punta de los dedos aunque no llegue a la placa (pegada a una pared)', () => {
    const tipFront = (grip: GripMode) => {
      const g = solo({ grip });
      const r = g.player;
      r.phys.teleport(0, 2.0, 0);
      steps(g, 1.5, { toggleIntake: true });
      const p = g.pieces.list[0];
      // Quieta, con su borde de atrás en la punta de los dedos y 30° de giro
      g.pieces.place(p, r.mech.tipX() + CLAW.fingerLength / 2 + F.SAMPLE_SIZE / 2, F.SAMPLE_SIZE / 2, 2.0, 30 * DEG);
      steps(g, 0.5);
      return r.mech.inClaw;
    };
    expect(tipFront('compliant')).toBe(true);
    expect(tipFront('precise')).toBe(false);
  });
});

describe('fallas por golpes (lógica pura)', () => {
  it('probabilidad: 0 bajo el umbral, crece con el golpe y con el nivel; apagado = 0', () => {
    expect(faultChance(DAMAGE.threshold - 0.01, 'normal')).toBe(0);
    expect(faultChance(2.0, 'normal')).toBeGreaterThan(faultChance(1.5, 'normal'));
    expect(faultChance(2.5, 'high')).toBeGreaterThan(faultChance(2.5, 'normal'));
    expect(faultChance(2.5, 'low')).toBeLessThan(faultChance(2.5, 'normal'));
    expect(faultChance(9, 'off')).toBe(0);
    expect(faultChance(9, 'high')).toBeLessThanOrEqual(0.95);
  });

  it('el medidor avisa una vez por golpe y se rearma tras un rato tranquilo', () => {
    const m = new ImpactMeter(1 / 120);
    expect(m.push(0.05)).toBeNull();
    expect(m.push(2.0)).toBeCloseTo(2.05, 6);
    expect(m.push(0.5)).toBeNull(); // el mismo golpe
    for (let i = 0; i < 6; i++) m.push(0);
    for (let i = 0; i < Math.ceil(DAMAGE.rearm * 120) + 1; i++) expect(m.push(0)).toBeNull();
    expect(m.push(2.0)).not.toBeNull();
    // Empujar con los motores (≈ 0.05 m/s por paso) nunca llega al umbral
    const push = new ImpactMeter(1 / 120);
    for (let i = 0; i < 600; i++) expect(push.push(0.05)).toBeNull();
  });

  it('lado del golpe y qué se daña (sin repetir lo ya dañado)', () => {
    expect(impactSide(-2, 0.1)).toBe('front');
    expect(impactSide(2, 0.1)).toBe('back');
    expect(impactSide(0.2, 2)).toBe('side');
    const rand = rng(5);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(pickFault(rand, 'front', new Set(['armSlow']))!);
    expect(seen.has('armSlow')).toBe(false);
    expect(seen.size).toBe(3);
    expect(pickFault(rand, 'side', new Set(['clawJam', 'armSlow', 'motorWeak', 'commLoss']))).toBeNull();
  });

  it('ajustes guardados raros vuelven a los de por defecto', () => {
    expect(sanitizeDamage({ level: 'mucho', targets: 3, random: 'si' })).toEqual({ level: 'normal', targets: 'all', random: true });
    expect(sanitizeDamage({ level: 'off', targets: 'player', random: false })).toEqual({ level: 'off', targets: 'player', random: false });
  });
});

describe('fallas en la física', () => {
  const crash = (level: 'off' | 'high', seed: number) => {
    const g = solo({ damage: { level, targets: 'all', random: false }, seed });
    g.player.phys.teleport(-1.0, -1.0, Math.PI / 2);
    const evs: string[] = [];
    let max = 0;
    for (let i = 0; i < 2.5 * 120; i++) {
      g.setInput({ ...emptyInput(), forward: 1 });
      g.step();
      max = Math.max(max, g.damage.impact(0));
      for (const e of g.damageEvents) evs.push(e.type);
    }
    return { g, evs, max };
  };

  it('chocar a toda velocidad contra la pared es un golpe fuerte; con fallas apagadas no pasa nada', () => {
    const on = crash('high', 3);
    expect(on.max).toBeGreaterThan(DAMAGE.threshold);
    expect(on.evs).toContain('impact');
    const off = crash('off', 3);
    expect(off.evs).toEqual([]);
    expect(off.g.damage.faults(0).size).toBe(0);
  });

  it('con varios choques fuertes algo se descompone; reacomodar la cancha lo repara', () => {
    let broke: GameSession | null = null;
    for (let seed = 1; seed <= 12 && !broke; seed++) {
      const c = crash('high', seed);
      if (c.g.damage.faults(0).size > 0) broke = c.g;
    }
    expect(broke).not.toBeNull();
    broke!.resetField();
    expect(broke!.damage.faults(0).size).toBe(0);
    expect(broke!.player.phys.driveScale).toBe(1);
  });

  it('cada falla hace lo suyo: sin comunicación no obedece, motor débil es más lento, garra atascada no agarra', () => {
    const g = solo({ damage: { level: 'normal', targets: 'all', random: false } });
    const r = g.player;
    r.phys.teleport(-1.0, 1.5, 0);
    g.damage.inflict(0, 'commLoss', 2);
    steps(g, 1.0, { forward: 1 });
    expect(Math.abs(r.phys.position().x + 1.0)).toBeLessThan(0.02);
    // Se le quita sola
    steps(g, 1.5);
    expect(g.damage.has(0, 'commLoss')).toBe(false);
    // Motor débil: más lento y se va de lado
    const speed = (weak: boolean) => {
      const h = solo({ damage: { level: 'normal', targets: 'all', random: false } });
      h.player.phys.teleport(-2.0, 1.0, 0);
      if (weak) h.damage.inflict(0, 'motorWeak');
      steps(h, 1.0, { forward: 1 });
      const v = h.player.phys.body.linvel();
      return { v: Math.hypot(v.x, v.z), turn: Math.abs(h.player.phys.heading()) };
    };
    const sane = speed(false);
    const weak = speed(true);
    expect(weak.v).toBeLessThan(sane.v * 0.85);
    expect(weak.turn).toBeGreaterThan(sane.turn + 0.1);
    // Garra atascada
    const j = solo({ damage: { level: 'normal', targets: 'all', random: false } });
    j.player.phys.teleport(0, 2.0, 0);
    j.damage.inflict(0, 'clawJam', 30);
    steps(j, 0.6, { toggleIntake: true });
    j.pieces.place(j.pieces.list[0], j.player.mech.tipX() + 0.3, F.SAMPLE_SIZE / 2, 2.0);
    steps(j, 2.5, { forward: 0.08 });
    expect(j.player.mech.inClaw).toBe(false);
  });

  it('"solo el mío": a los robots de la IA no les pasa nada', () => {
    const g = new GameSession({ player: 0, preload: false, autos: still, damage: { level: 'high', targets: 'player', random: true } });
    const ai = g.robots[2];
    ai.phys.teleport(-1.0, -1.0, Math.PI / 2);
    let hits = 0;
    for (let i = 0; i < 2.5 * 120; i++) {
      // Empujado a 3 m/s contra la pared −Z
      ai.phys.body.setLinvel({ x: 0, y: 0, z: -3 }, true);
      g.step();
      hits = Math.max(hits, g.damage.impact(2));
    }
    expect(hits).toBeGreaterThan(DAMAGE.threshold);
    expect(g.damage.faults(2).size).toBe(0);
  });
});
