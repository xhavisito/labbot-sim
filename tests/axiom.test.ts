/** Axiom: garra con pivote 180°, importada del STEP del equipo (16-nov). Lo que el CAD no dice es SUPUESTO (ver el JSON). */
import { existsSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { CAD_ROBOT_SPECS, CAD_ROBOT_PROBLEMS } from '../src/cad/cadRobots';
import { robotSpec } from '../src/config/robotIds';
import { posAngle } from '../src/config/robot';
import { labSpots } from '../src/config/field';
import { GameSession } from '../src/game/GameSession';
import { emptyInput } from '../src/input/InputManager';
import { initRapier } from '../src/physics/PhysicsWorld';
import axiom from '../robots/axiom.robot.json';

beforeAll(async () => {
  await initRapier();
});

describe('Axiom tal cual el CAD', () => {
  const A = () => CAD_ROBOT_SPECS.axiom;
  it('lleva las medidas, las 4 llantas y el brazo del CAD', () => {
    const s = A();
    expect(s.mechanism).toBe('pivot180');
    expect(s.length).toBeCloseTo(0.561, 3); // 56 cm sin brazo (Xhavi)
    expect(s.width).toBeCloseTo(0.6511, 3);
    expect(s.wheel!.xs).toHaveLength(2); // 2 por lado = 4 llantas
    expect(s.wheel!.r).toBeCloseTo(0.0762, 4); // 6 in
    expect(s.arm.length).toBeCloseTo(0.6246, 3);
    expect(s.arm.pivotY).toBeCloseTo(0.2421, 3);
    expect(s.model?.url).toBe('robots/axiom.glb');
    expect(s.model?.staticWheels).toBe(true);
    expect(existsSync(new URL('../public/robots/axiom.glb', import.meta.url))).toBe(true);
  });
  it('es una garra de pinza al frente: sin lanzador de Phoenix ni rodillos', () => {
    const s = A();
    expect(s.intake?.kind).toBe('pinza');
    expect(s.intake?.shooter).toBeUndefined();
    expect(s.intake?.rollers).toBeFalsy();
    expect(s.arm.pickBack).toBe(false);
    expect(s.capacity).toBe(1);
  });
  it('solo se pasa del límite de ancho que dice el CAD (0.651 m) y declara sus SUPUESTOS', () => {
    expect(CAD_ROBOT_PROBLEMS.axiom).toEqual(['chasis mayor a 65 × 65 cm (§7.2)']);
    const t = (axiom as { supuestos: string[] }).supuestos.join(' ');
    expect(t).toMatch(/SUPUESTO \(Xhavi, 16-nov\)/);
    expect(t).toMatch(/pose de inicio del brazo a 60°/);
  });
  it('empieza dentro del perímetro con el brazo guardado', () => {
    const s = A();
    const tipX = s.arm.pivotX + s.arm.length * Math.cos(s.arm.stowAngle!);
    expect(Math.abs(tipX) + 0.075).toBeLessThanOrEqual(s.length / 2 + 1e-6);
  });
});

describe('IA con Axiom', () => {
  it('un match de solo IA con 4 Axiom: se mueven, sin trabarse, y anotan', () => {
    const P = robotSpec('cad:axiom');
    const g = new GameSession({ player: 0, preload: true, ai: true, specs: [P, P, P, P] });
    g.startMatch();
    for (let i = 0; i < 151 * 120 && !g.match!.finished; i++) {
      g.setInput(emptyInput());
      g.step();
    }
    const m = g.match!;
    const red = m.breakdown('red');
    const blue = m.breakdown('blue');
    console.log('AI-AXIOM', JSON.stringify({ red, blue }));
    expect(red.samplesAuto + red.samplesTeleop + blue.samplesAuto + blue.samplesTeleop).toBeGreaterThan(0);
  }, 240000);
});

describe('Axiom: ángulos de los niveles (Xhavi, 16-nov)', () => {
  it('N3 a 110° con la garra volteada atrás; N1 y N2 al frente', async () => {
    const { posAngle, posDir, armTip } = await import('../src/config/robot');
    const s = CAD_ROBOT_SPECS.axiom;
    expect(posAngle(s, 3)).toBeCloseTo((110 * Math.PI) / 180, 3);
    expect(armTip(s.arm, posAngle(s, 3)).y).toBeCloseTo(s.elevatorHeights[3], 3);
    expect([1, 2, 3].map((l) => posDir(s, l as 1 | 2 | 3))).toEqual([1, 1, -1]);
    expect(posAngle(s, 2)).toBeLessThan(Math.PI / 2);
    expect(posAngle(s, 1)).toBeLessThan(posAngle(s, 2));
  });
});

describe('Menú: sin ⚠ en los robots del CAD (aprobados por el mentor)', () => {
  it('la descripción de Axiom y Psycho no lleva ⚠ aunque pasen un límite de §7.2', async () => {
    const src = (await import('node:fs')).readFileSync(new URL('../src/ui/Menu.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/CAD_ROBOT_PROBLEMS/);
    expect(src).not.toMatch(/` ⚠ \$\{/);
  });
});

describe('Axiom: la pinza no atraviesa el piso en la pose de piso (Xhavi, 16-nov)', () => {
  it('los dedos del CAD quedan sobre el piso con la punta en elevatorHeights[0] y aun así recoge del piso', async () => {
    const { readFileSync } = await import('node:fs');
    const { posAngle } = await import('../src/config/robot');
    const FLOOR_POSE_MAX = 0.06;
    const b = readFileSync(new URL('../public/robots/axiom.glb', import.meta.url));
    const n0 = 20 + b.readUInt32LE(12);
    const j = JSON.parse(b.subarray(20, n0).toString('utf8'));
    const bin = b.subarray(n0 + 8);
    let lowest = Infinity;
    const s = CAD_ROBOT_SPECS.axiom;
    const d = posAngle(s, 0) - (axiom as { model: { stowAngle: number } }).model.stowAngle;
    for (const n of j.nodes.filter((q: { name?: string }) => q.name === 'garra')) {
      const a = j.accessors[j.meshes[n.mesh].primitives[0].attributes.POSITION];
      const bv = j.bufferViews[a.bufferView];
      const o = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
      for (let k = 0; k < a.count; k++) {
        const x = bin.readFloatLE(o + k * (bv.byteStride ?? 12));
        const y = bin.readFloatLE(o + k * (bv.byteStride ?? 12) + 4);
        lowest = Math.min(lowest, s.arm.pivotY + Math.sin(d) * x + Math.cos(d) * y);
      }
    }
    expect(lowest).toBeGreaterThanOrEqual(-0.002);
    expect(lowest).toBeLessThan(0.02); // y casi tocándolo: se agarra desde el piso
    expect(s.elevatorHeights[0]).toBeLessThan(FLOOR_POSE_MAX);
  });

  it('recoge una Muestra del piso con la pose de piso (un toque cierra la garra sobre ella)', () => {
    const g = new GameSession({ player: 0, preload: false, specs: [robotSpec('cad:axiom')] });
    const m = g.player.mech;
    const spot = labSpots()[0];
    // Brazo ya en la pose de piso y la Muestra entre los dedos
    (m as unknown as { stowed: boolean; angle: number }).stowed = false;
    (m as unknown as { angle: number }).angle = posAngle(CAD_ROBOT_SPECS.axiom, 0);
    g.player.phys.teleport(spot.x + 0.44, spot.z, Math.PI);
    g.setInput(emptyInput());
    for (let i = 0; i < 120; i++) g.step();
    g.setInput({ ...emptyInput(), intake: true });
    for (let i = 0; i < 3 * 120 && !m.inClaw; i++) g.step();
    expect(m.inClaw).toBe(true);
  });
});

describe('Axiom: la garra es un interruptor (Xhavi, 16-nov)', () => {
  const press = (g: GameSession, ms = 3) => {
    g.setInput({ ...emptyInput(), intake: true });
    for (let i = 0; i < ms; i++) g.step();
    g.setInput(emptyInput());
    for (let i = 0; i < 2; i++) g.step();
  };
  const wait = (g: GameSession, s: number) => {
    g.setInput(emptyInput());
    for (let i = 0; i < s * 120; i++) g.step();
  };

  it('una pulsación sobre una Muestra la toma y sigue cerrada sin mantener la tecla; otra pulsación la suelta', () => {
    const g = new GameSession({ player: 0, preload: false, specs: [robotSpec('cad:axiom')] });
    const m = g.player.mech;
    const spot = labSpots()[0];
    // Brazo en la pose de piso y la Muestra ya entre los dedos
    (m as unknown as { stowed: boolean; angle: number }).stowed = false;
    (m as unknown as { angle: number }).angle = posAngle(CAD_ROBOT_SPECS.axiom, 0);
    g.player.phys.teleport(spot.x + 0.44, spot.z, Math.PI);
    wait(g, 1);
    press(g);
    expect(m.clawClosed).toBe(true);
    wait(g, 2);
    expect(m.inClaw).toBe(true); // se queda sin mantener la tecla
    expect(m.clawClosed).toBe(true);
    press(g);
    expect(m.clawClosed).toBe(false);
    expect(m.inClaw).toBe(false); // abrir la suelta
  });

  it('cerrar sin Muestra solo queda cerrada vacía; no recoge una que llegue después', () => {
    const g = new GameSession({ player: 0, preload: false, specs: [robotSpec('cad:axiom')] });
    const m = g.player.mech;
    g.player.phys.teleport(-1.5, 0, 0);
    press(g);
    expect(m.clawClosed).toBe(true);
    wait(g, 1.5);
    expect(m.inClaw).toBe(false);
    expect(m.clawClosed).toBe(true);
    // Mantener la tecla presionada cuenta como UNA pulsación (abre una vez y no vuelve a cambiar)
    g.setInput({ ...emptyInput(), intake: true });
    for (let i = 0; i < 3 * 120; i++) g.step();
    expect(m.clawClosed).toBe(false);
  });
});
