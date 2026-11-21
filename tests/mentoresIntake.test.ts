/** Mentores 3478: el intake (rodillos del CAD) come la Muestra del piso y los rodillos negros y verdes del CAD existen. */
import { beforeAll, describe, expect, it } from 'vitest';
import { CAD_ROBOT_SPECS } from '../src/cad/cadRobots';
import { SAMPLE_SIZE } from '../src/config/field';
import { armTip, heldOffsetOf, posAngle, rollerColsOf, wristAngleOf, wristOf } from '../src/config/robot';
import { GameSession } from '../src/game/GameSession';
import { emptyInput } from '../src/input/InputManager';
import { initRapier } from '../src/physics/PhysicsWorld';

beforeAll(async () => {
  await initRapier();
});

const M = () => CAD_ROBOT_SPECS['mentores-3478'];

function trial(dx: number, dz: number, level: 0 | 4 = 0) {
  const g = new GameSession({ player: 0, preload: false, specs: [M()] });
  for (const p of g.pieces.list) if (p.state.at === 'field' && p.kind === 'sample') g.pieces.stash(p, { at: 'hp', alliance: 'red' });
  g.player.phys.teleport(1.0, -1.2, 0);
  const p = g.pieces.list.find((x) => x.kind === 'sample')!;
  g.pieces.place(p, 1.0 + dx, SAMPLE_SIZE / 2 + 0.001, -1.2 + dz, 0);
  let t = Infinity;
  for (let i = 0; i < 8 * 120; i++) {
    g.setInput({ ...emptyInput(), forward: g.player.phys.position().x < 1.0 + dx - 0.55 ? 0.5 : 0, intake: true, elevator: level });
    g.step();
    if (g.player.mech.inClaw) { t = i / 120; break; }
  }
  return { t, inClaw: g.player.mech.inClaw, x: g.player.phys.position().x };
}

describe('Mentores 3478: intake', () => {
  it('con el brazo al piso come una Muestra de frente, con desvío y manejando hacia ella', () => {
    for (const [dx, dz] of [[1.0, 0], [0.8, 0.05], [1.0, -0.06], [0.7, 0]] as const) {
      const r = trial(dx, dz);
      console.log('MENTORES-INTAKE', dx, dz, JSON.stringify(r));
      expect(r.inClaw).toBe(true);
    }
  });
});

describe('Mentores 3478: intake de mantener (no interruptor) y Muestra horizontal', () => {
  const setup = () => {
    const g = new GameSession({ player: 0, preload: false, specs: [M()] });
    for (const p of g.pieces.list) if (p.state.at === 'field' && p.kind === 'sample') g.pieces.stash(p, { at: 'hp', alliance: 'red' });
    g.player.phys.teleport(1.0, -1.2, 0);
    const p = g.pieces.list.find((x) => x.kind === 'sample')!;
    g.setInput({ ...emptyInput(), elevator: 1 });
    for (let i = 0; i < 120; i++) g.step();
    g.setInput({ ...emptyInput(), elevator: 0 });
    for (let i = 0; i < 240; i++) g.step();
    return { g, p };
  };

  it('solo come mientras se mantiene el botón: al soltarlo ya no come', () => {
    const { g, p } = setup();
    g.pieces.place(p, 1.0 + 0.47, SAMPLE_SIZE / 2 + 0.001, -1.2, 0);
    for (let i = 0; i < 2 * 120; i++) {
      g.setInput({ ...emptyInput(), elevator: 0 }); // botón suelto
      g.step();
    }
    expect(g.player.mech.inClaw).toBe(false);
    expect(g.player.mech.intakeOn).toBe(false);
    for (let i = 0; i < 2 * 120 && !g.player.mech.inClaw; i++) {
      g.setInput({ ...emptyInput(), elevator: 0, intake: true }); // botón mantenido
      g.step();
    }
    expect(g.player.mech.inClaw).toBe(true);
    // Sigue adentro al soltar el botón (no se escupe) y no es un interruptor: soltar = intake apagado
    g.setInput({ ...emptyInput(), elevator: 0 });
    for (let i = 0; i < 120; i++) g.step();
    expect(g.player.mech.intakeOn).toBe(false);
    expect(g.player.mech.inClaw).toBe(true);
  });

  it('la Muestra agarrada queda horizontal (sin girar con el brazo) en el piso y en todos los niveles', () => {
    const { g, p } = setup();
    g.pieces.place(p, 1.0 + 0.47, SAMPLE_SIZE / 2 + 0.001, -1.2, 0);
    for (let i = 0; i < 2 * 120 && !g.player.mech.inClaw; i++) {
      g.setInput({ ...emptyInput(), elevator: 0, intake: true });
      g.step();
    }
    expect(g.player.mech.inClaw).toBe(true);
    const poses = (a: number) => (g.player.phys as unknown as { armPoses(a: number): { sample: { r: { x: number; y: number; z: number; w: number } } } }).armPoses(a).sample.r;
    for (const a of [-0.3715, -0.1, 0.4, 0.8, 2.3153]) {
      const r = poses(a);
      expect(Math.abs(r.z)).toBeLessThan(1e-9);
      expect(r.w).toBeCloseTo(1, 9);
    }
  });
});

describe('Mentores 3478: brazo a N3', () => {
  it('N3 usa el mismo ángulo que el N3 de Axiom (100°, Xhavi 21-nov) y acepta la altura que resulta', () => {
    expect(M().arm.levelAngles?.[3]).toBe(CAD_ROBOT_SPECS.axiom.arm.levelAngles?.[3]);
    const g = new GameSession({ player: 0, preload: true, specs: [M()] });
    const m = g.player.mech;
    g.player.phys.teleport(1.0, -1.2, 0); // piso plano
    for (const lvl of [1, 3] as const) {
      for (let i = 0; i < 4 * 120; i++) {
        g.setInput({ ...emptyInput(), elevator: lvl });
        g.step();
      }
    }
    expect((m.angle * 180) / Math.PI).toBeCloseTo(100, 1);
    expect(m.height).toBeCloseTo(0.335 + 0.7003 * Math.sin((100 * Math.PI) / 180), 3); // 1.025 m
  });
});

describe('Mentores 3478: muñeca, rodillos con colisión y Muestra apoyada', () => {
  const spec = () => M();
  const floorA = () => posAngle(spec(), 0);

  it('en el piso la Muestra agarrada queda apoyada en la alfombra, entre las ruedas', () => {
    const o = heldOffsetOf(spec(), floorA(), 0)!;
    const tip = armTip(spec().arm, floorA());
    expect(tip.y + o.y - SAMPLE_SIZE / 2).toBeCloseTo(0, 2); // su cara de abajo en el piso (antes flotaba 8 cm)
    // la rueda de 4 in (arriba) apenas toca su cara de arriba y no la atraviesa
    const wheel = rollerColsOf(spec(), floorA())[0];
    expect(wheel.y - wheel.r).toBeGreaterThanOrEqual(o.y + SAMPLE_SIZE / 2 - 0.01);
  });

  it('brazo y muñeca en N1–N3 como en las capturas de lado de SolidWorks (Xhavi, 21-nov)', () => {
    const s = spec();
    const deg = (r: number) => (r * 180) / Math.PI;
    // Medido de las capturas (hombro → eje de la muñeca, y rumbo de la placa: eje de la muñeca → rueda de 4 in), ejes del robot (x al frente)
    const ref = { 1: { beam: 14.6, plate: -7.8 }, 2: { beam: 41.0, plate: 26.6 }, 3: { beam: 109.5, plate: 159.0 } } as const;
    const w = s.model!.cadWrist!;
    const st = s.model!.stowAngle!;
    const L = s.model!.cadArmLength!;
    const tip0 = { x: L * Math.cos(st), y: L * Math.sin(st) };
    const beamOff = Math.atan2(w.axis[1], w.axis[0]) - st; // la viga (hombro → muñeca) va arriba de la línea hombro → Muestra
    const wheel0 = s.model!.cadRollerCols!.cyl[0];
    for (const lvl of [1, 2, 3] as const) {
      const a = posAngle(s, lvl);
      expect(deg(a + beamOff)).toBeCloseTo(ref[lvl].beam, -0.3); // ±1°
      // rueda de 4 in respecto al eje de la muñeca, en la pose del CAD, girada con el brazo y la muñeca
      const v = { x: wheel0[0] + tip0.x - w.axis[0], y: wheel0[1] + tip0.y - w.axis[1] };
      const plate = deg(Math.atan2(v.y, v.x) + (a - st) + wristAngleOf(s, a));
      expect(plate).toBeCloseTo(ref[lvl].plate, -0.3);
    }
    // En el piso y en la Repisa, la pose del CAD
    for (const lvl of [0, 4] as const) expect(wristAngleOf(s, posAngle(s, lvl))).toBeCloseTo(0, 9);
    // Entre N2 y N3 va de un giro al otro sin pasarse
    const mid = (posAngle(s, 2) + posAngle(s, 3)) / 2;
    expect(wristAngleOf(s, mid)).toBeGreaterThan(w.levels[2]!);
    expect(wristAngleOf(s, mid)).toBeLessThan(w.levels[3]!);
  });

  it('los rodillos y la Muestra agarrada van con la muñeca; en N3 los rodillos no chocan', () => {
    const s = spec();
    const g = new GameSession({ player: 0, preload: false, specs: [M()] });
    const cols = g.player.phys.armColliders.rollers;
    expect(cols.length).toBe(2);
    for (const lvl of [1, 2, 3] as const) {
      const a = posAngle(s, lvl);
      const wr = wristOf(s)!;
      const d = a - s.model!.stowAngle!;
      const wAbs = { x: wr.x * Math.cos(d) - wr.y * Math.sin(d), y: wr.x * Math.sin(d) + wr.y * Math.cos(d) }; // eje de la muñeca, desde la punta
      // misma distancia al eje de la muñeca que en la pose de piso (giran alrededor de ella)
      const dist = (o: { x: number; y: number }, w0: { x: number; y: number }) => Math.hypot(o.x - w0.x, o.y - w0.y);
      const f = posAngle(s, 0);
      const fd = f - s.model!.stowAngle!;
      const wF = { x: wr.x * Math.cos(fd) - wr.y * Math.sin(fd), y: wr.x * Math.sin(fd) + wr.y * Math.cos(fd) };
      expect(dist(rollerColsOf(s, a)[0], wAbs)).toBeCloseTo(dist(rollerColsOf(s, f)[0], wF), 6);
      expect(dist(heldOffsetOf(s, a, 0)!, wAbs)).toBeCloseTo(dist(heldOffsetOf(s, f, 0)!, wF), 6);
      g.player.phys.setArmPose(a, null);
      for (const c of cols) expect(c.isEnabled()).toBe(lvl !== 3);
    }
    // N3: la Muestra queda atrás del robot, fuera del chasis (anota hacia atrás) y arriba de la pared de 80 cm del Nivel 3
    const a3 = posAngle(s, 3);
    const h3 = heldOffsetOf(s, a3, 0)!;
    const t3 = armTip(s.arm, a3);
    expect(t3.x + h3.x + SAMPLE_SIZE / 2).toBeLessThan(-s.length / 2);
    expect(t3.y + h3.y - SAMPLE_SIZE / 2).toBeGreaterThan(0.8);
  });

  it('una Muestra suelta choca con la rueda de arriba en vez de atravesarla', () => {
    const g = new GameSession({ player: 0, preload: false, specs: [M()] });
    for (const p of g.pieces.list) if (p.state.at === 'field' && p.kind === 'sample') g.pieces.stash(p, { at: 'hp', alliance: 'red' });
    g.player.phys.teleport(1.0, -1.2, 0);
    const p = g.pieces.list.find((x) => x.kind === 'sample')!;
    for (let i = 0; i < 1.5 * 120; i++) { g.setInput({ ...emptyInput(), elevator: 1 }); g.step(); }
    for (let i = 0; i < 1.5 * 120; i++) { g.setInput({ ...emptyInput(), elevator: 0 }); g.step(); }
    const tip = g.player.phys.localToWorld(armTip(spec().arm, g.player.mech.angle).x, 0, 0);
    // arriba de la rueda de 4 in: cae encima de ella (queda más arriba que el cubo que está entre las ruedas)
    g.pieces.place(p, tip.x + 0.033, 0.35, -1.2, 0);
    for (let i = 0; i < 1 * 120; i++) { g.setInput({ ...emptyInput(), elevator: 0 }); g.step(); }
    expect(p.body.translation().y).toBeGreaterThan(0.15);
  });
});
