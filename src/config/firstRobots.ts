/**
 * Robots de referencia de juegos FIRST parecidos a LabBot Rescue (comparación en el proyecto:
 * "LabBot Rescue y los retos FIRST"). Cada uno es un `RobotSpec` con TODAS las variables llenas,
 * ADAPTADO a las reglas de LabBot: tanque obligatorio y sin bumpers (§7.2), chasis ≤ 65 × 65 cm,
 * ≤ 40 cm fuera del chasis y ≤ 100 cm de alto (§7.2). Los robots reales eran más grandes (FRC) o más
 * chicos (no hay FTC aquí) y varios eran swerve.
 *
 * Lo que dice la fuente de cada equipo va como dato; lo demás es SUPUESTO y está marcado. Las
 * medidas de FRC se recortan al máximo de LabBot. Masa: el límite de FRC era ≈ 54 kg sin batería
 * ni bumpers (SUPUESTO por conocimiento general, no verificado aquí); se usa como referencia.
 */
import type { Level } from '../core/types';
import { mm } from './field';
import { DEFAULT_ROBOT, MECHANISM_KINDS, PIVOT_ROBOT, ROBOT_PRESETS, TOWER_ROBOT, type MechanismKind, type RobotSpec } from './robot';

/** De dónde junta Muestras la IA y qué hace en el ENDGAME (como `BotOptions` de `ai/Bot.ts`). */
export interface FirstStrategy {
  level: Level;
  source?: 'any' | 'lab' | 'hp';
  endgame?: 'platform' | 'critical' | 'none';
}

export interface FirstRobot {
  id: FirstRobotId;
  team: number;
  robot: string;
  year: number;
  game: string;
  spec: RobotSpec;
  /** Cómo juega la IA con este robot (lo que le funcionó en su juego, traducido a LabBot). */
  strategy: FirstStrategy;
  /** Fuentes de los datos (página del equipo, technical binder o CAD). */
  sources: string[];
}

const ft = (x: number) => x * 0.3048; // ft/s → m/s
const deg = (x: number) => (x * Math.PI) / 180;

export type FirstRobotId = 'everybot18' | 'lockdown254' | 'baguette5940' | 'everybot23' | 'breakdown254' | 'team401' | 'rainbowdash2713' | 'skyfire254';

export const FIRST_ROBOTS: FirstRobot[] = [
  {
    id: 'everybot18',
    team: 118,
    robot: 'Everybot',
    year: 2018,
    game: 'POWER UP',
    // Fuente: robot de $1000 con piezas del kit; recibe cubos del PORTAL del HP en una "cubeta",
    // anota en el SWITCH (no en la SCALE) y no escala (lo sube un compañero). Ciclos de ≈ 5 s desde
    // el PORTAL según un usuario del foro (SUPUESTO). En LabBot: SWITCH ≈ N2, así que no llega a N3.
    spec: {
      ...DEFAULT_ROBOT,
      name: 'Everybot 2018',
      label: '118 Everybot 2018',
      mechanism: 'generic',
      length: mm(650),
      width: mm(600),
      baseHeight: mm(450),
      massKg: 45, // SUPUESTO: más ligero que un robot de punta
      maxSpeed: 3.3, // SUPUESTO: chasis del kit (≈ 10.7 ft/s)
      maxAccel: 5.0,
      maxOmega: 5.0,
      traction: 1.0,
      intake: { extension: mm(150), width: mm(450) }, // la boca de la cubeta (SUPUESTO); más corta, la IA se sale de la cancha junto a la Campana
      capacity: 1, // SUPUESTO: un cubo a la vez, como en su juego
      reach: mm(200),
      elevatorSpeed: 1.0, // SUPUESTO: cubeta que se inclina, lenta
      elevatorHeights: [mm(100), mm(260), mm(560), mm(560), mm(560)],
      maxLevel: 2,
    },
    strategy: { level: 2, source: 'hp', endgame: 'platform' },
    sources: ['https://www.chiefdelphi.com/t/the-robonauts-118-everybot/161897', 'https://grabcad.com/library/robonauts-everybot-2018-1'],
  },
  {
    id: 'lockdown254',
    team: 254,
    robot: 'Lockdown',
    year: 2018,
    game: 'POWER UP',
    // Fuente: tracción de 6 ruedas de dos velocidades, elevador de 2 etapas, intake que pivotea y
    // anota adelante o atrás a varias alturas, horquillas para levantar a un compañero, campeón de
    // Houston y Autonomous Award. En LabBot: elevador al frente con un depósito largo.
    spec: {
      ...DEFAULT_ROBOT,
      name: 'Lockdown',
      label: '254 Lockdown',
      mechanism: 'generic',
      length: mm(650),
      width: mm(650),
      baseHeight: mm(450),
      massKg: 54, // SUPUESTO: al límite de FRC
      maxSpeed: 4.0, // SUPUESTO: marcha alta (la fuente no da la velocidad)
      maxAccel: 7.0,
      maxOmega: 6.0,
      traction: 1.05,
      intake: { extension: mm(300), width: mm(450) },
      capacity: 1, // SUPUESTO: un cubo a la vez
      reach: mm(350), // intake que pivotea hacia afuera para soltar
      elevatorSpeed: 2.0, // SUPUESTO: elevador rápido
      elevatorHeights: [mm(100), mm(260), mm(560), mm(850), mm(640)],
    },
    strategy: { level: 3, source: 'any', endgame: 'platform' },
    sources: ['https://www.team254.com/frc/2018/', 'https://media.team254.com/2018/07/8fda07af-2018-Techbinder.pdf'],
  },
  {
    id: 'baguette5940',
    team: 5940,
    robot: 'Baguette',
    year: 2018,
    game: 'POWER UP',
    // Fuente (technical binder): West Coast Drive con 2 CIM por lado, ≈ 6 ft/s en baja y ≈ 13 ft/s en
    // alta, ruedas de 6 in con 2 in de altura libre; intake de dos brazos con ruedas compliant que se
    // abren con pistón; elevador en cascada con un 775pro.
    spec: {
      ...DEFAULT_ROBOT,
      name: 'Baguette',
      label: '5940 Baguette',
      mechanism: 'generic',
      length: mm(650),
      width: mm(650),
      baseHeight: mm(450),
      massKg: 54, // SUPUESTO: al límite de FRC
      maxSpeed: ft(13), // 3.96 m/s (marcha alta)
      maxAccel: 6.0,
      maxOmega: 5.5,
      traction: 1.0,
      intake: { extension: mm(300), width: mm(500) }, // brazos "sideswipe" que bajan al frente
      capacity: 1, // SUPUESTO: un cubo a la vez
      reach: mm(250),
      elevatorSpeed: 1.5, // SUPUESTO
      elevatorHeights: [mm(100), mm(260), mm(560), mm(850), mm(640)],
    },
    strategy: { level: 3, source: 'any', endgame: 'platform' },
    sources: ['https://www.chiefdelphi.com/uploads/default/original/3X/6/9/694a48cdda3beef7f26dfcdc5075ac25d12229b7.pdf'],
  },
  {
    id: 'everybot23',
    team: 118,
    robot: 'Everybot',
    year: 2023,
    game: 'CHARGED UP',
    // Fuente: chasis del kit recortado a 22 × 28.3 in, brazo pivotante con cadena y "roller claw" de
    // ruedas squishy; anota en las filas baja y media (no en la alta), entra y balancea la CHARGE
    // STATION, y es angosto para compartirla. En LabBot: pivote que llega a N2.
    spec: {
      ...PIVOT_ROBOT,
      name: 'Everybot 2023',
      label: '118 Everybot 2023',
      length: mm(650), // 28.3 in = 719 mm, recortado al máximo de §7.2
      width: mm(559), // 22 in
      baseHeight: mm(450),
      massKg: 45, // SUPUESTO
      maxSpeed: 3.3, // SUPUESTO: chasis del kit
      maxAccel: 5.0,
      maxOmega: 5.0,
      traction: 1.0,
      capacity: 1,
      arm: { pivotX: mm(110), pivotY: mm(440), length: mm(500), speed: 3, stowAngle: deg(127) }, // brazo de cadena, más lento (SUPUESTO)
      elevatorHeights: [0, mm(260), mm(560), mm(560), mm(600)],
      maxLevel: 2,
    },
    strategy: { level: 2, source: 'any', endgame: 'platform' },
    sources: ['https://www.chiefdelphi.com/t/the-2023-robonauts-everybot-low-resource-build/421783/', 'https://grabcad.com/library/the-2023-robonauts-everybot-1', 'https://firstinmichigan.us/FRC/2023-everybot/'],
  },
  {
    id: 'breakdown254',
    team: 254,
    robot: 'Breakdown',
    year: 2023,
    game: 'CHARGED UP',
    // Fuente: swerve (aquí tanque, §7.2), elevador rápido con "laterator" (brazo que sale de lado) y
    // pinza en la punta, intake de cubos del piso, horquillas para colgarse de otros en la CHARGE
    // STATION. En LabBot: elevador al frente con el depósito al máximo de 40 cm, y lleva la Crítica.
    spec: {
      ...DEFAULT_ROBOT,
      name: 'Breakdown',
      label: '254 Breakdown',
      mechanism: 'generic',
      length: mm(650),
      width: mm(650),
      baseHeight: mm(450),
      massKg: 55, // SUPUESTO: al límite de FRC 2023
      maxSpeed: 4.2, // SUPUESTO: su swerve era más rápido; tanque con CIM
      maxAccel: 7.0,
      maxOmega: 6.0,
      traction: 1.05,
      intake: { extension: mm(300), width: mm(450) },
      capacity: 1, // SUPUESTO: una pieza a la vez
      reach: mm(400), // el laterator al máximo de §7.2
      elevatorSpeed: 2.2, // SUPUESTO: "high-speed elevator"
      elevatorHeights: [mm(100), mm(260), mm(560), mm(850), mm(640)],
    },
    strategy: { level: 3, source: 'any', endgame: 'critical' },
    sources: ['https://www.team254.com/frc/2023/', 'https://media.team254.com/2023/10/90bc07c6-2023-Tech-Binder-V6.pdf'],
  },
  {
    id: 'team401',
    team: 401,
    robot: 'Robot 2023',
    year: 2023,
    game: 'CHARGED UP',
    // Fuente: swerve (aquí tanque), brazo con 250° de giro y 30 in de extensión, muñeca de 330° que
    // agarra en cualquier orientación y anota por los dos lados. En LabBot: pivote más largo (54 cm) y más
    // rápido, con el eje más bajo para que quepa guardado (§4.1).
    spec: {
      ...PIVOT_ROBOT,
      name: '401 (2023)',
      label: '401 (2023)',
      length: mm(650),
      width: mm(650),
      baseHeight: mm(400),
      massKg: 55, // SUPUESTO
      maxSpeed: 4.0, // SUPUESTO
      maxAccel: 6.5,
      maxOmega: 6.0,
      traction: 1.0,
      capacity: 1,
      arm: { pivotX: mm(90), pivotY: mm(350), length: mm(540), speed: 5, stowAngle: deg(127) },
      elevatorHeights: [0, mm(260), mm(560), mm(830), mm(600)],
    },
    strategy: { level: 3, source: 'any', endgame: 'critical' },
    sources: ['https://www.chiefdelphi.com/t/team-401-2022-and-2023-cad-releases/436607', 'https://team401.github.io/pdf/401_2023_Tech_Binder.pdf'],
  },
  {
    id: 'rainbowdash2713',
    team: 2713,
    robot: 'Rainbow Dash',
    year: 2023,
    game: 'CHARGED UP',
    // Fuente: swerve de 26.5 × 26.5 in (aquí tanque), elevador continuo con 2 NEO que saca 55 in,
    // intake de 4 barras con rodillos en la última etapa que se guarda dentro del robot. En LabBot:
    // elevador al frente, rápido, con intake que sale y se guarda.
    spec: {
      ...DEFAULT_ROBOT,
      name: 'Rainbow Dash',
      label: '2713 Rainbow Dash',
      mechanism: 'generic',
      length: mm(650), // 26.5 in = 673 mm, recortado a §7.2
      width: mm(650),
      baseHeight: mm(450),
      massKg: 55, // SUPUESTO
      maxSpeed: 4.0, // SUPUESTO
      maxAccel: 6.5,
      maxOmega: 6.0,
      traction: 1.0,
      intake: { extension: mm(350), width: mm(450) }, // 4 barras que salen del chasis
      capacity: 1,
      reach: mm(300),
      elevatorSpeed: 2.0, // SUPUESTO: elevador continuo
      elevatorHeights: [mm(100), mm(260), mm(560), mm(850), mm(640)],
    },
    strategy: { level: 3, source: 'any', endgame: 'platform' },
    sources: ['https://www.onshape.com/en/blog/red-hawk-robotics-world-championship', 'https://cad.onshape.com/documents/8bb8a620cd015d977bc57e69/w/c808c2431240746727811726/e/bbbc06a0eec6a6bc54c0573e'],
  },
  {
    id: 'skyfire254',
    team: 254,
    robot: 'Skyfire',
    year: 2012,
    game: 'REBOUND RUMBLE',
    // Fuente: tracción de 8 ruedas de dos velocidades con freno neumático, más de 20 ft/s, intake de
    // tres pelotas de ancho con tolva, lanzador de largo alcance y mecanismo para bajar el puente. En
    // LabBot no se lanza: torre que guarda y saca a N3, y la pala del puente lleva la Crítica.
    spec: {
      ...TOWER_ROBOT,
      name: 'Skyfire',
      label: '254 Skyfire',
      length: mm(650),
      width: mm(650),
      baseHeight: mm(950),
      massKg: 54, // SUPUESTO
      maxSpeed: ft(20), // 6.1 m/s
      maxAccel: 8.0, // SUPUESTO
      maxOmega: 6.5,
      traction: 1.15, // 8 ruedas (SUPUESTO)
      intake: { extension: mm(250), width: mm(500) },
      capacity: 3, // SUPUESTO: 3 pelotas, el máximo de su juego
      reach: mm(300),
      sampleExit: mm(830),
      critReach: mm(250),
      elevatorSpeed: 1.2,
      elevatorHeights: [mm(100), mm(260), mm(560), mm(600), mm(600)],
    },
    strategy: { level: 3, source: 'lab', endgame: 'critical' },
    sources: ['https://www.team254.com/frc/2012/'],
  },
];
/** Robot elegible: un tipo de las sugerencias de LabBot o un robot de referencia de FIRST. */
export type RobotId = MechanismKind | FirstRobotId;

export const ROBOT_IDS: readonly RobotId[] = [...MECHANISM_KINDS, ...FIRST_ROBOTS.map((r) => r.id)];

export const firstRobot = (id: RobotId): FirstRobot | undefined => FIRST_ROBOTS.find((r) => r.id === id);

/** El `RobotSpec` de cualquier robot elegible. */
export function robotSpec(id: RobotId): RobotSpec {
  return firstRobot(id)?.spec ?? ROBOT_PRESETS[id as MechanismKind];
}
