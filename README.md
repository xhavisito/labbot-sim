# LabBot Rescue Sim

Simulador 3D web del reto interno **LabBot Rescue 2026** (Robotics WinterFest, LamBot 3478).
Cancha, piezas, robots tanque, reloj, puntuación, faltas y Ranking Points según el manual del reto.

- **Reglas:** [`docs/reglas-reto.md`](docs/reglas-reto.md) resume el manual con la sección de cada
  regla (§x.y), las medidas tomadas de las figuras y la lista de dudas y supuestos (D1–D36).
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
                     #   --plans pivcrit3+pivn3  --vs pivn3+p180n3  --seeds 3  --workers 4  --out batch.json
                     #   --set mech: el pivote y su variante de 180°, con puntos por robot
                     #   --set ai --a hard --b normal: una dificultad contra otra, alianzas de los dos tipos
npm run shots        # capturas con Playwright en shots/ (requiere build; en la nube: CHROMIUM_PATH=/opt/pw-browsers/chromium; --mobile = celular)
```

El build es estático (`base: './'`), así que funciona en cualquier hosting. **En línea:**
<https://xhavisito.github.io/labbot-sim/>. Lo publica `.github/workflows/deploy.yml` cada vez que algo
entra a `main` (pruebas, build y copia de `dist/` a la rama `gh-pages`).

**Sin conexión / instalable (PWA):** después de la primera visita todo queda en caché (`sw.js`, lo
genera `vite.config.ts` con la lista del build) y el simulador abre y juega sin internet; el menú
muestra "Sin conexión" cuando ya está listo. Para instalarlo en el celular: en Android, el botón
**Instalar** del menú (o "Agregar a la pantalla principal" de Chrome); en iPhone, Safari → Compartir →
**Agregar a inicio**. Cada build nuevo cambia la versión de la caché: la app se actualiza sola al
abrirla con conexión (los cambios se ven la siguiente vez que se abre). Íconos: `public/icons/`
(`node scripts/icons.mjs` los regenera desde `icon.svg`).

## Cómo se juega

**Realismo** (Ajustes → Realismo, pedido del equipo el 29-oct; detalles y números en D33–D36 de
`docs/reglas-reto.md`):
- **Pared perimetral** baja alrededor de la cancha: 508 mm (20 in) como el guardrail de FRC
  (SUPUESTO: el manual no tiene paredes). Choca con robots y piezas.
- **Hitbox de todo el robot:** el brazo, la garra y la pieza que llevas chocan con los otros robots
  (cuenta como contacto para las faltas), las piezas y la pared.
- **Agarre realista:** la Muestra tiene que entrar derecha (≲18°) entre los dedos de la garra y
  despacio; la garra tarda en cerrar y la Muestra se puede resbalar. "Fácil" deja el agarre de antes.
- **Fallas:** un golpe fuerte contra la pared u otro robot puede atascar la garra, alentar el brazo,
  debilitar un motor (más lento y jala de lado) o cortar la comunicación unos segundos; también puede
  tirar la pieza. Se ven en la tarjeta de tu robot y en sus LEDs (ámbar parpadeando). Se eligen el
  nivel (No/Pocas/Normal/Muchas), si les pasa a todos o solo a tu robot, y fallas al azar.
  Reacomodar la cancha (Backspace) lo repara.
- **Salir de la cancha** (Tech Foul, §4.6) solo cuenta con todo el robot fuera.

**Editor de robot** (menú → Taller): arma tu robot con medidas del chasis, tracción (motor, cantidad,
reducción, rueda), mecanismo (tipo de pivote, posición del eje y largo del brazo, velocidad, nivel máximo), motores de
mecanismos y materiales (área de MDF de 5.5 mm, PLA, otros, o la masa de báscula). Calcula masa
estimada por partes, velocidad (velocidad libre del motor ÷ reducción × circunferencia × 0.8) y
aceleración, y revisa las reglas de construcción: chasis ≤ 65 × 65 cm, ≤ 100 cm con el brazo (§7.2),
motores (§7.3), PLA ≤ 150 g (§7.1.1); la masa solo se informa (no hay límite de peso, §7.2).
**Comparar score** juega matches de solo IA de dos robots tuyos contra una alianza rival y lo mismo
con un robot de referencia. Se guarda en el navegador y aparece en la lista de robots junto a los
presets. Datos de motores: hojas de datos (CIM, Kraken X60/X44, NEO); masas de piezas
y densidad del MDF: SUPUESTOS (`src/config/customRobots.ts`).

**Repeticiones y estadísticas:** cada match terminado se graba (15 cuadros por segundo) y se guarda
en el navegador (las últimas 12; las de ★ se conservan). En los resultados, o en el menú →
**Repeticiones**, puedes verlo otra vez (play/pausa, 0.25×–4×, saltar con la línea de tiempo o ←/→,
cámara siguiendo a cualquier robot) y abrir sus **Estadísticas**: mapa de calor de cada robot,
Muestras anotadas por robot y nivel con sus puntos (§4.4), tiempos de ciclo (definición del sim:
Muestras a menos de 2.5 s son un ciclo; solo TELEOP), distancia y velocidad. Se descargan como
`.lbreplay` (≈ 80 KB) para abrirlas en otro equipo.

**Práctica de AUTO** (menú → Taller): solo tu robot en su Zona de Inicio con la precarga y sin Human
Player. **Grabar 15 s** guarda lo que haces con los controles en cada paso de física; luego la ruta
se **repite** igual (también desde una pose movida unos cm o grados) y se califica con los puntos de
AUTO (§4.4: Línea de Autónomo y Muestras por nivel). Avisa si cruzas la línea central (§4.2; D7,
SUPUESTO Foul) o si la pose movida ya no cabe en la Zona de Inicio (§4.1). **Probar variaciones**
corre la ruta sin dibujar desde N poses al azar (± cm, ± °) y dice cuántas dan los mismos puntos y
cuánto se desvía la pose final. **Guardar** la deja en Ajustes → AUTO de tu robot para el match.
Ojo: repite tus controles, así que con otro robot u otra Zona de Inicio termina en otro lugar.

**Entrenamiento por retos** (menú → Taller): ejercicios cortos con tu robot solo en la cancha, con
medalla (bronce, plata, oro) y récord personal por robot guardados en el navegador. Cada reto tiene
instrucciones, cuenta de 3 s, el avance en vivo y el resultado (con lo que falta para la siguiente
medalla); Enter lo repite y Backspace lo reinicia.

| Reto | Meta | Límite | Oro · Plata · Bronce | Manual |
|---|---|---|---|---|
| Línea de autónomo | Salir por completo de la Zona de Inicio | 15 s (AUTO) | ≤ 1 · 1.6 · 3 s | §4.4, D1 |
| Anotar en N3 | 5 Muestras en el Nivel 3 | 120 s | ≤ 35 · 55 · 120 s | §3.2.3, §4.4 |
| Muestra Crítica | De la rendija de la Campana a la Repisa (se queda 0.5 s) | 30 s (ENDGAME) | ≤ 11 · 17 · 30 s | §3.2.4, §3.2.5, §4.3.1 |
| Plataforma a tiempo | Desde la Cámara, subir y quedarse 1 s | 10 s | ≤ 4.5 · 6 · 10 s | §4.4, D5 |
| ENDGAME completo | Puntos en 30 s (Plataforma y Crítica al sonar la bocina) | 30 s | ≥ 40 · 25 · 10 pts | §4.3.1, §4.4 |
| Ciclos de 60 s | Puntos de Muestras con valores de TELEOP | 60 s | ≥ 105 · 60 · 30 pts | §4.4 |
| Dominio de Cámara | 10 Muestras en tu Cámara | 135 s (TELEOP) | ≤ 50 · 75 · 135 s | §4.4 |

Los puntos son los del manual (TELEOP; la línea, los de AUTO). **SUPUESTOS del simulador:** los
límites, los cortes de cada medalla (calibrados con la física: una ruta con script de un robot de referencia hace
la línea en 0.6 s, la Plataforma en 3.0 s y la Crítica en 7.1 s, y la IA difícil anota 5 en N3 a los
≈28 s del TELEOP), la salida "frente a la Cámara" del reto de Plataforma, los tiempos que la pieza o
el robot tienen que quedarse para contar, y el ritmo del pivote en los retos de Muestras
(×1.5 para los dos tipos: más tiempo o menos puntos para la misma medalla). En la práctica no hay faltas: en el match, tomar la Crítica o subir a la Plataforma
antes del ENDGAME es Tech Foul (§4.6).

En el menú eliges tu robot (Rojo 1–2, Azul 1–2) y el modo:

- **Jugar match:** primero la pantalla **Preparar match**: eliges dónde arranca tu robot (arrastrándolo
  en el mapa de tu Zona de Inicio y con el giro; solo deja lugares donde el chasis completo queda
  dentro de la zona, §3.2.1 y §4.1) y, para cada robot de la IA, su tipo, su **estrategia** (automática,
  N3, N2, N1, va por la Muestra Crítica, atiende al Human Player, solo del Laboratorio, sin ENDGAME o
  solo línea y Plataforma), su **dificultad** (Fácil, Normal o Difícil, o todas de un jalón) y su
  rutina de AUTO. Se recuerda para el siguiente match. En el AUTO (15 s) los robots corren su rutina preprogramada. En el TELEOP (135 s) manejas tu robot, y en el ENDGAME
  (últimos 30 s) se habilitan la Plataforma y la Muestra Crítica. Al final verás el desglose de
  puntos, RP y faltas.
- **Scouting** (en el menú): equipos del reto y su tipo de robot; formato del torneo (SUPUESTO,
  configurable: el manual no lo define) y calendario de clasificación, donde cada match se puede
  simular con la IA, jugar tú o capturar a mano viendo uno real; tabla por equipo (puntos, N3,
  Plataforma, Crítica, faltas, constancia, RP) y alianzas sugeridas con el mejor compañero, el reparto
  de papeles y el pronóstico de eliminatorias. Se guarda en el navegador; exporta JSON y CSV.
- **Torneo** (en el menú, como el de rebuilt-sim): los equipos del Scouting juegan Qualifications
  2 vs 2; tu equipo juega en el simulador con tu robot y los matches de los demás se ven (transmisión
  o gradas) u omiten (simulación estadística calibrada con la física). Ranking general y por
  categoría, selección de alianzas por invitación (§8.2.1: el Rank 1 no puede elegir al Rank 2; cada
  equipo acepta o rechaza) y PlayOffs del manual (§8.2.2: todos contra todos a 2 de 3 y final a 2 de
  3) o, opcional, la doble eliminación de rebuilt-sim. Se guarda en el navegador y sus registros se
  pueden pasar al Scouting.
- **Práctica libre:** sin reloj ni faltas; el marcador cuenta las Muestras anotadas.
  Backspace reacomoda la cancha.
- **Tipo de robot** (en el menú; solo hay dos y los dos son el **Pivote**; con "Al azar" la IA usa
  los dos):
  - *Pivote* (sugerencia de CAD en MDF): chasis 60×60 cm, brazo de 50 cm con garra y eje a 44 cm.
    Empieza guardado con la precarga; con el brazo en el piso (tecla 0) y la garra encendida agarra
    una Muestra y la suelta al frente en N1–N3. Lleva una sola pieza (Muestra o Crítica).
  - *Pivote 180°* (estilo Jack in the Bot 2025): recoge **atrás** y anota al frente sin girar el
    chasis (volteado el 29-oct: al avanzar, el frente es el lado donde se acomoda para anotar). Eje
    bajo (17 cm) y 15 cm delante del centro, brazo de 71 cm: agarra del piso atrás (de reversa),
    voltea por arriba y suelta delante del robot en N1–N3 (desde 78/78/82 cm). Llega a la Cámara de
    frente. La Crítica (posición 4, 60 cm) y la Repisa van atrás, del lado de la garra. Al voltear con una
    Muestra la punta llega a ~103 cm: excede 100 cm solo durante el giro (SUPUESTO D24, a confirmar
    con los jueces). En simulación (`--set mech`, 3 semillas) rinde parecido al Pivote: 235 vs 228
    puntos por alianza con dos iguales y más en AUTO (61 vs 53).
  Los dos cumplen §7.2 (65×65 cm, ≤40 cm fuera del chasis, ≤100 cm de alto guardados con la precarga)
  y caben guardados al inicio (§4.1); lo revisa `validateRobot`. Los robots guardados de tipos que se
  quitaron (genérico, elevador, torre, chasis, pivote con hopper) se abren como Pivote con su chasis.
  Con la IA difícil (`npm run batch -- --set mech`, 27-oct) los dos juegan parejo: una alianza de
  pivotes hace ≈210–240 puntos y 12–14 Muestras por match; sin ENDGAME pierde ≈1.5 RP.
- **Ajustes:** IA de los otros 3 robots (encendida por defecto; su dificultad, estrategia y rutina de
  AUTO se eligen en Preparar match), rutina de AUTO de tu robot, velocidad y
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
| Garra (encender/apagar) | Espacio | A |
| Brazo: piso, N1, N2, N3, Repisa | 0, 1, 2, 3, 4 | — |
| Subir / bajar brazo | — | RB / LB (o cruceta ↕) |
| Soltar Muestra | E | B |
| Tomar Muestra Crítica | F | X |
| Soltar Muestra Crítica | R | Y |
| Cambiar cámara | C | Back |
| Pausa | Esc | Start |

**Touch:** en celular o tableta aparecen un joystick (izquierda) y botones (derecha): garra, soltar,
subir/bajar el brazo y la Crítica, más cámara y pausa arriba. `?touch=1` los fuerza en escritorio.

**Para anotar:** acércate de frente a la pared de tu Cámara de Seguridad, sube el brazo al nivel y
suelta la Muestra; cuenta cuando cae dentro del nivel. **Para la Muestra Crítica**, en el ENDGAME
ponte de frente a la rendija de tu Campana con el brazo en "Repisa" y presiona F; luego sube a la
Plataforma y suéltala sobre la Repisa (R).

## Estructura

```
src/
  config/     field.ts (medidas de la cancha, §3), fieldLayout.ts (sólidos para física y render),
              game.ts (tiempos, puntos, faltas y RP, §4.4–§4.6), robot.ts (límites §7.2),
              settings.ts (ajustes del usuario), customRobots.ts (robots del editor: masa con MDF,
              velocidad por reducción y revisión de §7.1–§7.3)
  core/       lógica pura y probada: clock.ts, match.ts (puntuación y RP), fouls.ts, matchLog.ts, types.ts,
              scouting.ts (registro por robot, resumen por equipo, predicción de alianzas),
              tournament.ts (calendario, selección de alianzas y eliminatorias; formato SUPUESTO)
              training.ts (retos del entrenamiento: medallas y récords)
  physics/    Rapier: PhysicsWorld, FieldColliders, Pieces (pool de Muestras), RobotPhysics (tanque)
  game/       GameSession (une todo), Robot, Mechanisms, Sensors (anotación), HumanPlayer
              drills.ts (cuenta de cada reto en la física) y trainingStore.ts (récords, localStorage)
  referee/    Referee.ts: faltas automáticas
  auto/       rutinas de AUTO; recorded.ts (rutas grabadas, localStorage); practice.ts (calificar
              15 s de AUTO y probar poses iniciales desplazadas)
  ai/         Bot.ts: IA de los robots (recolectar → anotar → Plataforma o Muestra Crítica en el ENDGAME;
              papeles: anotar, solo chasis, bloquear; fuente: Laboratorio, Human Player o ambos);
              Team.ts: reparto de papeles en la alianza; difficulty.ts: Fácil/Normal/Difícil;
              lineup.ts: tipos de robot distintos para la IA en cada match
  sim/        compare.ts: comparación de score del editor (matches de IA por partes, sin congelar la UI)
  sim/        batch.ts: estrategias de alianza y matches de solo IA sin render (npm run batch);
              legacyBot.ts: la IA anterior, solo para compararla (--set ai --b old);
              quickSim.ts: simular un match del calendario del Scouting en el navegador
  render/     Three.js: Renderer, FieldView, PieceView, RobotView, CameraRig
  input/      teclado, gamepad y touch; bindings.ts (asignación reasignable)
  ui/         i18n (es-MX / en), HUD, menús, resultados, Controles y TouchControls
  replay/     format.ts (repetición en binario compacto), Recorder.ts (graba cada match, cuelga de
              GameSession.tap), ReplayPlayer.ts (sesión "títere" que pone las poses grabadas),
              stats.ts (mapa de calor, Muestras por robot y tiempos de ciclo) y store.ts (IndexedDB, .lbreplay)
  pwa/        register.ts (service worker, botón Instalar) y sw-template.js (precache del build)
tests/        field, physics, robot, match (reglas y casos borde), session (match completo),
              bot (IA en un match completo, sin faltas de cancha), settings (ajustes y registro),
              lineup (tipos de la IA y niveles de dificultad)
```

Todos los parámetros del juego viven en `src/config/`; si el manual cambia, se ajustan ahí.
Cada regla en el código cita su sección del manual.

## Limitaciones conocidas

- Varias posiciones (Zonas de Inicio, Laboratorio, Plataforma, Repisa) se midieron sobre la figura de
  §3.2 (error ≈ ±30 mm). El CAD oficial de la cancha (§3.3) daría las medidas exactas.
- Supuestos marcados en `docs/reglas-reto.md`: zonas de color de cada alianza (D8), frecuencia de faltas por contacto (D11, D15), entre otros.
- La IA calcula sus tiempos (anota antes de que acabe el AUTO, deja lo justo para el ENDGAME), junta
  varias Muestras por viaje, anota en el Nivel 3 y se reparte con su compañero las Muestras, el Human
  Player, el frente de la Cámara y la Muestra Crítica (uno la lleva a la Repisa, el otro sube a la
  Plataforma). No defiende (§6.1: "no hay defensa") y evita el contacto con rivales (§4.5). Aún
  pierde tiempo cuando un robot quieto le tapa el frente de la Cámara.
- El Human Player es automático (una Muestra cada 3 s si la ranura está libre).
- No se simulan las faltas de conducta, seguridad o del Human Player humano (no se pueden detectar).
- El brazo y la garra chocan con otros robots, las piezas y la pared perimetral, pero no con las
  estructuras del juego (Cámara, Campana, Plataforma, Repisa; D34). Los tipos son presets
  en `src/config/robot.ts` con medidas SUPUESTAS; el editor de robot (`config/customRobots.ts`) cambia
  medidas, masa, tracción y mecanismo, pero no la geometría de cada tipo.
- Al pasar por la vertical, el brazo del pivote con una Muestra llega a ~109 cm; el manual no aclara
  si los 100 cm aplican con mecanismos en movimiento (§7.2) y la simulación no lo cobra.
