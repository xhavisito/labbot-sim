/**
 * Garra de la Crítica de Psycho ("Garrita" del CAD del 16-nov, `IntakeSpec.critClaw`): fija al chasis, aparte de la caja del brazo.
 * El CAD solo trae la pose abierta: el asiento, la ventana de agarre y el giro de los dedos son SUPUESTOS (ver `robots/psycho.robot.json`).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { COLLECT_HOME } from '../src/auto/AutoRoutine';
import { canHoldCritical, critSeat, intakeOf, posDir, posTip, validateRobot } from '../src/config/robot';
import { robotSpec } from '../src/config/robotIds';
import { CRITICAL_SIZE, REPISA_TOP } from '../src/config/field';
import { GameSession } from '../src/game/GameSession';
import { initRapier } from '../src/physics/PhysicsWorld';
import { runMatch, type AlliancePlan, type RobotPlan } from '../src/sim/batch';
import { analyzeStep } from '../src/cad/analyze';
import { parseStep } from '../src/cad/step';
import { buildStep } from './helpers/stepFixture';

beforeAll(async () => {
  await initRapier();
});

const spec = () => robotSpec('cad:psycho');

describe('Psycho: garra de la Crítica', () => {
  it('la lleva (ya no hay noCritical): asiento al frente, sobre la placa, dentro de los límites de §7.2', () => {
    const s = spec();
    const i = intakeOf(s);
    expect(i.noCritical).toBeUndefined();
    expect(canHoldCritical(s)).toBe(true);
    const seat = critSeat(s)!;
    expect(seat.x).toBeGreaterThan(s.length / 2 - 0.1); // sobresale del frente (+x, donde anota)
    expect(posDir(s, 4)).toBe(1);
    expect(posTip(s, 4)).toEqual({ x: seat.x, y: seat.bottom });
    // El cubo (20 cm) sobresale menos de 40 cm del chasis y no pasa de 100 cm de alto (§7.2)
    expect(seat.x + CRITICAL_SIZE / 2 - s.length / 2).toBeLessThan(0.4);
    expect(seat.bottom + CRITICAL_SIZE).toBeLessThan(1);
    expect(validateRobot(s).filter((p) => /Crítica/.test(p))).toEqual([]);
  });

  it('el CAD trae la placa y los dedos como hitbox, y los dedos tienen su eje vertical', () => {
    const s = spec();
    const names = (s.hitboxes ?? []).map((h) => h.name);
    for (const n of ['Garrita-Suelo', 'Garrita-Soporte', 'Garrita-Garrita', 'Flecha 10cm']) expect(names, n).toContain(n);
    expect(names.filter((n) => n === 'Garrita-Garrita')).toHaveLength(2);
    // La placa (Garrita-Suelo) llega al frente del chasis y su cara de arriba es la base del asiento
    const plate = s.hitboxes!.find((h) => h.name === 'Garrita-Suelo')!.pts;
    const xs = plate.filter((_, k) => k % 3 === 0);
    const ys = plate.filter((_, k) => k % 3 === 1);
    expect(Math.max(...xs)).toBeCloseTo(s.length / 2, 2);
    expect(Math.max(...ys)).toBeCloseTo(critSeat(s)!.bottom, 2);
    const cc = intakeOf(s).critClaw!;
    expect(cc.shafts).toHaveLength(2);
    expect(Math.sign(cc.shafts[0].z)).toBe(-Math.sign(cc.shafts[1].z));
  });

  /** Sesión con Psycho de jugador y la Crítica puesta de frente a la garra a la altura de la rendija (cubo apoyado a 61 cm). */
  function setup(frontDist: number, y = 0.61 + CRITICAL_SIZE / 2, side = 0) {
    const g = new GameSession({ player: 0, preload: false, specs: [spec()] });
    const r = g.player;
    r.phys.teleport(2.6, -1.2, 0);
    const c = g.pieces.critical(r.alliance);
    const at = r.phys.localToWorld(frontDist, 0, side);
    g.pieces.place(c, at.x, y, at.z, 0);
    return { g, r, c };
  }

  it('toma la Crítica de la rendija al llegar de frente y la deja en su asiento', () => {
    const { r, c } = setup(0.42);
    const ev: Parameters<typeof r.mech.grabCritical>[0] = [];
    expect(r.mech.grabCritical(ev)).toBe(true);
    expect(r.mech.critical).toBe(c);
    expect(ev.some((e) => e.type === 'grabCritical')).toBe(true);
    expect(r.phys.armColliders.critical.isEnabled()).toBe(true);
    // El colisionador del cubo va fijo en el asiento
    const t = r.phys.armColliders.critical.translationWrtParent()!;
    const seat = critSeat(r.spec)!;
    expect(t.x).toBeCloseTo(seat.x, 6);
    expect(t.y).toBeCloseTo(seat.y, 6);
  });

  it('no la toma lejos, de lado, en el piso ni detrás', () => {
    for (const [d, y, side] of [[0.8, 0.71, 0], [0.42, 0.71, 0.35], [0.42, 0.1, 0], [-0.4, 0.71, 0]] as const) {
      const { r } = setup(d, y, side);
      expect(r.mech.grabCritical([]), `${d} ${y} ${side}`).toBe(false);
      expect(r.mech.critical).toBeNull();
    }
  });

  it('lleva Muestras en la caja a la vez que la Crítica, y al soltar la deja sobre la Repisa si el robot está arriba', () => {
    const { g, r, c } = setup(0.4);
    // Una Muestra en la caja del brazo
    const sample = g.pieces.list.find((p) => p.kind === 'sample' && p.state.at === 'field')!;
    r.mech.load(sample);
    expect(r.mech.inClaw).toBe(true);
    expect(r.mech.grabCritical([])).toBe(true);
    expect(r.mech.inClawCount).toBe(1);
    expect(r.phys.armColliders.critical.isEnabled()).toBe(true);
    expect(r.phys.armColliders.sample.isEnabled()).toBe(true);
    // Suelta la Crítica: sale del asiento, la Muestra sigue en la caja
    expect(r.mech.release('critical', [], true)).toBe(true);
    expect(r.mech.critical).toBeNull();
    expect(r.mech.inClaw).toBe(true);
    expect(r.phys.armColliders.critical.isEnabled()).toBe(false);
    expect(c.state.at).toBe('field');
    const seatW = r.phys.localToWorld(critSeat(r.spec)!.x, critSeat(r.spec)!.y, 0);
    const t = c.body.translation();
    expect(Math.hypot(t.x - seatW.x, t.z - seatW.z)).toBeLessThan(0.05);
    expect(t.y).toBeGreaterThan(REPISA_TOP); // a la altura de la garra (la Repisa queda abajo)
  });
});

describe('analizador de CAD: flechas de los dedos', () => {
  it('con varias flechas sin "pivote" en el nombre, el eje del brazo es la flecha larga (no la corta y vertical de un dedo)', () => {
    const r = analyzeStep(
      parseStep(
        buildStep('R', [
          { name: 'Chasis-Base', boxes: [[0, 0, 0, 600, 100, 600]], at: [0, 0, 0] },
          { name: 'Pivote-Brazo', boxes: [[0, 100, 280, 600, 40, 40]], at: [0, 0, 0] },
          { name: 'Garra-Inferior', boxes: [[-200, 150, 150, 150, 10, 300]], at: [0, 0, 0] },
          { name: 'Flecha 25cm', boxes: [[100, 500, 175, 20, 20, 250]], at: [0, 0, 0] },
          { name: 'Flecha 10cm', boxes: [[500, 200, 100, 15, 100, 15]], at: [0, 0, 0] },
        ]),
      ),
      { up: 'y', forward: '+x' },
    );
    expect(r.spec.arm).toBeDefined();
    // El pivote sale de la flecha larga (x ≈ 110 mm del origen del chasis), no corrido hacia la de 10 cm
    expect(r.spec.arm!.pivotX).toBeLessThan(0.2);
  });
});

describe('Psycho con la IA: toma la Crítica y la deja en la Repisa', () => {
  const plan = (id: string, bot: RobotPlan['bot']): RobotPlan => ({ id, name: id, spec: spec(), auto: COLLECT_HOME, bot });
  const alliance = (a: RobotPlan, b: RobotPlan): AlliancePlan => ({ id: `${a.id}+${b.id}`, name: 'prueba', robots: [a, b] });

  it('con la estrategia Crítica + N3 la deja en la Repisa (15 + 1 RP) sin faltas por tomarla antes de tiempo', () => {
    const red = alliance(plan('psy-crit', { level: 3, endgame: 'critical' }), plan('psy-n3', { level: 3 }));
    const blue = alliance(plan('psy-n3b', { level: 3 }), plan('psy-n3c', { level: 3 }));
    const r = runMatch(red, blue, 1);
    expect(r.red.critical).toBe(15);
    expect(r.red.rpCritical).toBe(true);
    expect(r.red.fouls.CRITICAL_EARLY ?? 0).toBe(0);
    expect(r.red.samples).toBeGreaterThan(5);
  }, 120_000);
});
