/**
 * La IA le cede a la persona de su alianza la Campana y la Cámara, y no da vueltas en su lugar mientras espera
 * (Xhavi 22-nov: "robots de mi alianza me estorban en la feeder zone o el scoring zone… se ponen a dar vueltas").
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Bot } from '../src/ai/Bot';
import * as F from '../src/config/field';
import { robotSpec } from '../src/config/robotIds';
import { GameSession } from '../src/game/GameSession';
import { emptyInput } from '../src/input/InputManager';
import { initRapier } from '../src/physics/PhysicsWorld';

beforeAll(async () => {
  await initRapier();
});

type Out = { forward: number; turn: number; intake: boolean; elevator: number; release: boolean };
const out0 = (): Out => ({ forward: 0, turn: 0, intake: false, elevator: 0, release: false });
/** Llama un método privado del Bot (o lee un campo). */
const call = <T>(b: unknown, k: string, ...a: unknown[]): T => {
  const v = (b as Record<string, unknown>)[k];
  return typeof v === 'function' ? (v as (...x: unknown[]) => T).apply(b, a) : (v as T);
};

/** Match ya en el TELEOP con la persona en la estación 0 (roja) y la IA como su compañero (estación 1). */
function teleop(specs?: ReturnType<typeof robotSpec>[]) {
  const g = new GameSession({ player: 0, preload: true, ai: true, aiLevel: 'expert', seed: 3, specs });
  g.startMatch();
  g.match!.t = 30;
  g.match!.tick(0);
  return { g, ally: (g as unknown as { bots: Bot[] }).bots[1] };
}
const run = (g: GameSession, s: number, each: () => void) => {
  for (let i = 0; i < s * 120; i++) {
    g.setInput(emptyInput());
    g.step();
    each();
  }
};
/** El pasillo de la Campana roja: entre la barra (§3.2.4) y la pared de la alianza. */
const inRedCampana = (p: { x: number; z: number }) => p.x > F.HALF_L - F.CAMPANA_LENGTH - 0.3 && p.z < -F.HALF_W + F.BARRIER_LENGTH + 0.4;

describe('IA compañera: le deja a la persona la Campana y la Cámara', () => {
  it('con la persona en la Campana, la IA no va por el Human Player ni se mete al pasillo', () => {
    const { g, ally } = teleop();
    const pose = call<{ x: number; z: number }>(ally, 'hpPose');
    g.robots[0].phys.teleport(pose.x, pose.z + 0.25, Math.PI / 2);
    g.robots[1].phys.teleport(1.2, -1.7, 0);
    expect(call<boolean>(ally, 'humanWantsHp')).toBe(true);
    expect(call<boolean>(ally, 'wantsHp', 'TELEOP')).toBe(false);
    let inside = 0;
    let hp = 0;
    run(g, 6, () => {
      if (inRedCampana(g.robots[1].phys.position())) inside++;
      if (ally.mode === 'hp') hp++;
    });
    expect(inside).toBe(0);
    expect(hp).toBe(0);
    // Lejos de la Campana, la persona ya no se la aparta
    g.robots[0].phys.teleport(-1, 2.2, 0);
    expect(call<boolean>(ally, 'humanWantsHp')).toBe(false);
    g.dispose();
  });

  it('si la persona llega a la Campana con la IA ahí, la IA le cede el lugar', () => {
    const { g, ally } = teleop();
    const pose = call<{ x: number; z: number }>(ally, 'hpPose');
    g.robots[1].phys.teleport(pose.x, pose.z + 0.3, Math.PI / 2);
    ally.mode = 'hp';
    // La persona llega a la entrada de la Campana, junto a la punta de la barra
    g.robots[0].phys.teleport(pose.x - 1.5, pose.z + 1.575, Math.PI / 2);
    let lastInside = 0;
    run(g, 8, () => {
      if (inRedCampana(g.robots[1].phys.position())) lastInside = g.match!.t;
    });
    expect(ally.mode).not.toBe('hp');
    expect(lastInside).toBeLessThan(30 + 4);
    g.dispose();
  });

  it('no escoge el nivel de la Cámara al que la persona va a anotar', () => {
    const { g, ally } = teleop();
    const samples = g.pieces.list.filter((p) => p.kind === 'sample' && p.state.at === 'field');
    // Los dos traen una Muestra
    for (const [k, i] of [[0, 0], [1, 1]] as const) {
      g.pieces.stash(samples[k], { at: 'robot', robot: i });
      g.robots[i].mech.stored.push(samples[k]);
    }
    g.robots[1].phys.teleport(0, -1.8, 0);
    g.robots[0].phys.teleport(-1, 2.2, 0);
    expect(call<number | null>(ally, 'chooseLevel')).toBe(3);
    // La persona llega frente al Nivel 3 con su Muestra
    const n3 = call<{ x: number; z: number }>(ally, 'scoringPose', 3);
    g.robots[0].phys.teleport(n3.x, n3.z + 0.5, Math.PI / 2);
    (ally as unknown as { lockedLevel: null }).lockedLevel = null;
    expect(call<number | null>(ally, 'chooseLevel')).not.toBe(3);
    g.dispose();
  });

  it('su lugar de espera junto a la Cámara queda fuera del pasillo, de la zona de anotación y de la Plataforma (ambas alianzas)', () => {
    const g = new GameSession({ player: -1, preload: true, ai: true, seed: 1 });
    g.startMatch();
    for (const i of [0, 2]) {
      const b = (g as unknown as { bots: Bot[] }).bots[i];
      for (const phase of ['TELEOP', 'ENDGAME'] as const) {
        (b as unknown as { phase: string }).phase = phase;
        const w = call<{ x: number; z: number }>(b, 'camaraWaitSpot');
        // Pasillos Campana ↔ Cámara pegados a las paredes largas
        expect(Math.abs(w.z)).toBeLessThan(F.HALF_W - 2);
        // Lejos de la Cámara de su alianza (enfrente de ella anota la otra)
        const n3 = call<{ x: number; z: number }>(b, 'scoringPose', 3);
        expect(Math.hypot(w.x - n3.x, w.z - n3.z)).toBeGreaterThan(1.3);
        // Del lado de su Cámara, fuera de la Plataforma y su margen
        expect(Math.sign(w.x)).toBe(Math.sign(n3.x));
        expect(Math.abs(w.x)).toBeGreaterThan(F.PLATFORM_LENGTH / 2 + 0.65);
      }
    }
    g.dispose();
  });
});

describe('IA: no da vueltas en su lugar', () => {
  it('ya en su lugar de espera se queda quieta (antes giraba hacia un punto que tenía debajo)', () => {
    const { g, ally } = teleop();
    const w = { x: -3.4, z: -0.95 };
    g.robots[1].phys.teleport(w.x + 0.12, w.z - 0.05, 2.5);
    const o = out0();
    call(ally, 'park', w, o, 'TELEOP');
    expect(o.forward).toBe(0);
    expect(o.turn).toBe(0);
    // Ya parada, que la empujen unos centímetros no la hace volver a acomodarse
    g.robots[1].phys.teleport(w.x + 0.3, w.z, 2.5);
    const o2 = out0();
    call(ally, 'park', w, o2, 'TELEOP');
    expect(o2.turn).toBe(0);
    g.dispose();
  });

  it('una Muestra metida en el canal del chasis más adentro que la garra: sube la garra y avanza derecho para sacarla, sin girar (Psycho)', () => {
    const psycho = robotSpec('cad:psycho');
    const { g, ally } = teleop([psycho, psycho, psycho, psycho]);
    const r = g.robots[1];
    r.phys.teleport(0, -1.8, 0);
    g.step();
    const piece = g.pieces.list.find((p) => p.kind === 'sample' && p.state.at === 'field')!;
    const pd = call<number>(ally, 'pickDir');
    expect(pd).toBe(-1); // Psycho toma por atrás
    // Dentro del canal: 16 cm atrás del centro (la punta de la garra queda a ≈21 cm), un poco de lado
    const tip = Math.abs(r.mech.tipX());
    expect(tip).toBeGreaterThan(0.19);
    const pos = r.phys.position();
    const h = r.phys.heading();
    const lx = -0.16;
    const lz = 0.07;
    const x = pos.x + lx * Math.cos(h) + lz * Math.sin(h);
    const z = pos.z - lx * Math.sin(h) + lz * Math.cos(h);
    const q = r.phys.worldToLocalFlat(x, z);
    expect(q.lx).toBeCloseTo(lx, 2);
    piece.body.setTranslation({ x, y: F.SAMPLE_SIZE / 2, z }, true);
    const o = out0();
    call(ally, 'driveToPiece', { x, z, i: piece.index }, o, 'TELEOP');
    expect(o.turn).toBe(0);
    // Con la garra abajo la Muestra queda encerrada entre la garra y el chasis: primero la sube, sin avanzar
    expect(o.elevator).toBeGreaterThan(0);
    expect(o.intake).toBe(false);
    expect(o.forward * pd).toBeLessThanOrEqual(0);
    // Ya arriba, avanza derecho hacia el lado contrario de la garra
    (r.mech as unknown as { height: number }).height = 0.3;
    const o2 = out0();
    call(ally, 'driveToPiece', { x, z, i: piece.index }, o2, 'TELEOP');
    expect(o2.turn).toBe(0);
    expect(o2.forward * pd).toBeLessThan(0);
    g.dispose();
  });
});
