/**
 * Mentores 3478 agarra la Muestra Crítica desde AFUERA (Xhavi, 22-nov: "tiene que quedarse por fuera y agarrar la critical piece y quedarse
 * afuera"; "se aprietan, como en la vida real"). Antes (PR 271) la llevaba entre los rodillos: las ruedas de 4 in se hundían ~3.6 cm en su cara de
 * arriba, los cilindros de 1 in quedaban adentro y flotaba 4 cm sobre el piso. Su prueba solo medía contra los cilindros achicados de la física.
 *
 * Aquí se mide contra la geometría de verdad: los cilindros del CAD con su radio real (`cadRollerCols`, el mismo de las ruedas del GLB) y,
 * con Rapier, contra TODOS los colisionadores del robot (chasis, cascos del CAD, brazo, muñeca, rodillos), en cada paso mientras el brazo
 * va del piso a N1, N2, N3 y de regreso.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import * as F from '../src/config/field';
import { CRIT_SQUEEZE, armTip, critHeldSeatOf, heldCritOf, posAngle, rollerColsOf, wristAngleOf, type RobotSpec } from '../src/config/robot';
import { robotSpec } from '../src/config/robotIds';
import { GameSession } from '../src/game/GameSession';
import { emptyInput } from '../src/input/InputManager';
import { initRapier } from '../src/physics/PhysicsWorld';

beforeAll(async () => {
  await initRapier();
});

const H = F.CRITICAL_SIZE / 2;

/** Penetración (m, + = adentro) de un círculo (centro `cx`, `cy`, radio `r`) en el cuadrado de la Crítica (centro 0, girado `rot`). */
function circleIntoCrit(cx: number, cy: number, r: number, crit: { x: number; y: number; rot: number }): number {
  const dx = cx - crit.x;
  const dy = cy - crit.y;
  const c = Math.cos(-crit.rot);
  const s = Math.sin(-crit.rot);
  const lx = Math.abs(dx * c - dy * s) - H;
  const ly = Math.abs(dx * s + dy * c) - H;
  const out = lx > 0 && ly > 0 ? Math.hypot(lx, ly) : Math.max(lx, ly);
  return r - out;
}

function session(spec: RobotSpec): GameSession {
  const g = new GameSession({ player: 0, preload: false, specs: [spec], hp: { enabled: false, interval: 3 } });
  for (const p of g.pieces.list) if (p.state.at === 'field' && p.kind === 'sample') g.pieces.stash(p, { at: 'hp', alliance: 'red' });
  return g;
}

const step = (g: GameSession, n = 1) => {
  for (let i = 0; i < n; i++) {
    g.setInput(emptyInput());
    g.step();
  }
};

describe('Mentores 3478: la Crítica se agarra desde afuera', () => {
  const spec = robotSpec('cad:mentores-3478');

  it('el lugar de la Crítica está enfrente de las ruedas, apoyada en el piso, sin entrar a la boca', () => {
    const c0 = critHeldSeatOf(spec)!;
    expect(c0).not.toBeNull();
    const cyl = spec.model!.cadRollerCols!.cyl;
    const front = Math.max(...cyl.map(([x, , r]) => x + r));
    // su cara de atrás va contra el frente de las ruedas (apretada CRIT_SQUEEZE), no entre los rodillos
    expect(c0.x - H).toBeCloseTo(front - CRIT_SQUEEZE, 6);
    for (const [x] of cyl) expect(c0.x - H).toBeGreaterThan(x); // todos los ejes de los rodillos quedan detrás de la pieza
    // apoyada en el piso con el brazo en la pose de piso
    const floorTip = armTip(spec.arm, posAngle(spec, 0));
    expect(floorTip.y + c0.y - H).toBeCloseTo(0, 6);
  });

  it('en cualquier ángulo del brazo y de la muñeca los rodillos (radio real) la aprietan como mucho CRIT_SQUEEZE', () => {
    let worst = -1;
    const lo = posAngle(spec, 0);
    const hi = posAngle(spec, 3);
    for (const fold of [0, 0.5, 1])
      for (let k = 0; k <= 200; k++) {
        const a = lo + ((hi - lo) * k) / 200;
        const crit = heldCritOf(spec, a, fold)!;
        for (const o of rollerColsOf(spec, a, fold)) worst = Math.max(worst, circleIntoCrit(o.x, o.y, o.r, crit));
      }
    expect(worst).toBeLessThanOrEqual(CRIT_SQUEEZE + 1e-6);
  });

  it('gira con la placa de la muñeca (fija a ella, como las ruedas que la sostienen)', () => {
    for (const pos of [0, 1, 2, 3] as const) {
      const a = posAngle(spec, pos);
      expect(heldCritOf(spec, a)!.rot).toBeCloseTo(a - (spec.model!.stowAngle ?? 0) + wristAngleOf(spec, a), 9);
    }
  });

  it('en la simulación: la toma del piso, y del piso a N3 y de regreso no se mete en ningún colisionador del robot ni en el piso', () => {
    const g = session(spec);
    const r = g.player;
    r.phys.teleport(0, 2.2, 0);
    const m = r.mech;
    m.target = 0;
    m.stowed = false; // como al primer mando del brazo: la muñeca se despliega
    step(g, 6 * 120); // se despliega la muñeca y baja al piso
    expect(m.wristFold).toBe(0);
    const c = g.pieces.critical(r.alliance);
    // en el piso, enfrente de la boca (todavía sin tocar las ruedas)
    const c0 = critHeldSeatOf(spec)!;
    const at = r.phys.localToWorld(m.tipX() + c0.x + 0.05, 0, 0);
    g.pieces.place(c, at.x, H, at.z, 0);
    step(g, 30);
    g.setInput({ ...emptyInput(), intake: true });
    g.step();
    expect(m.critical).toBe(c);
    const held = r.phys.armColliders.critical;
    const others = () => {
      const out = [];
      for (let i = 0; i < r.phys.body.numColliders(); i++) {
        const col = r.phys.body.collider(i);
        if (col.handle !== held.handle && col.isEnabled()) out.push(col);
      }
      return out;
    };
    let worst = -1;
    let worstFloor = -1;
    let steps = 0;
    for (const pos of [0, 1, 2, 3, 2, 1, 0] as const) {
      m.target = pos;
      for (let i = 0; i < 2 * 120; i++) {
        step(g);
        expect(m.critical).toBe(c);
        for (const o of others()) {
          const hit = held.contactCollider(o, 0.05);
          if (hit) worst = Math.max(worst, -hit.distance);
        }
        // el punto más bajo del cubo (girado) no se mete en la alfombra
        const t = held.translation();
        const q = held.rotation();
        let minY = Infinity;
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
          const v = { x: sx * H, y: sy * H, z: sz * H };
          // y de q·v
          const tx = 2 * (q.y * v.z - q.z * v.y);
          const tz = 2 * (q.x * v.y - q.y * v.x);
          minY = Math.min(minY, t.y + v.y + q.w * 2 * (q.z * v.x - q.x * v.z) + (q.z * tx - q.x * tz));
        }
        worstFloor = Math.max(worstFloor, -minY);
        steps++;
      }
    }
    expect(steps).toBeGreaterThan(1000);
    // Rapier: los rodillos de la física van 4 mm más chicos (para que entre la Muestra); el chasis, los cascos y el brazo, tal cual
    expect(worst).toBeLessThanOrEqual(CRIT_SQUEEZE + 0.001);
    expect(worstFloor).toBeLessThanOrEqual(0.005);
  });

  it('al soltarla sale girada como la llevaba (no se acomoda derecha dentro de las ruedas)', () => {
    const g = session(spec);
    const r = g.player;
    r.phys.teleport(0, 2.2, 0);
    const m = r.mech;
    m.target = 0;
    m.stowed = false; // como al primer mando del brazo: la muñeca se despliega
    step(g, 6 * 120);
    const c = g.pieces.critical(r.alliance);
    const c0 = critHeldSeatOf(spec)!;
    const at = r.phys.localToWorld(m.tipX() + c0.x, 0, 0);
    g.pieces.place(c, at.x, H, at.z, 0);
    g.setInput({ ...emptyInput(), intake: true });
    g.step();
    expect(m.critical).toBe(c);
    m.target = 2;
    step(g, 2 * 120);
    const want = heldCritOf(spec, m.angle, m.wristFold)!;
    const pose = r.phys.armColliders.critical.translation();
    m.release('critical', [], true);
    expect(m.critical).toBeNull();
    const t = c.body.translation();
    expect(Math.hypot(t.x - pose.x, t.y - pose.y, t.z - pose.z)).toBeLessThan(0.01);
    // giro sobre el eje lateral del robot (z local): el mismo que llevaba
    const q = c.body.rotation();
    expect(Math.abs(2 * Math.atan2(Math.hypot(q.x, q.y, q.z), q.w))).toBeCloseTo(Math.abs(want.rot), 2);
  });
});
