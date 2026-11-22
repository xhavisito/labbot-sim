/** El Human Player abate la repisa de la Crítica hacia atrás y la pieza cae al piso (SUPUESTO: el manual no lo dice, §3.2.4). */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_INTAKE } from '../src/config/robot';
import { CRITICAL_HOLDER_RED, CRITICAL_SIZE } from '../src/config/field';
import { robotSpec } from '../src/config/robotIds';
import { emptyInput } from '../src/input/InputManager';
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

  it('sin que el jugador oprima el botón nunca la tira (ni en el ENDGAME, ni con nadie con mecanismo)', () => {
    const g = setup();
    for (const i of g.robots.keys()) setIntake(g, i, { noCritical: true });
    run(g, 1);
    for (let t = 0; t < 40; t += 1 / 120) g.hps.red.step(1 / 120, true);
    expect(g.hps.red.criticalDrops).toBe(0);
    expect(g.pieces.critical('red').body.translation().y).toBeGreaterThan(CRITICAL_HOLDER_RED.y);
  });

  it('la pose abatida gira sobre la arista pegada a la pared (la orilla libre baja)', () => {
    const up = shelfPose(0, 0);
    const down = shelfPose(0, SHELF_FOLD_ANGLE);
    expect(down.y).toBeLessThan(up.y);
    expect(shelfPose(0, 0).qx).toBe(0);
  });
});

describe('Botón de la Repisa = dejar caer la Crítica (Axiom y Mentores 3478, Xhavi 21-nov)', () => {
  const press = (g: GameSession, s: number) => {
    g.setInput({ ...emptyInput(), elevator: 4 });
    for (let i = 0; i < s * 120; i++) g.step();
    g.setInput(emptyInput());
  };
  for (const id of ['cad:axiom', 'cad:mentores-3478'] as const) {
    it(`${id}: no la toma de la repisa y el botón 4 la deja caer sin subir el brazo`, () => {
      const spec = robotSpec(id);
      expect(spec.intake?.critFloorOnly).toBe(true);
      expect(spec.intake?.critDropKey).toBe(true);
      const g = new GameSession({ player: 0, preload: false, solo: true, specs: [spec], hp: { enabled: true, interval: 3, smart: true } });
      g.player.phys.teleport(-2, 2, 0);
      for (let i = 0; i < 120; i++) g.step();
      const c = g.pieces.critical(g.player.alliance);
      expect(c.body.translation().y).toBeGreaterThan(CRITICAL_HOLDER_RED.y);
      const target = g.player.mech.target;
      press(g, 0.5);
      expect(g.player.mech.target).toBe(target);
      expect(g.hps[g.player.alliance].criticalDrops).toBe(1);
      for (let i = 0; i < 3 * 120; i++) g.step();
      expect(c.body.translation().y).toBeLessThan(CRITICAL_SIZE / 2 + 0.03);
    });
  }

  it('un robot sin la marca (Psycho) no cambia: el botón 4 sigue siendo suyo', () => {
    const spec = robotSpec('cad:psycho');
    expect(spec.intake?.critDropKey).toBeUndefined();
    const g = new GameSession({ player: 0, preload: false, solo: true, specs: [spec] });
    g.player.phys.teleport(-2, 2, 0);
    for (let i = 0; i < 120; i++) g.step();
    press(g, 0.5);
    expect(g.hps[g.player.alliance].criticalDrops).toBe(0);
  });
});
