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
    expect(r.source.forward).toBe('-x');
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
    const { CAD_ROBOT_SPECS } = await import('../src/cad/cadRobots');
    expect(Object.keys(CAD_ROBOT_SPECS)).toContain('psycho');
    for (const spec of Object.values(CAD_ROBOT_SPECS)) expect(validateRobot(spec)).toEqual([]);
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
