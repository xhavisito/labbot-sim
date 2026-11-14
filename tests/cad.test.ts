import { describe, expect, it } from 'vitest';
import { analyzeStep } from '../src/cad/analyze';
import { parseStep } from '../src/cad/step';
import { specFromRobotFile } from '../src/config/robotFile';
import { validateRobot } from '../src/config/robot';
import { buildStep, sampleRobotStep } from './helpers/stepFixture';

describe('lector STEP', () => {
  const model = parseStep(sampleRobotStep());
  const byName = (n: string) => model.parts.find((p) => p.name === n)!;

  it('encuentra las piezas del ensamble y la unidad (mm → m)', () => {
    expect(model.unitScale).toBe(1e-3);
    expect(model.parts.map((p) => p.name).sort()).toEqual(['Chasis', 'Flecha 25cm', 'Garra', 'Pivote-Brazo']);
    expect(model.parts[0].path.startsWith('EnsambleGeneral/')).toBe(true);
  });

  it('aplica la transformación de cada instancia', () => {
    const arm = byName('Pivote-Brazo').box;
    expect(arm.min[0]).toBeCloseTo(-0.05, 6);
    expect(arm.max[0]).toBeCloseTo(0.55, 6);
    expect(arm.min[1]).toBeCloseTo(0.45, 6);
    const claw = byName('Garra').box;
    expect(claw.max[0]).toBeCloseTo(-0.15, 6);
  });

  it('incluye el radio de los círculos (ruedas con un solo vértice)', () => {
    const ch = byName('Chasis').box;
    expect(ch.min[1]).toBeCloseTo(0, 6); // la rueda baja al piso
    expect(ch.max[1]).toBeCloseTo(0.15, 6);
  });

  it('convierte pulgadas', () => {
    const inch = parseStep(buildStep('R', [{ name: 'Chasis', boxes: [[0, 0, 0, 10, 10, 10]], at: [0, 0, 0] }], 'IN'));
    expect(inch.unitScale).toBeCloseTo(0.0254, 8);
    expect(inch.box.max[0]).toBeCloseTo(0.254, 6);
  });

  it('rechaza archivos que no son STEP o no tienen sólidos', () => {
    expect(() => parseStep('hola')).toThrow(/DATA/);
    expect(() => parseStep('DATA;\n#1=CARTESIAN_POINT(\'\',(0.,0.,0.));\nENDSEC;')).toThrow(/sólida/);
  });
});

describe('analizador de robot', () => {
  const model = parseStep(sampleRobotStep());

  it('saca chasis, garra y brazo del ejemplo', () => {
    const r = analyzeStep(model, { name: 'Psycho', up: 'y', forward: '+x', massKg: 38 }, 'ejemplo.step');
    expect(r.mechanism).toBe('pivot');
    expect(r.spec.length).toBeCloseTo(0.6, 4);
    expect(r.spec.width).toBeCloseTo(0.6, 4);
    expect(r.spec.baseHeight).toBeCloseTo(0.46, 4); // chasis + flecha (el brazo y la garra se mueven)
    expect(r.spec.massKg).toBe(38);
    expect(r.spec.arm).toMatchObject({ pivotX: -0.05, pivotY: 0.45 });
    expect(r.spec.arm?.length).toBeCloseTo(Math.hypot(0.15, 0.32), 3);
    expect(r.spec.arm?.stowAngle).toBeCloseTo(Math.atan2(-0.32, -0.15), 3);;
    expect(r.supuestos.some((s) => /masa/.test(s))).toBe(false);
  });

  it('el resultado pasa los límites del manual (§7.2)', () => {
    const spec = specFromRobotFile(analyzeStep(model, { name: 'Psycho', forward: '+x' }));
    expect(validateRobot(spec)).toEqual([]);
    expect(spec.mechanism).toBe('pivot');
    expect(spec.arm.stowAngle).toBeDefined();
  });

  it('detecta el frente y el eje vertical solos', () => {
    const r = analyzeStep(model, { up: 'auto' });
    expect(r.source.up).toBe('y');
    expect(r.source.forward).toBe('+x'); // el frente es el lado de anotar: opuesto a la garra (que está en -x)
    expect(r.supuestos.join(' ')).toMatch(/detectado/);
  });

  it('si el frente es el contrario, se refleja', () => {
    const r = analyzeStep(model, { forward: '-x' });
    expect(r.spec.arm?.pivotX).toBeCloseTo(0.05, 4); // el frente es -x: el pivote queda 5 cm "delante" del centro
  });

  it('los overrides se aplican y quedan anotados', () => {
    const r = analyzeStep(model, { forward: '+x', overrides: { 'arm.pivotY': 0.5, maxSpeed: 2.5 } });
    expect(r.spec.arm?.pivotY).toBe(0.5);
    expect(r.spec.maxSpeed).toBe(2.5);
    expect(r.supuestos.join(' ')).toMatch(/a mano/);
  });
});

describe('archivo de robot', () => {
  it('rechaza robots que se pasan del manual', () => {
    const f = { schema: 'labbot-robot/1', mechanism: 'pivot', name: 'Gigante', spec: { length: 0.9, width: 0.6, baseHeight: 0.4 } };
    expect(() => specFromRobotFile(f)).toThrow(/65/);
  });
  it('rechaza esquema o mecanismo desconocidos', () => {
    expect(() => specFromRobotFile({ schema: 'x' })).toThrow(/schema/);
    expect(() => specFromRobotFile({ schema: 'labbot-robot/1', mechanism: 'raro', spec: {} })).toThrow(/mecanismo/);
  });
});

describe('robots importados', () => {
  it('el registro carga y valida todos los robots/*.robot.json', async () => {
    const { CAD_ROBOT_SPECS, CAD_ROBOT_PROBLEMS } = await import('../src/cad/cadRobots');
    expect(Object.keys(CAD_ROBOT_SPECS)).toContain('psycho');
    for (const [id, spec] of Object.entries(CAD_ROBOT_SPECS)) expect(CAD_ROBOT_PROBLEMS[id]).toEqual(validateRobot(spec));
    // El brazo real de Psycho (0.95 m) pasa los 40 cm de §7.2 al voltear: se avisa, no se oculta
    expect(CAD_ROBOT_PROBLEMS.psycho.length).toBeGreaterThan(0);
  });
});

describe('pivote por flecha', () => {
  it('usa el centro de la flecha como pivote y el largo hasta la garra', () => {
    const step = buildStep('R', [
      { name: 'Chasis-Base', boxes: [[-300, 0, -300, 300, 100, 300]], at: [0, 0, 0] },
      { name: 'Pivote-Torre', boxes: [[0, 0, -20, 40, 700, 20]], at: [-100, 100, 0] },
      { name: 'Flecha 25cm', boxes: [[0, 0, -125, 20, 20, 125]], at: [-90, 700, 0] },
      { name: 'Garra-Superior', boxes: [[0, 0, -75, 100, 60, 75]], at: [200, 100, 0] },
    ]);
    const r = analyzeStep(parseStep(step), { forward: '+x' });
    expect(r.spec.arm?.pivotX).toBeCloseTo(-0.08, 4);
    expect(r.spec.arm?.pivotY).toBeCloseTo(0.71, 4); // piso en y=0
    expect(r.spec.arm?.length).toBeCloseTo(Math.hypot(0.33, 0.58), 3); // pivote (-0.08, 0.71) a centro de garra (0.25, 0.13)
    expect(r.spec.baseHeight).toBeCloseTo(0.8, 4); // la torre cuenta como estructura fija
  });
});

describe('selector de robots', () => {
  it('psycho es elegible desde el menú y conserva su configuración', async () => {
    const { allRobotIds, robotSpec, isCadId } = await import('../src/config/robotIds');
    expect(allRobotIds()).toContain('cad:psycho');
    expect(isCadId('cad:psycho')).toBe(true);
    expect(isCadId('cad:nada')).toBe(false);
    const s = robotSpec('cad:psycho');
    expect(s.label).toBe('Psycho');
    expect(s.length).toBeCloseTo(0.64, 3);
    expect(s.arm.length).toBeCloseTo(0.9493, 3);
    expect(s.model?.url).toBe('robots/psycho.glb');
  });
  it('los ajustes guardados con psycho no se pierden al cargar', async () => {
    const { sanitizeSettings } = await import('../src/config/settings');
    expect(sanitizeSettings({ robotType: 'cad:psycho' }, []).robotType).toBe('cad:psycho');
  });
});

describe('modelo 3D del robot', () => {
  it('el GLB de Psycho es válido, con el brazo aparte y centrado en el pivote', async () => {
    const { readFileSync } = await import('node:fs');
    const buf = readFileSync('public/robots/psycho.glb');
    expect(buf.toString('latin1', 0, 4)).toBe('glTF');
    const jsonLen = buf.readUInt32LE(12);
    const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
    const nodes = json.nodes as { name: string; translation?: number[]; children?: number[] }[];
    const arm = nodes.find((n) => n.name === 'brazo')!;
    const fixed = nodes.find((n) => n.name === 'estatico')!;
    expect(fixed.children!.length).toBeGreaterThan(30);
    expect(arm.children!.length).toBeGreaterThanOrEqual(8); // placas, garra, sprockets, flecha
    const { CAD_ROBOT_SPECS } = await import('../src/cad/cadRobots');
    const a = CAD_ROBOT_SPECS.psycho.arm;
    expect(arm.translation![0]).toBeCloseTo(a.pivotX, 3);
    expect(arm.translation![1]).toBeCloseTo(a.pivotY, 3);
    // Garra y placas del brazo están en el brazo; el chasis y la torre, no
    const nameOf = (i: number) => nodes[i].name;
    expect(arm.children!.map(nameOf).some((n) => /^Garra/.test(n))).toBe(true);
    expect(arm.children!.map(nameOf).some((n) => /^Garrita/.test(n))).toBe(false); // el gancho trasero no gira
    expect(fixed.children!.map(nameOf).some((n) => /^Chasis/.test(n))).toBe(true);
  });
  it('el marco del robot lleva el frente a +x, arriba a +y y es una rotación (no un espejo)', () => {
    const r = analyzeStep(parseStep(sampleRobotStep()), { forward: '-x' });
    const { ex, ey, ez } = r.frame;
    expect(ex).toEqual([-1, 0, 0]);
    expect(ey).toEqual([0, 1, 0]);
    expect(ez).toEqual([0, 0, -1]);
  });
});

describe('Psycho según el CAD (pose de piso, dos Muestras, hueco)', () => {
  it('el piso es la pose del CAD: garra apoyada, ángulo de guardado = ángulo de piso', async () => {
    const { robotSpec } = await import('../src/config/robotIds');
    const { posAngle, posTip } = await import('../src/config/robot');
    const s = robotSpec('cad:psycho');
    expect(s.arm.pickBack).toBe(true);
    expect(s.elevatorHeights[0]).toBeCloseTo(0.0249, 3); // pieza sobre la placa baja de la garra
    const d = posAngle(s, 0) - s.arm.stowAngle!;
    expect(Math.cos(d)).toBeCloseTo(1, 3);
    const tip = posTip(s, 0);
    expect(tip.y).toBeCloseTo(0.0249, 2); // la punta toca el piso, no lo atraviesa
    expect(tip.x).toBeLessThan(-0.2); // la garra recoge atrás del frente (el lado de anotar es +x)
  });
  it('lleva dos Muestras a la vez (la garra mide 30.9 cm por dentro)', async () => {
    const { robotSpec } = await import('../src/config/robotIds');
    const s = robotSpec('cad:psycho');
    expect(s.capacity).toBe(2);
    expect(s.arm.holdsTwo).toBe(true);
    expect(s.intake!.gap).toBeGreaterThanOrEqual(0.3);
  });
  it('el chasis deja el canal hueco entre los rieles (las Muestras pueden entrar)', async () => {
    const { robotSpec } = await import('../src/config/robotIds');
    const fp = robotSpec('cad:psycho').footprint!;
    const covered = (x: number, z: number) => fp.some(([x0, x1, z0, z1]) => x > x0 && x < x1 && z > z0 && z < z1);
    expect(covered(-0.25, 0)).toBe(false); // canal de la garra, al fondo del lado de recoger
    expect(covered(-0.25, 0.27)).toBe(true); // riel
    expect(covered(0.2, 0)).toBe(true); // cubierta trasera
  });
});

describe('psycho sin mecanismo para la Crítica (Xhavi, 13-nov)', () => {
  it('no la lleva: la IA y el HUD lo ven, y la garra no la toma aunque esté enfrente', async () => {
    const { robotSpec } = await import('../src/config/robotIds');
    const { canHoldCritical, intakeOf } = await import('../src/config/robot');
    const { GameSession } = await import('../src/game/GameSession');
    const { initRapier } = await import('../src/physics/PhysicsWorld');
    await initRapier();
    const s = robotSpec('cad:psycho');
    expect(intakeOf(s).noCritical).toBe(true);
    expect(canHoldCritical(s)).toBe(false);
    // Con la bandera apagada la apertura (30.9 cm) sí le cabe: es reversible
    expect(canHoldCritical({ intake: { ...intakeOf(s), noCritical: false } })).toBe(true);
    const g = new GameSession({ player: 0, preload: false, specs: [s] });
    const m = g.player.mech;
    const c = g.pieces.critical(g.player.alliance);
    // La Crítica pegada a la garra, a su altura
    const tip = g.player.phys.localToWorld(m.tipX(), m.height, 0);
    g.pieces.place(c, tip.x, tip.y + 0.1, tip.z, 0);
    expect(m.grabCritical([])).toBe(false);
    expect(m.critical).toBeNull();
  });
});

describe('psycho con sus ruedas reales (Xhavi, 14-nov)', () => {
  it('apoya en 6 ruedas de 15 cm, sin hundirse, y avanza', async () => {
    const { robotSpec } = await import('../src/config/robotIds');
    const { GameSession } = await import('../src/game/GameSession');
    const { emptyInput } = await import('../src/input/InputManager');
    const { initRapier } = await import('../src/physics/PhysicsWorld');
    await initRapier();
    const s = robotSpec('cad:psycho');
    expect(s.wheel).toBeDefined();
    expect(s.wheel!.xs).toHaveLength(3); // 3 por lado = 6
    expect(s.wheel!.r * 2).toBeCloseTo(0.1524, 3); // 6 in
    // Las ruedas caben en el hueco entre la pared interior y la exterior del chasis (z 0.24–0.314 en el CAD)
    expect(s.wheel!.z - s.wheel!.width / 2).toBeGreaterThan(0.24);
    expect(s.wheel!.z + s.wheel!.width / 2).toBeLessThan(0.314);
    const g = new GameSession({ player: 0, preload: false, specs: [s] });
    g.player.phys.teleport(2.6, -1.2, 0);
    for (let i = 0; i < 120; i++) {
      g.setInput(emptyInput());
      g.step();
    }
    // Quieto: el cuerpo no se hunde (las ruedas tocan la alfombra y el chasis no)
    expect(Math.abs(g.player.phys.body.translation().y)).toBeLessThan(0.02);
    expect(g.player.phys.grounded).toBe(1);
    const x0 = g.player.phys.position().x;
    for (let i = 0; i < 180; i++) {
      g.setInput({ ...emptyInput(), forward: 1 });
      g.step();
    }
    expect(Math.abs(g.player.phys.position().x - x0)).toBeGreaterThan(0.5);
  });
});
