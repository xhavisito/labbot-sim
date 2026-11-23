import { appendFileSync } from 'fs'; const out = (s: string) => appendFileSync('/tmp/explore.txt', s + '\n');
import { beforeAll, describe, it } from 'vitest';
import { CAD_ROBOT_SPECS } from '../src/cad/cadRobots';
import { SAMPLE_SIZE } from '../src/config/field';
import { GameSession } from '../src/game/GameSession';
import { emptyInput } from '../src/input/InputManager';
import { initRapier } from '../src/physics/PhysicsWorld';
beforeAll(async () => { await initRapier(); });
function trial(lx: number, fwd: number, secs = 4) {
  const g = new GameSession({ player: 0, preload: false, specs: [CAD_ROBOT_SPECS['mentores-3478']] });
  for (const p of g.pieces.list) if (p.state.at === 'field' && p.kind === 'sample') g.pieces.stash(p, { at: 'hp', alliance: 'red' });
  g.player.phys.teleport(0.5, -1.2, 0);
  const p = g.pieces.list.find((x) => x.kind === 'sample')!;
  const w = g.player.phys.localToWorld(lx, 0, 0);
  g.pieces.place(p, w.x, SAMPLE_SIZE / 2 + 0.001, w.z, 0);
  const m = g.player.mech;
  for (let i = 0; i < secs * 120; i++) { g.setInput({ ...emptyInput(), forward: fwd, intake: true }); g.step(); if (m.inClaw) return `Y@${(i/120).toFixed(1)}`; }
  const t = p.body.translation(); const l = g.player.phys.worldToLocalFlat(t.x, t.z);
  return `n(lx=${l.lx.toFixed(3)} lz=${l.lz.toFixed(3)} y=${t.y.toFixed(3)})`;
}
describe('x', () => { it('x', () => {
  for (const lx of [0.62, 0.65, 0.7]) for (const f of [0, 0.1, 0.3]) out(`lx ${lx} fwd ${f}: ${trial(lx, f)}`);
}); });
