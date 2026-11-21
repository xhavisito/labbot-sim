import { appendFileSync } from 'node:fs';
import { beforeAll, describe, it } from 'vitest';
import { GameSession } from '../src/game/GameSession';
import { emptyInput } from '../src/input/InputManager';
import { robotSpec } from '../src/config/robotIds';
import { initRapier } from '../src/physics/PhysicsWorld';
beforeAll(async () => { await initRapier(); });
describe('dbg', () => { it('x', () => {
  const P = robotSpec('cad:mentores-3478');
  const g = new GameSession({ player: 0, preload: true, ai: true, specs: [P, P, P, P] });
  g.startMatch();
  const r = g.robots[1]; let was = r.mech.inClaw; let tr = -1;
  for (let i = 0; i < 60 * 120 && !g.match!.finished; i++) {
    g.setInput(emptyInput()); g.step();
    if (was && !r.mech.inClaw) { tr = i; appendFileSync('/tmp/dbg.txt', `REL t=${(i/120).toFixed(1)} rob=${JSON.stringify(r.phys.position())} ang=${r.mech.angle.toFixed(2)} h=${r.mech.height.toFixed(2)} head=${r.phys.heading().toFixed(2)}\n`); }
    was = r.mech.inClaw;
    if (tr >= 0 && (i - tr) % 20 === 0 && i - tr < 200) { const ps = g.pieces.list.filter((p) => p.kind === 'sample' && p.state.at === 'field').map((p) => ({ p, t: p.body.translation() })).sort((a, b) => Math.hypot(a.t.x - r.phys.position().x, a.t.z - r.phys.position().z) - Math.hypot(b.t.x - r.phys.position().x, b.t.z - r.phys.position().z))[0]; appendFileSync('/tmp/dbg.txt', `  +${i - tr} ${JSON.stringify({ x: +ps.t.x.toFixed(2), y: +ps.t.y.toFixed(2), z: +ps.t.z.toFixed(2) })}\n`); }
  }
}, 240000); });
