/**
 * Estadísticas por robot de una repetición (puro): mapa de calor de dónde anduvo, distancia,
 * velocidad, Muestras y puntos que anotó (§4.4), y tiempos de ciclo.
 *
 * Ciclo (definición del sim, no del manual): una "ráfaga" de Muestras que el robot anota sin más de
 * `BURST_GAP` s entre una y otra; el tiempo de ciclo es lo que pasa del inicio de una ráfaga al de
 * la siguiente. Solo cuenta el TELEOP (en AUTO todos arrancan juntos).
 */
import * as F from '../config/field';
import { bounds } from '../core/clock';
import { GAME } from '../config/game';
import type { Level } from '../core/types';
import { frameTime, REPLAY_HZ, robotFrame, type Replay } from './format';

/** Celda del mapa de calor (m). */
export const HEAT_CELL = 0.25;
export const HEAT_COLS = Math.round(F.FIELD_LENGTH / HEAT_CELL);
export const HEAT_ROWS = Math.round(F.FIELD_WIDTH / HEAT_CELL);
/** Muestras anotadas a menos de esto (s) una de otra son la misma ráfaga. */
export const BURST_GAP = 2.5;

export interface RobotStats {
  index: number;
  /** Segundos en cada celda (columna = X, fila = Z), de −X a +X y de −Z a +Z. */
  heat: Float32Array;
  heatMax: number;
  /** Metros recorridos (en el piso, sin contar los saltos de la física). */
  distance: number;
  /** Velocidad promedio mientras se mueve (> 0.1 m/s) y máxima (m/s). */
  avgSpeed: number;
  maxSpeed: number;
  /** Segundos en su mitad de la cancha, en la del rival y sobre la Plataforma (sus rampas). */
  timeOwnHalf: number;
  timeRivalHalf: number;
  /** Muestras que anotó por nivel y periodo, y los puntos que dieron (valor del periodo, §4.4). */
  samples: Record<'AUTO' | 'TELEOP', Record<Level, number>>;
  samplePoints: number;
  /** Puntos de AUTO: su Línea de Autónomo + sus Muestras del AUTO (§4.4). */
  autoPoints: number;
  /** Muestras que recogió (intake o garra). */
  pickups: number;
  /** Ráfagas anotadas en el TELEOP y tiempos de ciclo (s). */
  cycles: number[];
  avgCycle: number | null;
  bestCycle: number | null;
  /** Tiempo (s) de cada Muestra anotada, para la línea de tiempo. */
  scoreTimes: number[];
  onPlatform: boolean;
  critical: boolean;
}

const emptyLevels = (): Record<Level, number> => ({ 1: 0, 2: 0, 3: 0 });

export function robotStats(r: Replay): RobotStats[] {
  const h = r.header;
  const teleopStart = bounds(GAME).teleopStart;
  // Quién dejó la Muestra Crítica: el último de la alianza que la soltó
  const critBy = new Map<string, number>();
  for (const e of r.events) if (e.type === 'release' && e.kind === 'critical') critBy.set(h.robots.find((x) => x.index === e.robot)?.alliance ?? '', e.robot);
  return h.robots.map((rb, i) => {
    const heat = new Float32Array(HEAT_COLS * HEAT_ROWS);
    let distance = 0;
    let moving = 0;
    let maxSpeed = 0;
    let own = 0;
    let rival = 0;
    let prev: { x: number; z: number; t: number } | null = null;
    const ownSign = rb.alliance === 'red' ? 1 : -1;
    for (let f = 0; f < h.frames; f++) {
      const p = robotFrame(r, f, i);
      const t = frameTime(r, f);
      const dt = prev ? t - prev.t : 1 / REPLAY_HZ;
      const c = Math.floor((p.x + F.HALF_L) / HEAT_CELL);
      const row = Math.floor((p.z + F.HALF_W) / HEAT_CELL);
      if (c >= 0 && c < HEAT_COLS && row >= 0 && row < HEAT_ROWS) heat[row * HEAT_COLS + c] += dt;
      if (Math.sign(p.x) === ownSign) own += dt;
      else rival += dt;
      if (prev && dt > 0) {
        const d = Math.hypot(p.x - prev.x, p.z - prev.z);
        const v = d / dt;
        // Un salto de más de 8 m/s es un reacomodo, no manejo
        if (v < 8) {
          distance += d;
          if (v > 0.1) moving += dt;
          maxSpeed = Math.max(maxSpeed, v);
        }
      }
      prev = { x: p.x, z: p.z, t };
    }
    const samples = { AUTO: emptyLevels(), TELEOP: emptyLevels() };
    let samplePoints = 0;
    let autoPoints = h.endgame.autoLine.includes(rb.index) ? GAME.points.autoLine : 0;
    const scoreTimes: number[] = [];
    let pickups = 0;
    for (const e of r.events) {
      if (e.type === 'intake' && e.robot === rb.index) pickups++;
      if (e.type !== 'score' || e.robot !== rb.index) continue;
      samples[e.period][e.level]++;
      samplePoints += e.points;
      if (e.period === 'AUTO') autoPoints += e.points;
      scoreTimes.push(e.t);
    }
    // Ráfagas del TELEOP → tiempos de ciclo
    const bursts: number[] = [];
    let last = -Infinity;
    for (const t of scoreTimes) {
      if (t >= teleopStart && t - last > BURST_GAP) bursts.push(t);
      last = t;
    }
    const cycles = bursts.slice(1).map((t, k) => Math.round((t - bursts[k]) * 10) / 10);
    return {
      index: rb.index,
      heat,
      heatMax: heat.reduce((a, b) => Math.max(a, b), 0),
      distance,
      avgSpeed: moving > 0 ? distance / moving : 0,
      maxSpeed,
      timeOwnHalf: own,
      timeRivalHalf: rival,
      samples,
      samplePoints,
      autoPoints,
      pickups,
      cycles,
      avgCycle: cycles.length ? cycles.reduce((a, b) => a + b, 0) / cycles.length : null,
      bestCycle: cycles.length ? Math.min(...cycles) : null,
      scoreTimes,
      onPlatform: h.endgame.platform.includes(rb.index),
      critical: h.endgame.critical[rb.alliance] && critBy.get(rb.alliance) === rb.index,
    };
  });
}

/** Muestras anotadas en total por un robot. */
export const totalSamples = (s: RobotStats): number => [1, 2, 3].reduce((a, l) => a + s.samples.AUTO[l as Level] + s.samples.TELEOP[l as Level], 0);
