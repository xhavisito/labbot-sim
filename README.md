# LabBot Rescue Sim

Simulador 3D web del reto interno **LabBot Rescue 2026** (Robotics WinterFest, LamBot 3478).
Cancha, piezas, robots tanque, reloj, puntuación, faltas y Ranking Points según el manual del reto.

- **Reglas:** [`docs/reglas-reto.md`](docs/reglas-reto.md) resume el manual con la sección de cada
  regla (§x.y), las medidas tomadas de las figuras y la lista de dudas y supuestos (D1–D16).
- **Plan y arquitectura:** [`docs/PLAN.md`](docs/PLAN.md).

## Instalar y correr

Requiere Node 22 o más nuevo.

```bash
npm install          # el .npmrc usa legacy-peer-deps (evita un error de npm 10 con vitest)
npm run dev          # servidor de desarrollo en http://localhost:5173
npm test             # pruebas unitarias y de física (Vitest)
npm run build        # revisa tipos y genera el sitio estático en dist/
npm run preview      # sirve dist/
npm run batch        # matches de solo IA entre estrategias de alianza (sin navegador): tabla de puntos, RP y faltas
                     #   --plans torre+torre,n3+n3  --vs n3+n3  --seeds 3  --workers 4  --out batch.json
npm run shots        # capturas con Playwright en shots/ (requiere build; en la nube: CHROMIUM_PATH=/opt/pw-browsers/chromium; --mobile = celular)
```

El build es estático (`base: './'`), así que funciona en cualquier hosting. **En línea:**
<https://xhavisito.github.io/labbot-sim/>. Lo publica `.github/workflows/deploy.yml` cada vez que algo
entra a `main` (pruebas, build y copia de `dist/` a la rama `gh-pages`).

## Cómo se juega

En el menú eliges tu robot (Rojo 1–2, Azul 1–2) y el modo:

- **Jugar match:** 150 s con reloj. En el AUTO (15 s) los robots corren su rutina preprogramada
  (por defecto, salen de su Zona de Inicio). En el TELEOP (135 s) manejas tu robot, y en el ENDGAME
  (últimos 30 s) se habilitan la Plataforma y la Muestra Crítica. Al final verás el desglose de
  puntos, RP y faltas.
- **Práctica libre:** sin reloj ni faltas; el marcador cuenta las Muestras anotadas.
  Backspace reacomoda la cancha.
- **Tipo de robot** (en el menú, y el de los demás robots en Ajustes):
  - *Genérico:* intake al frente, tolva de 5 y elevador con depósito que suelta al frente.
  - *Elevador:* intake al frente, tolva de 5 y una plataforma que sube y empuja las Muestras por
    atrás (30 cm detrás del chasis). Se anota de reversa: espalda contra la pared de la Cámara.
  - *Pivote* (sugerencia de CAD en MDF): chasis 60×60 cm, brazo de 50 cm con pivote a 44 cm.
    Empieza guardado con la precarga; con el brazo en el piso (tecla 0) y la intake encendida agarra
    una Muestra y la suelta al frente en N1–N3. Lleva una sola pieza (Muestra o Crítica).
  - *Torre* (sugerencia de CAD en MDF): torre fija de ruedas, sin carro que suba. Guarda hasta 5
    Muestras y las saca atrás a 83 cm (altura del N3), de reversa como el Elevador; la Crítica va en
    una pala al frente (teclas 0–4 la mueven).
  - *Chasis* (base común de las sugerencias en MDF, mínimo viable): tanque de 60×60 cm sin mecanismo
    para anotar. Lleva la precarga sin soltarla, cruza la línea en AUTO (5) y sube a la Plataforma
    (10 o 20). Con IA espera junto a su rampa y sube en el ENDGAME.
  Todos cumplen §7.2 (65×65 cm, ≤40 cm fuera del chasis, ≤100 cm de alto) y el pivote cabe guardado
  al inicio (§4.1); lo revisa `validateRobot`. El elevador se descartó para construir en MDF.
  - *Inspirados en FIRST* (`src/config/firstRobots.ts`): 8 robots de referencia de los juegos más
    parecidos, con todas sus variables (medidas, masa, velocidad, intake, capacidad, brazo o
    elevador, nivel máximo) y la estrategia de IA que les funcionó: 118 Everybot 2018 y 2023,
    254 Lockdown (2018), 5940 Baguette (2018), 254 Breakdown (2023), 401 (2023), 2713 Rainbow Dash
    (2023) y 254 Skyfire (2012). Están **adaptados** a LabBot (tanque, 65×65 cm, 40 cm, 100 cm,
    §7.2); lo que no viene de la fuente del equipo está marcado SUPUESTO. Se eligen en el menú o en
    Ajustes; al elegir uno, la velocidad y la capacidad toman las suyas. `npm run batch -- --plans
    lockdown254+lockdown254 --vs n3+n3` los pone a jugar.
- **Ajustes:** IA de los otros 3 robots (encendida por defecto), rutina de AUTO de tu robot y de los
  demás (salir de la zona, anotar precarga, anotar y recolectar, quedarse quieto), velocidad y
  capacidad de tu robot, y el Human Player automático. Se guardan en el navegador. Los puntos y
  tiempos no se cambian aquí: son los del manual, en `src/config/game.ts`.
- **Registro del match:** en la pantalla de resultados, "Descargar registro (JSON)" baja el desglose,
  RP, cada Muestra (nivel y periodo), las faltas con su sección del manual y los eventos con su tiempo.

### Controles

Teclado, control (mapeo estándar del navegador: Xbox, PlayStation y la mayoría por USB o Bluetooth)
y touch. **Menú → Controles** (o en la pausa) reasigna cada acción: toca la casilla y presiona la
tecla o el botón. Cada tecla o botón hace una sola cosa (si ya estaba en otra acción, se mueve), hay
hasta 2 por acción y se guarda en el navegador. Ahí también eliges manejar con un stick o con los dos
(izquierdo avanza, derecho gira), invertir el avance y cuándo mostrar los controles touch.

Asignación por defecto:

| Acción | Teclado | Control |
|---|---|---|
| Avanzar / retroceder | W / S (o flechas) | Stick izquierdo ↕ |
| Girar | A / D (o flechas) | Stick izquierdo ↔ (o derecho) |
| Modo lento | Shift | LT |
| Intake (encender/apagar) | Espacio | A |
| Elevador: abajo, N1, N2, N3, Repisa | 0, 1, 2, 3, 4 | — |
| Subir / bajar elevador | — | RB / LB (o cruceta ↕) |
| Soltar Muestra | E | B |
| Tomar Muestra Crítica | F | X |
| Soltar Muestra Crítica | R | Y |
| Cambiar cámara | C | Back |
| Pausa | Esc | Start |

**Touch:** en celular o tableta aparecen un joystick (izquierda) y botones (derecha): intake, soltar,
subir/bajar elevador y la Crítica, más cámara y pausa arriba. `?touch=1` los fuerza en escritorio.

**Para anotar:** acércate de frente a la pared de tu Cámara de Seguridad, sube el elevador al nivel y
suelta la Muestra; cuenta cuando cae dentro del nivel. **Para la Muestra Crítica**, en el ENDGAME
ponte de frente a la rendija de tu Campana con el elevador en "Repisa" y presiona F; luego sube a la
Plataforma y suéltala sobre la Repisa (R).

## Estructura

```
src/
  config/     field.ts (medidas de la cancha, §3), fieldLayout.ts (sólidos para física y render),
              game.ts (tiempos, puntos, faltas y RP, §4.4–§4.6), robot.ts (límites §7.2),
              settings.ts (ajustes del usuario)
  core/       lógica pura y probada: clock.ts, match.ts (puntuación y RP), fouls.ts, matchLog.ts, types.ts
  physics/    Rapier: PhysicsWorld, FieldColliders, Pieces (pool de Muestras), RobotPhysics (tanque)
  game/       GameSession (une todo), Robot, Mechanisms, Sensors (anotación), HumanPlayer
  referee/    Referee.ts: faltas automáticas
  auto/       rutinas de AUTO
  ai/         Bot.ts: IA de los robots (recolectar → anotar → Plataforma o Muestra Crítica en el ENDGAME;
              papeles: anotar, solo chasis, bloquear; fuente: Laboratorio, Human Player o ambos)
  sim/        batch.ts: estrategias de alianza y matches de solo IA sin render (npm run batch)
  render/     Three.js: Renderer, FieldView, PieceView, RobotView, CameraRig
  input/      teclado, gamepad y touch; bindings.ts (asignación reasignable)
  ui/         i18n (es-MX / en), HUD, menús, resultados, Controles y TouchControls
tests/        field, physics, robot, match (reglas y casos borde), session (match completo),
              bot (IA en un match completo, sin faltas de cancha), settings (ajustes y registro)
```

Todos los parámetros del juego viven en `src/config/`; si el manual cambia, se ajustan ahí.
Cada regla en el código cita su sección del manual.

## Limitaciones conocidas

- Varias posiciones (Zonas de Inicio, Laboratorio, Plataforma, Repisa) se midieron sobre la figura de
  §3.2 (error ≈ ±30 mm). El CAD oficial de la cancha (§3.3) daría las medidas exactas.
- Supuestos marcados en `docs/reglas-reto.md`: zonas de color de cada alianza (D8), frecuencia de faltas por contacto (D11, D15), entre otros.
- La IA es sencilla: va por la Muestra libre más cercana, anota en el Nivel 3 (o el nivel libre),
  y en el ENDGAME sube a la Plataforma. No toma la Muestra Crítica ni defiende, y a veces choca con
  rivales (Fouls por contacto, §4.5).
- El Human Player es automático (una Muestra cada 3 s si la ranura está libre).
- No se simulan las faltas de conducta, seguridad o del Human Player humano (no se pueden detectar).
- La intake, el brazo y la plataforma no chocan con la cancha (solo mueven piezas); no hay editor de
  robots: los cuatro tipos son presets en `src/config/robot.ts` con medidas SUPUESTAS.
- Al pasar por la vertical, el brazo del pivote con una Muestra llega a ~109 cm; el manual no aclara
  si los 100 cm aplican con mecanismos en movimiento (§7.2) y la simulación no lo cobra.
