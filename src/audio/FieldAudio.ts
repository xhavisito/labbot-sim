/**
 * Sonidos del campo con Web Audio: los cues del FMS de FRC al iniciar el match, el TELEOP, el
 * ENDGAME y al terminar. Se tocan las grabaciones reales (`public/sounds/*.wav`, ver su
 * `LICENSES.md`, las mismas de rebuilt-sim); si un archivo no carga, una versión sintetizada.
 * El manual solo dice que "la señal de sonido dará el aviso" del TELEOP (§4.2); usar los sonidos de
 * FRC es SUPUESTO. Volumen en Ajustes (0 = silencio).
 */
import type { MatchEvent } from '../core/match';

/** Cue → archivo en `public/sounds/`. */
const FIELD_SOUNDS = {
  start: 'start.wav', // Cavalry Charge
  teleop: 'resume.wav', // 3 Bells
  endgame: 'warning.wav', // Steam Whistle
  end: 'end.wav', // Buzzer
} as const;
export type FieldCue = keyof typeof FIELD_SOUNDS;

/**
 * Cue que toca cada evento del match. Sin pausa entre AUTO y TELEOP (D9) el buzzer de fin de AUTO
 * caería encima de las campanas, así que ahí solo suenan las campanas (SUPUESTO).
 */
export function cueFor(e: MatchEvent): FieldCue | null {
  if (e.type === 'end') return 'end';
  if (e.type !== 'phase') return null;
  if (e.phase === 'AUTO') return 'start';
  if (e.phase === 'TELEOP') return 'teleop';
  if (e.phase === 'ENDGAME') return 'endgame';
  return null;
}

export class FieldAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private samples = new Map<FieldCue, AudioBuffer>();
  private loading = new Map<FieldCue, Promise<AudioBuffer | null>>();

  /** `volume` 0–1. */
  constructor(private volume: number) {
    // Se descargan y decodifican desde el inicio (el service worker los guarda para jugar sin
    // conexión). Se decodifican con un OfflineAudioContext, que no espera un gesto del usuario, para
    // que el primer cue (inicio del match) ya esté listo
    const decoder = typeof OfflineAudioContext === 'function' ? new OfflineAudioContext(1, 1, 44100) : null;
    for (const [k, file] of Object.entries(FIELD_SOUNDS) as Array<[FieldCue, string]>)
      this.loading.set(
        k,
        fetch(`${import.meta.env.BASE_URL}sounds/${file}`)
          .then((r) => (r.ok && decoder ? r.arrayBuffer() : null))
          .then((buf) => (buf && decoder ? decoder.decodeAudioData(buf) : null))
          .then((b) => {
            if (b) this.samples.set(k, b);
            return b;
          })
          .catch(() => null), // formato no soportado o sin red: queda la versión sintetizada
      );
    // El navegador solo deja sonar el AudioContext después de un gesto
    const unlock = () => {
      this.ensure();
      void this.ctx?.resume();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchend', unlock);
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.ctx) this.master.gain.value = this.volume;
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);
    return ctx;
  }

  /** Toca los cues de los eventos del match de este cuadro. */
  events(evs: readonly MatchEvent[]): void {
    for (const e of evs) {
      const c = cueFor(e);
      if (c) this.play(c);
    }
  }

  play(cue: FieldCue): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.volume <= 0) return;
    const buf = this.samples.get(cue);
    if (buf) return this.playBuffer(buf);
    // Aún decodificando: suena cuando esté, si no tarda (si no, la versión sintetizada)
    const t0 = ctx.currentTime;
    void this.loading.get(cue)?.then((b) => {
      if (b && ctx.currentTime - t0 < 1) this.playBuffer(b);
      else this.synth(cue, ctx.currentTime);
    });
  }

  private playBuffer(buf: AudioBuffer): void {
    const src = this.ctx!.createBufferSource();
    src.buffer = buf;
    src.connect(this.master);
    src.start();
  }

  private synth(cue: FieldCue, t: number): void {
    if (cue === 'start') this.cavalryCharge(t);
    else if (cue === 'teleop') this.threeBells(t);
    else if (cue === 'endgame') this.steamWhistle(t);
    else this.buzzer(t);
  }

  // ------------------------------------------------------------------ respaldo sintetizado
  private tone(freq: number, start: number, dur: number, o: { wave?: OscillatorType; gain?: number; attack?: number; release?: number; filter?: number; vibrato?: number } = {}): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = o.wave ?? 'sine';
    osc.frequency.setValueAtTime(freq, start);
    if (o.vibrato) {
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = 5.5;
      lg.gain.value = o.vibrato;
      lfo.connect(lg).connect(osc.frequency);
      lfo.start(start);
      lfo.stop(start + dur + 0.3);
    }
    const g = ctx.createGain();
    const peak = o.gain ?? 0.3;
    const atk = o.attack ?? 0.01;
    const rel = o.release ?? 0.08;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(peak, start + atk);
    g.gain.setValueAtTime(peak, start + Math.max(atk, dur - rel));
    g.gain.linearRampToValueAtTime(0, start + dur);
    let node: AudioNode = osc;
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.filter;
      node.connect(f);
      node = f;
    }
    node.connect(g).connect(this.master);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }

  /** "Cavalry Charge" (trompeta). */
  private cavalryCharge(t: number): void {
    const seq: Array<[number, number, number]> = [
      [392, 0, 0.13],
      [523.25, 0.15, 0.13],
      [659.25, 0.3, 0.13],
      [783.99, 0.45, 0.32],
      [659.25, 0.82, 0.13],
      [783.99, 0.97, 0.75],
    ];
    for (const [f, s, d] of seq) {
      this.tone(f, t + s, d, { wave: 'sawtooth', gain: 0.18, attack: 0.02, filter: 2600, vibrato: s > 0.9 ? 6 : 0 });
      this.tone(f * 2, t + s, d, { wave: 'square', gain: 0.03, attack: 0.02, filter: 3000 });
    }
  }

  /** "3 Bells". */
  private threeBells(t: number): void {
    for (let k = 0; k < 3; k++)
      for (const [mul, g] of [
        [1, 0.22],
        [2.76, 0.08],
        [5.4, 0.04],
      ] as const)
        this.tone(988 * mul, t + k * 0.42, 1.4, { gain: g, attack: 0.003, release: 1.3 });
  }

  /** "Steam Whistle". */
  private steamWhistle(t: number): void {
    for (const f of [523, 659, 784]) this.tone(f, t, 1.6, { gain: 0.09, attack: 0.12, release: 0.3, vibrato: 3 });
  }

  /** "Buzzer". */
  private buzzer(t: number): void {
    this.tone(110, t, 1.1, { wave: 'square', gain: 0.16, filter: 1400 });
    this.tone(165, t, 1.1, { wave: 'sawtooth', gain: 0.1, filter: 1200 });
  }
}
