/**
 * El gimnasio del WinterFest alrededor de la cancha (solo decorativo, como el estadio de
 * rebuilt-sim pero a escala de evento interno): duela, gradas vacías (sin público, en ninguna
 * calidad), estructuras con focos emisivos (el bloom les da brillo), mantas LED con texto genérico
 * y una pantalla con el marcador.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as F from '../config/field';
import { gymFloorTexture } from './textures';

export class Arena {
  readonly group = new THREE.Group();
  private screenCanvas: HTMLCanvasElement | null = null;
  private screenTex: THREE.CanvasTexture | null = null;
  private lastScreen = '';
  private led: THREE.Texture[] = [];
  /** Focos del techo: se ocultan si la cámara está arriba de ellos (vista superior). */
  private overhead = new THREE.Group();

  constructor() {
    this.group.name = 'arena';

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

  update(time: number, cameraY = 0): void {
    this.overhead.visible = cameraY < 7;
    for (const t of this.led) t.offset.x = (time * 0.04) % 1;
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
