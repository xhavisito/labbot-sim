/** El Human Player abate la repisa de la Crítica hacia atrás y la pieza cae al piso (SUPUESTO: el manual no lo dice, §3.2.4). */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_INTAKE } from '../src/config/robot';
import { CRITICAL_HOLDER_RED, CRITICAL_SIZE, HALF_W } from '../src/config/field';
import { GameSession } from '../src/game/GameSession';
import { SHELF_FOLD_ANGLE, shelfPose } from '../src/game/CriticalShelf';
import { initRapier } from '../src/physics/PhysicsWorld';

beforeAll(async () => {
  await initRapier();
});

/** Cambia el intake de un robot sin tocar la ficha compartida entre sesiones. */
function setIntake(g: GameSession, i: number, patch: Record<string, unknown>) {
  const r = g.robots[i] as unknown as { spec: { intake?: object } };
  r.spec = { ...r.spec, intake: { ...DEFAULT_INTAKE, ...r.spec.intake, ...patch } };
}

function setup() {
  const g = new GameSession({ player: 0, preload: false, solo: true, hp: { enabled: true, interval: 3, smart: true } });
  g.robots.forEach((r, i) => r.phys.teleport(-2 + i * 0.3, 2, 0));
  return g;
}
const run = (g: GameSession, s: number) => {
  for (let i = 0; i < s * 120; i++) g.step();
};

describe('Human Player deja caer la Crítica al piso', () => {
  for (const a of ['red', 'blue'] as const) {
    it(`alianza ${a}: abate la repisa y la Crítica llega al piso`, () => {
      const g = setup();
      const c = g.pieces.critical(a);
      run(g, 1); // se asienta sobre la repisa
      expect(c.body.translation().y).toBeGreaterThan(CRITICAL_HOLDER_RED.y);
      expect(g.hps[a].dropCritical()).toBe(true);
      run(g, 0.5);
      expect(g.shelves[a].tilt).toBeCloseTo(SHELF_FOLD_ANGLE, 3);
      run(g, 2);
      expect(c.body.translation().y).toBeLessThan(CRITICAL_SIZE / 2 + 0.03);
      expect(g.hps[a].criticalDrops).toBe(1);
      // La repisa regresa a su lugar
      run(g, 2);
      expect(g.shelves[a].tilt).toBe(0);
    });
  }

  it('sin la Crítica sobre la repisa no hace nada', () => {
    const g = setup();
    const c = g.pieces.critical('red');
    g.pieces.place(c, 0, 0.1, 0, 0);
    expect(g.hps.red.dropCritical()).toBe(false);
    expect(g.shelves.red.folded).toBe(false);
  });

  it('en el ENDGAME, con su robot que solo la toma del piso de frente a la pared, se la deja caer sola', () => {
    const g = setup();
    run(g, 1);
    g.robots[0].phys.teleport(CRITICAL_HOLDER_RED.x, -HALF_W + 1, Math.PI / 2);
    setIntake(g, 0, { critFloorOnly: true });
    // Antes del ENDGAME no hace nada
    g.hps.red.step(1 / 120, false);
    expect(g.hps.red.criticalDrops).toBe(0);
    g.hps.red.step(1 / 120, true);
    expect(g.hps.red.criticalDrops).toBe(1);
    run(g, 3);
    expect(g.pieces.critical('red').body.translation().y).toBeLessThan(CRITICAL_SIZE / 2 + 0.03);
  });

  /** Los robots rojos (índices de `g.robots`) con la configuración de su intake. */
  const redIdx = (g: GameSession) => g.robots.map((r, i) => (r.alliance === 'red' ? i : -1)).filter((i) => i >= 0);
  const endgame = (g: GameSession, s: number) => {
    for (let t = 0; t < s; t += 1 / 120) g.hps.red.step(1 / 120, true);
  };

  it('si nadie de la alianza tiene mecanismo para la Crítica, la tira al empezar el ENDGAME', () => {
    const g = setup();
    for (const i of redIdx(g)) setIntake(g, i, { noCritical: true });
    run(g, 1);
    endgame(g, 0.5);
    expect(g.hps.red.criticalDrops).toBe(0);
    endgame(g, 1);
    expect(g.hps.red.criticalDrops).toBe(1);
  });

  it('con mecanismo que no la planea (lejos, sin papel) la tira pasados 12 s; si la planea, la deja', () => {
    const g = setup();
    run(g, 1);
    g.hps.red.plansCritical = () => false;
    endgame(g, 11);
    expect(g.hps.red.criticalDrops).toBe(0);
    endgame(g, 2);
    expect(g.hps.red.criticalDrops).toBe(1);

    const g2 = setup();
    run(g2, 1);
    g2.hps.red.plansCritical = (i) => i === redIdx(g2)[0];
    for (let t = 0; t < 20; t += 1 / 120) g2.hps.red.step(1 / 120, true);
    expect(g2.hps.red.criticalDrops).toBe(0);
  });

  it('un robot cerca de la repisa o con el brazo a su altura cuenta como que la planea', () => {
    const g = setup();
    run(g, 1);
    g.robots[redIdx(g)[0]].phys.teleport(CRITICAL_HOLDER_RED.x, -HALF_W + 1.5, Math.PI / 2);
    endgame(g, 15);
    expect(g.hps.red.criticalDrops).toBe(0);
  });

  it('con garra fija para la Crítica (critSeat, Psycho) nunca la tira', () => {
    const g = setup();
    run(g, 1);
    setIntake(g, redIdx(g)[0], { critClaw: { seat: { x: 0.4, y: 0.3 } } });
    endgame(g, 30);
    expect(g.hps.red.criticalDrops).toBe(0);
  });

  it('la pose abatida gira sobre la arista pegada a la pared (la orilla libre baja)', () => {
    const up = shelfPose(0, 0);
    const down = shelfPose(0, SHELF_FOLD_ANGLE);
    expect(down.y).toBeLessThan(up.y);
    expect(shelfPose(0, 0).qx).toBe(0);
  });
});
