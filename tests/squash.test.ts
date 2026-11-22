/**
 * Las Muestras no se dejan atravesar (Xhavi, 22-nov: "quiero que la interacción de los robots con las muestras normales y las
 * críticas se sienta realista, ¿por qué esto atraviesa todo?"). Causa: una Muestra pesa ~0.1 kg y un robot 40 kg; con esa razón de
 * masas el solver no frena al robot ni saca la pieza, y apretada contra la pared, el piso o dos robots quedaba hundida 8–14 cm
 * en el robot. Ahora la espuma se exprime como mucho `MAX_SQUASH` (ver `Pieces.relieveSquash`).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import * as F from '../src/config/field';
import { ELEVATOR_ROBOT, PIVOT_ROBOT, type RobotSpec } from '../src/config/robot';
import { GameSession } from '../src/game/GameSession';
import { emptyInput } from '../src/input/InputManager';
import type { Piece } from '../src/physics/Pieces';
import { MAX_SQUASH } from '../src/physics/Pieces';
import { initRapier } from '../src/physics/PhysicsWorld';

beforeAll(async () => {
  await initRapier();
});

function session(spec: RobotSpec): GameSession {
  const g = new GameSession({ player: 0, preload: false, specs: [spec], hp: { enabled: false, interval: 3 } });
  for (const p of g.pieces.list) if (p.state.at === 'field' && p.kind === 'sample') g.pieces.stash(p, { at: 'hp', alliance: 'red' });
  return g;
}

/** Cuánto está hundida la pieza en el robot (m): la peor penetración de sus contactos con cualquier colisionador del robot. */
function depthInRobot(g: GameSession, piece: Piece): number {
  const w = g.pw.world;
  let worst = 0;
  w.contactPairsWith(piece.collider, (other) => {
    if (g.pw.tagOf(other.handle)?.kind !== 'robot') return;
    w.contactPair(piece.collider, other, (m) => {
      for (let k = 0; k < m.numContacts(); k++) worst = Math.max(worst, -m.contactDist(k));
    });
  });
  return worst;
}

const run = (g: GameSession, s: number, inp: Partial<ReturnType<typeof emptyInput>> = {}, each?: () => void) => {
  for (let i = 0; i < s * 120; i++) {
    g.setInput({ ...emptyInput(), ...inp });
    g.step();
    each?.();
  }
};

describe('la espuma no se deja atravesar', () => {
  for (const spec of [PIVOT_ROBOT, ELEVATOR_ROBOT])
    for (const kind of ['sample', 'critical'] as const) {
      it(`${spec.name}: una ${kind === 'sample' ? 'Muestra' : 'Crítica'} empujada contra la pared no se hunde más de ${MAX_SQUASH * 100} cm en el robot`, () => {
        const g = session(spec);
        const r = g.player.phys;
        r.teleport(3.0, 1.5, 0);
        const piece = kind === 'sample' ? g.pieces.list.find((p) => p.kind === 'sample')! : g.pieces.critical('red');
        // contra la pared perimetral (x = 4.5 m), de frente al robot
        g.pieces.place(piece, 4.5 - g.pieces.size(piece) / 2 - 0.003, g.pieces.size(piece) / 2, 1.5, 0);
        let peak = 0;
        let steady = 0;
        // el robot llega a toda velocidad (~1.7 s) y sigue empujando: antes la pieza quedaba hundida 8–14 cm en el chasis
        run(g, 3.5, { forward: 1 }, () => {
          const d = depthInRobot(g, piece);
          peak = Math.max(peak, d);
          if (g.time > 2.8) steady = Math.max(steady, d);
        });
        // apretada de continuo, la compresión no pasa de `MAX_SQUASH`; en el golpe (un solo paso a 3 m/s) no llega a la mitad de la pieza
        expect(steady).toBeLessThanOrEqual(MAX_SQUASH);
        expect(peak).toBeLessThan(F.SAMPLE_SIZE / 2);
        // el robot nunca pasa por encima: el centro de la pieza no queda dentro del chasis (se queda al frente o sale de lado)
        const t = piece.body.translation();
        const p = r.position();
        expect(Math.abs(t.x - p.x) > r.halfL || Math.abs(t.z - p.z) > r.halfW).toBe(true);
      });
    }

  it('una Muestra que queda debajo del chasis (apretada contra el piso) sale de lado en vez de quedar adentro', () => {
    const g = session(PIVOT_ROBOT);
    const r = g.player.phys;
    r.teleport(0, 2.0, 0);
    const piece = g.pieces.list.find((p) => p.kind === 'sample')!;
    g.pieces.place(piece, 0.05, F.SAMPLE_SIZE / 2, 2.0, 0);
    run(g, 1.5);
    const t = piece.body.translation();
    const p = r.position();
    // fuera del chasis (o a lo más con la compresión máxima adentro)
    const out = Math.max(Math.abs(t.x - p.x) - r.halfL, Math.abs(t.z - p.z) - r.halfW);
    expect(out + F.SAMPLE_SIZE / 2).toBeGreaterThan(-MAX_SQUASH - 0.005);
    expect(depthInRobot(g, piece)).toBeLessThanOrEqual(MAX_SQUASH + 0.005);
  });

  it('una Muestra suelta que un robot empuja en el piso abierto se mueve y no se exprime', () => {
    const g = session(PIVOT_ROBOT);
    const r = g.player.phys;
    r.teleport(0, 2.0, 0);
    const piece = g.pieces.list.find((p) => p.kind === 'sample')!;
    g.pieces.place(piece, 0.8, F.SAMPLE_SIZE / 2, 2.0, 0);
    let worst = 0;
    run(g, 2, { forward: 0.6 }, () => (worst = Math.max(worst, depthInRobot(g, piece))));
    expect(worst).toBeLessThan(MAX_SQUASH + 0.01);
    expect(piece.body.translation().x).toBeGreaterThan(1.0);
  });
});
