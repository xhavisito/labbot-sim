# PLAN — LabBot Rescue Sim (propuesta, pendiente de visto bueno)

Simulador 3D web del reto interno **LabBot Rescue 2026**. Reglas: solo `docs/reglas-reto.md`
(resumen del manual con secciones citadas). Referencia de arquitectura: `rebuilt-sim` (solo lectura).

## 1. Estado de los repos

**labbot-sim**: vacío (sin commits, sin ramas remotas). No hay convenciones previas que respetar,
así que propongo adoptar las de rebuilt-sim (mismo autor, mismo stack) adaptadas.

**rebuilt-sim** (≈31 k líneas TS, 61 commits): Vite 8 + TypeScript 6 estricto + Three.js 0.186
(WebGL2) + Rapier3D compat 0.21 (WASM embebido) + Vitest 5 + Playwright; UI en DOM sin framework,
i18n es-MX/en, PWA con `sw.js` propio, deploy a GitHub Pages con Actions.

| rebuilt-sim | ¿Se toma? | Cómo |
|---|---|---|
| Capas `core/` (puro, sin Three/Rapier, con pruebas) · `config/` · `physics/` · `render/` · `input/` · `game/` (sesión que une todo) · `ui/` | **Sí, la idea** | Misma separación; código nuevo. |
| `core/clock.ts`: fases como tabla de fronteras + `phaseAt(t)` | Sí, idea | AUTO 15 / TELEOP 135 / ENDGAME = últimos 30. Sin SHIFTS ni pausa de 3 s ni gracia de 3 s (son de REBUILT). |
| `core/match.ts`: máquina de estados que recibe eventos físicos y emite eventos (fase, falta, fin) | Sí, idea | Eventos de LabBot: muestra depositada (nivel), cruce de línea, evaluación final (plataforma, Muestra Crítica, Dominio). |
| `core/fouls.ts` catálogo de reglas con código y texto · `core/rp.ts` | Sí, idea | Catálogo con §4.5/§4.6 en lugar de G4xx; RP de §4.4. |
| Coordenadas: origen al centro, Y arriba, simetría 180°, `inch()` con medida original en comentario | Sí | Aquí todo viene en mm/cm: `mm()` y la medida del manual en comentario. |
| Física: paso fijo 120 Hz + interpolación; robot = cuerpo dinámico con tracción limitada por μ·m·g; modo `tank` ya existente | Sí, idea | Solo tanque (§7.2), sin bumpers; cubos (no pelotas) como cuerpos Rapier caja. |
| Pool de piezas (cuerpo deshabilitado = pieza guardada, contador lógico) | Sí, idea | Muestras dentro del robot o anotadas = lógicas. |
| Árbitro automático con umbrales documentados por regla | Sí, idea | Faltas de §4.5/4.6 que se pueden detectar (contacto, pinning, salir de la cancha, Plataforma/Muestra Crítica antes del endgame, zonas rivales). |
| Input con acciones abstractas (teclado, gamepad, táctil) | Sí, simplificado | Teclado + gamepad en H4; táctil después. |
| HUD/menús DOM + `t('clave')` | Sí | es-MX por defecto. |
| Balística, HUB, FUEL, TOWER, SHIFTS, CAD de robots reales, en línea (WebRTC/MQTT), repeticiones, IA en capas, ranking, Supabase, PWA | **No** (por ahora) | No aplican al reto o son extras; se evalúan después del simulador funcional. |

## 2. Stack (sin dependencias pesadas)
- Runtime: `three`, `@dimforge/rapier3d-compat` (las mismas versiones exactas que rebuilt-sim).
- Dev: `vite`, `typescript`, `vitest`, `@types/three`; `playwright` solo para capturas/e2e (se puede
  usar el Chromium preinstalado en la nube).
- Nada más. Sin framework de UI.

## 3. Árbol propuesto
```
index.html · vite.config.ts · tsconfig.json · package.json · README.md · CLAUDE.md
docs/reglas-reto.md · docs/PLAN.md
src/
  main.ts                 carga Rapier y arranca App
  config/game.ts          TIEMPOS, PUNTOS, FALTAS, RP (cada número con su §)
  config/field.ts         medidas y posiciones de la cancha (mm del manual en comentario; [fig.] marcadas)
  config/robot.ts         RobotSpec (65×65 cm, alto ≤100 cm, extensión ≤40 cm, tanque) + presets
  core/                   PURO + pruebas
    types.ts  clock.ts  scoring.ts  fouls.ts  rp.ts  match.ts  rng.ts
  physics/                PhysicsWorld.ts  FieldColliders.ts  Pieces.ts (Muestras/Críticas)  RobotPhysics.ts (tanque)
  game/                   GameSession.ts  Robot.ts  Mechanisms.ts (intake/elevador/depósito)  HumanPlayer.ts  Sensors.ts (detección de anotación, plataforma, línea)
  referee/Referee.ts      faltas automáticas
  render/                 Renderer.ts  FieldView.ts  RobotView.ts  PieceView.ts  CameraRig.ts
  input/                  actions.ts  InputManager.ts (teclado + gamepad)
  ui/                     i18n.ts  Hud.ts  Menu.ts  Results.ts  styles.css
  auto/                   rutinas simples de AUTO (H5)
tests/                    clock, scoring, fouls/cards, rp, match (casos borde), field (cuadres de medidas)
```

## 4. Hitos (commits atómicos `feat(hito-N): …`)
1. **Cancha y piezas** — `config/field.ts` + colisionadores + vista 3D: cancha 9×7 m, Zonas de Inicio,
   Laboratorio (16 Muestras), Cámaras (3 niveles con aperturas a 200/500/800 mm), Campanas con ranura
   y barra, Plataforma (rampas 15°, repisa +300 mm). Pruebas de cuadre (1035.28·cos15° = 1000 mm,
   simetría 180°, todo dentro de 9×7). Cámara libre/superior para revisar.
2. **Robot** — tanque con tracción limitada, 65×65 cm, mecanismo genérico: intake al piso, almacenamiento
   (capacidad configurable, el manual no limita), elevador/depósito con altura objetivo N1/N2/N3 y
   repisa; tomar la Muestra Crítica de la rendija. Colisiones robot–cancha–piezas; subir la rampa.
3. **Lógica de juego** — reloj y fases, sensores de anotación por nivel con el valor del periodo,
   línea de autónomo, evaluación final (Plataforma no acumulable, Muestra Crítica, Dominio ≥10),
   faltas/Tech Fouls/tarjetas (2 Yellow = Red = 0 puntos), RP. Pruebas unitarias con casos borde
   (empate, Red Card, 1 vs 2 robots en plataforma, muestra al segundo 15.0, etc.).
4. **UI y controles** — marcador, timer, aviso de ENDGAME, desglose de puntos y RP al final;
   teclado y gamepad; cámaras (piloto, seguimiento, superior); 1 jugador + 3 robots quietos o
   controlados por teclas alternas.
5. **Configuración, pruebas y extras** — pantalla de ajustes (puntos/tiempos editables desde `config`),
   modo práctica (sin reloj, reiniciar piezas), HP automático, rutinas simples de AUTO, IA básica,
   registro de eventos del match (log exportable). Repetición/en línea solo si lo pides.
   *Hecho:* los puntos y tiempos se quedan en `config/game.ts` (son reglas, no ajustes de usuario);
   la pantalla de Ajustes cambia IA, rutinas de AUTO, velocidad y capacidad de tu robot y el Human
   Player (`config/settings.ts`). IA en `ai/Bot.ts`; registro en `core/matchLog.ts`.
6. **Tipos de robot** (pedido después del plan) — Elevador (plataforma que sube y empuja las Muestras
   por atrás) y Pivote (brazo con garra), elegibles en el menú.
   *Hecho:* `RobotSpec.mechanism` + presets en `config/robot.ts`; `Mechanisms` saca las piezas al
   frente, atrás o en la punta del brazo; la IA anota de reversa con el elevador.
   *Pivote con hopper* (idea del equipo, 26-oct): `pivotHopper`, brazo con garra entre las paredes de
   un hopper de 4; la garra pasa cada Muestra al hopper y la saca para anotar. Diseño en MDF en
   `docs/pivote-hopper.md`.
7. **Scouting y estrategia** (pedido después) — registro por equipo y match (simulado o capturado),
   tabla, calendario de clasificación, selección de alianzas y pronóstico de eliminatorias.
   *Hecho:* cada Muestra recuerda el robot que la soltó (`Piece.lastRobot`) y el match guarda quién
   subió a la Plataforma y quién dejó la Crítica; `core/scouting.ts` y `core/tournament.ts` (formato
   SUPUESTO y configurable: 5 matches por equipo, 4 alianzas de 2, ranking por RP, 1 vs 4 y 2 vs 3);
   pantalla `ui/Scouting.ts` con datos en localStorage (`game/scoutStore.ts`). Meta con solo robots
   con mecanismo: `npm run batch -- --set mech`.
8. **IA rival** (pedido después) — rivales dignos: robots de la IA de tipos distintos en cada match,
   ciclos eficientes, Muestra Crítica y Plataforma en el ENDGAME, coordinación de la alianza, sin
   faltas ni defensa (§4.5, §4.6, §6.1) y tres dificultades. Se quitaron los robots FIRST de prueba.
   *Hecho:* `ai/Bot.ts` reescrito (tiempos estimados, varias Muestras por viaje, acomodo fino frente
   a la Cámara, filtro de orilla y Plataforma), `ai/Team.ts` (reparto de Muestras, Human Player,
   Cámara y Crítica), `ai/difficulty.ts` (SUPUESTOS de diseño, no del manual), `ai/lineup.ts`.
   La IA anterior queda en `sim/legacyBot.ts` para comparar: `npm run batch -- --set ai --a hard --b old`.
   *Juego en equipo* (pedido después: "juegan como si fueran los únicos en la cancha"): no empuja a
   nadie (D41, `Bot.noPush` con `ai/contact.ts`), rodea por la rejilla (`ai/grid.ts`) al toparse, no
   se pelea Muestras ni la Campana con otros robots; el lote mide `empuja(s)` y `empujón máx(s)`.
9. **Modo torneo** (pedido después, "como en rebuilt-sim") — Qualifications contra la IA, ranking,
   selección de alianzas por invitación y PlayOffs, con el formato del manual (§8.2).
   *Hecho:* `core/tournament.ts` (parte de abajo: calendario con `makeSchedule`, marcador desde los
   registros del Scouting, simulación estadística por tipo de robot calibrada con 20 matches de la
   física, ranking D18, selección D19, PlayOffs D20 y la doble eliminación de rebuilt-sim como
   opción); pantalla `ui/TournamentScreen.ts`, guardado en localStorage (`labbot.tournament.v1`).
   Los matches propios se juegan por el camino del Scouting (`ScoutPlay.tour`); los de otros se ven
   con la IA en los 4 robots o se omiten.
10. **Entrenamiento por retos** (pedido después) — ejercicios guiados con medalla y récord personal.
   *Hecho:* `core/training.ts` (7 retos, cortes de medalla SUPUESTOS, ritmo por tipo de robot,
   récords por reto y robot), `game/drills.ts` (acomodo y cuenta en la física con `GameSession.tap`;
   la sesión ahora también avisa las Muestras anotadas en práctica, con 0 puntos), `game/trainingStore.ts`
   (localStorage `labbot.training.v1`) y `ui/Training.ts` (lista de retos y panel sobre la cancha).
   Tabla de retos y supuestos en el README.

Cada hito: `npm test`, `npm run build` y captura con Playwright; resumen corto al terminar.

## 5. Decisiones que necesito antes del Hito 3
Las dudas D1–D12 de `docs/reglas-reto.md`. Puedo avanzar H1 y H2 con los supuestos marcados;
las más urgentes son **D1** (línea de autónomo), **D4** (cuándo cuenta una muestra) y **D5**
(qué es estar sobre la Plataforma).

## 6. Cambio del 27-oct: solo el Pivote
Por pedido de Xhavi se quitaron los demás robots (genérico, elevador, torre, chasis y pivote con
hopper): quedan el **Pivote** y su variante **Pivote 180°** (`config/robot.ts`), que recoge atrás y
voltea el brazo por arriba para anotar al frente en N1–N3 sin girar el chasis (`arm.pickBack`,
`posAngle`, `posDir`); la IA llega de frente a la Cámara y de reversa a la Muestra y a la Crítica
(`Bot.pickDir`, `Bot.critDir`). Hasta el 29-oct estaba al revés (recogía al frente y anotaba atrás);
Xhavi pidió voltearlo para que al avanzar el frente sea el lado donde se acomoda para anotar. Los
robots propios guardados antes con el eje detrás del centro se abren con el eje adelante.
Lo que arriba dice "intake/elevador/depósito" hoy es el brazo con garra (`game/Mechanisms.ts`). Los
datos guardados de tipos quitados se abren como Pivote. (Un primer cambio dejó por error el Pivote
con hopper; se corrigió el mismo día.)
Antes de cada match, **Preparar match** (`ui/MatchSetup.ts`) elige tu posición de inicio (D31,
`config/startSpot.ts`) y, por robot de la IA, tipo, estrategia (`ai/strategy.ts`), dificultad y AUTO.

## 7. Realismo (pedido del 29-oct)
Xhavi: "que todas las partes del robot tengan hitbox, se me hace extremadamente fácil recoger las
muestras… agrega las fallas… pon las paredes… quita que puedan cometer ese faul hasta que
completamente estemos fuera de la cancha".
*Hecho:* pared perimetral de 508 mm (guardrail FRC, SUPUESTO D35, `fieldLayout.wallsRed`); hitbox
del brazo, la garra y la pieza agarrada (`RobotPhysics.setArmPose`, grupo `GROUPS.arm`, D34); agarre
realista con alineación, cierre y resbalones (`Mechanisms.runClaw`, `GRIP`, D36) y la IA llegando
derecho a cada Muestra (`Bot.driveToPiece`); fallas por golpes y al azar (`core/damage.ts` puro,
`game/Damage.ts` en la física, tarjeta del HUD y LEDs del robot); fuera de la cancha solo con todo el
robot fuera (`fullyOutOfField`, D33). Ajustes → Realismo. Pruebas en `tests/realism.test.ts`.
Con el agarre realista la IA anota ≈12.5 Muestras por alianza (antes ≈15, `npm run batch -- --set ai`).

**30-oct (Xhavi):** "nomás no agarra aunque esté alineado… nuestro robot va a tener compliants" y "que
se use el mismo botón para pieza normal que para crítica". El agarre por defecto es ahora **con
compliants** (`COMPLIANT` en `game/Mechanisms.ts`, D37): agarra de cualquier ángulo con la garra abajo,
de la placa hasta 3 cm delante de la punta de los dedos, con que toque la rueda de un dedo (antes la
Muestra tenía que llegar hasta la placa, así que pegada a una Cámara o a la pared no se dejaba). El
estricto queda como "Preciso". Garra (Espacio/A) toma la Crítica si está al alcance y si no
prende/apaga la garra; Soltar (E/B) suelta lo que traiga.
