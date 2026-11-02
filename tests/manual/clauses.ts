/**
 * Auditoría continua contra el manual del reto (game manual copy 2026.pdf).
 *
 * Cada cláusula trae su sección, la cita textual del manual (`quote`, como sale de `pdftotext
 * -layout` con los espacios juntados) y una revisión que la compara con el simulador. Las pruebas
 * (`tests/manual.test.ts`) corren todas las revisiones siempre; si el texto del manual está
 * disponible (`npm run audit:manual -- <pdf>`) además revisan que cada cita siga en el manual, para
 * enterarse cuando los organizadores lo cambian (§11.2 "puede sufrir modificaciones").
 *
 * `covers` dice qué números de `GAME` (config/game.ts) respalda la cláusula: una prueba exige que
 * todos tengan cita (o un SUPUESTO con su D en docs/reglas-reto.md).
 */
import { expect } from 'vitest';
import * as F from '../../src/config/field';
import { GAME } from '../../src/config/game';
import { MDF_THICKNESS, MOTOR_LIMITS, PLA_LIMIT_G } from '../../src/config/customRobots';
import { DEFAULT_ROBOT, ROBOT_LIMITS, validateRobot } from '../../src/config/robot';
import { bounds, formatTimer, phaseAt, timerSeconds } from '../../src/core/clock';
import { RULES } from '../../src/core/fouls';
import { Match } from '../../src/core/match';
import { ALLIANCE_SIZE, allianceCountFor, roundRobin, SERIES_WINS } from '../../src/core/tournament';
import { FOUL_POINTS, TABLE_4_4, TIMES } from './reference';

export interface Clause {
  id: string;
  section: string;
  /** Texto del manual (una o varias citas); se busca con los espacios normalizados. */
  quote: string | string[];
  /** Rutas de `GAME` que respalda, p. ej. 'points.sampleAuto.3'. */
  covers?: string[];
  /** SUPUESTOS (D de docs/reglas-reto.md) en los que se apoya la revisión. */
  supuestos?: string[];
  verify: () => void;
}

const none = { red: 0, blue: 0 };
const noCrit = { red: false, blue: false };
const m0 = () => {
  const m = new Match(GAME);
  m.start();
  return m;
};
/** Avanza el match hasta el segundo `t` (pasos de 1/120 s). */
export function until(m: Match, t: number): void {
  while (m.t < t - 1e-9) m.tick(Math.min(1 / 120, t - m.t));
  // Sin error de redondeo en los bordes (15 s, 120 s): el reloj queda justo en `t`
  if (m.running && m.t !== t) {
    m.t = t;
    m.tick(0);
  }
}

const sampleRow = (lv: 1 | 2 | 3) => () => {
  const row = TABLE_4_4.sample[lv];
  expect(GAME.points.sampleAuto[lv]).toBe(row.auto);
  expect(GAME.points.sampleTeleop[lv]).toBe(row.teleop);
  expect(row.endgame).toBe(row.teleop); // el sim usa un solo valor para TeleOp y EndGame
  const m = m0();
  expect(m.scoreSample('red', lv)).toBe(row.auto); // AUTO
  until(m, 60);
  expect(m.scoreSample('red', lv)).toBe(row.teleop); // TeleOp
  until(m, 140);
  expect(m.phase).toBe('ENDGAME');
  expect(m.scoreSample('red', lv)).toBe(row.endgame); // EndGame
};

export const CLAUSES: Clause[] = [
  // ------------------------------------------------------------------ Tiempos (§2, §4.2, §4.3)
  {
    id: 'auto-15',
    section: '§2, §4.2',
    quote: ['Cada match cuenta con 15 segundos de periodo autónomo', 'durante los primeros 15 segundos de match'],
    covers: ['times.auto'],
    verify: () => {
      expect(GAME.times.auto).toBe(TIMES.auto);
      expect(phaseAt(0, GAME)).toBe('AUTO');
      expect(phaseAt(TIMES.auto - 1e-3, GAME)).toBe('AUTO');
      expect(formatTimer(timerSeconds(0, GAME))).toBe('0:15');
    },
  },
  {
    id: 'teleop-135',
    section: '§2, §4.3',
    quote: ['En los 2 minutos y 15 segundos restantes', 'los drivers cuentan con 135 segundos'],
    covers: ['times.teleop'],
    verify: () => {
      expect(GAME.times.teleop).toBe(TIMES.teleop);
      const b = bounds(GAME);
      expect(b.teleopEnd - b.teleopStart).toBe(135);
      expect(formatTimer(timerSeconds(b.teleopStart, GAME))).toBe('2:15');
      expect(phaseAt(b.teleopEnd, GAME)).toBe('DONE');
    },
  },
  {
    id: 'teleop-after-auto',
    section: '§4.2',
    quote: 'Una vez que los 15 segundos de autónomo se terminen, la señal de sonido dará el aviso para el inicio del periodo de teleoperado.',
    covers: ['times.autoToTeleopPause'],
    supuestos: ['D9'],
    verify: () => {
      expect(GAME.times.autoToTeleopPause).toBe(0);
      expect(phaseAt(TIMES.auto, GAME)).toBe('TELEOP');
      expect(bounds(GAME).teleopEnd).toBe(150);
    },
  },
  {
    id: 'endgame-30',
    section: '§4.3.1, §4.1.1',
    quote: ['En los últimos 30 segundos del periodo TeleOperado se habilitará la Plataforma de Contención.', 'Solo puede ser tomada por el robot durante el endgame (últimos 30 segundos)'],
    covers: ['times.endgame'],
    verify: () => {
      expect(GAME.times.endgame).toBe(TIMES.endgame);
      const end = bounds(GAME).teleopEnd;
      expect(phaseAt(end - 30 - 1e-3, GAME)).toBe('TELEOP');
      expect(phaseAt(end - 30, GAME)).toBe('ENDGAME');
      expect(formatTimer(timerSeconds(end - 30, GAME))).toBe('0:30');
    },
  },
  {
    id: 'eval-at-buzzer',
    section: '§4.3.1',
    quote: 'Los puntos se otorgan al sonar la bocina final según la posición de los robots y las muestras depositadas.',
    supuestos: ['D16'],
    verify: () => {
      const m = m0();
      until(m, 150);
      // Antes de la bocina no hay puntos de Plataforma ni de Crítica; al sonar, sí
      expect(m.breakdown('red').platform + m.breakdown('red').critical).toBe(0);
      m.finish({ red: 2, blue: 0 }, { red: true, blue: false });
      expect(m.breakdown('red').platform + m.breakdown('red').critical).toBe(20 + 15);
    },
  },
  {
    id: 'no-score-after-buzzer',
    section: '§2, §4.3',
    quote: '¡El equipo con el mayor número de puntos al final del match será el ganador!',
    supuestos: ['D12'],
    verify: () => {
      const m = m0();
      until(m, 150);
      expect(m.scoreSample('blue', 3)).toBe(0);
      expect(m.crossAutoLine('blue', 2)).toBe(false);
    },
  },

  // ------------------------------------------------------------------ Puntos (§4.4)
  {
    id: 'auto-line',
    section: '§4.4',
    quote: ['Línea de Ambos 5 c/u - - 1', 'Cruzar la línea de autónomo'],
    covers: ['points.autoLine', 'rp.autoLine'],
    supuestos: ['D1', 'D2'],
    verify: () => {
      expect(GAME.points.autoLine).toBe(TABLE_4_4.autoLine.auto);
      expect(GAME.rp.autoLine).toBe(TABLE_4_4.autoLine.rp);
      const m = m0();
      m.crossAutoLine('red', 0);
      expect(m.breakdown('red').autoLine).toBe(5); // "5 c/u" (D2: aunque cruce uno)
      m.crossAutoLine('red', 0);
      expect(m.breakdown('red').autoLine).toBe(5); // una vez por robot
      until(m, 150);
      m.finish(none, noCrit);
      expect(m.rankingPoints('red').autoLine).toBe(false); // el RP pide "ambos robots"
      const m2 = m0();
      m2.crossAutoLine('blue', 2);
      m2.crossAutoLine('blue', 3);
      until(m2, 15);
      expect(m2.crossAutoLine('blue', 2)).toBe(false); // solo en AUTO
      until(m2, 150);
      m2.finish(none, noCrit);
      expect(m2.breakdown('blue').autoLine).toBe(10);
      expect(m2.rankingPoints('blue').autoLine).toBe(true);
    },
  },
  { id: 'sample-n1', section: '§4.4', quote: 'Muestra El robot 5 2 2 -', covers: ['points.sampleAuto.1', 'points.sampleTeleop.1'], supuestos: ['D4'], verify: sampleRow(1) },
  { id: 'sample-n2', section: '§4.4', quote: 'Muestra El robot 10 6 6 -', covers: ['points.sampleAuto.2', 'points.sampleTeleop.2'], supuestos: ['D4'], verify: sampleRow(2) },
  { id: 'sample-n3', section: '§4.4', quote: 'Muestra El robot 18 15 15 -', covers: ['points.sampleAuto.3', 'points.sampleTeleop.3'], supuestos: ['D4'], verify: sampleRow(3) },
  {
    id: 'platform',
    section: '§4.4 (nota)',
    quote: [
      'Robot en 1 robot de la - - 10 -',
      'Alianza en 2 robots de - - 20 -',
      'Los puntos de Robot en Plataforma y Alianza en Plataforma no son acumulables. Si 2 robots están en la Plataforma se otorgan 20 puntos totales (no 10 + 20).',
    ],
    covers: ['points.platformOne', 'points.platformTwo'],
    supuestos: ['D5', 'D28'],
    verify: () => {
      expect(GAME.points.platformOne).toBe(TABLE_4_4.robotOnPlatform);
      expect(GAME.points.platformTwo).toBe(TABLE_4_4.allianceOnPlatform);
      for (const [n, want] of [
        [0, 0],
        [1, 10],
        [2, 20],
      ] as const) {
        const m = m0();
        until(m, 150);
        m.finish({ red: n, blue: 0 }, noCrit);
        expect(m.breakdown('red').platform).toBe(want);
      }
    },
  },
  {
    id: 'critical',
    section: '§4.4, §4.3.1',
    quote: ['Muestra 1 robot de la - - 15 1', 'Cada alianza deposita su propia Muestra Crítica.'],
    covers: ['points.critical', 'rp.critical'],
    supuestos: ['D16', 'D29'],
    verify: () => {
      expect(GAME.points.critical).toBe(TABLE_4_4.critical.endgame);
      expect(GAME.rp.critical).toBe(TABLE_4_4.critical.rp);
      const m = m0();
      until(m, 150);
      m.finish(none, { red: false, blue: true });
      expect(m.breakdown('blue').critical).toBe(15);
      expect(m.breakdown('red').critical).toBe(0);
      expect(m.rankingPoints('blue').critical).toBe(true);
    },
  },
  {
    id: 'dominance',
    section: '§4.4',
    quote: ['Dominio La alianza - - - 1', 'tiene ≥10', 'muestras anotadas en su Cámara al final del match'],
    covers: ['rp.dominance', 'rp.dominanceSamples'],
    verify: () => {
      expect(GAME.rp.dominance).toBe(TABLE_4_4.dominance.rp);
      expect(GAME.rp.dominanceSamples).toBe(TABLE_4_4.dominance.samples);
      const m = m0();
      // Cuentan las del AUTO y las del TELEOP; las faltas del rival no son Muestras
      for (let i = 0; i < 4; i++) m.scoreSample('red', 1);
      until(m, 30);
      for (let i = 0; i < 5; i++) m.scoreSample('red', 2);
      m.foul('CONTACT', 'blue', 2);
      until(m, 150);
      m.finish(none, noCrit);
      expect(m.rankingPoints('red').dominance).toBe(false); // 9
      const m2 = m0();
      for (let i = 0; i < 10; i++) m2.scoreSample('blue', 1);
      until(m2, 150);
      m2.finish(none, noCrit);
      expect(m2.rankingPoints('blue').dominance).toBe(true); // 10 = "≥10"
    },
  },
  {
    id: 'tie-win',
    section: '§4.4',
    quote: ['Empate Ambas - - - 1', 'Victoria Al terminar el - - - 2'],
    covers: ['rp.tie', 'rp.win'],
    verify: () => {
      expect(GAME.rp.tie).toBe(TABLE_4_4.tie);
      expect(GAME.rp.win).toBe(TABLE_4_4.win);
      const tie = m0();
      until(tie, 150);
      tie.finish(none, noCrit);
      expect([tie.rankingPoints('red').win, tie.rankingPoints('blue').win]).toEqual([1, 1]);
      const w = m0();
      until(w, 30);
      w.scoreSample('blue', 1);
      until(w, 150);
      w.finish(none, noCrit);
      expect([w.rankingPoints('red').win, w.rankingPoints('blue').win]).toEqual([0, 2]);
    },
  },
  {
    id: 'rp-max',
    section: '§4.4',
    quote: 'Victoria Al terminar el - - - 2',
    verify: () => {
      // Máximo por match: victoria 2 + línea 1 + Crítica 1 + Dominio 1 = 5
      const m = m0();
      m.crossAutoLine('red', 0);
      m.crossAutoLine('red', 1);
      for (let i = 0; i < 10; i++) m.scoreSample('red', 3);
      until(m, 150);
      m.finish({ red: 2, blue: 0 }, { red: true, blue: false });
      expect(m.rankingPoints('red').total).toBe(5);
    },
  },

  // ------------------------------------------------------------------ Faltas (§4.5, §4.6, §4.2)
  {
    id: 'foul-4',
    section: '§4.5',
    quote: 'Cada foul otorga 4 puntos al equipo contrario',
    covers: ['fouls.foul'],
    supuestos: ['D30'],
    verify: () => {
      expect(GAME.fouls.foul).toBe(FOUL_POINTS.foul);
      const m = m0();
      m.foul('CONTACT', 'red', 0);
      expect(m.breakdown('blue').penalties).toBe(4);
      expect(m.breakdown('red').penalties).toBe(0);
    },
  },
  {
    id: 'tech-8',
    section: '§4.6',
    quote: 'Cada Tech Foul otorga 8 puntos al equipo contrario',
    covers: ['fouls.tech'],
    verify: () => {
      expect(GAME.fouls.tech).toBe(FOUL_POINTS.tech);
      const m = m0();
      m.foul('OUT_OF_BOUNDS', 'blue', 2);
      expect(m.breakdown('red').penalties).toBe(8);
      expect(m.breakdown('blue').penalties).toBe(0);
    },
  },
  {
    id: 'fouls-4.5',
    section: '§4.5',
    quote: ['Por hacer pinning contra el equipo contrario.', 'Entrar en contacto con los robots de la alianza contraria.'],
    supuestos: ['D11', 'D15'],
    verify: () => {
      for (const r of ['PIN', 'CONTACT'] as const) {
        expect(RULES[r].kind).toBe('FOUL');
        expect(RULES[r].section).toContain('§4.5');
      }
    },
  },
  {
    id: 'tech-4.6',
    section: '§4.6',
    quote: [
      'Tocar a un robot en una de las zonas del color de la alianza contraria.',
      'El robot sale de los límites de la cancha.',
      'Bloquear u obstruir las zonas del equipo contrario deliberadamente.',
      'Subir a la Plataforma de Contención antes del inicio del endgame (últimos 30 segundos).',
      'Tomar la Muestra Crítica antes del inicio del endgame.',
      'Tirar intencionalmente la Muestra Crítica del equipo contrario de la Repisa de Seguridad.',
    ],
    supuestos: ['D8', 'D17', 'D21', 'D23', 'D33'],
    verify: () => {
      for (const r of ['ZONE_CONTACT', 'OUT_OF_BOUNDS', 'OBSTRUCT', 'PLATFORM_EARLY', 'CRITICAL_EARLY', 'CRITICAL_KNOCK'] as const) {
        expect(RULES[r].kind).toBe('TECH');
        expect(RULES[r].section).toContain('§4.6');
      }
    },
  },
  {
    id: 'auto-center',
    section: '§4.2',
    quote: 'Los robots no pueden cruzar la línea central durante el periodo autónomo.',
    supuestos: ['D7', 'D22'],
    verify: () => {
      // El manual no le asigna falta: el sim cobra un Foul y lo marca como SUPUESTO
      expect(RULES.AUTO_CENTER.kind).toBe('FOUL');
      expect(RULES.AUTO_CENTER.supuesto).toMatch(/D7/);
      expect(F.CENTER_LINE_X).toBe(0);
    },
  },

  // ------------------------------------------------------------------ Tarjetas (§4.3.3)
  {
    id: 'two-yellows',
    section: '§4.3.3',
    quote: 'Acumular 2 Yellow Cards.',
    covers: ['fouls.yellowsForRed'],
    supuestos: ['D25'],
    verify: () => {
      expect(GAME.fouls.yellowsForRed).toBe(2);
      const m = m0();
      m.card('YELLOW', 0, 'red', 'a');
      expect(m.cards.some((c) => c.type === 'RED')).toBe(false);
      m.card('YELLOW', 0, 'red', 'b');
      expect(m.cards.filter((c) => c.type === 'RED')).toHaveLength(1);
    },
  },
  {
    id: 'red-card',
    section: '§4.3.3',
    quote: 'Se trata de la pérdida de todos los puntos de un match para el equipo que la reciba',
    supuestos: ['D10'],
    verify: () => {
      const m = m0();
      m.crossAutoLine('red', 0);
      m.crossAutoLine('red', 1);
      for (let i = 0; i < 10; i++) m.scoreSample('red', 3);
      m.foul('CONTACT', 'red', 0); // 4 para azul
      m.card('RED', 0, 'red', 'conducta');
      until(m, 150);
      m.finish(none, { red: true, blue: false });
      expect(m.score('red')).toBe(0);
      expect(m.rankingPoints('red').total).toBe(0);
      // El rival conserva los puntos de las faltas y gana el match
      expect(m.score('blue')).toBe(4);
      expect(m.rankingPoints('blue').win).toBe(2);
    },
  },

  // ------------------------------------------------------------------ Cancha (§3)
  {
    id: 'field',
    section: '§3.1',
    quote: 'Con dimensiones de 700 cm x 900 cm',
    supuestos: ['D13'],
    verify: () => {
      expect(F.FIELD_WIDTH).toBe(7);
      expect(F.FIELD_LENGTH).toBe(9);
    },
  },
  {
    id: 'symmetry',
    section: '§3.2, §3.2.2',
    quote: 'Cada robot tiene asignado un color (rojo/azul) para trabajar en su propia área.',
    verify: () => {
      // Rojo en +X; azul = rotación de 180° (x, z) → (−x, −z)
      expect(F.CAMARA_X_END_RED).toBeGreaterThan(0);
      expect(F.forAlliance('blue', { x: 1.2, z: -3 })).toEqual({ x: -1.2, z: 3 });
      expect(F.forAlliance('red', { x: 1.2, z: -3 })).toEqual({ x: 1.2, z: -3 });
    },
  },
  {
    id: 'start-zones',
    section: '§3.2.1',
    quote: 'Cada alianza cuenta con 2 Zonas de Inicio, una por robot participante en el match.',
    supuestos: ['D31'],
    verify: () => {
      expect(F.START_ZONES_RED).toHaveLength(2);
      for (const z of F.START_ZONES_RED) {
        expect(z.x0).toBeGreaterThan(0); // en la mitad roja
        expect(Math.min(z.x1 - z.x0, z.z1 - z.z0)).toBeGreaterThanOrEqual(ROBOT_LIMITS.maxChassis);
      }
    },
  },
  {
    id: 'lab',
    section: '§3.2.2, §4.1.1',
    quote: ['contiene 16 Muestras de Laboratorio distribuidas simétricamente', 'Cantidad inicial en cancha: 16 muestras en el Laboratorio'],
    verify: () => {
      expect(F.LAB_SAMPLES).toBe(16);
      const s = F.labSpots();
      expect(s).toHaveLength(16);
      for (const p of s) expect(s.some((q) => Math.abs(q.x + p.x) < 1e-9 && Math.abs(q.z + p.z) < 1e-9)).toBe(true);
    },
  },
  {
    id: 'camara',
    section: '§3.2.3',
    quote: [
      'Largo total: 2150 mm',
      'Ancho: 600 mm',
      'Altura máxima: 800 mm',
      'Nivel 1: 789 mm de largo × 600 mm de ancho — apertura a 200 mm del suelo',
      'Nivel 2: 689 mm de largo × 600 mm de ancho — apertura a 500 mm del suelo',
      'Nivel 3: 639 mm de largo × 600 mm de ancho — apertura a 800 mm del suelo',
    ],
    verify: () => {
      expect(F.CAMARA_LENGTH).toBeCloseTo(2.15, 9);
      expect(F.CAMARA_WIDTH).toBeCloseTo(0.6, 9);
      expect(F.CAMARA_HEIGHT).toBeCloseTo(0.8, 9);
      expect(F.CAMARA_LEVELS[1]).toEqual({ length: 0.789, rim: 0.2 });
      expect(F.CAMARA_LEVELS[2]).toEqual({ length: 0.689, rim: 0.5 });
      expect(F.CAMARA_LEVELS[3]).toEqual({ length: 0.639, rim: 0.8 });
      // Una por alianza, en el lado de su mitad de cancha
      expect(F.CAMARA_X_END_RED - F.CAMARA_LENGTH).toBeGreaterThan(0);
      expect(F.CAMARA_Z_RED[1]).toBeCloseTo(F.HALF_W, 9);
    },
  },
  {
    id: 'campana',
    section: '§3.2.4',
    quote: [
      'Pared principal: 2000 mm de largo × 610 mm de alto',
      'Ranura inferior (Muestras de Laboratorio): 1850.80 mm de ancho × 160 mm de alto, ubicada a 200 mm del suelo.',
      'Barra lateral de obstáculo: 1250 mm de largo × 50.80 mm de ancho.',
    ],
    verify: () => {
      expect(F.CAMPANA_LENGTH).toBeCloseTo(2.0, 9);
      expect(F.CAMPANA_HEIGHT).toBeCloseTo(0.61, 9);
      expect(F.CAMPANA_SLOT_WIDTH).toBeCloseTo(1.8508, 9);
      expect(F.CAMPANA_SLOT_HEIGHT).toBeCloseTo(0.16, 9);
      expect(F.CAMPANA_SLOT_Y).toBeCloseTo(0.2, 9);
      expect(F.BARRIER_LENGTH).toBeCloseTo(1.25, 9);
      expect(F.BARRIER_WIDTH).toBeCloseTo(0.0508, 9);
    },
  },
  {
    id: 'plataforma',
    section: '§3.2.5',
    quote: [
      'Longitud total horizontal: 1800 mm',
      'Longitud de la superficie inclinada: 1035.28 mm',
      'Inclinación: 15°',
      'Plataforma horizontal superior: 800 mm de largo',
      'Altura del escalón: 300 mm desde el nivel de la plataforma superior',
    ],
    supuestos: ['D6'],
    verify: () => {
      expect(F.RAMP_TOTAL_RUN).toBeCloseTo(1.8, 9);
      expect(F.RAMP_SLOPE_LENGTH).toBeCloseTo(1.03528, 9);
      expect((F.RAMP_ANGLE * 180) / Math.PI).toBeCloseTo(15, 9);
      expect(F.PLATFORM_TOP_LENGTH).toBeCloseTo(0.8, 9);
      expect(F.REPISA_STEP).toBeCloseTo(0.3, 9);
      // Las medidas cuadran entre sí: 1035.28 × cos 15° = 1000 mm; 1000 + 800 = 1800 mm
      expect(F.RAMP_RUN + F.PLATFORM_TOP_LENGTH).toBeCloseTo(F.RAMP_TOTAL_RUN, 4);
    },
  },

  // ------------------------------------------------------------------ Piezas y setup (§4.1)
  {
    id: 'pieces',
    section: '§4.1.1',
    quote: [
      'Dimensiones: (150 mm × 150 mm × 150 mm)',
      'Muestras disponibles para el HP: 10 por alianza por match',
      'Dimensiones: 200 mm × 200 mm × 200 mm',
      'Cantidad: 1 por alianza por match',
    ],
    verify: () => {
      expect(F.SAMPLE_SIZE).toBeCloseTo(0.15, 9);
      expect(F.CRITICAL_SIZE).toBeCloseTo(0.2, 9);
      expect(F.HP_SAMPLES_PER_ALLIANCE).toBe(10);
    },
  },
  {
    id: 'preload',
    section: '§4.1',
    quote: 'Es posible pre-cargar el robot con 1 Muestra de Laboratorio al inicio del match.',
    supuestos: ['D3'],
    verify: () => expect(F.PRELOAD_PER_ROBOT).toBe(1),
  },

  // ------------------------------------------------------------------ Robot (§7)
  {
    id: 'robot-size',
    section: '§7.2',
    quote: [
      'Las medidas máximas del perímetro del robot son de 65 × 65 cm',
      'se agregan 40 cm de extensión en cualquier dirección',
      'La altura máxima del robot es de 100 cm (1000 mm). No hay límite de peso.',
    ],
    supuestos: ['D24'],
    verify: () => {
      expect(ROBOT_LIMITS.maxChassis).toBeCloseTo(0.65, 9);
      expect(ROBOT_LIMITS.maxExtension).toBeCloseTo(0.4, 9);
      expect(ROBOT_LIMITS.maxHeight).toBeCloseTo(1.0, 9);
      expect(validateRobot(DEFAULT_ROBOT)).toEqual([]);
      expect(validateRobot({ ...DEFAULT_ROBOT, length: 0.66 }).join()).toMatch(/65 × 65/);
      expect(validateRobot({ ...DEFAULT_ROBOT, baseHeight: 1.01 }).join()).toMatch(/100 cm/);
    },
  },
  {
    id: 'motors',
    section: '§7.3, §7.1, §7.1.1',
    quote: [
      'El número de motores máximos permitidos es 6 CIMs, 1 Kraken x44, 3 Kraken x60 y 1 NEO.',
      'Madera tipo MDF de 5.5 mm de grosor.',
      'Cada equipo cuenta con 150 g de material para imprimir (PLA Tough+).',
    ],
    verify: () => {
      expect(MOTOR_LIMITS).toEqual({ cim: 6, x44: 1, x60: 3, neo: 1 });
      expect(MDF_THICKNESS).toBeCloseTo(0.0055, 9);
      expect(PLA_LIMIT_G).toBe(150);
    },
  },

  // ------------------------------------------------------------------ Torneo (§8.2)
  {
    id: 'tournament',
    section: '§8.2, §8.2.2',
    quote: [
      'El torneo cuenta con 8 equipos divididos en 4 alianzas de 2. En cada match participan 2 robots por alianza (4 robots en total en cancha).',
      'todos los matches serán a 2 de 3 victorias para cada alianza.',
    ],
    supuestos: ['D20'],
    verify: () => {
      expect(F.ROBOTS_PER_ALLIANCE).toBe(2);
      expect(ALLIANCE_SIZE).toBe(2);
      expect(allianceCountFor(8)).toBe(4);
      expect(SERIES_WINS).toBe(2);
      expect(roundRobin(4)).toHaveLength(6);
    },
  },
];
