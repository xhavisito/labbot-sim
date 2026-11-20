import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { DO_NOTHING } from '../src/auto/AutoRoutine';
import * as F from '../src/config/field';
import { Director, tee } from '../src/director/Director';
import { HighlightDetector, RULES, type DetFrame, type Trigger } from '../src/director/HighlightDetector';
import { dynamicFov, travel, RevealCamera } from '../src/director/RevealCamera';
import { FrameRing } from '../src/director/ring';
import { extensionFor, pickMime } from '../src/director/exportClip';
import { advance, DEFAULT_RAMP, realDuration, speedAt } from '../src/director/speedRamp';
import { GameSession } from '../src/game/GameSession';
import { emptyInput } from '../src/input/InputManager';
import { initRapier } from '../src/physics/PhysicsWorld';
import { decodeReplay, encodeReplay, frameTime, replayDuration, robotFrame } from '../src/replay/format';
import { Recorder } from '../src/replay/Recorder';
import { ReplayPlayer } from '../src/replay/ReplayPlayer';

beforeAll(async () => {
  await initRapier();
});

/** Anillo de 3 valores por cuadro: tiempo (cs) y dos datos; el 2.º guarda el tiempo en ms para verificar el recorte. */
function filledRing(seconds: number, hz = 30): FrameRing {
  const ring = new FrameRing(3, 15, hz);
  for (let i = 0; i < seconds * hz; i++) {
    const { data, offset } = ring.slot();
    data[offset] = 0;
    data[offset + 1] = Math.round((i / hz) * 100);
    data[offset + 2] = 7;
    ring.commit(i / hz);
  }
  return ring;
}

describe('búfer circular de cuadros', () => {
  it('se queda con los últimos 15 s y descarta lo viejo', () => {
    const ring = filledRing(40);
    expect(ring.latest).toBeCloseTo(40 - 1 / 30, 3);
    expect(ring.latest - ring.oldest).toBeLessThanOrEqual(15.1);
    expect(ring.count).toBe(ring.capacity);
  });

  it('extrae un tramo con el tiempo relativo al inicio del clip', () => {
    const ring = filledRing(30);
    const c = ring.extract(20, 22)!;
    expect(c.duration).toBeCloseTo(2, 1);
    expect(c.start).toBeCloseTo(20, 1);
    expect(c.data[0]).toBe(0);
    expect(c.data[(c.frames - 1) * 3]).toBeCloseTo(200, -1);
    expect(c.data[1]).toBe(2000); // el dato del primer cuadro se conserva
    expect(ring.extract(100, 101)).toBeNull();
  });
});

describe('control de velocidad (speed ramp)', () => {
  it('sin cámara lenta es 1× y con cámara lenta baja en el momento y vuelve después', () => {
    const r = DEFAULT_RAMP(5);
    expect(speedAt(r, 5)).toBe(1);
    r.slow = 0.25;
    r.after = 1.5;
    expect(speedAt(r, 1)).toBeCloseTo(1, 3);
    expect(speedAt(r, 5)).toBeCloseTo(0.25, 3);
    expect(speedAt(r, 9)).toBeCloseTo(1.5, 3);
  });

  it('la cámara lenta alarga el tiempo real del clip', () => {
    const r = DEFAULT_RAMP(3);
    r.slow = 0.25;
    const slowed = realDuration(r, 0, 6);
    expect(slowed).toBeGreaterThan(6 + 2);
    expect(realDuration(DEFAULT_RAMP(3), 0, 6)).toBeCloseTo(6, 1);
    expect(advance(DEFAULT_RAMP(3), 0, 1)).toBeCloseTo(1, 3);
  });
});

/** Cuadro de detección base: 2 robots rojos y 2 azules quietos en la cancha. */
function frame(time: number, over: Partial<DetFrame> = {}): DetFrame {
  return {
    time,
    remaining: 100,
    endgame: false,
    robots: [0, 1, 2, 3].map((i) => ({ alliance: i < 2 ? ('red' as const) : ('blue' as const), x: i * 2 - 3, z: 0, speed: 0, omega: 0, maxSpeed: 2, onPlatform: false })),
    touching: () => false,
    criticalOnRepisa: { red: false, blue: false },
    halfL: F.HALF_L,
    halfW: F.HALF_W,
    ...over,
  };
}

describe('detección de highlights', () => {
  const make = () => {
    const out: Trigger[] = [];
    return { out, d: new HighlightDetector((t) => out.push(t)) };
  };

  it('dos anotaciones seguidas de la misma alianza → rapid; con mucho tiempo entre ellas no', () => {
    const { out, d } = make();
    d.onScore(10, 'red', 1, 0, 100);
    d.onScore(14, 'red', 2, 0, 96);
    expect(out.map((o) => o.kind)).toEqual(['rapid']);
    d.onScore(40, 'red', 1, 0, 70);
    expect(out).toHaveLength(1);
  });

  it('el nivel 3 es un tiro de precisión y una anotación en los últimos 10 s es de endgame', () => {
    const { out, d } = make();
    d.onScore(5, 'blue', 3, 2, 100);
    d.onScore(60, 'blue', 1, 3, RULES.endgameLast - 1);
    expect(out.map((o) => o.kind)).toEqual(['topLevel', 'endgame']);
    expect(out[1].focus).toBe(3);
  });

  it('un golpe fuerte y una anotación de la alianza en ≤ 4 s → clutch', () => {
    const { out, d } = make();
    const hit = (time: number, speed: number) => {
      const f = frame(time, { touching: (i, j) => i + j === 1 });
      f.robots[0].speed = speed;
      d.onFrame(f);
    };
    hit(0, 2);
    hit(1 / 30, 0.5);
    d.onScore(2, 'red', 1, 0, 100);
    expect(out.map((o) => o.kind)).toEqual(['clutch']);
    const b = make();
    b.d.onScore(2, 'red', 1, 0, 100);
    expect(b.out).toEqual([]);
  });

  it('maniobra rápida girando cerca de una pared sin tocar a nadie, sostenida', () => {
    const { out, d } = make();
    for (let k = 0; k < 20; k++) {
      const f = frame(k / 30);
      Object.assign(f.robots[0], { x: F.HALF_L - 0.3, speed: 1.6, omega: 3 });
      d.onFrame(f);
    }
    expect(out.map((o) => o.kind)).toEqual(['maneuver']);
    // En contacto con otro robot no cuenta
    const t = make();
    for (let k = 0; k < 20; k++) {
      const f = frame(k / 30, { touching: (i, j) => i + j === 1 });
      Object.assign(f.robots[0], { x: F.HALF_L - 0.3, speed: 1.6, omega: 3 });
      t.d.onFrame(f);
    }
    expect(t.out).toEqual([]);
  });

  it('subirse a la Plataforma o dejar la Crítica en la Repisa en el ENDGAME', () => {
    const { out, d } = make();
    d.onFrame(frame(100, { endgame: true }));
    const f = frame(101, { endgame: true });
    f.robots[1].onPlatform = true;
    f.criticalOnRepisa.blue = true;
    d.onFrame(f);
    expect(out.map((o) => o.kind).sort()).toEqual(['critical', 'platform']);
    expect(out.find((o) => o.kind === 'critical')!.focus).toBeGreaterThanOrEqual(2);
  });
});

describe('Modo Director sobre una sesión real', () => {
  const still = [DO_NOTHING, DO_NOTHING, DO_NOTHING, DO_NOTHING];
  const run = (g: GameSession, s: number) => {
    for (let i = 0; i < s * 120; i++) {
      g.setInput({ ...emptyInput() });
      g.step();
    }
  };
  const make = () => {
    const g = new GameSession({ player: 0, preload: true, autos: still });
    const dir = new Director();
    dir.attach(g, g.robots.map((r) => r.spec.name), 150);
    g.tap = tee(null, dir);
    return { g, dir };
  };

  it('la marca manual guarda los últimos 10 s como una repetición que se puede reproducir', () => {
    const { g, dir } = make();
    g.startMatch();
    run(g, 12);
    const c = dir.markManual()!;
    expect(c.kind).toBe('manual');
    expect(c.duration).toBeGreaterThan(9.5);
    expect(c.duration).toBeLessThanOrEqual(10.1);
    expect(c.replay.header.robots).toHaveLength(4);
    expect(c.replay.header.pieces).toHaveLength(g.pieces.list.length);
    expect(frameTime(c.replay, 0)).toBe(0);
    expect(replayDuration(c.replay)).toBeCloseTo(c.duration, 1);
    // El clip es una repetición normal: se guarda en archivo y se reproduce con el reproductor
    const again = decodeReplay(encodeReplay(c.replay));
    expect(again.header.frames).toBe(c.replay.header.frames);
    const p = new ReplayPlayer(c.replay);
    p.seek(5);
    const x = robotFrame(c.replay, Math.round(5 * 30), 0).x;
    expect(Math.abs(p.session.robots[0].phys.position().x - x)).toBeLessThan(0.05);
    p.dispose();
    g.dispose();
  });

  it('una Muestra en el nivel 3 genera un clip automático con 2 s después y su robot protagonista', () => {
    const { g, dir } = make();
    g.startMatch();
    run(g, 8);
    const w = F.camaraWells()[3];
    const p = g.pieces.list.find((x) => x.kind === 'sample' && x.state.at === 'hp')!;
    g.pieces.place(p, (w.x0 + w.x1) / 2, w.rim + 0.2, (w.z0 + w.z1) / 2);
    run(g, 1);
    expect(dir.clips).toHaveLength(0); // aún falta la posproducción
    run(g, 2);
    expect(dir.clips).toHaveLength(1);
    expect(dir.clips[0].kind).toBe('topLevel');
    expect(dir.clips[0].trigger).toBeGreaterThan(5);
    expect(dir.clips[0].duration).toBeLessThan(10.5);
    expect(dir.clips[0].focus).toBeGreaterThanOrEqual(0);
    g.dispose();
  });

  it('en práctica sin match también graba (tiempo de sesión) y comparte la ranura con la grabadora', () => {
    const g = new GameSession({ player: 0, preload: true, autos: still });
    const dir = new Director();
    dir.attach(g, g.robots.map((r) => r.spec.name));
    const rec = new Recorder(g, g.robots.map((r) => r.spec.name));
    g.tap = tee(rec, dir);
    run(g, 4);
    const c = dir.markManual()!;
    expect(c.duration).toBeGreaterThan(3.5);
    expect(Number.isNaN(c.matchStart)).toBe(true);
    g.dispose();
  });

  it('attach limpia los clips de la sesión anterior y no graba sesiones ajenas', () => {
    const { g, dir } = make();
    run(g, 3);
    dir.markManual();
    dir.attach(g, []);
    expect(dir.clips).toHaveLength(0);
    const other = new GameSession({ player: 0, preload: true, autos: still });
    other.tap = dir;
    run(other, 1);
    expect(dir.bufferSeconds).toBe(0);
    dir.detach();
    expect(dir.markManual()).toBeNull();
    g.dispose();
    other.dispose();
  });
});

describe('cámaras y exportación', () => {
  it('FOV dinámico crece con la rapidez y se acota', () => {
    expect(dynamicFov(0)).toBe(52);
    expect(dynamicFov(100)).toBe(74);
    expect(dynamicFov(1.25)).toBeCloseTo(63, 5);
  });

  it('chase queda detrás del robot y mirando hacia él; contrapicado a ras de piso', () => {
    const cam = new THREE.PerspectiveCamera();
    const rc = new RevealCamera(cam);
    const s = { pos: new THREE.Vector3(2, 0.1, 1), quat: new THREE.Quaternion(), speed: 0 };
    rc.setPreset('chase');
    rc.update(s, 0, 0, 1 / 60);
    expect(cam.position.x).toBeLessThan(2 - 2);
    rc.setPreset('low');
    rc.update(s, 0, 0, 1 / 60);
    expect(cam.position.y).toBeLessThan(0.2);
    rc.setPreset('orbit');
    rc.update(s, 1, 0, 1 / 60);
    expect(Math.hypot(cam.position.x - 2, cam.position.z - 1)).toBeCloseTo(1.9, 1);
  });

  it('el travelling pasa por los keyframes (máximo 3) con transiciones suaves', () => {
    const cam = new THREE.PerspectiveCamera();
    const rc = new RevealCamera(cam);
    cam.position.set(0, 1, 0);
    expect(rc.addKeyframe()).toBe(true);
    cam.position.set(4, 1, 0);
    rc.addKeyframe();
    cam.position.set(4, 1, 4);
    rc.addKeyframe();
    expect(rc.addKeyframe()).toBe(false);
    const p = new THREE.Vector3();
    travel(rc.keys, 0, p, new THREE.Quaternion());
    expect(p.x).toBeCloseTo(0);
    travel(rc.keys, 0.5, p, new THREE.Quaternion());
    expect(p.x).toBeCloseTo(4);
    travel(rc.keys, 1, p, new THREE.Quaternion());
    expect(p.z).toBeCloseTo(4);
  });

  it('elige el mejor formato de video que el navegador sepa grabar', () => {
    const onlyWebm = (m: string) => m.startsWith('video/webm');
    expect(pickMime('auto', onlyWebm)).toBe('video/webm;codecs=vp9');
    expect(pickMime('mp4', onlyWebm)).toBe('video/webm;codecs=vp9'); // cae a webm
    expect(pickMime('mp4', (m) => m === 'video/mp4')).toBe('video/mp4');
    expect(pickMime('auto', () => false)).toBeNull();
    expect(extensionFor('video/mp4;codecs=avc1')).toBe('mp4');
    expect(extensionFor('video/webm')).toBe('webm');
  });
});
