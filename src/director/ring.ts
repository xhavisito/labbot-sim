/**
 * Búfer circular de cuadros del Modo Director (puro: sin Three.js ni Rapier, se prueba en Vitest).
 *
 * Guarda a ~30 Hz los últimos segundos de la sesión con el MISMO formato de cuadro que la repetición
 * (`replay/format.ts`: enteros de 16 bits). Todo vive en UN `Int16Array` preasignado: grabar un cuadro
 * no crea objetos, así que no mete tirones al simular. Al guardar un clip se copia el tramo (una sola vez).
 */
export const RECORD_HZ = 30;
export const BUFFER_SECONDS = 15;

export class FrameRing {
  readonly capacity: number;
  private data: Int16Array;
  private times: Float64Array;
  /** Siguiente casilla a escribir. */
  private head = 0;
  count = 0;

  constructor(
    /** Valores por cuadro (`frameSize` de la repetición). */
    readonly size: number,
    seconds = BUFFER_SECONDS,
    readonly hz = RECORD_HZ,
  ) {
    this.capacity = Math.ceil(seconds * hz) + 2;
    this.data = new Int16Array(this.capacity * size);
    this.times = new Float64Array(this.capacity);
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }

  /** Dónde escribir el cuadro nuevo: `data` y el desplazamiento (llamar a `commit` al terminar). */
  slot(): { data: Int16Array; offset: number } {
    return { data: this.data, offset: this.head * this.size };
  }

  /** Cierra el cuadro escrito con su tiempo de simulación (s, monótono). */
  commit(time: number): void {
    this.times[this.head] = time;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  /** Tiempo del cuadro más reciente (−∞ si está vacío). */
  get latest(): number {
    return this.count ? this.times[(this.head - 1 + this.capacity) % this.capacity] : -Infinity;
  }

  get oldest(): number {
    return this.count ? this.times[(this.head - this.count + this.capacity) % this.capacity] : Infinity;
  }

  /**
   * Copia los cuadros con tiempo en [t0, t1]. El primer valor de cada cuadro (tiempo, centésimas) se
   * reescribe relativo al inicio del clip. `null` si hay menos de 2.
   */
  extract(t0: number, t1: number): { data: Int16Array; frames: number; start: number; duration: number } | null {
    const idx: number[] = [];
    for (let k = 0; k < this.count; k++) {
      const i = (this.head - this.count + k + this.capacity) % this.capacity;
      if (this.times[i] >= t0 - 1e-9 && this.times[i] <= t1 + 1e-9) idx.push(i);
    }
    if (idx.length < 2) return null;
    const s = this.size;
    const out = new Int16Array(idx.length * s);
    const start = this.times[idx[0]];
    idx.forEach((i, k) => {
      out.set(this.data.subarray(i * s, (i + 1) * s), k * s);
      out[k * s] = Math.round((this.times[i] - start) * 100);
    });
    return { data: out, frames: idx.length, start, duration: this.times[idx[idx.length - 1]] - start };
  }
}
