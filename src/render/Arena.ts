/**
 * El gimnasio del WinterFest alrededor de la cancha (solo decorativo, como el estadio de
 * rebuilt-sim pero a escala de evento interno): duela, gradas con público instanciado (se mueve en
 * el vertex shader; la densidad depende de la calidad), estructuras con focos emisivos (el bloom
 * les da brillo), mantas LED con texto genérico y una pantalla con el marcador.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as F from '../config/field';
import { gymFloorTexture } from './textures';

const MAX_CROWD = 900;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Arena {
  readonly group = new THREE.Group();
  private crowd: THREE.InstancedMesh;
  private heads: THREE.InstancedMesh;
  private shaders: Array<{ uniforms: Record<string, THREE.IUniform> }> = [];
  private excite = 0;
  private screenCanvas: HTMLCanvasElement | null = null;
  private screenTex: THREE.CanvasTexture | null = null;
  private lastScreen = '';
  private led: THREE.Texture[] = [];
  /** Focos del techo: se ocultan si la cámara está arriba de ellos (vista superior). */
  private overhead = new THREE.Group();

  constructor() {
    this.group.name = 'arena';
    const r = rng(11);

    // ---- Duela del gimnasio y paredes lejanas
    const floorTex = gymFloorTexture();
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(34, 28),
      new THREE.MeshStandardMaterial({ color: floorTex ? 0xffffff : 0xa77a4a, map: floorTex?.map ?? null, bumpMap: floorTex?.bump ?? null, bumpScale: 0.6, roughness: 0.42, metalness: 0 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.004;
    floor.receiveShadow = true;
    this.group.add(floor);
    // Líneas de cancha de básquet pintadas en la duela (un gimnasio de verdad)
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xf2f2f2, transparent: true, opacity: 0.55 });
    for (const [w, h, x, z] of [
      [28, 0.05, 0, -12],
      [28, 0.05, 0, 12],
      [0.05, 24, -14, 0],
      [0.05, 24, 14, 0],
    ]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), lineMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, -0.003, z);
      this.group.add(m);
    }
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x1b2130, roughness: 0.9 });
    const walls = [
      new THREE.BoxGeometry(34, 9, 0.3).translate(0, 4.5, -14),
      new THREE.BoxGeometry(34, 9, 0.3).translate(0, 4.5, 14),
      new THREE.BoxGeometry(0.3, 9, 28).translate(-17, 4.5, 0),
      new THREE.BoxGeometry(0.3, 9, 28).translate(17, 4.5, 0),
    ];
    this.group.add(new THREE.Mesh(mergeGeometries(walls)!, wallMat));

    // ---- Gradas de aluminio en los lados largos y atrás de cada Driver Station
    const tierGeos: THREE.BufferGeometry[] = [];
    const seatGeos: THREE.BufferGeometry[] = [];
    const seats: Array<{ x: number; y: number; z: number; ry: number }> = [];
    const rows = 7;
    const place = (g: THREE.BufferGeometry, ry: number) => g.rotateY(ry);
    const addStand = (len: number, ry: number, start: number) => {
      for (let i = 0; i < rows; i++) {
        const d = start + i * 0.8;
        const h = 0.4 + i * 0.38;
        tierGeos.push(place(new THREE.BoxGeometry(len, h - 0.1, 0.8).translate(0, (h - 0.1) / 2, d + 0.4), ry));
        seatGeos.push(place(new THREE.BoxGeometry(len, 0.045, 0.3).translate(0, h, d + 0.58), ry));
        seatGeos.push(place(new THREE.BoxGeometry(len, 0.03, 0.32).translate(0, h - 0.09, d + 0.18), ry));
        if (i === 0) seatGeos.push(place(new THREE.BoxGeometry(len, 0.05, 0.05).translate(0, h + 0.55, d - 0.05), ry));
        for (let s = -len / 2 + 0.35; s < len / 2 - 0.35; s += 0.55) {
          if (r() < 0.18) continue;
          const local = new THREE.Vector3(s + (r() - 0.5) * 0.15, h, d + 0.42).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry);
          seats.push({ x: local.x, y: local.y, z: local.z, ry: ry + Math.PI });
        }
      }
    };
    addStand(16, 0, F.HALF_W + 2.6); // lado +Z
    addStand(16, Math.PI, F.HALF_W + 2.6); // lado −Z
    addStand(7, Math.PI / 2, F.HALF_L + 4.2); // atrás de la alianza roja
    addStand(7, -Math.PI / 2, F.HALF_L + 4.2); // atrás de la alianza azul
    this.group.add(new THREE.Mesh(mergeGeometries(tierGeos)!, new THREE.MeshStandardMaterial({ color: 0x10131a, roughness: 0.95 })));
    const boards = new THREE.Mesh(mergeGeometries(seatGeos)!, new THREE.MeshStandardMaterial({ color: 0xa2a9b3, metalness: 0.75, roughness: 0.35 }));
    boards.receiveShadow = true;
    this.group.add(boards);

    // ---- Público sentado (torso + cabeza, dos InstancedMesh con la misma matriz)
    const body = new THREE.CapsuleGeometry(0.15, 0.26, 3, 8).scale(1, 1, 0.75).translate(0, 0.33, 0);
    const head = new THREE.SphereGeometry(0.1, 10, 8).translate(0, 0.66, 0.01);
    for (let i = seats.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [seats[i], seats[j]] = [seats[j], seats[i]];
    }
    const n = Math.min(MAX_CROWD, seats.length);
    const phase = new Float32Array(n);
    for (let i = 0; i < n; i++) phase[i] = r() * Math.PI * 2;
    body.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    head.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    const bob = (sh: { uniforms: Record<string, THREE.IUniform>; vertexShader: string }) => {
      sh.uniforms.uTime = { value: 0 };
      sh.uniforms.uExcite = { value: 0 };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uExcite;\nattribute float aPhase;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y += (0.03 + 0.14 * uExcite) * max(0.0, sin(uTime * (2.0 + 4.0 * uExcite) + aPhase));');
      this.shaders.push(sh);
    };
    const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    const headMat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
    bodyMat.onBeforeCompile = bob;
    headMat.onBeforeCompile = bob;
    this.crowd = new THREE.InstancedMesh(body, bodyMat, n);
    this.heads = new THREE.InstancedMesh(head, headMat, n);
    // Playeras: sobre todo oscuras, con rojo/azul de los equipos y el amarillo de LamBot
    const palette = [0x2b2f36, 0x3a3f47, 0x1f2329, 0x55595f, 0xc9ccd1, 0x23344f, 0x8a1f1f, 0x1d3f7a, 0xc9a01a, 0x2f5a35];
    const skins = [0x8d5524, 0xc68642, 0xe0ac69, 0xf1c27d, 0xffdbac, 0x5c3a1e];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const s = seats[i];
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.ry);
      const k = 0.9 + r() * 0.2;
      m.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(k, k, k));
      this.crowd.setMatrixAt(i, m);
      this.heads.setMatrixAt(i, m);
      this.crowd.setColorAt(i, c.setHex(palette[Math.floor(r() * palette.length)]).multiplyScalar(0.55 + r() * 0.35));
      this.heads.setColorAt(i, c.setHex(skins[Math.floor(r() * skins.length)]));
    }
    this.crowd.frustumCulled = this.heads.frustumCulled = false;
    this.group.add(this.crowd, this.heads);

    // ---- Estructuras de focos sobre la cancha (barras emisivas: el bloom las hace brillar)
    const truss = new THREE.MeshStandardMaterial({ color: 0x161a22, metalness: 0.6, roughness: 0.5 });
    const lamp = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff2dc, emissiveIntensity: 5 });
    const trussGeos: THREE.BufferGeometry[] = [];
    const lampGeos: THREE.BufferGeometry[] = [];
    for (const x of [-4.5, -1.5, 1.5, 4.5]) {
      trussGeos.push(new THREE.BoxGeometry(0.25, 0.25, 14).translate(x, 7.6, 0));
      for (const z of [-3, -1, 1, 3]) lampGeos.push(new THREE.BoxGeometry(0.5, 0.1, 0.5).translate(x, 7.42, z));
    }
    this.overhead.add(new THREE.Mesh(mergeGeometries(trussGeos)!, truss), new THREE.Mesh(mergeGeometries(lampGeos)!, lamp));
    this.group.add(this.overhead);

    // ---- Mantas LED al frente de las gradas largas
    for (const ry of [0, Math.PI]) {
      const t = ledTexture();
      if (!t) break;
      t.repeat.set(16 / 6, 1);
      const g = new THREE.PlaneGeometry(16, 0.36).rotateY(Math.PI).translate(0, 0.55, F.HALF_W + 2.58).rotateY(ry);
      this.group.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: t, toneMapped: false })));
      this.led.push(t);
    }

    // ---- Pantalla con el marcador sobre la pared −Z
    if (typeof document !== 'undefined') {
      this.screenCanvas = document.createElement('canvas');
      this.screenCanvas.width = 512;
      this.screenCanvas.height = 192;
      this.screenTex = new THREE.CanvasTexture(this.screenCanvas);
      this.screenTex.colorSpace = THREE.SRGBColorSpace;
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 2.4), new THREE.MeshBasicMaterial({ map: this.screenTex, toneMapped: false }));
      screen.position.set(0, 6.2, -13.8);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(6.8, 2.8, 0.2), truss);
      frame.position.set(0, 6.2, -13.92);
      this.group.add(screen, frame);
      this.setScreen('LABBOT RESCUE', '', '');
    }
  }

  /** Densidad del público según la calidad (0–1). */
  setDensity(d: number): void {
    this.crowd.count = this.heads.count = Math.round(this.crowd.instanceMatrix.count * d);
    this.crowd.visible = this.heads.visible = d > 0;
  }

  /** El público se emociona (al anotar, al terminar el match). */
  cheer(amount = 1): void {
    this.excite = Math.min(1, this.excite + amount);
  }

  update(dt: number, time: number, cameraY = 0): void {
    this.overhead.visible = cameraY < 7;
    this.excite = Math.max(0, this.excite - dt * 0.35);
    for (const t of this.led) t.offset.x = (time * 0.04) % 1;
    for (const sh of this.shaders) {
      sh.uniforms.uTime.value = time;
      sh.uniforms.uExcite.value = this.excite;
    }
  }

  /** Pantalla: rojo · centro (timer o título) · azul. */
  setScreen(center: string, red: string, blue: string): void {
    const key = `${center}|${red}|${blue}`;
    if (!this.screenCanvas || !this.screenTex || key === this.lastScreen) return;
    this.lastScreen = key;
    const g = this.screenCanvas.getContext('2d')!;
    const W = this.screenCanvas.width;
    const H = this.screenCanvas.height;
    g.fillStyle = '#05070c';
    g.fillRect(0, 0, W, H);
    const score = red !== '' || blue !== '';
    if (score) {
      g.fillStyle = '#b71c1c';
      g.fillRect(0, 0, W * 0.32, H);
      g.fillStyle = '#0d47a1';
      g.fillRect(W * 0.68, 0, W * 0.32, H);
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#fff';
    if (score) {
      g.font = '800 96px "Chakra Petch", Arial, sans-serif';
      g.fillText(red, W * 0.16, H / 2);
      g.fillText(blue, W * 0.84, H / 2);
    }
    g.fillStyle = '#ffc72c';
    g.font = `800 ${score ? 76 : 56}px "Chakra Petch", Arial, sans-serif`;
    g.fillText(center, W / 2, H / 2);
    this.screenTex.needsUpdate = true;
  }
}

/** Manta LED genérica: texto del evento sobre un degradado rojo → azul. */
function ledTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 1024, 0);
  grd.addColorStop(0, '#8e1414');
  grd.addColorStop(0.5, '#0b0d12');
  grd.addColorStop(1, '#0d3a8e');
  g.fillStyle = grd;
  g.fillRect(0, 0, 1024, 64);
  g.fillStyle = '#ffffff';
  g.font = '700 40px "Chakra Petch", Impact, sans-serif';
  g.textBaseline = 'middle';
  for (const [x, t] of [
    [30, 'LABBOT RESCUE'],
    [390, 'WINTERFEST 2026'],
    [760, 'LAMBOT 3478'],
  ] as Array<[number, string]>)
    g.fillText(t, x, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}
